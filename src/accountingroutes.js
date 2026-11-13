// Comptabilité : page, saisie des lignes (avec justificatif obligatoire), situation, déclaration, exports (justificatifs en ZIP, journal CSV).
// Tout est filtré par compte : une ligne, un justificatif ou un total n'est jamais visible d'un autre compte (réponse « introuvable »).
// Les justificatifs sont des fichiers du disque (data/compta/<compte>/<ligne>/), reconnus à leur signature (PDF, JPEG, PNG, WebP, GIF), servis sans exécution.
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, html, json, redirect, readBody } from './http.js';
import { getSetting, setSetting, now } from './db.js';
import { userAccountingRoot, getUser } from './users.js';
import { accessibleProjects } from './mailroutes.js';
import { sniff, displayName } from './chatfiles.js';
import { writeZip } from './services/zip.js';
import {
  KIND_BY_KEY, EntryError, validateEntry, normalizeSettings, REGIMES, ACTIVITIES, VAT_MODES, FREQUENCIES, todayIso, periodRange, recentPeriods, periodToDeclare,
  validDate, LIMITS, computeTotals, rowsInRange, computeAlerts, declarationGuide, buildCsv, exportFileName, extOf, slug, deadlineOf, daysLeft,
} from './services/accounting.js';
import { accountingPage } from './accountingviews.js';
import { requireFeature, hasFeature } from './services/plans.js';

const MB = 1024 * 1024;
const refuse = (status, msg) => new HttpError(status, msg, { expose: true });

/** Corps brut d'une requête (le fichier lui-même), borné. */
async function readRaw(req, max) {
  const declared = Number(req.headers['content-length']);
  if (!Number.isFinite(declared) || declared <= 0) throw refuse(411, 'Joins un justificatif (PDF ou image).');
  if (declared > max) throw refuse(413, `Fichier trop gros (${Math.round(max / MB)} Mo au plus).`);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw refuse(413, `Fichier trop gros (${Math.round(max / MB)} Mo au plus).`);
    chunks.push(c);
  }
  if (size !== declared) throw refuse(400, 'Envoi incomplet : réessaie.');
  return Buffer.concat(chunks);
}

/** Type d'un justificatif d'après sa signature : PDF ou image seulement. */
function proofType(buf, name) {
  const t = sniff(buf.subarray(0, 8192), name);
  if (!t || (t.kind !== 'pdf' && t.kind !== 'image')) throw refuse(415, 'Le justificatif doit être un PDF ou une image (JPG, PNG, WebP).');
  return t;
}

const parseEntryHeader = (req) => {
  try { return JSON.parse(decodeURIComponent(String(req.headers['x-entry'] || ''))); } catch { throw refuse(400, 'Données de la ligne illisibles : réessaie.'); }
};

export async function userAccountingSettings(db, userId) {
  const [regime, activity, vat, freq] = await Promise.all(['acc_regime', 'acc_activity', 'acc_vat', 'acc_freq'].map((k) => getSetting(db, userId, k, '')));
  return normalizeSettings({ regime, activity, vat, freq });
}

/** Options du sélecteur de période : année en cours et précédente, derniers trimestres, derniers mois. */
function periodOptions(today) {
  const y = Number(today.slice(0, 4));
  const opts = [['tout', 'Toute la période'], [String(y), `Année ${y}`], [String(y - 1), `Année ${y - 1}`]];
  for (const q of recentPeriods('quarterly', today, 5)) opts.push([q, periodRange(q).short.replace(/^./, (c) => c.toUpperCase())]);
  for (const m of recentPeriods('monthly', today, 12)) opts.push([m, periodRange(m).short.replace(/^./, (c) => c.toUpperCase())]);
  return opts;
}

