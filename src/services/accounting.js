// Comptabilité : types de lignes, catégories, montants (en centimes), périodes, totaux, guide de déclaration, alertes, journal CSV.
// Pur calcul, sans accès à la base ni au disque : tout ce qui est affiché à l'utilisateur est décidé ici, à un seul endroit.

export const KINDS = [
  { key: 'payment_in', label: 'Paiement reçu', dir: 'in', group: 'income', vat: true, help: "Un client t'a payé : facture réglée, abonnement, vente." },
  { key: 'expense', label: 'Dépense', dir: 'out', group: 'expense', vat: true, help: "Tu as payé quelque chose pour ton activité : logiciel, serveur, publicité, matériel…" },
  { key: 'refund_out', label: 'Remboursement versé à un client', dir: 'out', group: 'income', vat: true, help: "Tu as rendu de l'argent à un client (annulation, geste commercial)." },
  { key: 'refund_in', label: 'Remboursement reçu', dir: 'in', group: 'expense', vat: true, help: "Un fournisseur ou un service t'a remboursé une dépense." },
  { key: 'social_tax', label: 'Cotisations, impôts et taxes', dir: 'out', group: 'tax', vat: false, help: "Tu as payé l'URSSAF, des impôts, la CFE ou la TVA à l'État." },
  { key: 'owner_in', label: 'Apport ou prêt reçu', dir: 'in', group: 'owner', vat: false, help: "De l'argent personnel mis dans l'activité, ou un prêt. Ce n'est pas un gain : il n'entre pas dans ton chiffre d'affaires." },
  { key: 'owner_out', label: 'Retrait personnel', dir: 'out', group: 'owner', vat: false, help: "Tu t'es versé de l'argent pour toi. Ce n'est pas une dépense de l'activité." },
];
export const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k]));

export const CATEGORIES = {
  income: [['service', 'Prestation de service'], ['subscription', 'Abonnement client'], ['sale', 'Vente de produit'], ['other_income', 'Autre']],
  expense: [['software', 'Logiciels et abonnements'], ['hosting', 'Hébergement, serveurs et domaines'], ['marketing', 'Publicité et marketing'], ['equipment', 'Matériel informatique'],
    ['subcontract', 'Sous-traitance et freelances'], ['travel', 'Déplacements et repas'], ['fees', 'Frais bancaires et commissions'], ['training', 'Formation'],
    ['legal', 'Comptabilité, juridique et assurances'], ['other_expense', 'Autre dépense']],
  tax: [['social', 'Cotisations sociales (URSSAF)'], ['income_tax', 'Impôt sur le revenu ou sur les sociétés'], ['vat_paid', 'TVA payée à l\'État'], ['cfe', 'CFE et autres taxes']],
  owner: [['contribution', 'Apport personnel'], ['loan', 'Prêt'], ['withdrawal', 'Retrait personnel']],
};
export const categoryLabel = (group, key) => (CATEGORIES[group] || []).find(([k]) => k === key)?.[1] || key;
export const defaultCategory = (kind) => CATEGORIES[KIND_BY_KEY[kind].group][0][0];

export const METHODS = [['transfer', 'Virement'], ['card', 'Carte bancaire'], ['debit', 'Prélèvement'], ['platform', 'Stripe, PayPal ou autre plateforme'], ['cheque', 'Chèque'], ['cash', 'Espèces'], ['other', 'Autre']];
export const methodLabel = (k) => METHODS.find(([m]) => m === k)?.[1] || k;

/** Taux de TVA proposés, en centièmes de pour cent. */
export const VAT_RATES = [[0, 'Pas de TVA'], [2000, '20 %'], [1000, '10 %'], [550, '5,5 %'], [210, '2,1 %']];

/** Limites des justificatifs (lues par les routes et par la documentation du Support). */
export const LIMITS = { fileBytes: 10 * 1024 * 1024, perUserBytes: 300 * 1024 * 1024, perUserEntries: 20_000, pageSize: 100 };

// ---------- Situation de l'utilisateur ----------

