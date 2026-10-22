// File de jobs en base, UN seul worker : un seul `claude` à la fois.
import { now } from '../db.js';
import { HttpError } from '../http.js';
import { AI_JOBS } from './budget.js';
import { getUser } from '../users.js';
import { aiRefusal, assertCanRunAi } from '../claudelink.js';
import { waitCool } from './thermal.js';
import { assertRoom, recordUsage, withUserLock, MAIL_JOBS } from './plans.js';

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
  // Deux écritures de la même condition : "= ?" ne marche pas avec NULL, et "IS ?" n'existe pas en MySQL
  const running = projectId == null
    ? await db.prepare("SELECT id FROM jobs WHERE user_id = ? AND project_id IS NULL AND type = ? AND status IN ('queued','running')").get(user.id, type)
    : await db.prepare("SELECT id FROM jobs WHERE project_id = ? AND type = ? AND status IN ('queued','running')").get(projectId, type);
  if (running) return { id: running.id, existing: true };
  // Plafonds du plan : compter puis écrire dans la même section critique (deux requêtes simultanées ne passent pas toutes deux)
  return withUserLock(user.id, async () => {
    if (AI_JOBS.has(type)) await assertRoom(db, user, 'aiJobs');
    if (MAIL_JOBS.has(type)) await assertRoom(db, user, 'mails');
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
      createdAt: r.created_at, finishedAt: r.finished_at, runAfter: r.run_after,
    };
  }
  return out;
}

export class Worker {
  constructor(db, handlers, {
    thermalMax = 75, pollMs = 3000, log = console, clock = now, onFinish, onThermal,
    budget, isAiJob, onBudget, quota, isQuotaSensitive, onQuotaHold, cliModeEnabled = true,
  } = {}) {
    this.cliModeEnabled = cliModeEnabled;
    this.clock = clock;
    this.budget = budget;       // async (userId) => {blocked, reason} : budget de CET utilisateur
    this.isAiJob = isAiJob;     // (type) => bool : jobs à mettre en attente si budget ($ équivalent) atteint
    this.onBudget = onBudget;   // (reason, userId) → une notif quand le blocage commence
    this.budgetBlocked = new Set(); // utilisateurs dont les jobs IA attendent (budget)
    this.quota = quota;                     // async (userId) => {blocked, reason} : quota du compte Claude lui-même (session/semaine)
    this.isQuotaSensitive = isQuotaSensitive; // (type) => bool : jobs à reporter si le quota est serré (pas la prospection/l'envoi)
    this.onQuotaHold = onQuotaHold;          // (reason, userId) → une notif quand le report commence
    this.quotaBlocked = new Set();
    this.onFinish = onFinish;   // (job, {status, result, error}) → notifications
    this.onThermal = onThermal; // (°C, userId) → une fois par pause
    this.db = db;
    this.handlers = handlers;
    this.thermalMax = thermalMax;
    this.pollMs = pollMs;
    this.log = log;
    this.current = null;
    this.currentJob = null;
    this.stopped = false;
    this.pending = new Set();   // callbacks de notification en vol (attendus à l'arrêt)
    this.loopDone = null;
    this.wake = null;
  }

  async start() {
    // Un job "running" au démarrage = crash/reboot pendant l'exécution
    await this.db.prepare("UPDATE jobs SET status = 'error', error = 'Interrompu (redémarrage)', finished_at = ? WHERE status = 'running'").run(now());
    this.loopDone = this.loop();
  }

  /** Arrête la boucle et attend le job en cours ainsi que les notifications en vol. */
  async stop() {
    this.stopped = true;
    this.current?.abort();
    this.wake?.();
    await this.loopDone;
    await this.idle();
  }

  /** Interrompt le job en cours s'il appartient à cet utilisateur (suppression du compte). */
  abortUser(userId) {
    if (this.currentJob && Number(this.currentJob.user_id) === Number(userId)) this.current?.abort();
  }

