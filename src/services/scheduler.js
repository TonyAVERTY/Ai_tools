// Tâches de fond légères (sans Claude), toutes les 15 min :
//   1. lecture des boîtes IMAP (réponses, bounces)
//   2. puis seulement ensuite, mise en file des relances dues
//   3. rapport hebdo le lundi à 8h
//   4. photo quotidienne des KPI business (pour les courbes)
import { checkInbox } from './inbox.js';
import { followupPlan } from './followup.js';
import { enqueue } from './jobs.js';
import { getProject } from '../projects.js';
import { maybeSendWeekly } from './report.js';
import { snapshotAll } from './metrics.js';

export class Scheduler {
  constructor(app, { everyMs = 15 * 60_000, log = console } = {}) {
    this.app = app;
    this.everyMs = everyMs;
    this.log = log;
    this.running = false;
    this.inflight = null;
  }

  // Passage lancé par un minuteur : suivi (stop() l'attend) et jamais d'erreur non gérée
  run() {
    this.inflight = this.tick().catch((e) => this.log.error('[planificateur]', e.message));
  }

  start() {
    this.timer = setInterval(() => this.run(), this.everyMs);
    this.timer.unref();
    // Premier passage peu après le démarrage
    this.first = setTimeout(() => this.run(), 60_000);
    this.first.unref();
  }

  async stop() {
    clearInterval(this.timer);
    clearTimeout(this.first);
    await this.inflight;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const projects = await this.app.db.prepare('SELECT id FROM projects WHERE imap_enc IS NOT NULL').all();
      for (const { id } of projects) {
        try { await checkInbox(this.app, id); }
        catch (e) { this.log.error(`[inbox ${id}]`, e.message); }
      }
      await this.queueFollowups();
      try { await maybeSendWeekly(this.app); }
      catch (e) { this.log.error('[rapport hebdo]', e.message); }
      await snapshotAll(this.app, { log: this.log });
    } finally { this.running = false; }
  }

  async queueFollowups(opts) {
    const { db } = this.app;
    const queued = [];
    for (const { id } of await db.prepare('SELECT id FROM projects WHERE followup_enabled = 1').all()) {
      const plan = await followupPlan(db, await getProject(this.app, id), opts);
      if (plan.ready) queued.push({ id, ...await enqueue(db, { projectId: id, type: 'followup', params: { count: plan.due } }) });
    }
    return queued;
  }
}