export const REGIMES = [
  ['micro', 'Micro-entrepreneur', "Tu as un numéro SIRET et tu déclares ton chiffre d'affaires à l'URSSAF (autoentrepreneur.urssaf.fr)."],
  ['reel', 'Société ou entreprise au réel', "Tu as une société (SAS, SARL, EURL…) ou une entreprise individuelle au réel : tu déclares la TVA aux impôts et un comptable fait ton bilan."],
  ['unknown', 'Je ne sais pas encore', "Pas de souci : on te montre comment le savoir en deux minutes."],
];
export const ACTIVITIES = [
  ['services', 'Prestations de services (commerciale ou artisanale)', "Tu vends du temps, un service, un abonnement, du développement… (la plupart des activités du web)."],
  ['liberal', 'Profession libérale', "Conseil, formation, expertise, activité intellectuelle réglementée ou non commerciale (BNC)."],
  ['goods', 'Vente de marchandises', "Tu revends des objets physiques ou fournis un hébergement."],
];
export const VAT_MODES = [
  ['franchise', 'Je ne facture pas la TVA', "Franchise en base de TVA : tes factures portent la mention « TVA non applicable, art. 293 B du CGI »."],
  ['assujetti', 'Je facture la TVA', "Tes factures indiquent un montant de TVA (20 % le plus souvent) que tu reverses à l'État."],
];
export const FREQUENCIES = [['monthly', 'Chaque mois'], ['quarterly', 'Chaque trimestre']];

/** Valeurs de référence : à revérifier chaque année (service-public.fr). Affichées comme telles, jamais présentées comme définitives. */
export const REFERENCE = {
  year: 2025,
  microCeiling: { services: 77_700, liberal: 77_700, goods: 188_700 },
  vatFranchiseCeiling: { services: 37_500, liberal: 37_500, goods: 85_000 },
};

export function normalizeSettings(raw = {}) {
  const pick = (v, list, dflt = '') => (list.some(([k]) => k === v) ? v : dflt);
  const regime = pick(raw.regime, REGIMES);
  const activity = pick(raw.activity, ACTIVITIES);
  const vat = pick(raw.vat, VAT_MODES, regime === 'reel' ? 'assujetti' : regime === 'micro' ? 'franchise' : '');
  const freq = pick(raw.freq, FREQUENCIES, 'quarterly');
  return { regime, activity, vat, freq, complete: !!(regime && activity && vat) };
}

// ---------- Montants ----------

