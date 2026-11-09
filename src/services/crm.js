// Prospects : filtres, tri, pagination, fiche détaillée. Partagé par la liste et l'export CSV.
import { now } from '../db.js';
import { parisTime, parisParts } from './paris-time.js';

export const STATUSES = {
  new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté', invalid: 'Adresse invalide',
};

const SORTS = {
  score: 'score DESC, id DESC',
  recent: 'created_at DESC, id DESC',
  contacted: 'COALESCE(sent_at, 0) DESC, id DESC',
  company: 'LOWER(company), id',
};

const int = (v, min, max, def) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/** Filtres depuis une query string (valeurs inconnues ignorées, jamais injectées dans le SQL). */
export function parseFilters(sp) {
  return {
    q: String(sp.get('q') || '').trim().slice(0, 100),
    status: Object.hasOwn(STATUSES, sp.get('status')) ? sp.get('status') : '',
    minScore: int(sp.get('minScore'), 0, 10, 0),
    sort: Object.hasOwn(SORTS, sp.get('sort')) ? sp.get('sort') : 'score',
    todo: sp.get('todo') === '1',
    page: int(sp.get('page'), 1, 100_000, 1),
  };
}

export function filterWhere(projectId, f) {
  const where = ['project_id = ?'];
  const args = [projectId];
  if (f.q) {
    // '!' comme échappement : le backslash n'a pas le même sens dans un littéral SQLite et MySQL
    const like = `%${f.q.replace(/[!%_]/g, (c) => `!${c}`)}%`;
    where.push("(company LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR city LIKE ? ESCAPE '!' OR sector LIKE ? ESCAPE '!')");
    args.push(like, like, like, like);
  }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  if (f.minScore) { where.push('score >= ?'); args.push(f.minScore); }
  if (f.todo) { where.push('next_action_at IS NOT NULL AND next_action_at <= ?'); args.push(f.at ?? now()); }
  return { sql: where.join(' AND '), args, order: SORTS[f.sort] || SORTS.score };
}

export async function listProspects(db, projectId, f, { limit = 100 } = {}) {
  const { sql, args, order } = filterWhere(projectId, f);
  const total = (await db.prepare(`SELECT COUNT(*) n FROM prospects WHERE ${sql}`).get(...args)).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(f.page, pages);
  const rows = await db.prepare(`SELECT id, company, email, website, city, sector, score, status, sent_at, followup_at, replied_at,
    next_action, next_action_at
    FROM prospects WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
  // Compteurs des puces (« Tous », « À contacter »…) : tout le projet, quels que soient les filtres
  const by = await db.prepare('SELECT status, COUNT(*) n FROM prospects WHERE project_id = ? GROUP BY status').all(projectId);
  const counts = { all: 0, new: 0, sent: 0, replied: 0, todo: 0 };
  for (const r of by) { counts.all += Number(r.n); if (r.status in counts) counts[r.status] = Number(r.n); }
  counts.todo = Number((await db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND next_action_at IS NOT NULL AND next_action_at <= ?').get(projectId, f.at ?? now())).n);
  return { total, page, pages, rows, counts };
}

// ---------- Fiche prospect ----------

/** Tout ce qu'on sait d'un prospect : infos, mails envoyés, réponse, notes. */
export async function prospectDetail(db, id) {
  const p = await db.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
  if (!p) return null;
  const mails = await db.prepare(`SELECT kind, subject, variant, sent_at, error FROM mail_log
    WHERE prospect_id = ? ORDER BY sent_at, id`).all(id);
  const notes = await db.prepare('SELECT id, body, created_at FROM prospect_notes WHERE prospect_id = ? ORDER BY created_at DESC, id DESC').all(id);
  // La liste d'opposition est commune à tous les comptes : on n'en révèle que le strict nécessaire. Le motif d'un
  // autre compte (refus, adresse invalide) n'est pas montré ; seule la désinscription, acte de la personne elle-même, l'est.
  const row = await db.prepare('SELECT reason FROM blacklist WHERE email = ?').get(p.email);
  // Seulement si le prospect de CE compte porte déjà ce statut : un compte ne découvre jamais qu'une adresse est sur la liste à cause d'un autre.
  const optOut = row && (p.status === 'refused' || p.status === 'bounced')
    ? { reason: row.reason === 'unsubscribe' ? 'unsubscribe' : p.status === 'bounced' ? 'bounce' : 'refused' } : null;
  return { prospect: p, mails, notes, optOut };
}

export async function addNote(db, prospectId, body) {
  const text = String(body || '').trim().slice(0, 2000);
  if (!text) return null;
  return Number((await db.prepare('INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, ?, ?)').run(prospectId, text, now())).lastInsertRowid);
}

export async function deleteNote(db, prospectId, noteId) {
  return (await db.prepare('DELETE FROM prospect_notes WHERE id = ? AND prospect_id = ?').run(noteId, prospectId)).changes > 0;
}

/** Prochaine action : texte + jour (AAAA-MM-JJ, rappel à 9h heure de Paris). Vide = effacer. */
export async function setNextAction(db, prospectId, action, day) {
  const text = String(action || '').trim().slice(0, 200);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!text) {
    await db.prepare('UPDATE prospects SET next_action = NULL, next_action_at = NULL WHERE id = ?').run(prospectId);
    return null;
  }
  if (!m) throw new Error('Date attendue au format AAAA-MM-JJ');
  const date = parisTime(+m[1], +m[2], +m[3], 9);
  // 2026-02-31 deviendrait le 3 mars sans prévenir : on refuse
  if (parisParts(date).day !== +m[3]) throw new Error('Date invalide');
  const at = Math.floor(date.getTime() / 1000);
  await db.prepare('UPDATE prospects SET next_action = ?, next_action_at = ? WHERE id = ?').run(text, at, prospectId);
  return at;
}

/**
 * Vue Kanban : une colonne par statut, avec le total et les premières fiches (mêmes filtres que la liste).
 * Le filtre « statut » de la liste ne s'applique pas ici : les colonnes sont justement les statuts.
 */
export async function kanbanColumns(db, projectId, f, { per = 25 } = {}) {
  const cols = [];
  for (const [status, label] of Object.entries(STATUSES)) {
    const { sql, args, order } = filterWhere(projectId, { ...f, status });
    const total = Number((await db.prepare(`SELECT COUNT(*) n FROM prospects WHERE ${sql}`).get(...args)).n);
    const rows = total ? await db.prepare(`SELECT id, company, email, city, score, status, sent_at, replied_at, next_action, next_action_at
      FROM prospects WHERE ${sql} ORDER BY ${order} LIMIT ?`).all(...args, per) : [];
    cols.push({ status, label, total, rows });
  }
  return cols;
}
