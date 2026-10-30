// File de jobs en base : jobs IA simultanés (plafond global), plafond par utilisateur selon son offre (multi jobs), tourniquet entre utilisateurs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { now } from '../db.js';
import { modelLabel } from './models.js';
import { HttpError } from '../http.js';
import { AI_JOBS } from './budget.js';
import { getUser } from '../users.js';
import { aiRefusal, assertCanRunAi } from '../claudelink.js';
import { loadRatio } from './load.js';
import { LOAD } from '../limits.js';
import { createJobLog } from './joblog.js';
import { assertRoom, recordUsage, withUserLock, MAIL_JOBS } from './plans.js';
import { sendPause, pauseMessage } from './abuse.js';

// Job en cours d'exécution, retrouvé par le wrapper claude() : c'est lui qui dit quel modèle a réellement servi (affiché dans l'avancement et le résultat)
export const jobContext = new AsyncLocalStorage();

/**
 * Met un job en file pour un utilisateur. Point de passage obligé de toutes les routes et tâches de fond :
 *  - le projet doit appartenir à l'utilisateur (sinon 404) ;
 *  - un compte suspendu ne met rien en file ;
 *  - un job IA exige une liaison Claude valide de CET utilisateur.
 * Sans projet, `userId` est obligatoire. `opts.cliModeEnabled` : drapeau CLAUDE_CLI_MODE_ENABLED (vrai par défaut).
 */
export async function enqueue(db, { userId, projectId, type, params = {}, runAfter = null }, opts = {}) {
  if (projectId != null) {
    const owner = await db.prepare('SELECT user_id FROM projects WHERE id = ?').get(projectId);
    if (!owner || (userId != null && Number(owner.user_id) !== Number(userId))) throw new HttpError(404, 'Projet introuvable');
    userId = Number(owner.user_id);
  }
  const user = userId == null ? null : await getUser(db, userId);
  if (!user) throw new Error('enqueue : utilisateur requis');
  if (user.status !== 'active') throw new HttpError(403, 'Compte suspendu');
  if (AI_JOBS.has(type)) await assertCanRunAi(db, user.id, opts);
  // Pause d'envoi (trop de rejets) : refus explicite et immédiat, jamais silencieux
  if (MAIL_JOBS.has(type)) {
    const pause = await sendPause(db, user.id);
    if (pause) throw new HttpError(403, pauseMessage(pause), { expose: true, code: 'send_paused' });
  }
  // Deux écritures de la même condition : "= ?" ne marche pas avec NULL, et "IS ?" n'existe pas en MySQL
  const running = projectId == null
    ? await db.prepare("SELECT id FROM jobs WHERE user_id = ? AND project_id IS NULL AND type = ? AND status IN ('queued','running')").get(user.id, type)
    : await db.prepare("SELECT id FROM jobs WHERE project_id = ? AND type = ? AND status IN ('queued','running')").get(projectId, type);
  if (running) return { id: running.id, existing: true };
  // Plafonds du plan : compter puis écrire dans la même section critique (deux requêtes simultanées ne passent pas toutes deux)
  return withUserLock(user.id, async () => {
    if (AI_JOBS.has(type)) await assertRoom(db, user, 'aiJobs');
    if (MAIL_JOBS.has(type)) {
      await assertRoom(db, user, 'mails');
    }
    const r = await db.prepare('INSERT INTO jobs(user_id, project_id, type, params_json, created_at, run_after) VALUES(?, ?, ?, ?, ?, ?)')
      .run(user.id, projectId ?? null, type, JSON.stringify(params), now(), runAfter);
    const id = Number(r.lastInsertRowid);
    if (AI_JOBS.has(type)) await recordUsage(db, user.id, 'ai_job', { ref: id });
    return { id, existing: false };
  });
}

/**
 * Un job peut-il s'exécuter ? Renvoie la raison du refus, ou null. Revérifié par le worker à chaque
 * exécution (la file peut contenir un job mis en attente avant une suspension, un changement de rôle ou une déliaison).
 */
export async function jobRefusal(db, job, opts = {}) {
  const user = await getUser(db, job.user_id);
  if (!user) return 'Compte supprimé';
  if (user.status !== 'active') return 'Compte suspendu';
  if (AI_JOBS.has(job.type)) return aiRefusal(db, job.user_id, opts);
  return null;
}

export async function setProgress(db, jobId, progress) {
  await db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(JSON.stringify(progress), jobId);
}

