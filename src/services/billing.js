// Facturation : informations légales d'un projet, contenu des documents (devis, acompte, facture finale, avoir), calculs et rendu HTML.
// Règle de fond : Claude écrit le TEXTE (accroches, lignes de prestation, conditions) ; le code fixe tout ce qui engage juridiquement
// (identité de l'émetteur, mentions de TVA, délais et pénalités de paiement, totaux). Une mention légale n'est donc jamais inventée par une IA.
// Pur calcul : aucun accès à la base ; la seule lecture de fichiers est celle des faits du dépôt (suggestFromRepo).
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { parseAmountCents, fmtEur } from './accounting.js';

// ---------- Informations légales ----------

export const LEGAL_FORMS = [['micro', 'Micro-entrepreneur'], ['ei', 'Entreprise individuelle'], ['eurl', 'EURL'], ['sarl', 'SARL'], ['sas', 'SAS'], ['sasu', 'SASU'], ['other', 'Autre forme']];
export const COMPANY_FORMS = new Set(['eurl', 'sarl', 'sas', 'sasu']);
export const formLabel = (k) => LEGAL_FORMS.find(([f]) => f === k)?.[1] || k;
export const VAT_RATES_BILLING = [[2000, '20 %'], [1000, '10 %'], [550, '5,5 %'], [210, '2,1 %']];

