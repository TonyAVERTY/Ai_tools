// Tâches de fond légères (sans Claude) : lecture des boîtes IMAP toutes les 15 min.
import { checkInbox } from './inbox.js';

export class Scheduler {
  constructor(app, { everyMs = 15 * 60_000, log = console } = {}) {
    this.app = app;
    this.everyMs = everyMs;
    this.log = log;
    this.running = false;
  }

  start() {
    this.timer = setInterval(() => this.tick(), this.everyMs);
    this.timer.unref();
    // Premier passage peu après le démarrage
    this.first = setTimeout(() => this.tick(), 60_000);
    this.first.unref();
  }

  stop() { clearInterval(this.timer); clearTimeout(this.first); }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const projects = this.app.db.prepare('SELECT id FROM projects WHERE imap_enc IS NOT NULL').all();
      for (const { id } of projects) {
        try { await checkInbox(this.app, id); }
        catch (e) { this.log.error(`[inbox ${id}]`, e.message); }
      }
    } finally { this.running = false; }
  }
}