/** « 1 234,56 », « 12.5 », « 12 € » → centimes entiers ; null si ce n'est pas un montant positif raisonnable. */
export function parseAmountCents(v) {
  const s = String(v ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [i, d = ''] = s.split('.');
  const cents = Number(i) * 100 + Number(d.padEnd(2, '0'));
  return cents > 0 ? cents : null;
}
export const fmtEur = (cents) => (Number(cents) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
/** TVA contenue dans un montant TTC. */
export const vatOf = (ttc, rate) => (rate > 0 ? Math.round(ttc - (ttc * 10000) / (10000 + rate)) : 0);

// ---------- Dates et périodes (toutes en heure de Paris, sous forme AAAA-MM-JJ) ----------

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
export const todayIso = (at = new Date()) => {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
};
export const dayLabel = (iso) => `${Number(iso.slice(8))}${iso.slice(8) === '01' ? 'er' : ''} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 86400000);

/** Une période : « 2026 » (année), « 2026-10 » (mois), « 2026-Q3 » (trimestre). Renvoie des bornes AAAA-MM-JJ (fin exclusive) ou null. */
export function periodRange(period) {
  const p = String(period ?? '');
  let m = /^(\d{4})$/.exec(p);
  if (m) return { kind: 'year', from: `${m[1]}-01-01`, to: `${Number(m[1]) + 1}-01-01`, label: `l'année ${m[1]}`, short: m[1] };
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    const [ny, nm] = nextMonth(y, mo);
    return { kind: 'month', from: isoDate(y, mo, 1), to: isoDate(ny, nm, 1), label: `${MONTHS[mo - 1]} ${y}`, short: `${MONTHS[mo - 1]} ${y}` };
  }
  m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (m) {
    const [y, q] = [Number(m[1]), Number(m[2])];
    const [ny, nm] = nextMonth(y, q * 3);
    return { kind: 'quarter', from: isoDate(y, q * 3 - 2, 1), to: isoDate(ny, nm, 1), label: `le ${q === 1 ? '1er' : `${q}e`} trimestre ${y}`, short: `${q === 1 ? '1er' : `${q}e`} trimestre ${y}` };
  }
  return null;
}
export const monthOf = (iso) => iso.slice(0, 7);
export const quarterOf = (iso) => `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
export const periodOf = (iso, freq) => (freq === 'monthly' ? monthOf(iso) : quarterOf(iso));
const previousPeriod = (period) => {
  const r = periodRange(period);
  const d = new Date(`${r.from}T12:00:00Z`);
  d.setUTCDate(0); // dernier jour de la période précédente
  return periodOf(d.toISOString().slice(0, 10), r.kind === 'month' ? 'monthly' : 'quarterly');
};

/** La période à déclarer maintenant : la dernière terminée. */
export function periodToDeclare(freq, today) {
  return previousPeriod(periodOf(today, freq));
}
/** Les dernières périodes de déclaration (de la plus récente à la plus ancienne), la période en cours comprise. */
export function recentPeriods(freq, today, count = 8) {
  const out = [];
  let p = periodOf(today, freq);
  for (let i = 0; i < count; i++) { out.push(p); p = previousPeriod(p); }
  return out;
}

/** Date limite (AAAA-MM-JJ) pour déclarer la période. URSSAF : fin du mois suivant, ou fin du mois qui suit le trimestre. */
export function deadlineOf(period, regime = 'micro') {
  const r = periodRange(period);
  if (!r || r.kind === 'year') return null;
  const [ey, em] = [Number(r.to.slice(0, 4)), Number(r.to.slice(5, 7))]; // premier jour du mois qui suit la période
  if (regime === 'reel') return isoDate(ey, em, 24); // TVA : entre le 15 et le 24 selon le service des impôts
  return isoDate(ey, em, lastDay(ey, em));
}
export const daysLeft = (deadline, today) => daysBetween(today, deadline);

// ---------- Contrôle et mise en forme d'une ligne ----------

export class EntryError extends Error {}
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** Valide et normalise les champs d'une ligne. `vatMode` : « franchise » force la TVA à zéro. */
export function validateEntry(b, { today = todayIso(), vatMode = '' } = {}) {
  const kind = KIND_BY_KEY[b.kind];
  if (!kind) throw new EntryError('Choisis le type de ligne.');
  if (!validDate(b.date)) throw new EntryError('La date est invalide.');
  if (b.date > today) throw new EntryError("La date est dans le futur : ajoute la ligne le jour du paiement.");
  const label = clean(b.label, 120);
  if (!label) throw new EntryError('Écris un libellé : de quoi s\'agit-il ?');
  const amount = parseAmountCents(b.amount);
  if (amount == null) throw new EntryError('Le montant est invalide (exemple : 49,90).');
  const cats = CATEGORIES[kind.group];
  const category = b.category ? String(b.category) : cats[0][0];
  if (!cats.some(([k]) => k === category)) throw new EntryError('Cette catégorie ne correspond pas au type de ligne.');
  const method = METHODS.some(([k]) => k === (b.method || 'transfer')) ? (b.method || 'transfer') : null;
  if (!method) throw new EntryError('Mode de paiement inconnu.');
  let rate = 0;
  if (kind.vat && vatMode !== 'franchise') {
    rate = Number(b.vatRate || 0);
    if (!VAT_RATES.some(([r]) => r === rate)) throw new EntryError('Taux de TVA inconnu.');
  }
  return {
    kind: kind.key, date: b.date, label, party: clean(b.party, 120), category, method, notes: clean(b.notes, 400),
    amount, vatRate: rate, vat: vatOf(amount, rate),
  };
}

// ---------- Totaux ----------

const sum = (rows, pred) => rows.filter(pred).reduce((a, r) => a + Number(r.amount_cents), 0);
const sumVat = (rows, pred) => rows.filter(pred).reduce((a, r) => a + Number(r.vat_cents), 0);

/** Totaux d'un ensemble de lignes. `assujetti` : les montants « nets » sont hors TVA. */
export function computeTotals(rows, { assujetti = false } = {}) {
  const k = (key) => (r) => r.kind === key;
  const revenueTtc = sum(rows, k('payment_in')) - sum(rows, k('refund_out'));
  const vatCollected = sumVat(rows, k('payment_in')) - sumVat(rows, k('refund_out'));
  const expenseTtc = sum(rows, k('expense')) - sum(rows, k('refund_in'));
  const vatDeductible = sumVat(rows, k('expense')) - sumVat(rows, k('refund_in'));
  const taxes = sum(rows, (r) => r.kind === 'social_tax' && !(assujetti && r.category === 'vat_paid'));
  const vatPaid = sum(rows, (r) => r.kind === 'social_tax' && r.category === 'vat_paid');
  const owner = sum(rows, k('owner_in')) - sum(rows, k('owner_out'));
  const revenue = assujetti ? revenueTtc - vatCollected : revenueTtc;
  const expenses = assujetti ? expenseTtc - vatDeductible : expenseTtc;
  return {
    count: rows.length, revenue, expenses, taxes, result: revenue - expenses - taxes, owner,
    revenueTtc, expenseTtc, vatCollected, vatDeductible, vatDue: vatCollected - vatDeductible, vatPaid,
  };
}

export function rowsInRange(rows, from, to) {
  return rows.filter((r) => (!from || r.entry_date >= from) && (!to || r.entry_date < to));
}

// ---------- Guide de déclaration ----------

const URSSAF = { name: "autoentrepreneur.urssaf.fr", url: 'https://www.autoentrepreneur.urssaf.fr' };
const IMPOTS = { name: 'impots.gouv.fr', url: 'https://www.impots.gouv.fr' };
const URSSAF_FIELD = { services: "Chiffre d'affaires : prestations de services (BIC)", liberal: "Chiffre d'affaires : activités libérales (BNC)", goods: "Chiffre d'affaires : ventes de marchandises (BIC)" };

/**
 * Où déclarer et quoi renseigner pour une période. `totals` : les totaux de la période. Aucun montant n'est inventé : tout vient des lignes.
 * @returns {{where:{name:string,url:string}|null, steps:string[], amounts:Array<{label:string,value:string,raw:string,hint:string}>, deadline:string|null, notes:string[], title:string}}
 */
export function declarationGuide({ settings, period, totals }) {
  const r = periodRange(period);
  const eur = (c) => fmtEur(c);
  const num = (c) => (Number(c) / 100).toFixed(2).replace('.', ',');
  const notes = [];
  if (settings.regime === 'micro') {
    const field = URSSAF_FIELD[settings.activity] || URSSAF_FIELD.services;
    const amountNote = settings.vat === 'assujetti' ? 'Montant hors taxes (sans la TVA).' : "Tu ne factures pas la TVA : ton chiffre d'affaires est le total encaissé.";
    if (totals.count === 0 || totals.revenue === 0) notes.push("Tu n'as rien encaissé sur cette période : déclare quand même 0 €. Ne pas déclarer entraîne des pénalités.");
    if (totals.revenue < 0) notes.push('Tes remboursements dépassent tes encaissements : déclare 0 € et garde les justificatifs.');
    notes.push("Seuls les paiements REÇUS comptent (la date de l'encaissement, pas celle de la facture). Tes dépenses ne se déduisent pas du chiffre d'affaires en micro-entreprise : elles ne changent pas ce montant.");
    notes.push("L'URSSAF calcule tes cotisations à partir de ce montant : tu n'as rien à calculer.");
    return {
      title: `Déclarer ton chiffre d'affaires pour ${r.label}`, where: URSSAF,
      steps: [
        `Va sur ${URSSAF.name} et connecte-toi à ton compte.`,
        'Clique sur « Déclarer et payer », puis « Déclarer mon chiffre d\'affaires ».',
        `Choisis la période : ${r.short}.`,
        `Dans la case « ${field} », saisis le montant ci-dessous.`,
        'Valide, puis paie les cotisations affichées par le site.',
        'Reviens ici et clique « J\'ai fait ma déclaration ».',
      ],
      amounts: [{ label: field, value: eur(Math.max(0, totals.revenue)), raw: num(Math.max(0, totals.revenue)), hint: amountNote }],
      deadline: deadlineOf(period, 'micro'), notes,
    };
  }
  if (settings.regime === 'reel') {
    notes.push("Les montants viennent des lignes saisies pour cette période : vérifie-les avec tes factures avant de valider.");
    notes.push("Le bilan et la déclaration de résultats se font avec ton expert-comptable : exporte le journal (CSV) et les justificatifs pour les lui transmettre.");
    notes.push("Les intitulés exacts du formulaire peuvent varier selon ton régime (CA3 mensuelle ou trimestrielle, CA12 annuelle) : le service des impôts t'indique la bonne déclaration dans ton espace.");
    return {
      title: `Déclarer ta TVA pour ${r.label}`, where: IMPOTS,
      steps: [
        `Va sur ${IMPOTS.name} et connecte-toi à ton espace professionnel.`,
        'Ouvre « Déclarer » puis « Déclarer la TVA » (ou « Gérer mes services → Déclarer la TVA »).',
        `Choisis la période : ${r.short}.`,
        'Reporte les montants ci-dessous dans les lignes correspondantes du formulaire.',
        'Signe, valide et règle le montant dû par prélèvement.',
        'Reviens ici et clique « J\'ai fait ma déclaration ».',
      ],
      amounts: [
        { label: "Chiffre d'affaires hors taxes (ventes et prestations)", value: eur(totals.revenue), raw: num(totals.revenue), hint: 'Paiements reçus moins remboursements versés, hors TVA.' },
        { label: 'TVA collectée', value: eur(totals.vatCollected), raw: num(totals.vatCollected), hint: 'La TVA contenue dans les paiements reçus.' },
        { label: 'TVA déductible sur tes dépenses', value: eur(totals.vatDeductible), raw: num(totals.vatDeductible), hint: 'La TVA payée sur tes achats et services, si tes factures en indiquent.' },
        { label: totals.vatDue >= 0 ? 'TVA à payer' : 'Crédit de TVA', value: eur(Math.abs(totals.vatDue)), raw: num(Math.abs(totals.vatDue)), hint: 'TVA collectée moins TVA déductible.' },
      ],
      deadline: deadlineOf(period, 'reel'), notes,
    };
  }
  return {
    title: 'Trouver où déclarer', where: null,
    steps: [
      "Cherche ton numéro SIRET : il figure sur ton avis de situation (gratuit sur avis-situation-sirene.insee.fr) ou sur le mail reçu à la création de ton activité.",
      "Si tu as créé une micro-entreprise : ta déclaration se fait sur autoentrepreneur.urssaf.fr, chaque mois ou chaque trimestre.",
      "Si tu as créé une société (SAS, SARL, EURL…) : la TVA se déclare sur impots.gouv.fr et un comptable prépare ton bilan.",
      "Toujours pas sûr ? Appelle le guichet des entreprises ou demande à la personne qui a créé ton activité. Reviens ensuite choisir ta situation sur cette page.",
    ],
    amounts: [], deadline: null,
    notes: ["En attendant, continue de saisir tes paiements et tes dépenses avec leur justificatif : tout sera prêt le jour où tu déclares."],
  };
}

