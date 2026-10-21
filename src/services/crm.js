// Prospects : filtres, tri, pagination. Partagé par la liste et l'export CSV.

export const STATUSES = {
  new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté',
};

const SORTS = {
  score: 'score DESC, id DESC',
  recent: 'created_at DESC, id DESC',
  contacted: 'COALESCE(sent_at, 0) DESC, id DESC',
  company: 'company COLLATE NOCASE, id',
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
    page: int(sp.get('page'), 1, 100_000, 1),
  };
}

export function filterWhere(projectId, f) {
  const where = ['project_id = ?'];
  const args = [projectId];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(company LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR sector LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  if (f.status) { where.push('status = ?'); args.push(f.status); }
  if (f.minScore) { where.push('score >= ?'); args.push(f.minScore); }
  return { sql: where.join(' AND '), args, order: SORTS[f.sort] || SORTS.score };
}

export function listProspects(db, projectId, f, { limit = 100 } = {}) {
  const { sql, args, order } = filterWhere(projectId, f);
  const total = db.prepare(`SELECT COUNT(*) n FROM prospects WHERE ${sql}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(f.page, pages);
  const rows = db.prepare(`SELECT id, company, email, website, city, sector, score, status, sent_at, followup_at, replied_at
    FROM prospects WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
  return { total, page, pages, rows };
}
