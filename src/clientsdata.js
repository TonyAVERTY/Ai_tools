// Page Clients : clients d'un projet (coordonnées, notes), prospects, documents émis et échanges d'un client. Tout est filtré par compte ET par projet.
import { now } from './db.js';
import { addNote } from './services/crm.js';

export class ClientError extends Error {}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, max);
const likeOf = (q) => `%${String(q || '').replace(/[!%_]/g, (c) => `!${c}`)}%`;

/** Champs d'un client, vérifiés. `partial` : seuls les champs présents sont renvoyés (modification). */
export function cleanClient(raw, { partial = false } = {}) {
  const b = raw || {};
  const has = (k) => Object.hasOwn(b, k);
  const out = {};
  if (!partial || has('name')) {
    out.name = clean(b.name, 120);
    if (!out.name) throw new ClientError('Indique le nom du client.');
  }
  if (!partial || has('address')) out.address = clean(b.address, 200);
  if (!partial || has('siret')) {
    out.siret = clean(b.siret, 20).replace(/\s+/g, '');
    if (out.siret && !/^\d{14}$/.test(out.siret)) throw new ClientError('Le SIRET compte 14 chiffres (laisse vide pour un particulier).');
  }
  if (!partial || has('email')) {
    out.email = clean(b.email, 255).toLowerCase();
    if (out.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(out.email)) throw new ClientError("L'adresse e-mail n'est pas valide.");
  }
  if (!partial || has('phone')) out.phone = clean(b.phone, 40);
  if (!partial || has('contact')) out.contact = clean(b.contact, 120);
  if (!partial || has('notes')) out.notes = String(b.notes ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ').trim().slice(0, 2000);
  return out;
}

const shape = (r) => ({
  id: Number(r.id), projectId: Number(r.project_id), name: r.name, address: r.address || '', siret: r.siret || '', email: r.email || '', phone: r.phone || '', contact: r.contact || '',
  notes: r.notes || '', prospectId: r.prospect_id == null ? null : Number(r.prospect_id), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

export async function getClient(db, userId, id) {
  const r = await db.prepare('SELECT * FROM billing_clients WHERE id = ? AND user_id = ?').get(Number(id), Number(userId));
  return r ? shape(r) : null;
}

export async function createClient(db, userId, projectId, raw, { prospectId = null } = {}) {
  const c = cleanClient(raw);
  const dup = await db.prepare('SELECT id FROM billing_clients WHERE user_id = ? AND project_id = ? AND LOWER(name) = ?').get(Number(userId), Number(projectId), c.name.toLowerCase());
  if (dup) throw new ClientError('Un client porte déjà ce nom dans ce projet.');
  const at = now();
  return Number((await db.prepare(`INSERT INTO billing_clients(user_id, project_id, name, address, siret, email, phone, contact, notes, prospect_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(userId), Number(projectId), c.name, c.address, c.siret, c.email, c.phone, c.contact, c.notes, prospectId, at, at)).lastInsertRowid);
}

export async function updateClient(db, userId, id, raw) {
  const cur = await getClient(db, userId, id);
  if (!cur) return null;
  const f = cleanClient(raw, { partial: true });
  if (f.name !== undefined && f.name.toLowerCase() !== cur.name.toLowerCase()) {
    const dup = await db.prepare('SELECT id FROM billing_clients WHERE user_id = ? AND project_id = ? AND LOWER(name) = ? AND id <> ?').get(Number(userId), cur.projectId, f.name.toLowerCase(), cur.id);
    if (dup) throw new ClientError('Un client porte déjà ce nom dans ce projet.');
  }
  const keys = Object.keys(f);
  if (!keys.length) return cur;
  await db.prepare(`UPDATE billing_clients SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...keys.map((k) => f[k]), now(), cur.id, Number(userId));
  return getClient(db, userId, id);
}

/** Retire un client de la liste : ses documents émis restent (ils perdent seulement le lien). */
export async function removeClient(db, userId, id) {
  await db.prepare('UPDATE billing_invoices SET client_id = NULL WHERE client_id = ? AND user_id = ?').run(Number(id), Number(userId));
  await db.prepare('DELETE FROM billing_clients WHERE id = ? AND user_id = ?').run(Number(id), Number(userId));
}

/**
 * Les prospects passés au statut « Client » (CRM, API) deviennent des clients de la page Clients : un client par prospect, jamais de doublon.
 * Un client déjà saisi sous le même nom est relié au prospect plutôt que dupliqué.
 */
export async function syncProspectClients(db, userId, projectId) {
  const rows = await db.prepare(`SELECT x.id, x.company, x.email, x.city FROM prospects x WHERE x.project_id = ? AND x.status = 'client'
    AND NOT EXISTS (SELECT 1 FROM billing_clients c WHERE c.prospect_id = x.id AND c.user_id = ?)`).all(Number(projectId), Number(userId));
  for (const x of rows) {
    const same = await db.prepare('SELECT id FROM billing_clients WHERE user_id = ? AND project_id = ? AND LOWER(name) = ? AND prospect_id IS NULL').get(Number(userId), Number(projectId), String(x.company).toLowerCase());
    if (same) { await db.prepare('UPDATE billing_clients SET prospect_id = ? WHERE id = ?').run(x.id, same.id); continue; }
    const taken = await db.prepare('SELECT id FROM billing_clients WHERE user_id = ? AND project_id = ? AND LOWER(name) = ?').get(Number(userId), Number(projectId), String(x.company).toLowerCase());
    const name = taken ? `${String(x.company).slice(0, 100)} (${x.email})`.slice(0, 120) : String(x.company).slice(0, 120);
    await createClient(db, userId, projectId, { name, address: x.city || '', email: x.email }, { prospectId: Number(x.id) }).catch(() => null);
  }
}

/** Prospect → client : le prospect passe au statut « Client » et une fiche client est créée (ou retrouvée). */
export async function convertProspect(db, userId, projectId, prospectId) {
  const p = await db.prepare('SELECT id, company, email, city, status FROM prospects WHERE id = ? AND project_id = ?').get(Number(prospectId), Number(projectId));
  if (!p) return null;
  await db.prepare("UPDATE prospects SET status = 'client' WHERE id = ?").run(p.id);
  await syncProspectClients(db, userId, projectId);
  const c = await db.prepare('SELECT id FROM billing_clients WHERE user_id = ? AND prospect_id = ?').get(Number(userId), p.id);
  return c ? Number(c.id) : null;
}

// ---------- Documents émis d'un client ----------

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

/** Documents émis d'un projet avec l'état de leur ligne de comptabilité (devis, à encaisser, payée, non jointe). */
async function projectInvoices(db, userId, projectId) {
  const rows = await db.prepare(`SELECT i.*, e.pending AS e_pending, e.id AS e_id FROM billing_invoices i LEFT JOIN accounting_entries e ON e.id = i.entry_id AND e.user_id = i.user_id
    WHERE i.user_id = ? AND i.project_id = ? ORDER BY i.id DESC`).all(Number(userId), Number(projectId));
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind, number: r.number, issueDate: r.issue_date, dueDate: r.due_date, amount: Number(r.amount_cents), clientId: r.client_id == null ? null : Number(r.client_id),
    clientName: String(parse(r.client_json).name || ''), entryId: r.e_id == null ? null : Number(r.e_id),
    state: r.kind === 'devis' ? 'devis' : r.e_id == null ? 'hors' : Number(r.e_pending) === 1 ? 'pending' : 'paid',
  }));
}

const belongs = (i, c) => i.clientId === c.id || (i.clientId === null && i.clientName.toLowerCase() === c.name.toLowerCase());

/** Chiffres d'un client : facturé (acomptes et factures finales, moins les avoirs), déjà encaissé, reste à encaisser (factures jointes à la Comptabilité seulement). */
export function clientTotals(invoices) {
  let billed = 0; let paid = 0; let pending = 0;
  for (const i of invoices) {
    if (i.kind === 'devis') continue;
    const sign = i.kind === 'avoir' ? -1 : 1;
    billed += sign * i.amount;
    if (i.state === 'paid') paid += sign * i.amount;
    else if (i.state === 'pending') pending += sign * i.amount;
  }
  return { billed, paid, pending, docs: invoices.length };
}

export async function clientDocuments(db, userId, client) {
  return (await projectInvoices(db, userId, client.projectId)).filter((i) => belongs(i, client));
}

// ---------- Listes d'un projet ----------

/** Clients d'un projet (recherche : nom, e-mail, contact, ville dans l'adresse), avec leurs chiffres. */
export async function listProjectClients(db, userId, projectId, { q = '', limit = 30 } = {}) {
  await syncProspectClients(db, userId, projectId);
  const args = [Number(userId), Number(projectId)];
  let where = 'user_id = ? AND project_id = ?';
  const query = String(q || '').trim().slice(0, 100);
  if (query) {
    where += " AND (name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR contact LIKE ? ESCAPE '!' OR address LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!')";
    const l = likeOf(query);
    args.push(l, l, l, l, l);
  }
  const total = Number((await db.prepare(`SELECT COUNT(*) n FROM billing_clients WHERE ${where}`).get(...args)).n);
  const rows = (await db.prepare(`SELECT * FROM billing_clients WHERE ${where} ORDER BY LOWER(name), id LIMIT ?`).all(...args, Number(limit))).map(shape);
  const invoices = await projectInvoices(db, userId, projectId);
  return { total, rows: rows.map((c) => ({ ...c, totals: clientTotals(invoices.filter((i) => belongs(i, c))) })) };
}

/** Prospects d'un projet qui ne sont pas (encore) clients. */
export async function listProjectProspects(db, projectId, { q = '', limit = 30 } = {}) {
  const args = [Number(projectId)];
  let where = "project_id = ? AND status <> 'client'";
  const query = String(q || '').trim().slice(0, 100);
  if (query) {
    where += " AND (company LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR city LIKE ? ESCAPE '!' OR sector LIKE ? ESCAPE '!')";
    const l = likeOf(query);
    args.push(l, l, l, l);
  }
  const total = Number((await db.prepare(`SELECT COUNT(*) n FROM prospects WHERE ${where}`).get(...args)).n);
  const rows = await db.prepare(`SELECT id, company, email, city, sector, status, score, sent_at, replied_at FROM prospects WHERE ${where} ORDER BY LOWER(company), id LIMIT ?`).all(...args, Number(limit));
  return { total, rows: rows.map((r) => ({ id: Number(r.id), company: r.company, email: r.email, city: r.city || '', sector: r.sector || '', status: r.status, score: r.score == null ? null : Number(r.score), sentAt: r.sent_at == null ? null : Number(r.sent_at), repliedAt: r.replied_at == null ? null : Number(r.replied_at) })) };
}

/** Compteurs de la ligne repliée de chaque projet : clients, prospects, reste à encaisser (factures jointes à la Comptabilité). */
export async function clientsOverview(db, userId, projectIds) {
  const m = new Map();
  for (const id of projectIds) {
    await syncProspectClients(db, userId, id);
    m.set(Number(id), { clients: 0, prospects: 0, pending: 0 });
  }
  const clients = await db.prepare('SELECT project_id, COUNT(*) n FROM billing_clients WHERE user_id = ? GROUP BY project_id').all(Number(userId));
  const prospects = await db.prepare("SELECT project_id, COUNT(*) n FROM prospects WHERE status <> 'client' AND project_id IN (SELECT id FROM projects WHERE user_id = ?) GROUP BY project_id").all(Number(userId));
  const pending = await db.prepare(`SELECT i.project_id, SUM(CASE WHEN i.kind = 'avoir' THEN -i.amount_cents ELSE i.amount_cents END) n FROM billing_invoices i JOIN accounting_entries e ON e.id = i.entry_id
    WHERE i.user_id = ? AND e.pending = 1 GROUP BY i.project_id`).all(Number(userId));
  for (const r of clients) if (m.has(Number(r.project_id))) m.get(Number(r.project_id)).clients = Number(r.n);
  for (const r of prospects) if (m.has(Number(r.project_id))) m.get(Number(r.project_id)).prospects = Number(r.n);
  for (const r of pending) if (m.has(Number(r.project_id))) m.get(Number(r.project_id)).pending = Number(r.n);
  return m;
}

// ---------- Échanges ----------

/**
 * Tous les échanges avec un client, du plus récent au plus ancien : mails envoyés, réponses reçues, notes du CRM.
 * Rattachés par le prospect dont le client vient, ou par l'adresse e-mail du client (dans le même projet seulement).
 */
export async function clientExchanges(db, client) {
  const email = client.email.toLowerCase();
  const pid = client.prospectId;
  const items = [];
  if (pid || email) {
    const mailArgs = [client.projectId, pid ?? -1, email || '\u0000'];
    // Un prospect dont l'adresse a rejeté le mail : le dernier mail parti est celui qui a été rejeté (la raison est dans `note` quand le serveur du destinataire l'a donnée)
    const bouncing = pid ? (await db.prepare('SELECT status FROM prospects WHERE id = ? AND project_id = ?').get(pid, client.projectId))?.status === 'bounced' : false;
    let lastSent = true;
    for (const m of await db.prepare('SELECT kind, subject, sent_at, error, read_at, body, note, email FROM mail_log WHERE project_id = ? AND (prospect_id = ? OR LOWER(email) = ?) ORDER BY sent_at DESC LIMIT 200').all(...mailArgs)) {
      const bounced = bouncing && lastSent && !m.error;
      if (!m.error) lastSent = false;
      items.push({
        type: 'sent', at: Number(m.sent_at), subject: m.subject || '', kind: m.kind, error: m.error || '', read: m.read_at != null,
        to: m.email || '', body: String(m.body || '').slice(0, 20000), bounced, note: bounced ? String(m.note || '') : '',
      });
    }
    for (const r of await db.prepare('SELECT subject, body, intent, received_at FROM replies WHERE project_id = ? AND (prospect_id = ? OR LOWER(from_email) = ?) ORDER BY received_at DESC LIMIT 200').all(...mailArgs)) {
      items.push({ type: 'reply', at: Number(r.received_at), subject: r.subject || '', body: String(r.body || '').slice(0, 1500), intent: r.intent });
    }
  }
  if (pid) {
    for (const n of await db.prepare('SELECT body, created_at FROM prospect_notes WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 100').all(pid)) {
      items.push({ type: 'note', at: Number(n.created_at), body: n.body });
    }
  }
  return items.sort((a, b) => b.at - a.at);
}

/** Fiche d'un prospect du projet : infos, échanges (mails, réponses, notes). */
export async function prospectSheet(db, projectId, id) {
  const p = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(id), Number(projectId));
  if (!p) return null;
  const items = await clientExchanges(db, { projectId: Number(projectId), prospectId: Number(id), email: p.email || '' });
  return { prospect: p, exchanges: items };
}

export async function addProspectNote(db, projectId, prospectId, body) {
  const p = await db.prepare('SELECT id FROM prospects WHERE id = ? AND project_id = ?').get(Number(prospectId), Number(projectId));
  return p ? addNote(db, Number(prospectId), body) : null;
}

/** CSV des clients d'un projet (séparateur « ; », encodage UTF-8 avec BOM : s'ouvre directement dans Excel). */
export function clientsCsv(rows, fmtMoney) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['Nom', 'Contact', 'E-mail', 'Téléphone', 'Adresse', 'SIRET', 'Documents', 'Facturé TTC', 'Encaissé', 'À encaisser', 'Notes'];
  const lines = rows.map((c) => [c.name, c.contact, c.email, c.phone, c.address, c.siret, c.totals.docs, fmtMoney(c.totals.billed), fmtMoney(c.totals.paid), fmtMoney(c.totals.pending), c.notes].map(cell).join(';'));
  return `﻿${[head.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
}