// ---------- Points d'attention ----------

/** `rows` : toutes les lignes du compte. `done` : ensemble des périodes déjà déclarées. */
export function computeAlerts({ rows, settings, today, done = new Set() }) {
  const out = [];
  if (settings.complete && settings.regime !== 'unknown') {
    const period = periodToDeclare(settings.freq, today);
    const deadline = deadlineOf(period, settings.regime);
    if (deadline && !done.has(period)) {
      const left = daysLeft(deadline, today);
      const r = periodRange(period);
      out.push({
        level: left < 0 ? 'err' : left <= 7 ? 'warn' : 'info', code: 'declaration', period,
        text: left < 0 ? `Ta déclaration pour ${r.label} aurait dû être faite avant le ${dayLabel(deadline)}. Fais-la dès que possible.`
          : `Ta déclaration pour ${r.label} est à faire avant le ${dayLabel(deadline)} (${left === 0 ? "c'est aujourd'hui" : `dans ${left} jour${left > 1 ? 's' : ''}`}), même si tu n'as rien encaissé.`,
      });
    }
  }
  const year = today.slice(0, 4);
  const yearTotals = computeTotals(rowsInRange(rows, `${year}-01-01`, `${Number(year) + 1}-01-01`), { assujetti: settings.vat === 'assujetti' });
  const activity = settings.activity || 'services';
  if (settings.regime === 'micro') {
    const ceiling = REFERENCE.microCeiling[activity] * 100;
    const ratio = yearTotals.revenue / ceiling;
    if (ratio >= 0.8) {
      out.push({ level: ratio >= 1 ? 'err' : 'warn', code: 'ceiling', text: `Tu as encaissé ${fmtEur(yearTotals.revenue)} cette année : ${Math.round(ratio * 100)} % du plafond de la micro-entreprise (${fmtEur(ceiling)}, valeur de référence ${REFERENCE.year}). Au-delà, ton statut change : renseigne-toi sur service-public.fr.` });
    }
  }
  if (settings.vat === 'franchise') {
    const ceiling = REFERENCE.vatFranchiseCeiling[activity] * 100;
    const ratio = yearTotals.revenue / ceiling;
    if (ratio >= 0.8) {
      out.push({ level: ratio >= 1 ? 'err' : 'warn', code: 'vat', text: `Tu approches du seuil à partir duquel il faut facturer la TVA : ${fmtEur(yearTotals.revenue)} encaissés sur ${fmtEur(ceiling)} (valeur de référence ${REFERENCE.year}). Vérifie le seuil en vigueur sur service-public.fr.` });
    }
  }
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.entry_date}|${r.kind}|${r.amount_cents}|${String(r.label).toLowerCase()}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const dups = [...seen.values()].filter((n) => n > 1).length;
  if (dups) out.push({ level: 'info', code: 'duplicate', text: `${dups} ligne${dups > 1 ? 's semblent' : ' semble'} en double (même date, même montant, même libellé). Vérifie que ce n'est pas une erreur de saisie.` });
  return out;
}