export function registerAccountingRoutes(router, app) {
  const { db, cfg } = app;
  const root = (userId) => userAccountingRoot(cfg, userId);
  const entryDir = (userId, id) => join(root(userId), String(Number(id)));
  const mine = async (userId, id) => {
    const row = await db.prepare('SELECT * FROM accounting_entries WHERE id = ? AND user_id = ?').get(Number(id), Number(userId));
    if (!row) throw new HttpError(404, 'Ligne introuvable', { expose: true });
    return row;
  };
  const used = async (userId) => Number((await db.prepare('SELECT COALESCE(SUM(doc_size), 0) n FROM accounting_entries WHERE user_id = ?').get(userId)).n);

  /** Projet choisi pour une ligne : un projet auquel l'utilisateur a accès, ou aucun. Le nom est recopié (il survit à la suppression du projet). */
  const projectFor = async (userId, raw) => {
    if (raw == null || raw === '' || raw === 'none') return { id: null, name: '' };
    const p = (await accessibleProjects(db, userId)).find((x) => Number(x.id) === Number(raw));
    if (!p) throw refuse(400, 'Projet inconnu.');
    return { id: Number(p.id), name: String(p.name) };
  };

  // ---------- Page ----------
  router.get('/compta', async ({ res, url, session }) => {
    const userId = session.userId;
    const today = todayIso();
    const settings = await userAccountingSettings(db, userId);
    const q = url.searchParams;
    const periodRaw = q.get('periode') || String(today.slice(0, 4));
    const periodValue = periodRaw === 'tout' ? 'tout' : periodRange(periodRaw) ? periodRaw : today.slice(0, 4);
    const range = periodValue === 'tout' ? { from: null, to: null } : periodRange(periodValue);
    const projects = await accessibleProjects(db, userId);
    const projectFilter = q.get('projet') || '';
    const kindFilter = KIND_BY_KEY[q.get('type')] ? q.get('type') : '';
    const text = String(q.get('q') || '').trim().slice(0, 80).toLowerCase();

    const every = await db.prepare('SELECT * FROM accounting_entries WHERE user_id = ? ORDER BY entry_date DESC, id DESC').all(userId);
    // Les factures émises dans iaboss et pas encore encaissées ne comptent dans aucun chiffre : elles sont listées à part
    const all = every.filter((r) => !Number(r.pending));
    const pendingRows = every.filter((r) => Number(r.pending));
    const inPeriod = rowsInRange(all, range.from, range.to);
    const assujetti = settings.vat === 'assujetti';
    const totals = computeTotals(inPeriod, { assujetti });

    // Un groupe par projet accessible, plus « Hors projet » et les projets supprimés (leurs lignes restent, sous l'ancien nom)
    const groups = new Map(projects.map((p) => [`p${p.id}`, { key: String(p.id), label: String(p.name), rows: [] }]));
    for (const r of inPeriod) {
      const key = r.project_id != null ? `p${r.project_id}` : r.project_name ? `d${r.project_name}` : 'none';
      if (!groups.has(key)) groups.set(key, { key: r.project_id != null ? String(r.project_id) : r.project_name ? `del:${r.project_name}` : 'none', label: r.project_id == null && r.project_name ? `${r.project_name} (supprimé)` : r.project_id != null ? r.project_name : 'Hors projet', rows: [] });
      groups.get(key).rows.push(r);
    }
    if (!groups.has('none')) groups.set('none', { key: 'none', label: 'Hors projet', rows: [] });
    const projectRows = [...groups.values()].map((g) => ({ key: g.key, label: g.label, count: g.rows.length, totals: computeTotals(g.rows, { assujetti }) }));

    let list = inPeriod;
    if (projectFilter === 'none') list = list.filter((r) => r.project_id == null);
    else if (projectFilter.startsWith('del:')) list = list.filter((r) => r.project_id == null && r.project_name === projectFilter.slice(4));
    else if (/^\d+$/.test(projectFilter)) list = list.filter((r) => Number(r.project_id) === Number(projectFilter));
    if (kindFilter) list = list.filter((r) => r.kind === kindFilter);
    if (text) list = list.filter((r) => `${r.label} ${r.party}`.toLowerCase().includes(text));
    const pages = Math.max(1, Math.ceil(list.length / LIMITS.pageSize));
    const page = Math.min(pages, Math.max(1, Number(q.get('page')) || 1));
    const rows = list.slice((page - 1) * LIMITS.pageSize, page * LIMITS.pageSize);

    const doneRows = await db.prepare('SELECT period FROM accounting_declarations WHERE user_id = ?').all(userId);
    const done = new Set(doneRows.map((r) => r.period));
    const alerts = computeAlerts({ rows: all, settings, today, done });

    // Déclaration : la période à faire maintenant (ou celle demandée), calculée sur TOUS les projets
    const due = settings.complete && settings.regime !== 'unknown' ? periodToDeclare(settings.freq, today) : null;
    const next = due ? { period: due, label: periodRange(due).label, deadline: deadlineOf(due, settings.regime), done: done.has(due) } : null;
    if (next?.deadline) next.left = daysLeft(next.deadline, today);
    let guide = null;
    let declPeriod = null;
    if (q.has('declarer')) {
      const asked = q.get('declarer');
      const freq = settings.freq;
      declPeriod = periodRange(asked) && periodRange(asked).kind !== 'year' ? asked : (due || periodToDeclare(freq, today));
      const r = periodRange(declPeriod);
      const periodTotals = computeTotals(rowsInRange(all, r.from, r.to), { assujetti });
      guide = { ...declarationGuide({ settings, period: declPeriod, totals: periodTotals }), period: declPeriod, periodLabel: r.label, done: done.has(declPeriod), totals: periodTotals };
    }
    const declOptions = recentPeriods(settings.freq, today, 8).map((p) => [p, periodRange(p).short]);

    html(res, accountingPage({
      email: session.email, today, settings, projects, periodValue, periodOptions: periodOptions(today), periodLabel: periodValue === 'tout' ? 'toute la période' : periodRange(periodValue).label,
      filters: { projet: projectFilter, type: kindFilter, q: String(q.get('q') || '').slice(0, 80) },
      totals, projectRows, rows, total: list.length, count: all.length, pendingRows, page, pages, alerts, next, guide, declOptions,
      canExport: hasFeature(await getUser(db, session.userId), 'comptaExport'), editSituation: q.get('situation') === '1', usedBytes: await used(userId), limits: LIMITS, error: q.get('e'), saved: q.get('ok'),
    }));
  });

  // ---------- Situation (régime, activité, TVA, fréquence) ----------
  router.post('/compta/situation', async ({ req, res, session, url }) => {
    const b = await readBody(req);
    const asJson = url.searchParams.get('json') === '1'; // fin de l'assistant (public/app.js) : l'enregistrement part pendant la scène de fin
    const pick = (v, list) => (list.some(([k]) => k === v) ? v : '');
    const regime = pick(b.regime, REGIMES);
    const activity = pick(b.activity, ACTIVITIES);
    const vat = pick(b.vat, VAT_MODES);
    const freq = pick(b.freq, FREQUENCIES) || 'quarterly';
    if (!regime && asJson) throw refuse(400, 'Choisis ton statut pour continuer.');
    if (!regime) return redirect(res, '/compta?e=' + encodeURIComponent('Choisis ta situation pour continuer.') + '#situation');
    await setSetting(db, session.userId, 'acc_regime', regime);
    await setSetting(db, session.userId, 'acc_activity', activity || 'services');
    await setSetting(db, session.userId, 'acc_vat', vat || (regime === 'reel' ? 'assujetti' : 'franchise'));
    await setSetting(db, session.userId, 'acc_freq', freq);
    if (asJson) return json(res, { ok: true });
    redirect(res, '/compta?ok=situation');
  }, { limit: 'compta' });

  // ---------- Déclaration faite / à refaire ----------
  router.post('/compta/declaration', async ({ req, res, session }) => {
    const b = await readBody(req);
    const r = periodRange(b.period);
    if (!r || r.kind === 'year') throw refuse(400, 'Période inconnue.');
    if (b.done === '0' || b.done === 0) await db.prepare('DELETE FROM accounting_declarations WHERE user_id = ? AND period = ?').run(session.userId, b.period);
    else await db.prepare('INSERT OR IGNORE INTO accounting_declarations(user_id, period, done_at) VALUES(?, ?, ?)').run(session.userId, b.period, now());
    redirect(res, `/compta?declarer=${encodeURIComponent(b.period)}&ok=declaration#declaration`);
  }, { limit: 'compta' });

  // ---------- Créer une ligne : le corps est le justificatif, les champs sont dans X-Entry ----------
  router.post('/api/compta/entries', async ({ req, res, session }) => {
    const userId = session.userId;
    const fields = parseEntryHeader(req);
    const settings = await userAccountingSettings(db, userId);
    let v;
    try { v = validateEntry(fields, { vatMode: settings.vat }); } catch (e) { if (e instanceof EntryError) throw refuse(400, e.message); throw e; }
    const project = await projectFor(userId, fields.projectId);
    const count = Number((await db.prepare('SELECT COUNT(*) n FROM accounting_entries WHERE user_id = ?').get(userId)).n);
    if (count >= LIMITS.perUserEntries) throw refuse(429, `Tu as atteint ${LIMITS.perUserEntries.toLocaleString('fr-FR')} lignes : exporte et archive les anciennes.`);
    const buf = await readRaw(req, LIMITS.fileBytes);
    const name = (() => { try { return displayName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { return displayName(''); } })();
    const type = proofType(buf, name);
    if ((await used(userId)) + buf.length > LIMITS.perUserBytes) throw refuse(413, `Espace plein (${Math.round(LIMITS.perUserBytes / MB)} Mo) : exporte puis supprime d'anciens justificatifs.`);
    const at = now();
    const file = `justificatif.${type.ext}`;
    const id = Number((await db.prepare(`INSERT INTO accounting_entries(user_id, project_id, project_name, kind, entry_date, label, party, category, amount_cents, vat_rate, vat_cents, method, notes,
        doc_name, doc_mime, doc_size, doc_file, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, project.id, project.name, v.kind, v.date, v.label, v.party, v.category, v.amount, v.vatRate, v.vat, v.method, v.notes, name, type.mime, buf.length, file, at, at)).lastInsertRowid);
    try {
      mkdirSync(entryDir(userId, id), { recursive: true });
      writeFileSync(join(entryDir(userId, id), file), buf);
    } catch (e) {
      await db.prepare('DELETE FROM accounting_entries WHERE id = ?').run(id);
      rmSync(entryDir(userId, id), { recursive: true, force: true });
      throw e;
    }
    json(res, { ok: true, id });
  }, { limit: 'compta' });

  // ---------- Modifier les champs d'une ligne (le justificatif reste) ----------
  router.post('/api/compta/entries/:id', async ({ req, res, params, session }) => {
    const row = await mine(session.userId, params.id);
    const b = await readBody(req);
    const settings = await userAccountingSettings(db, session.userId);
    let v;
    try { v = validateEntry(b, { vatMode: settings.vat }); } catch (e) { if (e instanceof EntryError) throw refuse(400, e.message); throw e; }
    const project = b.projectId === undefined ? { id: row.project_id, name: row.project_name } : await projectFor(session.userId, b.projectId);
    await db.prepare(`UPDATE accounting_entries SET project_id = ?, project_name = ?, kind = ?, entry_date = ?, label = ?, party = ?, category = ?, amount_cents = ?, vat_rate = ?, vat_cents = ?,
        method = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(project.id, project.name, v.kind, v.date, v.label, v.party, v.category, v.amount, v.vatRate, v.vat, v.method, v.notes, now(), row.id, session.userId);
    json(res, { ok: true, id: Number(row.id) });
  }, { limit: 'compta' });

  // ---------- Remplacer le justificatif ----------
  router.post('/api/compta/entries/:id/file', async ({ req, res, params, session }) => {
    const row = await mine(session.userId, params.id);
    const buf = await readRaw(req, LIMITS.fileBytes);
    const name = (() => { try { return displayName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { return displayName(''); } })();
    const type = proofType(buf, name);
    if ((await used(session.userId)) - Number(row.doc_size) + buf.length > LIMITS.perUserBytes) throw refuse(413, `Espace plein (${Math.round(LIMITS.perUserBytes / MB)} Mo).`);
    const file = `justificatif.${type.ext}`;
    const dir = entryDir(session.userId, row.id);
    mkdirSync(dir, { recursive: true });
    if (row.doc_file !== file) rmSync(join(dir, row.doc_file), { force: true });
    writeFileSync(join(dir, file), buf);
    await db.prepare('UPDATE accounting_entries SET doc_name = ?, doc_mime = ?, doc_size = ?, doc_file = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(name, type.mime, buf.length, file, now(), row.id, session.userId);
    json(res, { ok: true });
  }, { limit: 'compta' });

  // ---------- Facture émise : marquée payée (elle entre alors dans les chiffres, à la date d'encaissement) ----------
  router.post('/compta/entries/:id/paid', async ({ req, res, params, session }) => {
    const row = await mine(session.userId, params.id);
    if (!Number(row.pending)) throw refuse(400, 'Cette ligne est déjà payée.');
    const b = await readBody(req);
    const date = String(b.date || todayIso()).slice(0, 10);
    if (!validDate(date)) throw refuse(400, 'Date invalide.');
    if (date > todayIso()) throw refuse(400, 'La date de paiement ne peut pas être dans le futur.');
    await db.prepare('UPDATE accounting_entries SET pending = 0, entry_date = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(date, now(), row.id, session.userId);
    redirect(res, '/compta?ok=payee#journal');
  }, { limit: 'compta' });

  // ---------- Supprimer une ligne et son justificatif ----------
  router.post('/compta/entries/:id/delete', async ({ res, params, session }) => {
    const row = await mine(session.userId, params.id);
    await db.prepare('DELETE FROM accounting_entries WHERE id = ? AND user_id = ?').run(row.id, session.userId);
    rmSync(entryDir(session.userId, row.id), { recursive: true, force: true });
    redirect(res, '/compta?ok=supprimee');
  }, { limit: 'compta' });

  // ---------- Voir ou télécharger un justificatif ----------
  router.get('/compta/entries/:id/file', async ({ res, params, url, session }) => {
    const row = await mine(session.userId, params.id);
    const path = join(entryDir(session.userId, row.id), row.doc_file);
    if (!existsSync(path)) throw new HttpError(404, 'Justificatif introuvable', { expose: true });
    const data = readFileSync(path);
    const download = url.searchParams.has('telecharger');
    const fname = `${row.entry_date}_${slug(row.label)}.${extOf(row.doc_mime)}`;
    res.writeHead(200, {
      'Content-Type': row.doc_mime, 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fname}"`,
      // Document du compte, jamais exécuté : ni script, ni réseau
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    });
    res.end(data);
  }, { limit: 'compta' });

  // ---------- Exports ----------
  /** Lignes à exporter : un projet (« projet=12 »), les lignes hors projet (« projet=none »), ou tout ; éventuellement une période. */
  const exportRows = async (userId, q) => {
    const period = q.get('periode');
    const r = period && period !== 'tout' ? periodRange(period) : null;
    let rows = await db.prepare('SELECT * FROM accounting_entries WHERE user_id = ? AND pending = 0 ORDER BY entry_date, id').all(userId);
    if (r) rows = rowsInRange(rows, r.from, r.to);
    const proj = q.get('projet') || '';
    let label = 'tous-les-projets';
    if (proj === 'none') { rows = rows.filter((x) => x.project_id == null && !x.project_name); label = 'hors-projet'; }
    else if (proj.startsWith('del:')) { const n = proj.slice(4); rows = rows.filter((x) => x.project_id == null && x.project_name === n); label = slug(n); }
    else if (/^\d+$/.test(proj)) { rows = rows.filter((x) => Number(x.project_id) === Number(proj)); label = slug(rows[0]?.project_name || `projet-${proj}`); }
    return { rows, label, period: r ? period : 'tout' };
  };

  router.get('/compta/export', async ({ res, url, session }) => {
    await requireFeature(db, session.userId, 'comptaExport');
    const { rows, label, period } = await exportRows(session.userId, url.searchParams);
    if (!rows.length) throw new HttpError(404, 'Aucun justificatif à exporter pour cette sélection.', { expose: true });
    const folder = (r) => (r.project_name ? r.project_name.replace(/[\\/]+/g, '-') : 'Hors projet');
    const single = !!url.searchParams.get('projet'); // un seul projet : pas de sous-dossiers
    const pathOf = (r) => `${single ? '' : `${folder(r)}/`}justificatifs/${exportFileName(r)}`;
    const files = [];
    const missing = [];
    for (const r of rows) {
      const path = join(entryDir(session.userId, r.id), r.doc_file);
      if (!existsSync(path)) { missing.push(r); continue; }
      files.push({ name: pathOf(r), read: () => readFileSync(path), mtime: new Date(Number(r.created_at) * 1000) });
    }
    const csv = buildCsv(rows, { fileOf: (r) => (missing.includes(r) ? 'fichier manquant' : pathOf(r)) });
    const readme = [`Archive générée par iaboss le ${todayIso()}.`, '', `Contenu : ${files.length} justificatif(s) et le journal (journal.csv).`,
      `Sélection : ${label.replace(/-/g, ' ')}${period !== 'tout' ? `, période ${period}` : ''}.`, '',
      'journal.csv : une ligne par écriture (séparateur « ; », virgule décimale), avec le chemin du justificatif.',
      'Les entrées sont positives, les sorties négatives. Transmets cette archive telle quelle à ton comptable.', ''].join('\r\n');
    const all = [{ name: 'LISEZMOI.txt', read: () => Buffer.from(readme, 'utf8') }, { name: 'journal.csv', read: () => Buffer.from(csv, 'utf8') }, ...files];
    const name = `comptabilite-${label}${period !== 'tout' ? `-${period}` : ''}-${todayIso()}.zip`;
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    await writeZip(res, all);
    res.end();
  }, { limit: 'compta_export' });

  router.get('/compta/journal.csv', async ({ res, url, session }) => {
    await requireFeature(db, session.userId, 'comptaExport');
    const { rows, label, period } = await exportRows(session.userId, url.searchParams);
    const csv = buildCsv(rows);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="journal-${label}${period !== 'tout' ? `-${period}` : ''}-${todayIso()}.csv"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(csv);
  }, { limit: 'compta_export' });
}
