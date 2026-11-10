// Communication : brouillons de posts Instagram et de newsletters d'un projet (table content_drafts).
// Un post Instagram = une légende, des hashtags, un texte alternatif et une image PNG dessinée d'après le design du projet.
// Une newsletter = un objet, un texte d'aperçu et un corps en Markdown. Rien n'est publié ni envoyé par iaboss : on relit, on copie, on télécharge.
import { now } from './db.js';
import { HttpError } from './http.js';

export const KINDS = ['instagram', 'newsletter'];

/** Formats d'image Instagram (pixels). */
export const INSTAGRAM_FORMATS = {
  carre: { label: 'Carré 1:1', width: 1080, height: 1080 },
  portrait: { label: 'Portrait 4:5', width: 1080, height: 1350 },
  story: { label: 'Story 9:16', width: 1080, height: 1920 },
};

export const LIMITS = {
  direction: 500,
  caption: 2200,   // limite d'Instagram
  hashtags: 30,    // limite d'Instagram
  alt: 400,
  subject: 150,
  preview: 200,
  newsletter: 20_000,
  perKind: 20,     // brouillons gardés par projet et par type : les plus anciens partent
  image: 4_000_000,
};

const fail = (status, message) => new HttpError(status, message, { expose: true });
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/** Hashtags propres : « #mot », sans espace ni doublon, 30 au plus. */
export function cleanHashtags(list) {
  const raw = Array.isArray(list) ? list : String(list ?? '').split(/[\s,]+/);
  const out = [];
  for (const h of raw) {
    const tag = String(h).trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    // Instagram ne distingue pas les majuscules : #Fidélité et #fidélité sont le même hashtag
    if (tag && !out.some((o) => o.toLowerCase() === `#${tag}`.toLowerCase())) out.push(`#${tag}`);
    if (out.length >= LIMITS.hashtags) break;
  }
  return out;
}

const view = (r) => ({
  id: Number(r.id), kind: r.kind, direction: r.direction || '', title: r.title || '', body: r.body, extra: parse(r.extra_json),
  hasImage: Number(r.image_size || 0) > 0, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  // Publication sur Instagram (draft | scheduled | publishing | published)
  status: r.status || 'draft', publishAs: r.publish_as || null, scheduledAt: r.scheduled_at ? Number(r.scheduled_at) : null,
  publishedAt: r.published_at ? Number(r.published_at) : null, permalink: r.permalink || null, publishError: r.publish_error || null,
});
const COLS = 'id, kind, direction, title, body, extra_json, created_at, updated_at, LENGTH(image) image_size, status, publish_as, scheduled_at, published_at, permalink, publish_error';

export async function saveDraft(db, projectId, kind, { direction = '', title = '', body, extra = {}, image = null }) {
  if (!KINDS.includes(kind)) throw fail(400, 'Type de brouillon inconnu');
  const t = now();
  const r = await db.prepare('INSERT INTO content_drafts(project_id, kind, direction, title, body, extra_json, image, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(Number(projectId), kind, String(direction).slice(0, LIMITS.direction) || null, String(title).slice(0, LIMITS.subject * 2) || null, String(body),
      JSON.stringify(extra), image ? Buffer.from(image) : null, t, t);
  const id = Number(r.lastInsertRowid);
  // Les plus anciens brouillons partent : le dernier reste toujours
  const old = await db.prepare("SELECT id FROM content_drafts WHERE project_id = ? AND kind = ? AND status NOT IN ('scheduled', 'publishing') ORDER BY id DESC LIMIT 1000 OFFSET ?").all(Number(projectId), kind, LIMITS.perKind);
  for (const o of old) await db.prepare('DELETE FROM content_drafts WHERE id = ?').run(Number(o.id));
  return id;
}

export async function listDrafts(db, projectId, kind, n = LIMITS.perKind) {
  return (await db.prepare(`SELECT ${COLS} FROM content_drafts WHERE project_id = ? AND kind = ? ORDER BY id DESC LIMIT ?`).all(Number(projectId), kind, n)).map(view);
}