// ---------- Journal CSV et noms de fichiers ----------

export const slug = (s, max = 40) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'sans-titre';
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const extOf = (mime) => EXT[mime] || 'bin';

/** Nom du justificatif dans une archive : date, numéro de ligne, libellé. */
export const exportFileName = (r) => `${r.entry_date}_${r.id}_${slug(r.label)}.${extOf(r.doc_mime)}`;

/** Une cellule de tableur : guillemets doublés, et jamais une formule (=, +, -, @) qu'un tableur exécuterait. */
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvMoney = (c) => (Number(c) / 100).toFixed(2).replace('.', ',');

/** Journal : une ligne par écriture, séparateur « ; » et virgule décimale (s'ouvre tel quel dans Excel en français). Montants signés : entrées +, sorties −. */
export function buildCsv(rows, { fileOf = exportFileName } = {}) {
  const head = ['Date', 'Projet', 'Type', 'Libellé', 'Client ou fournisseur', 'Catégorie', 'Mode de paiement', 'Montant TTC', 'Taux de TVA', 'TVA', 'Montant HT', 'Justificatif'];
  const lines = [head.join(';')];
  for (const r of rows) {
    const kind = KIND_BY_KEY[r.kind];
    const sign = kind.dir === 'in' ? 1 : -1;
    const ttc = sign * Number(r.amount_cents);
    const vat = sign * Number(r.vat_cents);
    const text = [r.entry_date, r.project_name || '', kind.label, r.label, r.party, categoryLabel(kind.group, r.category), methodLabel(r.method)].map(csvCell);
    // Les montants sont calculés ici (jamais saisis tels quels) : ils gardent leur signe, sans guillemet de protection
    lines.push([...text, csvMoney(ttc), r.vat_rate ? `${(r.vat_rate / 100).toString().replace('.', ',')} %` : '', csvMoney(vat), csvMoney(ttc - vat), csvCell(fileOf(r))].join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
