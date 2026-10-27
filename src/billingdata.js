// Facturation : lecture et écriture en base (informations légales, exemples de devis, documents définitifs). Tout est filtré par compte.
import { now } from './db.js';
import { normalizeLegal, normalizeContent, LEGAL_KEYS, DOC_KINDS } from './services/billing.js';

const parse = (s, dflt) => { try { return JSON.parse(s); } catch { return dflt; } };

/** Informations légales enregistrées (valeurs nettoyées, champs par défaut compris) et variante de devis choisie. */
export async function getBilling(db, projectId, userId) {
  const row = await db.prepare('SELECT * FROM billing_projects WHERE project_id = ? AND user_id = ?').get(Number(projectId), Number(userId));
  const saved = row ? parse(row.legal_json, {}) : {};
  return { exists: !!row, legal: normalizeLegal(saved).values, chosen: row?.chosen == null ? null : Number(row.chosen) };
}

/** Enregistre les informations légales (même incomplètes : rien n'est perdu) ; renvoie les erreurs de format et de complétude. */
export async function saveLegal(db, projectId, userId, raw) {
  const { values, errors } = normalizeLegal(raw);
  const at = now();
  await db.prepare(`INSERT INTO billing_projects(project_id, user_id, legal_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET legal_json = excluded.legal_json, updated_at = excluded.updated_at`)
    .run(Number(projectId), Number(userId), JSON.stringify(Object.fromEntries(LEGAL_KEYS.map((k) => [k, values[k]]))), at, at);
  return { values, errors };
}

const shape = (r) => ({
  id: Number(r.id), projectId: Number(r.project_id), kind: r.kind, variant: Number(r.variant), status: r.status, layout: r.layout,
  content: normalizeContent(parse(r.content_json, null), r.kind === 'quote_option' ? 'devis' : r.kind), refinement: r.refinement || '',
  updatedAt: Number(r.updated_at), validatedAt: r.validated_at == null ? null : Number(r.validated_at),
});

export async function listDocs(db, projectId, userId) {
  const rows = await db.prepare('SELECT * FROM billing_docs WHERE project_id = ? AND user_id = ? ORDER BY kind, variant, id').all(Number(projectId), Number(userId));
  return rows.map(shape).filter((d) => d.content);
}
export async function getDoc(db, docId, userId) {
  const r = await db.prepare('SELECT * FROM billing_docs WHERE id = ? AND user_id = ?').get(Number(docId), Number(userId));
  return r ? shape(r) : null;
}

/** Trois exemples de devis : remplace les précédents (tant qu'aucun n'est validé), repart d'un choix vide. */
export async function replaceOptions(db, projectId, userId, contents) {
  const at = now();
  await db.prepare("DELETE FROM billing_docs WHERE project_id = ? AND user_id = ? AND kind = 'quote_option'").run(Number(projectId), Number(userId));
  let v = 0;
  for (const c of contents) {
    v++;
    await db.prepare(`INSERT INTO billing_docs(project_id, user_id, kind, variant, status, layout, content_json, created_at, updated_at) VALUES(?, ?, 'quote_option', ?, 'draft', ?, ?, ?, ?)`)
      .run(Number(projectId), Number(userId), v, c.layout, JSON.stringify(c), at, at);
  }
  await db.prepare('UPDATE billing_projects SET chosen = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?').run(at, Number(projectId), Number(userId));
}
export async function setChosen(db, projectId, userId, variant) {
  await db.prepare('UPDATE billing_projects SET chosen = ?, updated_at = ? WHERE project_id = ? AND user_id = ?').run(variant == null ? null : Number(variant), now(), Number(projectId), Number(userId));
}

/** Nouveau contenu d'un document (après « Affiner ») : il repasse en brouillon et doit être validé de nouveau. */
export async function updateDocContent(db, docId, userId, content, refinement = '') {
  await db.prepare("UPDATE billing_docs SET content_json = ?, layout = ?, refinement = ?, status = 'draft', validated_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(content), content.layout, String(refinement).slice(0, 1000), now(), Number(docId), Number(userId));
}
export async function validateDoc(db, docId, userId) {
  const at = now();
  await db.prepare("UPDATE billing_docs SET status = 'validated', validated_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(at, at, Number(docId), Number(userId));
}

/** Les quatre documents définitifs (devis, acompte, facture finale, avoir), tous en brouillon. */
export async function replaceFinals(db, projectId, userId, byKind) {
  const at = now();
  await db.prepare("DELETE FROM billing_docs WHERE project_id = ? AND user_id = ? AND kind <> 'quote_option'").run(Number(projectId), Number(userId));
  for (const { key } of DOC_KINDS) {
    const c = byKind[key];
    await db.prepare(`INSERT INTO billing_docs(project_id, user_id, kind, variant, status, layout, content_json, created_at, updated_at) VALUES(?, ?, ?, 0, 'draft', ?, ?, ?, ?)`)
      .run(Number(projectId), Number(userId), key, c.layout, JSON.stringify(c), at, at);
  }
}

/** Tout recommencer : exemples, documents et choix effacés ; les informations légales restent. */
export async function resetDocs(db, projectId, userId) {
  await db.prepare('DELETE FROM billing_docs WHERE project_id = ? AND user_id = ?').run(Number(projectId), Number(userId));
  await db.prepare('UPDATE billing_projects SET chosen = NULL, updated_at = ? WHERE project_id = ? AND user_id = ?').run(now(), Number(projectId), Number(userId));
}

/** Pour la liste des projets : état de chaque projet du compte en une seule requête. */
export async function billingOverview(db, userId) {
  const bill = await db.prepare('SELECT * FROM billing_projects WHERE user_id = ?').all(Number(userId));
  const docs = await db.prepare('SELECT project_id, kind, variant, status FROM billing_docs WHERE user_id = ?').all(Number(userId));
  const byProject = new Map();
  for (const d of docs) (byProject.get(Number(d.project_id)) || byProject.set(Number(d.project_id), []).get(Number(d.project_id))).push({ kind: d.kind, variant: Number(d.variant), status: d.status });
  return new Map(bill.map((b) => [Number(b.project_id), { legal: normalizeLegal(parse(b.legal_json, {})).values, chosen: b.chosen == null ? null : Number(b.chosen), docs: byProject.get(Number(b.project_id)) || [] }]));
}