export async function getDraft(db, projectId, kind, id) {
  const r = await db.prepare(`SELECT ${COLS} FROM content_drafts WHERE id = ? AND project_id = ? AND kind = ?`).get(Number(id) || 0, Number(projectId), kind);
  return r ? view(r) : null;
}

/** Les derniers textes produits : donnés à l'IA pour que « Régénérer » change vraiment de sujet. */
export async function recentBodies(db, projectId, kind, n = 4) {
  return (await db.prepare('SELECT body FROM content_drafts WHERE project_id = ? AND kind = ? ORDER BY id DESC LIMIT ?').all(Number(projectId), kind, n)).map((r) => r.body);
}

/** L'image PNG d'un brouillon Instagram, ou null. */
export async function getImage(db, projectId, id) {
  const r = await db.prepare("SELECT image FROM content_drafts WHERE id = ? AND project_id = ? AND kind = 'instagram'").get(Number(id) || 0, Number(projectId));
  return r?.image ? Buffer.from(r.image) : null;
}

/** Modifie le texte d'un brouillon (l'image ne change pas). Seuls les champs donnés bougent. */
export async function editDraft(db, projectId, kind, id, { title, body, hashtags, alt, preview }) {
  const cur = await getDraft(db, projectId, kind, id);
  if (!cur) throw fail(404, 'Brouillon introuvable');
  if (kind === 'instagram' && cur.status !== 'draft') throw fail(409, cur.status === 'published' ? 'Ce post est déjà publié : il ne se modifie plus ici' : 'Ce post est programmé : annule la programmation pour le modifier');
  const extra = { ...cur.extra };
  let text = cur.body;
  let subject = cur.title;
  if (kind === 'instagram') {
    if (body !== undefined) text = String(body).replace(/\r\n/g, '\n').trim();
    if (!text) throw fail(400, 'La légende est vide');
    if (text.length > LIMITS.caption) throw fail(400, `La légende dépasse ${LIMITS.caption} caractères`);
    if (hashtags !== undefined) extra.hashtags = cleanHashtags(hashtags);
    if (alt !== undefined) extra.alt = String(alt).replace(/\s+/g, ' ').trim().slice(0, LIMITS.alt);
  } else {
    if (body !== undefined) text = String(body).replace(/\r\n/g, '\n').trim();
    if (!text) throw fail(400, 'Le texte de la newsletter est vide');
    if (text.length > LIMITS.newsletter) throw fail(400, `La newsletter dépasse ${LIMITS.newsletter} caractères`);
    if (title !== undefined) subject = String(title).replace(/\s+/g, ' ').trim().slice(0, LIMITS.subject);
    if (!subject) throw fail(400, "L'objet est vide");
    if (preview !== undefined) extra.preview = String(preview).replace(/\s+/g, ' ').trim().slice(0, LIMITS.preview);
  }
  await db.prepare('UPDATE content_drafts SET title = ?, body = ?, extra_json = ?, updated_at = ? WHERE id = ? AND project_id = ? AND kind = ?')
    .run(subject || null, text, JSON.stringify(extra), now(), Number(id), Number(projectId), kind);
}

export async function removeDraft(db, projectId, kind, id) {
  const cur = await db.prepare('SELECT status FROM content_drafts WHERE id = ? AND project_id = ? AND kind = ?').get(Number(id) || 0, Number(projectId), kind);
  if (cur?.status === 'publishing') throw fail(409, 'Ce post est en cours de publication : attends la fin');
  const r = await db.prepare('DELETE FROM content_drafts WHERE id = ? AND project_id = ? AND kind = ?').run(Number(id) || 0, Number(projectId), kind);
  if (!Number(r.changes ?? r.affectedRows ?? 0)) throw fail(404, 'Brouillon introuvable');
}
