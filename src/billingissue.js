// Facturation : émission d'un vrai document (client, numéro, dates) en PDF, et ajout automatique de la facture à la Comptabilité.
// Une facture émise est une ligne « à encaisser » : elle n'entre dans les chiffres qu'une fois marquée payée (un chiffre d'affaires se déclare à l'encaissement).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { now } from './db.js';
import { userAccountingRoot } from './users.js';
import { DOC_BY_KEY, documentFacts, legalComplete } from './services/billing.js';
import { renderDocumentPdf } from './services/billingpdf.js';
import { LIMITS, todayIso, validDate, vatOf, slug, defaultCategory } from './services/accounting.js';

export class IssueError extends Error {}

const PREFIX = { devis: 'D', acompte: 'AC', facture: 'F', avoir: 'AV' };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);
const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(days)); return d.toISOString().slice(0, 10); };

export const invoiceDir = (cfg, userId, id) => join(cfg.dataDir, 'billing', String(Number(userId)), String(Number(id)));

/** Champs saisis à l'émission → valeurs vérifiées, ou IssueError avec une phrase claire. */
export function normalizeIssue(raw, { kind, legal, today = todayIso() }) {
  const b = raw || {};
  const clientName = clean(b.client_nom, 120);
  const clientAddress = clean(b.client_adresse, 200);
  const siret = clean(b.client_siret, 20).replace(/\s+/g, '');
  if (!clientName) throw new IssueError('Indique le nom du client.');
  if (!clientAddress) throw new IssueError("Indique l'adresse du client.");
  if (siret && !/^\d{14}$/.test(siret)) throw new IssueError('Le SIRET du client compte 14 chiffres (laisse vide pour un particulier).');
  const date = clean(b.issue_date, 10) || today;
  if (!validDate(date)) throw new IssueError('Date invalide.');
  if (date > today) throw new IssueError("La date d'émission ne peut pas être dans le futur.");
  const out = { client_nom: clientName, client_adresse: clientAddress, client_siret: siret, date, numero: '' };
  if (kind === 'devis') out.date_validite = addDays(date, legal.quote_validity_days || 30);
  if (kind === 'acompte' || kind === 'facture') out.date_echeance = addDays(date, legal.payment_terms_days || 30);
  if (kind === 'facture') {
    const prest = clean(b.date_prestation, 10) || date;
    if (!validDate(prest)) throw new IssueError('Date de prestation invalide.');
    out.date_prestation = prest;
  }
  if (kind === 'avoir') {
    out.facture_numero = clean(b.facture_numero, 40);
    if (!out.facture_numero) throw new IssueError("Indique le numéro de la facture que cet avoir corrige.");
    out.motif = clean(b.motif, 300);
  }
  return out;
}

async function nextNumber(db, userId, kind, year) {
  const prefix = `${PREFIX[kind]}-${year}-`;
  const rows = await db.prepare('SELECT number FROM billing_invoices WHERE user_id = ? AND number LIKE ?').all(Number(userId), `${prefix}%`);
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.number).slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/**
 * Émet un document validé : numéro, PDF, et pour une facture (acompte, facture finale, avoir) dont `raw.to_accounting` est coché, une ligne « à encaisser »
 * dans la Comptabilité avec le PDF comme justificatif.
 * @returns {Promise<{ id: number, number: string, entryId: number|null }>}
 */