  /** Interrompt le job en cours s'il est un job IA de cet utilisateur (déliaison de son accès Claude). */
  abortUserAi(userId) {
    if (this.currentJob && Number(this.currentJob.user_id) === Number(userId) && this.isAiJob?.(this.currentJob.type)) this.current?.abort();
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
      let ran = false;
      try { ran = await this.tick(); }
      catch (e) { this.log.error('[worker]', e.message); } // base indisponible : on réessaie au prochain passage
      if (!ran && !this.stopped) {
        await new Promise((r) => { this.wake = r; setTimeout(r, this.pollMs).unref(); });
        this.wake = null;
      }
    }
  }

  async tick() {
    const due = await this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued'
      AND (run_after IS NULL OR run_after <= ?) ORDER BY id`).all(this.clock());
    if (!due.length) return false;

    // Budget $ atteint ou quota du compte Claude serré : les jobs concernés restent en file
    // (pas perdus), les autres passent devant. Deux garde-fous indépendants, deux périmètres :
    // le budget met en pause TOUS les jobs IA, le quota ne retarde que les jobs non urgents
    // (analyse, évolutions) — la prospection et les envois continuent. Chaque utilisateur a les siens.
    const budgets = new Map(), quotas = new Map();
    const perUser = async (cache, fn, userId) => {
      if (!cache.has(userId)) cache.set(userId, (await fn?.(userId)) || { blocked: false });
      return cache.get(userId);
    };
    const hold = async (j, reason) => {
      const msg = JSON.stringify({ message: `En attente : ${reason}` });
      if (j.progress_json !== msg) await this.db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(msg, j.id);
    };
    let job = null;
    const waiting = new Map(), quotaWaiting = new Map();
    for (const j of due) {
      // Compte suspendu ou supprimé, job IA sans liaison Claude valide : refusé sans exécution
      const refusal = await jobRefusal(this.db, j, { cliModeEnabled: this.cliModeEnabled });
      if (refusal) {
        await this.db.prepare("UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ? AND status = 'queued'").run(refusal, now(), j.id);
        continue;
      }
      const budget = await perUser(budgets, this.budget, j.user_id);
      if (budget.blocked && this.isAiJob?.(j.type)) { waiting.set(j.user_id, budget.reason); await hold(j, budget.reason); continue; }
      const quota = await perUser(quotas, this.quota, j.user_id);
      if (quota.blocked && this.isQuotaSensitive?.(j.type)) { quotaWaiting.set(j.user_id, quota.reason); await hold(j, quota.reason); continue; }
      job = j;
      break;
    }
    for (const [userId, reason] of waiting) if (!this.budgetBlocked.has(userId)) this.emit('onBudget', reason, userId);
    this.budgetBlocked = new Set(waiting.keys());
    for (const [userId, reason] of quotaWaiting) if (!this.quotaBlocked.has(userId)) this.emit('onQuotaHold', reason, userId);
    this.quotaBlocked = new Set(quotaWaiting.keys());
    if (!job) return false;
    const handler = this.handlers[job.type];
    if (!handler) {
      await this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=? WHERE id=?").run(`Type inconnu : ${job.type}`, now(), job.id);
      return true;
    }

    let warned = false;
    await waitCool(this.thermalMax, {
      onWait: async (t) => {
        await setProgress(this.db, job.id, { message: `Pause thermique (${t} °C)` });
        if (!warned) { warned = true; this.emit('onThermal', t, job.user_id); }
      },
    });

    await this.db.prepare("UPDATE jobs SET status='running', started_at=? WHERE id=? AND status='queued'").run(now(), job.id);
    const ctrl = new AbortController();
    this.current = ctrl;
    this.currentJob = job;
    const ctx = {
      job,
      params: JSON.parse(job.params_json || '{}'),
      signal: ctrl.signal,
      progress: (p) => setProgress(this.db, job.id, p),
      cancelled: () => this.isCancelled(job.id),
      usage: { costUsd: 0, tokensIn: 0, tokensOut: 0 },
    };
    // Annulation depuis l'UI : on surveille la BDD (une erreur ici ne doit jamais faire tomber le process)
    const watch = setInterval(() => {
      this.isCancelled(job.id).then((c) => { if (c) ctrl.abort(); }, () => {});
    }, 2000);

    try {
      const result = await handler(ctx);
      if (!(await this.isCancelled(job.id))) {
        await this.db.prepare("UPDATE jobs SET status='done', result_json=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
          .run(JSON.stringify(result ?? null), now(), ctx.usage.costUsd, ctx.usage.tokensIn, ctx.usage.tokensOut, job.id);
        this.emit('onFinish', job, { status: 'done', result });
      }
    } catch (e) {
      this.log.error(`[job ${job.id} ${job.type}]`, e.message);
      if (!(await this.isCancelled(job.id))) {
        await this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
          .run(String(e.message).slice(0, 2000), now(), ctx.usage.costUsd, ctx.usage.tokensIn, ctx.usage.tokensOut, job.id);
        this.emit('onFinish', job, { status: 'error', error: e.message });
      }
    } finally {
      clearInterval(watch);
      this.current = null;
      this.currentJob = null;
    }
    return true;
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
