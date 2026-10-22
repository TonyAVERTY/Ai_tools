// Import / export CSV des prospects. Format Excel FR : ";" + BOM UTF-8.
import { now } from '../db.js';
import { EMAIL_RE } from './mailer.js';
import { httpUrl } from '../handlers.js';
import { filterWhere, STATUSES } from './crm.js';

// ---------- Écriture ----------

// Excel exécute une cellule qui commence par = + - @ : on la neutralise (OWASP CSV injection)
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16) : '');

export async function exportProspects(db, projectId, filters) {
  const { sql, args, order } = filterWhere(projectId, filters);
  const rows = await db.prepare(`SELECT * FROM prospects WHERE ${sql} ORDER BY ${order} LIMIT 10000`).all(...args);
  const header = ['Entreprise', 'Email', 'Site', 'Ville', 'Secteur', 'Score', 'Statut', 'Ajouté le', 'Contacté le', 'Objet',
    'Relancé le', 'Répondu le', 'Prochaine action', 'Échéance', 'Source', 'Accroche'];
  return toCsv(header, rows.map((p) => [
    p.company, p.email, p.website, p.city, p.sector, p.score, STATUSES[p.status] || p.status, day(p.created_at), day(p.sent_at),
    p.variant, day(p.followup_at), day(p.replied_at), p.next_action, day(p.next_action_at), p.source, p.hook,
  ]));
}

// ---------- Lecture ----------

/** CSV RFC 4180 : guillemets, "" échappés, retours à la ligne dans les cellules, séparateur ; , ou tab. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (c) => firstLine.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ALIASES = {
  company: ['entreprise', 'societe', 'company', 'nom', 'raisonsociale', 'name', 'enseigne'],
  email: ['email', 'mail', 'courriel', 'adresseemail', 'adressemail', 'emailaddress'],
  website: ['site', 'website', 'url', 'siteweb', 'siteinternet'],
  city: ['ville', 'city', 'commune', 'localite'],
  sector: ['secteur', 'sector', 'activite', 'metier', 'categorie'],
  score: ['score', 'note', 'pertinence'],
  source: ['source', 'origine'],
  hook: ['accroche', 'hook'],
};
const MAX_ROWS = 2000;

// Notre propre export préfixe les formules par ' : on l'enlève à la relecture
const unformula = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

// `limit` : places restantes dans le plan (null = illimité) ; au-delà, l'import entier est annulé avec `limitError`
export async function importProspects(db, projectId, text, { at = now(), limit = null, limitError = null } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Fichier vide ou sans en-tête');
  const header = rows[0].map(norm);
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  if (col.email === undefined) throw new Error('Colonne email introuvable (attendu : "email", "mail" ou "courriel")');
  const data = rows.slice(1);
  if (data.length > MAX_ROWS) throw new Error(`Maximum ${MAX_ROWS} lignes par import (${data.length} dans le fichier)`);

  const dateLabel = new Date(at * 1000).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  const res = { total: data.length, imported: 0, duplicates: 0, blacklisted: 0, invalid: [] };
  const seen = new Set();
  const get = (r, k, max = 200) => (col[k] === undefined ? '' : unformula(String(r[col[k]] ?? '').trim()).slice(0, max));

  // Tout ou rien : une ligne qui plante annule l'import entier
  await db.transaction(async (tx) => {
    const exists = tx.prepare('SELECT 1 FROM prospects WHERE project_id = ? AND email = ?');
    const optOut = tx.prepare('SELECT 1 FROM blacklist WHERE email = ?');
    const insert = tx.prepare(`INSERT INTO prospects(project_id, company, email, website, city, sector, score, source, hook, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [i, r] of data.entries()) {
      const line = i + 2;
      const email = get(r, 'email').toLowerCase();
      if (!EMAIL_RE.test(email)) { if (res.invalid.length < 50) res.invalid.push({ line, reason: `email invalide : "${email || 'vide'}"` }); continue; }
      if (seen.has(email) || await exists.get(projectId, email)) { res.duplicates++; continue; }
      seen.add(email);
      if (await optOut.get(email)) { res.blacklisted++; continue; }
      if (limit != null && res.imported >= limit) throw limitError || new Error('Plafond de prospects atteint');
      const s = Number(get(r, 'score'));
      await insert.run(
        projectId, get(r, 'company') || email.split('@')[1], email, httpUrl(get(r, 'website', 300)), get(r, 'city', 100) || null,
        get(r, 'sector', 100) || null, Number.isFinite(s) && s > 0 ? Math.max(1, Math.min(10, Math.round(s))) : null,
        // RGPD : on garde toujours l'origine de la donnée
        httpUrl(get(r, 'source', 300)) || get(r, 'source', 300) || `Import CSV du ${dateLabel}`, get(r, 'hook', 400) || null, at,
      );
      res.imported++;
    }
  });
  return res;
}