/** Annule un job de l'utilisateur ; un job d'un autre compte est introuvable. */
export async function cancelJob(db, userId, jobId) {
  const r = await db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued','running')")
    .run(now(), jobId, userId);
  if (!r.changes && !(await db.prepare('SELECT 1 FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId))) throw new HttpError(404, 'Job introuvable');
}

/** Derniers jobs d'un projet (le projet doit déjà avoir été vérifié comme appartenant à l'utilisateur). */
export async function latestJobs(db, projectId) {
  const rows = await db.prepare(`
    SELECT j.* FROM jobs j
    JOIN (SELECT type, MAX(id) id FROM jobs WHERE project_id = ? GROUP BY type) lj ON lj.id = j.id
  `).all(projectId);
  const out = {};
  for (const r of rows) {
    out[r.type] = {
      id: r.id, status: r.status, error: r.error,
      progress: r.progress_json ? JSON.parse(r.progress_json) : null,
      result: r.result_json ? JSON.parse(r.result_json) : null,
      createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, runAfter: r.run_after,
    };
  }
  return out;
}

/**
 * File de jobs équitable et simultanée.
 *  - aucune limite globale de jobs : seule l'offre de chaque compte compte (`maxJobs` n'existe que pour les tests) ;
 *  - par utilisateur : autant de jobs en même temps que son offre le permet (`parallel(userId)` ; 1 par défaut = un seul à la fois, comme l'offre
 *    gratuite). Les envois de mails (premiers mails, relances) ne se chevauchent jamais pour un même compte : les plafonds d'envoi se calculent au départ ;
 *  - prochain job choisi en tourniquet entre utilisateurs (le moins récemment servi d'abord), donc pas de famine ;
 *    à l'intérieur d'un utilisateur, l'ordre des jobs (par id) est conservé, y compris pour les jobs programmés la nuit ;
 *  - réservation atomique : UPDATE conditionnel dont on contrôle le nombre de lignes affectées ;
 *  - nouveaux jobs en pause quand la charge du serveur (charge/cœurs) dépasse `loadMax` ; les jobs en cours continuent.
 * Budget $ et quota du compte Claude restent évalués par utilisateur.
 */
export class Worker {
  constructor(db, handlers, {
    maxJobs = Infinity, loadMax = LOAD.defaultMax, load = loadRatio, pollMs = 3000, log = console, clock = now, onFinish, onLoad,
    budget, isAiJob, onBudget, quota, isQuotaSensitive, onQuotaHold, cliModeEnabled = true, parallel,
  } = {}) {
    this.parallel = parallel; // async (userId) => nombre de jobs simultanés permis à CET utilisateur (selon son offre) ; absent = 1
    this.cliModeEnabled = cliModeEnabled;
    this.clock = clock;
    this.maxJobs = maxJobs === Infinity ? Infinity : Math.max(1, Math.floor(Number(maxJobs)) || 1); // Infinity = pas de plafond global
    this.loadMax = loadMax;
    this.load = load;
    this.loadPaused = false;
    this.budget = budget;       // async (userId) => {blocked, reason} : budget de CET utilisateur
    this.isAiJob = isAiJob;     // (type) => bool : jobs à mettre en attente si budget ($ équivalent) atteint
    this.onBudget = onBudget;   // (reason, userId) → une notif quand le blocage commence
    this.budgetBlocked = new Set(); // utilisateurs dont les jobs IA attendent (budget)
    this.quota = quota;                     // async (userId) => {blocked, reason} : quota du compte Claude lui-même (session/semaine)
    this.isQuotaSensitive = isQuotaSensitive; // (type) => bool : jobs à reporter si le quota est serré (pas la prospection/l'envoi)
    this.onQuotaHold = onQuotaHold;          // (reason, userId) → une notif quand le report commence
    this.quotaBlocked = new Set();
    this.onFinish = onFinish;   // (job, {status, result, error}) → notifications
    this.onLoad = onLoad;       // (ratio, userId) → une fois par pause et par utilisateur en attente
    this.loadNotified = new Set();
    this.db = db;
    this.handlers = handlers;
    this.pollMs = pollMs;
    this.log = log;
    this.running = new Map();   // id du job → { job, ctrl }
    this.busyUsers = new Map(); // utilisateur → nombre de jobs réservés ou en cours (plafonné par son offre)
    this.busyMail = new Set();  // utilisateurs ayant un envoi de mails réservé ou en cours (jamais deux à la fois)
    this.claiming = 0;          // réservations en cours (pour ne jamais dépasser maxJobs, s'il est fixé)
    this.served = new Map();    // utilisateur → rang de son dernier service (tourniquet)
    this.turn = 0;
    this.stopped = false;
    this.inflight = new Set();  // jobs lancés par la boucle (attendus à l'arrêt)
    this.pending = new Set();   // callbacks de notification en vol (attendus à l'arrêt)
    this.loopDone = null;
    this.wake = null;
  }

  async start() {
    // Un job "running" au démarrage = crash/reboot pendant l'exécution
    await this.db.prepare("UPDATE jobs SET status = 'error', error = 'Interrompu (redémarrage)', finished_at = ? WHERE status = 'running'").run(now());
    this.loopDone = this.loop();
  }

  /** Arrête la boucle, interrompt TOUS les jobs en cours et les attend, ainsi que les notifications en vol. */
  async stop() {
    this.stopped = true;
    for (const { ctrl } of this.running.values()) ctrl.abort();
    this.wake?.();
    await this.loopDone;
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
    await this.idle();
  }

  /** Interrompt les jobs en cours de cet utilisateur (suppression du compte, suspension). */
  abortUser(userId) {
    for (const { job, ctrl } of this.running.values()) if (Number(job.user_id) === Number(userId)) ctrl.abort();
  }

  /** Interrompt le job IA en cours de cet utilisateur (déliaison de son accès Claude). */
  abortUserAi(userId) {
    for (const { job, ctrl } of this.running.values()) {
      if (Number(job.user_id) === Number(userId) && this.isAiJob?.(job.type)) ctrl.abort();
    }
  }

  /** Attend les callbacks (notifications) lancés par emit(). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  // Les callbacks ne doivent jamais bloquer ni faire tomber le worker : lancés sans attendre,
  // mais suivis (idle/stop les attendent) et leurs erreurs journalisées.
  emit(name, ...args) {
    let p;
    try { p = Promise.resolve(this[name]?.(...args)); }
    catch (e) { this.log.error(`[${name}]`, e.message); return; }
    const tracked = p.catch((e) => this.log.error(`[${name}]`, e.message)).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  async isCancelled(jobId) {
    return (await this.db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId))?.status === 'cancelled';
  }

  async loop() {
    while (!this.stopped) {
      try {
        for (;;) {
          const job = await this.claim();
          if (!job) break;
          this.launch(job);
        }
      } catch (e) { this.log.error('[worker]', e.message); } // base indisponible : on réessaie au prochain passage
      if (!this.stopped) {
        await new Promise((r) => { this.wake = r; setTimeout(r, this.pollMs).unref(); });
        this.wake = null;
      }
    }
  }

  launch(job) {
    const p = this.runJob(job).catch((e) => this.log.error(`[job ${job.id}]`, e.message)).finally(() => { this.inflight.delete(p); this.wake?.(); });
    this.inflight.add(p);
  }

  /** Réserve et exécute un job (jusqu'à sa fin). Renvoie false s'il n'y avait rien à lancer. Utilisé tel quel par les tests. */
  async tick() {
    const job = await this.claim();
    if (!job) return false;
    await this.runJob(job);
    return true;
  }

  /** Nombre de jobs simultanés permis à cet utilisateur (au moins 1). Une erreur de lecture de l'offre retombe sur 1 : jamais plus que prévu. */
  async capOf(userId) {
    try {
      const n = Math.floor(Number(await this.parallel?.(Number(userId))));
      return Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : 1;
    } catch { return 1; }
  }

  /**
   * Choisit le prochain job et le réserve atomiquement. Renvoie le job réservé (déjà « running » en base), ou null.
   * Sûr si appelé en parallèle : un utilisateur n'a jamais deux jobs, le nombre total reste borné.
   */
  async claim() {
    if (this.stopped || this.running.size + this.claiming >= this.maxJobs) return null;
    this.claiming++;
    try {
      const due = await this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued'
        AND (run_after IS NULL OR run_after <= ?) ORDER BY id`).all(this.clock());
      if (!due.length) return null;

      // Budget $ atteint ou quota du compte Claude serré : les jobs concernés restent en file (pas perdus), les autres
      // passent devant. Le budget met en pause TOUS les jobs IA, le quota ne retarde que les jobs non urgents.
      const hold = async (j, reason) => {
        const msg = JSON.stringify({ message: `En attente : ${reason}` });
        if (j.progress_json !== msg) await this.db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(msg, j.id);
      };
      const byUser = new Map();
      for (const j of due) {
        if (!byUser.has(j.user_id)) byUser.set(j.user_id, []);
        byUser.get(j.user_id).push(j);
      }
      const candidates = []; // un seul candidat par utilisateur : son premier job exécutable
      for (const [userId, jobs] of byUser) {
        const cap = await this.capOf(userId);
        if ((this.busyUsers.get(Number(userId)) || 0) >= cap) { // autant de jobs en cours que son offre le permet : les suivants attendent, et le disent
          const why = cap === 1
            ? "un job est déjà en cours (ton offre en fait tourner un seul à la fois ; les offres payantes en font tourner plusieurs en même temps)"
            : `${cap} jobs sont déjà en cours (ton offre en permet ${cap} à la fois)`;
          for (const j of jobs) await hold(j, why);
          continue;
        }
        let budgetReason = null, quotaReason = null, cand = null;
        for (const j of jobs) {
          if (MAIL_JOBS.has(j.type) && this.busyMail.has(Number(userId))) continue; // un seul envoi de mails à la fois pour ce compte
          // Compte suspendu ou supprimé, job IA sans liaison Claude valide : refusé sans exécution
          const refusal = await jobRefusal(this.db, j, { cliModeEnabled: this.cliModeEnabled });
          if (refusal) {
            await this.db.prepare("UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ? AND status = 'queued'").run(refusal, now(), j.id);
            continue;
          }
          const b = (await this.budget?.(j.user_id)) || { blocked: false };
          if (b.blocked && this.isAiJob?.(j.type)) { budgetReason = b.reason; await hold(j, b.reason); continue; }
          const q = (await this.quota?.(j.user_id)) || { blocked: false };
          if (q.blocked && this.isQuotaSensitive?.(j.type)) { quotaReason = q.reason; await hold(j, q.reason); continue; }
          cand = j;
          break;
        }
        if (budgetReason && !this.budgetBlocked.has(userId)) this.emit('onBudget', budgetReason, userId);
        if (budgetReason) this.budgetBlocked.add(userId); else this.budgetBlocked.delete(userId);
        if (quotaReason && !this.quotaBlocked.has(userId)) this.emit('onQuotaHold', quotaReason, userId);
        if (quotaReason) this.quotaBlocked.add(userId); else this.quotaBlocked.delete(userId);
        if (cand) candidates.push(cand);
      }
      if (!candidates.length) return null;

      // Charge du serveur : pause des NOUVEAUX jobs (hystérésis pour éviter le yo-yo)
      const ratio = await this.load();
      const limit = this.loadPaused ? this.loadMax - LOAD.resumeGap : this.loadMax;
      if (ratio >= limit) {
        this.loadPaused = true;
        for (const j of candidates) {
          await hold(j, `charge du serveur élevée (${Math.round(ratio * 100)} %)`);
          if (!this.loadNotified.has(j.user_id)) { this.loadNotified.add(j.user_id); this.emit('onLoad', ratio, j.user_id); }
        }
        return null;
      }
      this.loadPaused = false;
      this.loadNotified.clear();

      // Tourniquet : le moins récemment servi d'abord (jamais servi = en tête), puis l'ordre des jobs
      candidates.sort((a, b) => (this.served.get(a.user_id) ?? -1) - (this.served.get(b.user_id) ?? -1) || a.id - b.id);
      for (const job of candidates) {
        const cap = await this.capOf(job.user_id);
        if ((this.busyUsers.get(Number(job.user_id)) || 0) >= cap) continue; // pris entre-temps par un claim concurrent
        if (MAIL_JOBS.has(job.type) && this.busyMail.has(Number(job.user_id))) continue;
        if (!(await this.reserve(job, cap))) continue;
        // Aucun await entre la réservation en base et ces lignes : l'état en mémoire suit toujours la base
        this.busyUsers.set(Number(job.user_id), (this.busyUsers.get(Number(job.user_id)) || 0) + 1);
        if (MAIL_JOBS.has(job.type)) this.busyMail.add(Number(job.user_id));
        this.served.set(job.user_id, ++this.turn);
        return job;
      }
      return null;
    } finally { this.claiming--; }
  }

  /**
   * Passage atomique queued → running. Réussit seulement si le job est encore en file ET si son utilisateur a moins de `cap` jobs en cours
   * (la sous-requête passe par une table dérivée : MySQL interdit de lire la table qu'on met à jour). `cap` est un entier déjà borné par capOf().
   */
  async reserve(job, cap = 1) {
    const n = Math.max(1, Math.floor(Number(cap)) || 1);
    const r = await this.db.prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'
      AND (SELECT COUNT(*) FROM (SELECT id FROM jobs WHERE user_id = ? AND status = 'running' LIMIT ${n}) busy) < ${n}`)
      .run(now(), job.id, job.user_id);
    return r.changes === 1;
  }

  async runJob(job) {
    const ctrl = new AbortController();
    this.running.set(job.id, { job, ctrl });
    const journal = createJobLog(this.db, job.id);
    journal.append('status', 'Démarrage de la tâche');
    const ctx = {
      job,
      params: JSON.parse(job.params_json || '{}'),
      signal: ctrl.signal,
      // Le modèle réellement utilisé (réglage de l'utilisateur) est joint à chaque avancement : « Modèle : Sonnet » dans Activité et sur le projet
      progress: (p) => { journal.append('progress', p.message); return setProgress(this.db, job.id, ctx.model ? { ...p, model: modelLabel(ctx.model) } : p); },
      log: (kind, text) => journal.append(kind, text),
      cancelled: () => this.isCancelled(job.id),
      usage: { costUsd: 0, tokensIn: 0, tokensOut: 0 },
    };
    // Annulation depuis l'UI : on surveille la BDD (une erreur ici ne doit jamais faire tomber le process)
    const watch = setInterval(() => {
      this.isCancelled(job.id).then((c) => { if (c) ctrl.abort(); }, () => {});
    }, 2000);
    try {
      const handler = this.handlers[job.type];
      if (!handler) {
        await this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=? WHERE id=?").run(`Type inconnu : ${job.type}`, now(), job.id);
        return;
      }
      try {
        const out = await jobContext.run(ctx, () => handler(ctx));
        journal.append('status', (await this.isCancelled(job.id)) ? 'Tâche annulée' : 'Tâche terminée');
        await journal.flush();
        const result = ctx.model && out && typeof out === 'object' && !Array.isArray(out) ? { ...out, model: ctx.model } : out;
        if (!(await this.isCancelled(job.id))) {
          await this.db.prepare("UPDATE jobs SET status='done', result_json=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
            .run(JSON.stringify(result ?? null), now(), ctx.usage.costUsd, ctx.usage.tokensIn, ctx.usage.tokensOut, job.id);
          this.emit('onFinish', job, { status: 'done', result });
        }
      } catch (e) {
        journal.append('error', e.message);
        await journal.flush().catch(() => {});
        this.log.error(`[job ${job.id} ${job.type}]`, e.message);
        if (!(await this.isCancelled(job.id))) {
          await this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
            .run(String(e.message).slice(0, 2000), now(), ctx.usage.costUsd, ctx.usage.tokensIn, ctx.usage.tokensOut, job.id);
          this.emit('onFinish', job, { status: 'error', error: e.message });
        }
      }
    } finally {
      if (ctrl.signal.aborted) journal.append('status', 'Tâche annulée');
      await journal.flush().catch(() => {});
      clearInterval(watch);
      this.running.delete(job.id);
      const left = (this.busyUsers.get(Number(job.user_id)) || 1) - 1;
      if (left > 0) this.busyUsers.set(Number(job.user_id), left); else this.busyUsers.delete(Number(job.user_id));
      if (MAIL_JOBS.has(job.type)) this.busyMail.delete(Number(job.user_id));
    }
  }
}

// Ajoute la conso d'un appel Claude au job courant
export function addUsage(ctx, r) {
  ctx.usage.costUsd += r.costUsd || 0;
  ctx.usage.tokensIn += r.tokensIn || 0;
  ctx.usage.tokensOut += r.tokensOut || 0;
}

// Conso des 30 derniers jours, pour la jauge (comptée à la fin du job, comme le budget)
export async function usageSummary(db, userId) {
  const since = now() - 30 * 86400;
  const day = now() - 86400;
  const q = (s) => db.prepare(`SELECT COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COUNT(*) n
    FROM jobs WHERE user_id = ? AND COALESCE(finished_at, created_at) > ?`).get(userId, s);
  return { month: await q(since), day: await q(day) };
}
