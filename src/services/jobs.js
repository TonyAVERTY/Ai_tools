// File de jobs en base, UN seul worker : un seul `claude` à la fois.
import { now } from '../db.js';
import { waitCool } from './thermal.js';

export async function enqueue(db, { projectId, type, params = {}, runAfter = null }) {
  // Deux écritures de la même condition : "= ?" ne marche pas avec NULL, et "IS ?" n'existe pas en MySQL
  const running = projectId == null
    ? await db.prepare("SELECT id FROM jobs WHERE project_id IS NULL AND type = ? AND status IN ('queued','running')").get(type)
    : await db.prepare("SELECT id FROM jobs WHERE project_id = ? AND type = ? AND status IN ('queued','running')").get(projectId, type);
  if (running) return { id: running.id, existing: true };
  const r = await db.prepare('INSERT INTO jobs(project_id, type, params_json, created_at, run_after) VALUES(?, ?, ?, ?, ?)')
    .run(projectId ?? null, type, JSON.stringify(params), now(), runAfter);
  return { id: Number(r.lastInsertRowid), existing: false };
}

export async function setProgress(db, jobId, progress) {
  await db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(JSON.stringify(progress), jobId);
}

export async function cancelJob(db, jobId) {
  await db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')")
    .run(now(), jobId);
}

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
    budget, isAiJob, onBudget, quota, isQuotaSensitive, onQuotaHold,
  } = {}) {
    this.clock = clock;
    this.budget = budget;       // async () => {blocked, reason}
    this.isAiJob = isAiJob;     // (type) => bool : jobs à mettre en attente si budget ($ équivalent) atteint
    this.onBudget = onBudget;   // (reason) → une notif quand le blocage commence
    this.budgetBlocked = false;
    this.quota = quota;                     // async () => {blocked, reason} : quota du compte Claude lui-même (session/semaine)
    this.isQuotaSensitive = isQuotaSensitive; // (type) => bool : jobs à reporter si le quota est serré (pas la prospection/l'envoi)
    this.onQuotaHold = onQuotaHold;          // (reason) → une notif quand le report commence
    this.quotaBlocked = false;
    this.onFinish = onFinish;   // (job, {status, result, error}) → notifications
    this.onThermal = onThermal; // (°C) → une fois par pause
    this.db = db;
    this.handlers = handlers;
    this.thermalMax = thermalMax;
    this.pollMs = pollMs;
    this.log = log;
    this.current = null;
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
    // (analyse, évolutions) — la prospection et les envois continuent.
    const budget = (await this.budget?.()) || { blocked: false };
    const quota = (await this.quota?.()) || { blocked: false };
    const hold = async (j, reason) => {
      const msg = JSON.stringify({ message: `En attente : ${reason}` });
      if (j.progress_json !== msg) await this.db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(msg, j.id);
    };
    let job = null;
    let waiting = false, quotaWaiting = false;
    for (const j of due) {
      if (budget.blocked && this.isAiJob?.(j.type)) { waiting = true; await hold(j, budget.reason); continue; }
      if (quota.blocked && this.isQuotaSensitive?.(j.type)) { quotaWaiting = true; await hold(j, quota.reason); continue; }
      job = j;
      break;
    }
    if (waiting && !this.budgetBlocked) this.emit('onBudget', budget.reason);
    this.budgetBlocked = waiting;
    if (quotaWaiting && !this.quotaBlocked) this.emit('onQuotaHold', quota.reason);
    this.quotaBlocked = quotaWaiting;
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
        if (!warned) { warned = true; this.emit('onThermal', t); }
      },
    });

    await this.db.prepare("UPDATE jobs SET status='running', started_at=? WHERE id=? AND status='queued'").run(now(), job.id);
    const ctrl = new AbortController();
    this.current = ctrl;
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
export async function usageSummary(db) {
  const since = now() - 30 * 86400;
  const day = now() - 86400;
  const q = (s) => db.prepare(`SELECT COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COUNT(*) n
    FROM jobs WHERE COALESCE(finished_at, created_at) > ?`).get(s);
  return { month: await q(since), day: await q(day) };
}
