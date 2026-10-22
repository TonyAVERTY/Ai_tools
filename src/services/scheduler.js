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
      // Les tâches de fond ne travaillent que pour les comptes actifs, projet par projet avec son propriétaire
      const projects = await this.app.db.prepare(`SELECT p.id, p.user_id FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.imap_enc IS NOT NULL AND u.status = 'active'`).all();
      for (const { id, user_id: userId } of projects) {
        try { await checkInbox(this.app, userId, id); }
        catch (e) { this.log.error(`[inbox ${id}]`, e.message); }
      }
      await this.queueFollowups();
      const users = await this.app.db.prepare(`SELECT s.user_id FROM user_settings s JOIN users u ON u.id = s.user_id
        WHERE s.\`key\` = 'weekly_report' AND s.value = '1' AND u.status = 'active'`).all();
      for (const { user_id: userId } of users) {
        try { await maybeSendWeekly(this.app, userId); }
        catch (e) { this.log.error('[rapport hebdo]', e.message); }
      }
      await snapshotAll(this.app, { log: this.log });
    } finally { this.running = false; }
  }

  async queueFollowups(opts) {
    const { db } = this.app;
    const queued = [];
    for (const { id, user_id: userId } of await db.prepare(`SELECT p.id, p.user_id FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.followup_enabled = 1 AND u.status = 'active'`).all()) {
      const plan = await followupPlan(db, await getProject(this.app, id, { userId }), opts);
      if (plan.ready) queued.push({ id, ...await enqueue(db, { userId, projectId: id, type: 'followup', params: { count: plan.due } }) });
    }
    return queued;
  }
}