const EMAIL = /^[^\s@<>()"',;:]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const trim = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

/** Clé de contrôle d'un IBAN (modulo 97). */
function ibanOk(s) {
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of r) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

const isCompany = (v) => COMPANY_FORMS.has(v.legal_form);
const isVat = (v) => v.vat_mode === 'assujetti';

/**
 * Les champs légaux, dans l'ordre d'affichage. `required` : fonction des valeurs. `clean` : normalisation ; `check` : message d'erreur ou ''.
 * `section` : regroupement dans le formulaire.
 */
export const LEGAL_FIELDS = [
  { key: 'legal_form', section: 'identity', label: 'Forme juridique', type: 'select', options: LEGAL_FORMS, required: () => true, hint: "Elle figure sur tes factures. Pas sûr ? Elle est sur ton avis de situation INSEE.",
    check: (v) => (LEGAL_FORMS.some(([k]) => k === v) ? '' : 'Choisis ta forme juridique.') },
  { key: 'legal_name', section: 'identity', label: 'Nom ou raison sociale', type: 'text', max: 120, required: () => true, placeholder: 'Tony Averty, ou Ma Société SAS', hint: 'Le nom exact de ton activité, tel qu\'il est enregistré.' },
  { key: 'siret', section: 'identity', label: 'Numéro SIRET', type: 'text', max: 20, required: () => true, placeholder: '123 456 789 00012', hint: '14 chiffres. Gratuit sur avis-situation-sirene.insee.fr.',
    clean: (v) => v.replace(/[\s.]/g, ''), check: (v) => (/^\d{14}$/.test(v) ? '' : 'Le SIRET compte 14 chiffres.') },
  { key: 'capital', section: 'identity', label: 'Capital social', type: 'text', max: 20, required: (v) => COMPANY_FORMS.has(v.legal_form), unit: '€', placeholder: '1 000', hint: 'Pour les sociétés (EURL, SARL, SAS, SASU).',
    check: (v) => (!v || parseAmountCents(v) ? '' : 'Le capital est un montant (exemple : 1 000).') },
  { key: 'rcs', section: 'identity', label: 'Immatriculation (RCS ou RM)', type: 'text', max: 80, required: (v) => COMPANY_FORMS.has(v.legal_form), placeholder: 'RCS Rennes 123 456 789', hint: 'Greffe et numéro, pour les sociétés. Les artisans indiquent « RM » et leur département.' },
  { key: 'activity_label', section: 'identity', label: 'Ton activité en une phrase', type: 'text', max: 160, required: () => true, placeholder: "Développement d'applications web sur mesure", hint: "Ce que tu vends, dans les mots de tes clients." },
  { key: 'address', section: 'address', label: 'Adresse', type: 'text', max: 160, required: () => true, placeholder: '12 rue des Lilas' },
  { key: 'postal_code', section: 'address', label: 'Code postal', type: 'text', max: 10, required: () => true, placeholder: '35000', clean: (v) => v.replace(/\s/g, ''), check: (v) => (/^\d{5}$/.test(v) ? '' : 'Le code postal compte 5 chiffres.') },
  { key: 'city', section: 'address', label: 'Ville', type: 'text', max: 80, required: () => true, placeholder: 'Rennes' },
  { key: 'vat_mode', section: 'tax', label: 'TVA', type: 'select', options: [['franchise', 'Je ne facture pas la TVA (franchise en base)'], ['assujetti', 'Je facture la TVA']], required: () => true,
    hint: 'Si tes factures indiquent « TVA non applicable, art. 293 B du CGI », tu es en franchise.', check: (v) => (['franchise', 'assujetti'].includes(v) ? '' : 'Dis si tu factures la TVA.') },
  { key: 'vat_number', section: 'tax', label: 'N° de TVA intracommunautaire', type: 'text', max: 20, required: isVat, placeholder: 'FR12 345678901', hint: 'Seulement si tu factures la TVA.',
    clean: (v) => v.replace(/\s/g, '').toUpperCase(), check: (v) => (!v || /^FR[0-9A-Z]{2}\d{9}$/.test(v) ? '' : 'Le numéro de TVA français commence par FR (par exemple FR12345678901).') },
  { key: 'vat_rate', section: 'tax', label: 'Taux de TVA habituel', type: 'select', options: VAT_RATES_BILLING.map(([r, l]) => [String(r), l]), required: isVat, hint: 'Le plus courant est 20 %.',
    check: (v) => (!v || VAT_RATES_BILLING.some(([r]) => String(r) === v) ? '' : 'Taux de TVA inconnu.') },
  { key: 'email', section: 'contact', label: 'E-mail de contact', type: 'text', max: 120, required: () => true, placeholder: 'contact@mon-entreprise.fr', clean: (v) => v.toLowerCase(), check: (v) => (EMAIL.test(v) ? '' : "L'adresse e-mail est invalide.") },
  { key: 'phone', section: 'contact', label: 'Téléphone', type: 'text', max: 30, required: () => false, placeholder: '06 12 34 56 78', check: (v) => (!v || /^[0-9 +().-]{6,30}$/.test(v) ? '' : 'Le numéro de téléphone est invalide.') },
  { key: 'website', section: 'contact', label: 'Site internet', type: 'text', max: 200, required: () => false, placeholder: 'https://mon-entreprise.fr',
    check: (v) => (!v || /^https?:\/\/[^\s<>"']+$/i.test(v) ? '' : "L'adresse du site doit commencer par https://.") },
  { key: 'iban', section: 'payment', label: 'IBAN', type: 'text', max: 40, required: () => false, placeholder: 'FR76 1234 5678 9012 3456 7890 123', hint: 'Facultatif, mais utile : il est imprimé sur tes factures pour te faire payer.',
    clean: (v) => v.replace(/\s/g, '').toUpperCase(), check: (v) => (!v || (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v) && ibanOk(v)) ? '' : "L'IBAN semble invalide : vérifie-le.") },
  { key: 'bic', section: 'payment', label: 'BIC', type: 'text', max: 14, required: () => false, placeholder: 'BNPAFRPP', clean: (v) => v.replace(/\s/g, '').toUpperCase(),
    check: (v) => (!v || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) ? '' : 'Le BIC semble invalide.') },
  { key: 'payment_terms_days', section: 'payment', label: 'Délai de paiement', type: 'number', unit: 'jours', required: () => true, dflt: '30', hint: 'Entre 0 et 60 jours : au-delà, la loi ne le permet pas entre professionnels.',
    check: (v) => (/^\d{1,2}$/.test(v) && Number(v) <= 60 ? '' : 'Le délai de paiement va de 0 à 60 jours.') },
  { key: 'quote_validity_days', section: 'payment', label: 'Durée de validité d\'un devis', type: 'number', unit: 'jours', required: () => true, dflt: '30',
    check: (v) => (/^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365 ? '' : 'La validité d\'un devis va de 1 à 365 jours.') },
  { key: 'offer_description', section: 'offer', label: 'Ce que tu proposes à tes clients', type: 'textarea', max: 700, required: () => true,
    placeholder: "Une application de prise de rendez-vous en ligne pour les kinés : paramétrage, formation, abonnement mensuel.", hint: 'Claude s\'en sert pour écrire tes devis. Plus c\'est précis, mieux c\'est.' },
  { key: 'pricing_notes', section: 'offer', label: 'Tes tarifs habituels', type: 'textarea', max: 500, required: () => false,
    placeholder: 'Journée à 450 € HT, abonnement à 29 € HT par mois, mise en place à 600 € HT.', hint: 'Facultatif. Sans tarifs, Claude propose des prix d\'exemple (marqués comme tels) à ajuster.' },
];
export const LEGAL_SECTIONS = [['identity', 'Qui es-tu ?'], ['address', 'Ton adresse'], ['tax', 'TVA'], ['contact', 'Comment te joindre'], ['payment', 'Paiement'], ['offer', 'Ce que tu vends']];
export const LEGAL_KEYS = LEGAL_FIELDS.map((f) => f.key);

/** Valeurs nettoyées + erreurs de format par champ. Les champs absents prennent leur valeur par défaut (délais). */
export function normalizeLegal(raw = {}) {
  const values = {};
  for (const f of LEGAL_FIELDS) {
    let v = trim(raw[f.key], f.max || 60);
    if (f.type === 'textarea') v = String(raw[f.key] ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, f.max);
    if (f.clean) v = f.clean(v);
    if (!v && f.dflt) v = f.dflt;
    values[f.key] = v;
  }
  if (!isVat(values)) { values.vat_number = ''; values.vat_rate = ''; }
  else if (!values.vat_rate) values.vat_rate = '2000';
  const errors = {};
  for (const f of LEGAL_FIELDS) {
    if (f.required(values) && !values[f.key]) errors[f.key] = 'À renseigner.';
    else if (values[f.key] && f.check) { const e = f.check(values[f.key]); if (e) errors[f.key] = e; }
  }
  return { values, errors };
}
/** Champs encore à remplir ou invalides (dans l'ordre du formulaire). */
export function legalMissing(values) {
  return Object.keys(normalizeLegal(values).errors);
}
export const legalComplete = (values) => legalMissing(values).length === 0;

// ---------- Ce que le dépôt, l'analyse et la comptabilité savent déjà ----------

const MAX_READ = 64 * 1024;
/** Lecture d'un fichier du dépôt cloné : jamais hors du dépôt (liens symboliques), jamais gros, jamais une erreur. */
function readInRepo(dir, rel) {
  try {
    const full = join(dir, rel);
    const st = lstatSync(full);
    if (!st.isFile() || st.size > MAX_READ * 4) return null;
    const real = realpathSync(full);
    if (!real.startsWith(realpathSync(dir) + sep)) return null;
    return readFileSync(real, 'utf8').slice(0, MAX_READ);
  } catch { return null; }
}
const person = (a) => {
  if (!a) return null;
  if (typeof a === 'string') { const m = /^([^<(]+?)\s*(?:<([^>]+)>)?\s*(?:\(([^)]+)\))?$/.exec(a.trim()); return m ? { name: m[1].trim(), email: m[2] || '', url: m[3] || '' } : { name: a.trim(), email: '', url: '' }; }
  return { name: a.name || '', email: a.email || '', url: a.url || a.homepage || '' };
};

/**
 * Ce qu'on peut lire dans le code sans l'exécuter : { champ: { value, source } }. Jamais une invention : un champ introuvable est absent.
 * Sources : package.json, composer.json, LICENSE (ligne « Copyright »).
 */
export function suggestFromRepo(dir) {
  const out = {};
  const put = (key, value, source) => { const v = trim(value, 200); if (v && !out[key]) out[key] = { value: v, source }; };
  const pkg = (() => { try { return JSON.parse(readInRepo(dir, 'package.json') || 'null'); } catch { return null; } })();
  if (pkg && typeof pkg === 'object') {
    const a = person(Array.isArray(pkg.contributors) && !pkg.author ? pkg.contributors[0] : pkg.author);
    if (a) { put('legal_name', a.name, 'package.json'); put('email', a.email, 'package.json'); put('website', a.url, 'package.json'); }
    if (/^https?:\/\//i.test(String(pkg.homepage || ''))) put('website', pkg.homepage, 'package.json');
  }
  const comp = (() => { try { return JSON.parse(readInRepo(dir, 'composer.json') || 'null'); } catch { return null; } })();
  if (comp && typeof comp === 'object') {
    const a = person(Array.isArray(comp.authors) ? comp.authors[0] : null);
    if (a) { put('legal_name', a.name, 'composer.json'); put('email', a.email, 'composer.json'); }
    if (/^https?:\/\//i.test(String(comp.homepage || ''))) put('website', comp.homepage, 'composer.json');
  }
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    const txt = readInRepo(dir, f);
    const m = txt && /copyright\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-–,]\s*\d{4})*)\s+([^\n\r<]{3,80})/i.exec(txt);
    if (m) { put('legal_name', m[1].replace(/[.,]\s*(all rights reserved.*)?$/i, ''), f); break; }
  }
  return out;
}

