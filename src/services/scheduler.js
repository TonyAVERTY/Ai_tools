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
import { runInactiveCleanup } from './inactive.js';
import { publishDuePosts } from '../linkedin.js';
import { purgeAudit } from '../audit.js';
import { expireGrace, purgeEvents } from '../subscriptions.js';
import { INACTIVITY } from '../limits.js';
import { now } from '../db.js';

export class Scheduler {
  constructor(app, { everyMs = 15 * 60_000, log = console, clock = now } = {}) {
    this.app = app;
    this.clock = clock; // secondes ; injectable pour les tests
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
      try { await this.queueFollowups(); } catch (e) { this.log.error('[relances]', e.message); }
      try { await publishDuePosts(this.app, { at: this.clock() }); } catch (e) { this.log.error('[linkedin programmés]', e.message); }
      // Offres payantes : délai de grâce écoulé après un paiement refusé → retour au plan gratuit ; vieux événements Stripe oubliés
      try { await expireGrace(this.app.db, { at: this.clock() }); await purgeEvents(this.app.db, { at: this.clock() }); } catch (e) { this.log.error('[abonnements]', e.message); }
      const users = await this.app.db.prepare(`SELECT s.user_id FROM user_settings s JOIN users u ON u.id = s.user_id
        WHERE s.\`key\` = 'weekly_report' AND s.value = '1' AND u.status = 'active'`).all();
      for (const { user_id: userId } of users) {
        try { await maybeSendWeekly(this.app, userId); }
        catch (e) { this.log.error('[rapport hebdo]', e.message); }
      }
      try { await snapshotAll(this.app, { log: this.log }); } catch (e) { this.log.error('[métriques]', e.message); }
      // Entretien : comptes inactifs (avertissement puis suppression) et ancien journal d'audit
      try {
        await runInactiveCleanup(this.app, { at: this.clock(), log: this.log });
        await purgeAudit(this.app.db, INACTIVITY.auditRetentionMonths, this.clock());
      } catch (e) { this.log.error('[inactifs]', e.message); }
    } finally { this.running = false; }
  }

  async queueFollowups(opts) {
    const { db } = this.app;
    const queued = [];
    for (const { id, user_id: userId } of await db.prepare(`SELECT p.id, p.user_id FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.followup_enabled = 1 AND u.status = 'active'`).all()) {
      // Un projet en erreur (donnée illisible, refus imprévu) ne bloque ni les relances des autres projets ni la suite du passage :
      // avant, l'erreur d'UN projet arrêtait tout (posts LinkedIn programmés, rapports, courbes, entretien) à chaque passage.
      try {
        const plan = await followupPlan(db, await getProject(this.app, id, { userId }), opts);
        if (!plan.ready) continue;
        queued.push({ id, ...await enqueue(db, { userId, projectId: id, type: 'followup', params: { count: plan.due } }) });
      } catch (e) {
        // Plafond mensuel atteint ou envois en pause : la relance attend, sans bruit dans les journaux
        if (!(e.status === 403 && ['plan_limit', 'send_paused'].includes(e.code))) this.log.error(`[relances ${id}]`, e.message);
      }
    }
    return queued;
  }
}