export async function issueDocument(app, { userId, project, doc, legal, raw }) {
  const { db, cfg } = app;
  if (!DOC_BY_KEY[doc.kind]) throw new IssueError('Ce document ne peut pas être émis.');
  if (doc.status !== 'validated') throw new IssueError("Valide d'abord ce document.");
  if (!legalComplete(legal)) throw new IssueError('Complète les informations légales du projet.');
  const kind = doc.kind;
  const values = normalizeIssue(raw, { kind, legal });
  const f = documentFacts({ kind, content: doc.content, legal });
  // Une facture n'entre en comptabilité que si l'utilisateur a coché « Joindre automatiquement à la comptabilité »
  const accounting = kind !== 'devis' && ['1', 'on', 'true', true, 1].includes(raw?.to_accounting);
  if (accounting) {
    const count = Number((await db.prepare('SELECT COUNT(*) n FROM accounting_entries WHERE user_id = ?').get(Number(userId))).n);
    if (count >= LIMITS.perUserEntries) throw new IssueError('Ta comptabilité est pleine : exporte et archive les anciennes lignes.');
  }

  // Numéro : le suivant de l'année ; deux émissions simultanées se départagent par l'unicité (nouvel essai)
  let id = null;
  let number = '';
  let pdf = null;
  const at = now();
  for (let attempt = 0; attempt < 4 && id === null; attempt++) {
    number = await nextNumber(db, userId, kind, values.date.slice(0, 4));
    values.numero = number;
    pdf = renderDocumentPdf({ kind, content: doc.content, legal, layout: doc.layout, values });
    const fileName = `${slug(DOC_BY_KEY[kind].label)}-${number}.pdf`;
    try {
      id = Number((await db.prepare(`INSERT INTO billing_invoices(user_id, project_id, project_name, kind, number, issue_date, due_date, client_json, amount_cents, pdf_file, pdf_size, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(userId), project.id, project.name, kind, number, values.date, values.date_echeance || values.date_validite || '',
          JSON.stringify({ name: values.client_nom, address: values.client_adresse, siret: values.client_siret }), f.due, fileName, pdf.length, at)).lastInsertRowid);
    } catch (e) {
      if (!/unique|duplicate/i.test(String(e.message))) throw e;
    }
  }
  if (id === null) throw new IssueError('Numérotation en cours : réessaie dans un instant.');
  const fileName = `${slug(DOC_BY_KEY[kind].label)}-${number}.pdf`;
  let entryId = null;
  try {
    mkdirSync(invoiceDir(cfg, userId, id), { recursive: true });
    writeFileSync(join(invoiceDir(cfg, userId, id), fileName), pdf);
    if (accounting) {
      const amount = f.due;
      const vat = f.rate > 0 ? vatOf(amount, f.rate) : 0;
      const label = `${DOC_BY_KEY[kind].label} ${number}`;
      const note = `Émise le ${values.date.split('-').reverse().join('/')}${values.date_echeance ? `, échéance le ${values.date_echeance.split('-').reverse().join('/')}` : ''}. Facture générée dans AiTools : à marquer payée à l'encaissement.`;
      const kindKey = kind === 'avoir' ? 'refund_out' : 'payment_in';
      entryId = Number((await db.prepare(`INSERT INTO accounting_entries(user_id, project_id, project_name, kind, entry_date, label, party, category, amount_cents, vat_rate, vat_cents, method, notes,
          doc_name, doc_mime, doc_size, doc_file, pending, invoice_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .run(Number(userId), project.id, project.name, kindKey, values.date, label, values.client_nom, defaultCategory(kindKey), amount, f.rate, vat, 'transfer', note,
          fileName, 'application/pdf', pdf.length, 'justificatif.pdf', id, at, at)).lastInsertRowid);
      const dir = join(userAccountingRoot(cfg, userId), String(entryId));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'justificatif.pdf'), pdf);
      await db.prepare('UPDATE billing_invoices SET entry_id = ? WHERE id = ?').run(entryId, id);
    }
  } catch (e) {
    await db.prepare('DELETE FROM billing_invoices WHERE id = ?').run(id);
    if (entryId) await db.prepare('DELETE FROM accounting_entries WHERE id = ?').run(entryId);
    rmSync(invoiceDir(cfg, userId, id), { recursive: true, force: true });
    if (entryId) rmSync(join(userAccountingRoot(cfg, userId), String(entryId)), { recursive: true, force: true });
    throw e;
  }
  return { id, number, entryId };
}

/** Documents émis d'un projet, du plus récent au plus ancien, avec l'état de leur ligne de comptabilité. */
export async function listInvoices(db, userId, projectId) {
  const rows = await db.prepare(`SELECT i.*, e.pending AS e_pending, e.id AS e_id FROM billing_invoices i LEFT JOIN accounting_entries e ON e.id = i.entry_id AND e.user_id = i.user_id
    WHERE i.user_id = ? AND i.project_id = ? ORDER BY i.id DESC`).all(Number(userId), Number(projectId));
  return rows.map((r) => {
    let client = {};
    try { client = JSON.parse(r.client_json); } catch { client = {}; }
    const state = r.kind === 'devis' ? 'devis' : r.e_id == null ? 'hors' : Number(r.e_pending) === 1 ? 'pending' : 'paid';
    return { id: Number(r.id), kind: r.kind, number: r.number, issueDate: r.issue_date, dueDate: r.due_date, client, amount: Number(r.amount_cents), entryId: r.e_id == null ? null : Number(r.e_id), state };
  });
}
export async function getInvoice(db, userId, id) {
  return db.prepare('SELECT * FROM billing_invoices WHERE id = ? AND user_id = ?').get(Number(id), Number(userId));
}