const ANALYSIS_SRC = "l'analyse du projet";
const OTHER_SRC = 'un autre de tes projets';
const IDENTITY_KEYS = ['legal_form', 'legal_name', 'siret', 'capital', 'rcs', 'address', 'postal_code', 'city', 'vat_mode', 'vat_number', 'vat_rate', 'email', 'phone', 'website', 'iban', 'bic', 'payment_terms_days', 'quote_validity_days'];

/** Ce que Claude a trouvé dans le dépôt pendant l'analyse (profile.facturation) : seules les valeurs au bon format sont gardées. */
export function suggestFromAnalysis(found) {
  if (!found || typeof found !== 'object') return {};
  const clean = {};
  for (const k of LEGAL_KEYS) {
    const v = found[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const t = String(v).trim();
    if (t && !/^(null|n\/a|inconnu|non renseign)/i.test(t)) clean[k] = t;
  }
  const { values, errors } = normalizeLegal(clean);
  const out = {};
  for (const k of Object.keys(clean)) if (!errors[k] && values[k]) out[k] = { value: String(values[k]), source: ANALYSIS_SRC };
  // Les champs qui dépendent d'une valeur écartée ne sont pas proposés seuls
  delete out.payment_terms_days; delete out.quote_validity_days; delete out.vat_rate;
  return out;
}

/** Les informations déjà enregistrées pour un autre projet du compte : l'identité de l'entreprise ne se ressaisit pas. */
export function suggestFromOthers(legals = []) {
  const out = {};
  for (const legal of legals) for (const k of IDENTITY_KEYS) if (legal?.[k] && !out[k]) out[k] = { value: String(legal[k]), source: OTHER_SRC };
  return out;
}

/** Valeurs proposées au formulaire quand rien n'est encore enregistré, avec leur origine (affichée à côté du champ). */
export function buildSuggestions({ repo = {}, profile = null, accounting = {}, smtpEmail = '', accountEmail = '', others = [] } = {}) {
  const out = { ...suggestFromOthers(others) };
  const put = (key, value, source) => { if (value && !out[key]) out[key] = { value: String(value), source }; };
  for (const [k, v] of Object.entries(repo)) put(k, v.value, v.source);
  for (const [k, v] of Object.entries(suggestFromAnalysis(profile?.facturation))) put(k, v.value, v.source);
  if (profile?.resume) put('offer_description', String(profile.resume).slice(0, 700), ANALYSIS_SRC);
  if (accounting.vat) put('vat_mode', accounting.vat, 'ta comptabilité');
  if (accounting.regime === 'micro') put('legal_form', 'micro', 'ta comptabilité');
  put('email', smtpEmail, "l'adresse d'envoi du projet");
  put('email', accountEmail, 'ton compte');
  return out;
}

// ---------- Documents ----------

export const DOC_KINDS = [
  { key: 'devis', label: 'Devis', short: 'Devis', help: "Ce que tu envoies avant de commencer : prestations, prix, conditions. Le client le signe pour accepter." },
  { key: 'acompte', label: 'Acompte', short: 'Acompte', help: "La facture d'acompte : une part du prix payée à la commande." },
  { key: 'facture', label: 'Facture finale', short: 'Facture', help: "La facture du solde, une fois le travail livré : l'acompte déjà versé est déduit." },
  { key: 'avoir', label: 'Avoir', short: 'Avoir', help: "Le document qui annule ou corrige une facture (remboursement, erreur, geste commercial)." },
];
export const DOC_BY_KEY = Object.fromEntries(DOC_KINDS.map((k) => [k.key, k]));
export const LAYOUTS = [['classique', 'Classique'], ['moderne', 'Moderne'], ['epure', 'Épuré']];

/** Variables laissées vides dans un modèle : elles seront remplies à l'émission d'un vrai document. */
export const DOC_VARIABLES = {
  devis: ['numero', 'date', 'date_validite', 'client_nom', 'client_adresse', 'client_siret'],
  acompte: ['numero', 'date', 'date_echeance', 'devis_numero', 'client_nom', 'client_adresse', 'client_siret'],
  facture: ['numero', 'date', 'date_echeance', 'date_prestation', 'devis_numero', 'client_nom', 'client_adresse', 'client_siret'],
  avoir: ['numero', 'date', 'facture_numero', 'motif', 'client_nom', 'client_adresse', 'client_siret'],
};

const num = (v, min, max, dflt) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const txt = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** Une ligne de prestation : désignation, description, quantité, unité, prix unitaire hors taxes. */
export function normalizeLine(l) {
  const label = txt(l?.label, 120);
  if (!label) return null;
  return { label, description: txt(l?.description, 300), qty: Math.round(num(l?.qty, 0.01, 100000, 1) * 100) / 100, unit: txt(l?.unit, 20) || 'forfait', unit_price: Math.round(num(l?.unit_price, 0, 10_000_000, 0) * 100) / 100 };
}

/** Contenu d'un document, tel que Claude le propose : borné, typé, jamais de HTML. `null` si inutilisable. */
export function normalizeContent(raw, kind = 'devis') {
  if (!raw || typeof raw !== 'object') return null;
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(normalizeLine).filter(Boolean).slice(0, 8);
  if (!lines.length && kind !== 'acompte') return null;
  return {
    layout: LAYOUTS.some(([k]) => k === raw.layout) ? raw.layout : 'classique',
    tagline: txt(raw.tagline, 160),
    title: txt(raw.title, 80) || DOC_BY_KEY[kind]?.label || 'Devis',
    intro: txt(raw.intro, 600),
    lines,
    conditions: txt(raw.conditions, 1200),
    payment: txt(raw.payment, 500),
    closing: txt(raw.closing, 300),
    deposit_percent: Math.round(num(raw.deposit_percent, 5, 90, 30)),
    reason: txt(raw.reason, 200),
  };
}

// ---------- Calculs ----------

const cents = (n) => Math.round(n * 100);
/** Totaux d'une liste de lignes. `rate` : centièmes de pour cent (2000 = 20 %), 0 en franchise de TVA. */
export function totalsOf(lines, rate = 0) {
  const ht = lines.reduce((a, l) => a + cents(l.qty * l.unit_price), 0);
  const vat = rate > 0 ? Math.round((ht * rate) / 10000) : 0;
  return { ht, vat, ttc: ht + vat, rate };
}
export const rateOf = (legal) => (legal.vat_mode === 'assujetti' ? Number(legal.vat_rate || 2000) : 0);

// ---------- Rendu HTML ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = (s) => String(s ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const ph = (name) => `<span class="ph">{{${name}}}</span>`;
const eur = (c) => fmtEur(c).replace(/ | /g, ' ');

const THEMES = {
  classique: 'body{font-family:Georgia,"Times New Roman",serif;color:#1c1c1c}h1{font-size:1.9em;letter-spacing:.02em}.rule{border-top:2px solid #1c1c1c}th{border-bottom:2px solid #1c1c1c}td{border-bottom:1px solid #ccc}.box{border:1px solid #1c1c1c}',
  moderne: 'body{font-family:"Segoe UI",system-ui,Helvetica,Arial,sans-serif;color:#18202e}h1{font-size:1.8em;color:#1d4ed8}.rule{border-top:4px solid #1d4ed8}th{background:#eef2ff;color:#1d4ed8}td{border-bottom:1px solid #e3e8f2}.box{border:1px solid #c7d2fe;background:#f8faff}.total{background:#1d4ed8;color:#fff}',
  epure: 'body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#222;font-weight:300}h1{font-size:1.6em;font-weight:300;letter-spacing:.12em;text-transform:uppercase}.rule{border-top:1px solid #bbb}th{font-weight:400;color:#777;border-bottom:1px solid #bbb}td{border-bottom:1px solid #eee}.box{border:1px solid #ddd}',
};
const BASE_CSS = 'html{background:#fff}body{margin:0;padding:28px 24px;font-size:13px;line-height:1.5}.doc{max-width:794px;margin:0 auto}.row{display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between}.row>div{flex:1 1 240px;min-width:0}'
  + 'h1{margin:0 0 4px}h2{font-size:1em;margin:0 0 4px}p{margin:0 0 8px}.muted{color:#666}.small{font-size:.85em}.rule{margin:18px 0 14px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:8px 6px;text-align:left;vertical-align:top}'
  + '.n{text-align:right;white-space:nowrap}.tot{margin-left:auto;width:min(100%,320px)}.tot div{display:flex;justify-content:space-between;gap:12px;padding:4px 6px}.total{font-weight:700;border-top:1px solid #888}.box{padding:12px 14px;margin:14px 0}'
  + '.ph{background:#fff6cc;color:#6b5400;padding:0 4px;border-radius:3px;font-family:ui-monospace,Menlo,monospace;font-size:.92em}.foot{margin-top:22px;font-size:.82em;color:#555}.sig{height:70px}';

/** Mentions légales d'un document, décidées par le code d'après les informations légales (jamais par Claude). */
export function legalMentions(kind, legal) {
  const m = [];
  const company = `${legal.legal_name} — ${formLabel(legal.legal_form)}${legal.capital ? ` au capital de ${legal.capital} €` : ''} — SIRET ${legal.siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4')}${legal.rcs ? ` — ${legal.rcs}` : ''}`;
  m.push(company);
  m.push(legal.vat_mode === 'assujetti' ? `N° de TVA intracommunautaire : ${legal.vat_number}` : 'TVA non applicable, art. 293 B du CGI');
  if (kind === 'devis') {
    m.push(`Devis valable ${legal.quote_validity_days} jours à compter de sa date d'émission. Pour l'accepter, retournez-le daté et signé, précédé de la mention « Bon pour accord ».`);
  } else if (kind === 'acompte' || kind === 'facture') {
    m.push(`Paiement à ${legal.payment_terms_days} jours à compter de la date de la facture${legal.iban ? ', par virement' : ''}.`);
    m.push("En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal est exigible, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (clients professionnels). Pas d'escompte pour paiement anticipé.");
  }
  return m;
}

/**
 * Document complet (HTML autonome, styles intégrés) : modèle avec variables entre accolades, mentions légales fixées par le code.
 * Servi seulement dans un cadre isolé (voir billingroutes.js).
 */
export function renderDocument({ kind, content, legal, layout, brand = null }) {
  const c = content;
  const theme = THEMES[layout] ? layout : 'classique';
  // Identité du projet (couleurs déjà vérifiées par billingbrand.js) : elle recouvre les couleurs de la mise en page choisie
  const bt = brand?.theme;
  const brandCss = bt ? `h1,h2{color:${bt.accent}}.rule{border-top-color:${bt.accent}}th{background:${bt.tint};color:${bt.accent};border-bottom:2px solid ${bt.accent}}.box{border-color:${bt.edge};background:${bt.tint}}${layout === 'moderne' ? `.total{background:${bt.accent};color:#fff}` : `.total{border-top:1px solid ${bt.accent}}`}body{color:${bt.text}}` : '';
  const logo = brand?.logoUri && !bt?.hideLogo ? `<img src="${brand.logoUri}" alt="" style="display:block;max-height:${Math.round(bt?.logoHeight || 44)}px;max-width:170px;margin:0 0 8px">` : '';
  const rate = rateOf(legal);
  const t = totalsOf(c.lines, rate);
  const vatText = legal.vat_mode === 'assujetti' ? `TVA ${rate / 100} %`.replace('.', ',') : 'TVA non applicable, art. 293 B du CGI';
  const sign = kind === 'avoir' ? -1 : 1;
  const money = (n) => eur(sign * n);
  const lineRows = (lines) => lines.map((l) => `<tr><td><b>${esc(l.label)}</b>${l.description ? `<br><span class="muted small">${esc(l.description)}</span>` : ''}</td><td class="n">${esc(String(l.qty).replace('.', ','))} ${esc(l.unit)}</td><td class="n">${money(cents(l.unit_price))}</td><td class="n">${money(cents(l.qty * l.unit_price))}</td></tr>`).join('');

  // Acompte : une seule ligne, la part du devis
  const dep = c.deposit_percent;
  const depHt = Math.round((t.ht * dep) / 100);
  const depTotals = { ht: depHt, vat: rate > 0 ? Math.round((depHt * rate) / 10000) : 0 };
  depTotals.ttc = depTotals.ht + depTotals.vat;
  let body;
  let totals;
  if (kind === 'acompte') {
    body = `<tr><td><b>Acompte de ${dep} % à la commande</b><br><span class="muted small">Sur le devis n° ${ph('devis_numero')} : ${esc(c.lines.map((l) => l.label).slice(0, 3).join(', ') || 'prestations convenues')}</span></td><td class="n">1</td><td class="n">${eur(depTotals.ht)}</td><td class="n">${eur(depTotals.ht)}</td></tr>`;
    totals = [['Total HT', eur(depTotals.ht)], [vatText, legal.vat_mode === 'assujetti' ? eur(depTotals.vat) : ''], ['Total TTC à payer', eur(depTotals.ttc), true]];
  } else if (kind === 'facture') {
    body = lineRows(c.lines);
    const left = t.ttc - depTotals.ttc;
    totals = [['Total HT', eur(t.ht)], [vatText, legal.vat_mode === 'assujetti' ? eur(t.vat) : ''], ['Total TTC', eur(t.ttc)], [`Acompte déjà réglé (${dep} %)`, `− ${eur(depTotals.ttc)}`], ['Reste à payer TTC', eur(left), true]];
  } else if (kind === 'avoir') {
    body = lineRows(c.lines);
    totals = [['Total HT', money(t.ht)], [vatText, legal.vat_mode === 'assujetti' ? money(t.vat) : ''], ['Total de l\'avoir TTC', money(t.ttc), true]];
  } else {
    body = lineRows(c.lines);
    totals = [['Total HT', eur(t.ht)], [vatText, legal.vat_mode === 'assujetti' ? eur(t.vat) : ''], ['Total TTC', eur(t.ttc), true]];
  }
  const meta = kind === 'devis' ? `<p>Devis n° ${ph('numero')}<br>Date : ${ph('date')}<br>Valable jusqu'au ${ph('date_validite')}</p>`
    : kind === 'acompte' ? `<p>Facture d'acompte n° ${ph('numero')}<br>Date : ${ph('date')}<br>Échéance : ${ph('date_echeance')}</p>`
      : kind === 'facture' ? `<p>Facture n° ${ph('numero')}<br>Date : ${ph('date')}<br>Échéance : ${ph('date_echeance')}<br>Prestation réalisée le ${ph('date_prestation')}</p>`
        : `<p>Avoir n° ${ph('numero')}<br>Date : ${ph('date')}<br>Sur la facture n° ${ph('facture_numero')}</p>`;
  const reason = kind === 'avoir' ? `<div class="box"><b>Motif de l'avoir :</b> ${c.reason ? esc(c.reason) : ph('motif')}</div>` : '';
  const addr = `${esc(legal.address)}<br>${esc(legal.postal_code)} ${esc(legal.city)}`;
  const contact = [legal.email, legal.phone, legal.website].filter(Boolean).map(esc).join(' · ');
  const bank = (kind === 'acompte' || kind === 'facture') && legal.iban ? `<p class="small"><b>Règlement par virement :</b> IBAN ${esc(legal.iban.replace(/(.{4})/g, '$1 ').trim())}${legal.bic ? ` — BIC ${esc(legal.bic)}` : ''}</p>` : '';
  const sig = kind === 'devis' ? `<div class="row"><div class="box"><b>Bon pour accord</b> — date et signature du client<div class="sig"></div></div><div></div></div>` : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(c.title)}</title><style>${BASE_CSS}${THEMES[theme]}${brandCss}</style></head>
<body><div class="doc">
<div class="row"><div>${logo}<h2>${esc(legal.legal_name)}</h2><p>${addr}</p><p class="muted small">${contact}</p></div><div style="text-align:right"><h1>${esc(c.title)}</h1>${meta}</div></div>
<div class="rule"></div>
<div class="row"><div></div><div class="box"><b>Client</b><br>${ph('client_nom')}<br>${ph('client_adresse')}<br>SIRET : ${ph('client_siret')}</div></div>
${c.intro ? para(c.intro) : ''}
<table><thead><tr><th>Désignation</th><th class="n">Quantité</th><th class="n">Prix unitaire HT</th><th class="n">Total HT</th></tr></thead><tbody>${body}</tbody></table>
<div class="tot">${totals.map(([l, v, strong]) => (v === '' ? '' : `<div class="${strong ? 'total' : ''}"><span>${esc(l)}</span><span>${esc(v)}</span></div>`)).join('')}${legal.vat_mode !== 'assujetti' ? `<div class="muted small"><span>${esc(vatText)}</span><span></span></div>` : ''}</div>
${reason}
${c.conditions && kind !== 'avoir' ? `<h2>Conditions</h2>${para(c.conditions)}` : ''}
${c.payment && kind !== 'avoir' ? `<h2>Modalités de paiement</h2>${para(c.payment)}` : ''}
${bank}${sig}
${c.closing ? para(c.closing) : ''}
<div class="foot rule">${legalMentions(kind, legal).map((m) => `<p>${esc(m)}</p>`).join('')}</div>
</div></body></html>`;
}

/**
 * Les chiffres d'un document, en centimes : lignes, totaux et montant à payer (ou à rembourser pour un avoir, en positif).
 * Une seule source pour l'aperçu, le PDF et la ligne de comptabilité.
 */
export function documentFacts({ kind, content, legal, lines = null, depositPercent = null, depositTtc = null, devisNumber = '', creditTtc = null, refNumber = '' }) {
  const c = content;
  const items = lines || c.lines; // à l'émission : les lignes réellement saisies (les lignes du modèle ne sont que des exemples)
  const rate = rateOf(legal);
  const t = totalsOf(items, rate);
  const assujetti = legal.vat_mode === 'assujetti';
  const vatLabel = assujetti ? `TVA ${rate / 100} %`.replace('.', ',') : 'TVA non applicable, art. 293 B du CGI';
  const dep = depositPercent ?? c.deposit_percent;
  const depHt = Math.round((t.ht * dep) / 100);
  const depVat = rate > 0 ? Math.round((depHt * rate) / 10000) : 0;
  const depTtc = depHt + depVat;
  const lineRows = items.map((l) => ({ label: l.label, description: l.description || '', qty: `${String(l.qty).replace('.', ',')} ${l.unit || ''}`.trim(), unit: cents(l.unit_price), total: cents(l.qty * l.unit_price) }));
  let rows = lineRows;
  let totals;
  let due = t.ttc;
  let paidDeposit = depTtc;
  if (kind === 'acompte') {
    rows = [{ label: `Acompte de ${dep} % à la commande`, description: `Sur le devis${devisNumber ? ` n° ${devisNumber}` : ''} : ${items.map((l) => l.label).slice(0, 3).join(', ') || 'prestations convenues'}`, qty: '1', unit: depHt, total: depHt }];
    totals = [['Total HT', depHt], [vatLabel, assujetti ? depVat : null], ['Total TTC à payer', depTtc, true]];
    due = depTtc;
  } else if (kind === 'facture') {
    // Acomptes réellement facturés sur ce devis (émission) ; à défaut, la part prévue par le modèle
    paidDeposit = depositTtc ?? depTtc;
    due = t.ttc - paidDeposit;
    totals = [['Total HT', t.ht], [vatLabel, assujetti ? t.vat : null], ['Total TTC', t.ttc]];
    if (paidDeposit > 0 || depositTtc === null) totals.push([depositTtc === null ? `Acompte déjà réglé (${dep} %)` : 'Acomptes déjà facturés', -paidDeposit]);
    totals.push(['Reste à payer TTC', due, true]);
  } else if (kind === 'avoir' && creditTtc !== null) {
    const ht = Math.round((creditTtc * 10000) / (10000 + rate));
    const vat = creditTtc - ht;
    rows = [{ label: `Avoir sur la facture${refNumber ? ` n° ${refNumber}` : ''}`, description: '', qty: '1', unit: ht, total: ht }];
    totals = [['Total HT', -ht], [vatLabel, assujetti ? -vat : null], ["Total de l'avoir TTC", -creditTtc, true]];
    due = creditTtc;
  } else if (kind === 'avoir') {
    totals = [['Total HT', -t.ht], [vatLabel, assujetti ? -t.vat : null], ["Total de l'avoir TTC", -t.ttc, true]];
  } else {
    totals = [['Total HT', t.ht], [vatLabel, assujetti ? t.vat : null], ['Total TTC', t.ttc, true]];
  }
  return { rate, t, dep, depTtc: paidDeposit, vatLabel, assujetti, rows: kind === 'avoir' ? rows.map((r) => ({ ...r, unit: -r.unit, total: -r.total })) : rows, totals, due };
}

// ---------- Avancement d'un projet ----------

/**
 * Où en est un projet. `docs` : lignes de billing_docs ({kind, variant, status}) ; `chosen` : variante choisie (ou null).
 * stage : legal → generate → choose → docs_pending → validate → ready.
 */
export function billingStage({ legal, docs = [], chosen = null, jobs = {} }) {
  const complete = legalComplete(legal);
  const options = docs.filter((d) => d.kind === 'quote_option');
  const finals = docs.filter((d) => d.kind !== 'quote_option');
  const validatedQuote = options.find((o) => o.status === 'validated');
  const allFinalsValidated = finals.length === DOC_KINDS.length && finals.every((d) => d.status === 'validated');
  const running = (type) => ['queued', 'running'].includes(jobs[type]?.status);
  let stage;
  if (!complete) stage = 'legal';
  else if (allFinalsValidated) stage = 'ready';
  else if (validatedQuote && finals.length === DOC_KINDS.length) stage = 'validate';
  else if (validatedQuote) stage = 'docs_pending';
  else if (options.length) stage = 'choose';
  else stage = 'generate';
  const steps = [
    { id: 'legal', label: 'Informations légales', done: complete },
    { id: 'quote', label: 'Choix du devis', done: !!validatedQuote },
    { id: 'docs', label: 'Documents', done: allFinalsValidated },
  ];
  return {
    stage, complete, steps, chosen, busy: running('billing_quotes') || running('billing_refine') || running('billing_docs'),
    finalsValidated: finals.filter((d) => d.status === 'validated').length,
  };
}

/** Phrase d'état pour la liste des projets. */
export function stageLabel(s, missing = 0) {
  return {
    legal: [`${missing} information${missing > 1 ? 's' : ''} légale${missing > 1 ? 's' : ''} à compléter`, 'warn'],
    generate: ['Prêt : génère un modèle de devis', ''],
    choose: ['Choisis et valide un devis', ''],
    docs_pending: ['Claude prépare tes documents…', ''],
    validate: [`Valide tes documents (${s.finalsValidated} sur ${DOC_KINDS.length})`, ''],
    ready: ['Documents prêts à l\'emploi', 'ok'],
  }[s.stage];
}
