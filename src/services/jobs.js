// File de jobs dans SQLite, UN seul worker : un seul `claude` à la fois sur le Pi.
import { now } from '../db.js';
import { waitCool } from './thermal.js';

export function enqueue(db, { projectId, type, params = {}, runAfter = null }) {
  const running = db.prepare(
    "SELECT id FROM jobs WHERE project_id IS ? AND type = ? AND status IN ('queued','running')"
  ).get(projectId ?? null, type);
  if (running) return { id: running.id, existing: true };
  const r = db.prepare('INSERT INTO jobs(project_id, type, params_json, created_at, run_after) VALUES(?, ?, ?, ?, ?)')
    .run(projectId ?? null, type, JSON.stringify(params), now(), runAfter);
  return { id: Number(r.lastInsertRowid), existing: false };
}

export function setProgress(db, jobId, progress) {
  db.prepare('UPDATE jobs SET progress_json = ? WHERE id = ?').run(JSON.stringify(progress), jobId);
}

export function cancelJob(db, jobId) {
  db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')")
    .run(now(), jobId);
}

export function latestJobs(db, projectId) {
  const rows = db.prepare(`
    SELECT j.* FROM jobs j
    JOIN (SELECT type, MAX(id) id FROM jobs WHERE project_id = ? GROUP BY type) last ON last.id = j.id
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
  constructor(db, handlers, { thermalMax = 75, pollMs = 3000, log = console, clock = now, onFinish, onThermal } = {}) {
    this.clock = clock;
    this.onFinish = onFinish;   // (job, {status, result, error}) → notifications
    this.onThermal = onThermal; // (°C) → une fois par pause
    this.db = db;
    this.handlers = handlers;
    this.thermalMax = thermalMax;
    this.pollMs = pollMs;
    this.log = log;
    this.current = null;
    this.stopped = false;
  }

  start() {
    // Un job "running" au démarrage = crash/reboot pendant l'exécution
    this.db.prepare("UPDATE jobs SET status = 'error', error = 'Interrompu (redémarrage)', finished_at = ? WHERE status = 'running'").run(now());
    this.loop();
  }

  stop() { this.stopped = true; this.current?.abort(); }

  // Les callbacks ne doivent jamais bloquer ni faire tomber le worker
  emit(name, ...args) {
    try { Promise.resolve(this[name]?.(...args)).catch((e) => this.log.error(`[${name}]`, e.message)); }
    catch (e) { this.log.error(`[${name}]`, e.message); }
  }

  isCancelled(jobId) {
    return this.db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)?.status === 'cancelled';
  }

  async loop() {
    while (!this.stopped) {
      const ran = await this.tick();
      if (!ran) await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  async tick() {
    const job = this.db.prepare(`SELECT * FROM jobs WHERE status = 'queued'
      AND (run_after IS NULL OR run_after <= ?) ORDER BY id LIMIT 1`).get(this.clock());
    if (!job) return false;
    const handler = this.handlers[job.type];
    if (!handler) {
      this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=? WHERE id=?").run(`Type inconnu : ${job.type}`, now(), job.id);
      return true;
    }

    let warned = false;
    await waitCool(this.thermalMax, {
      onWait: (t) => {
        setProgress(this.db, job.id, { message: `Pause thermique (${t} °C)` });
        if (!warned) { warned = true; this.emit('onThermal', t); }
      },
    });

    this.db.prepare("UPDATE jobs SET status='running', started_at=? WHERE id=? AND status='queued'").run(now(), job.id);
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
    // Annulation depuis l'UI : on surveille la BDD
    const watch = setInterval(() => { if (this.isCancelled(job.id)) ctrl.abort(); }, 2000);

    try {
      const result = await handler(ctx);
      if (!this.isCancelled(job.id)) {
        this.db.prepare("UPDATE jobs SET status='done', result_json=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
          .run(JSON.stringify(result ?? null), now(), ctx.usage.costUsd, ctx.usage.tokensIn, ctx.usage.tokensOut, job.id);
        this.emit('onFinish', job, { status: 'done', result });
      }
    } catch (e) {
      this.log.error(`[job ${job.id} ${job.type}]`, e.message);
      if (!this.isCancelled(job.id)) {
        this.db.prepare("UPDATE jobs SET status='error', error=?, finished_at=?, cost_usd=?, tokens_in=?, tokens_out=? WHERE id=?")
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

// Conso des 30 derniers jours, pour la jauge
export function usageSummary(db) {
  const since = now() - 30 * 86400;
  const day = now() - 86400;
  const q = (s) => db.prepare('SELECT COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COUNT(*) n FROM jobs WHERE created_at > ?').get(s);
  return { month: q(since), day: q(day) };
}
