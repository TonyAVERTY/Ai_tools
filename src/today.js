// Page « Aujourd'hui » : ce qui attend la personne maintenant (réponses, actions, tâches IA), l'agenda du jour, l'argent, les huit dernières
// semaines, ses projets et l'usage du mois. Tout est lu dans les données réelles, rien n'est inventé : une section sans donnée le dit.
// Isolation : chaque requête est limitée aux projets accessibles (`ids`, propres ou partagés par l'équipe) ou à `user_id`.
import { now } from './db.js';
import { parisParts, parisTime } from './services/paris-time.js';
import { monthEvents } from './calendar.js';
import { usageView } from './services/plans.js';
import {
  fmtEur, todayIso, periodToDeclare, deadlineOf, daysLeft, periodRange, rowsInRange, computeTotals, dayLabel,
} from './services/accounting.js';

const TZ = 'Europe/Paris';
const DAY = 86400;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const marks = (ids) => ids.map(() => '?').join(',');

/** Types de tâche IA qui méritent une ligne dans « À traiter » quand elles se terminent (les conversations n'en font pas). */
export const JOB_LABELS = {
  analyze: "Analyse du projet", prospect: 'Recherche de prospects', template: 'Mail de prospection', followup_template: 'Mail de relance',
  linkedin: 'Post LinkedIn', evolution: 'Idées d\'évolution', billing_quotes: 'Exemples de devis', billing_docs: 'Devis, acompte, facture et avoir',
  billing_refine: 'Affinage d\'un document', instagram_post: 'Post Instagram', newsletter: 'Newsletter', promo: 'Vidéo de promotion', audit: 'Audit du projet', poste: 'Tâches des postes',
};
const INTENT = {
  interested: ['Intéressé', 'ok', 'check'], question: ['Question', 'info', 'info'], later: ['Plus tard', 'warn', 'clock'],
  refused: ['Pas intéressé', 'n', 'info'], other: ['Réponse', 'n', 'info'],
};
export const FILTERS = [['all', 'Tout'], ['rep', 'Réponses'], ['act', 'Actions'], ['ia', 'IA']];

// ---------- Éléments « traités » ----------
const KEY_RE = /^(rep|act|job):\d{1,12}(:\d{1,12})?$/;
const MAX_DONE = 500;

/** Marque (ou démarque) un élément de la liste. La clé ne sert qu'à masquer une ligne que la personne voit déjà : rien d'autre n'en dépend. */
export async function setDone(db, userId, key, done) {
  if (!KEY_RE.test(String(key))) return false;
  if (done) {
    await db.prepare('INSERT OR IGNORE INTO today_done(user_id, item_key, done_at) VALUES(?, ?, ?)').run(Number(userId), key, now());
    const n = Number((await db.prepare('SELECT COUNT(*) n FROM today_done WHERE user_id = ?').get(Number(userId))).n);
    if (n > MAX_DONE) await db.prepare('DELETE FROM today_done WHERE user_id = ? AND done_at < ?').run(Number(userId), now() - 30 * DAY);
  } else {
    await db.prepare('DELETE FROM today_done WHERE user_id = ? AND item_key = ?').run(Number(userId), key);
  }
  return true;
}

// ---------- Semaines ----------
/** Lundi 0 h (heure de Paris) de la semaine qui contient `at` (epoch s), et les 7 lundis précédents : huit semaines, la plus ancienne d'abord. */
export function weekStarts(at, count = 8) {
  const p = parisParts(new Date(at * 1000));
  const sinceMonday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 7) % 7;
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(Math.floor(parisTime(p.year, p.month, p.day - sinceMonday - 7 * i, 0).getTime() / 1000));
  out.push(Math.floor(parisTime(p.year, p.month, p.day - sinceMonday + 7, 0).getTime() / 1000));
  return out; // count + 1 bornes : la dernière ferme la dernière semaine
}
const bucket = (ts, starts) => { for (let i = starts.length - 2; i >= 0; i--) if (ts >= starts[i]) return ts < starts[i + 1] ? i : -1; return -1; };
const shortDay = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: TZ });

async function weekly(db, userId, ids, starts) {
  const counts = { sent: Array(starts.length - 1).fill(0), rep: Array(starts.length - 1).fill(0), rdv: Array(starts.length - 1).fill(0) };
  const from = starts[0], to = starts.at(-1);
  if (ids.length) {
    for (const r of await db.prepare(`SELECT sent_at t FROM mail_log WHERE project_id IN (${marks(ids)}) AND error IS NULL AND sent_at >= ? AND sent_at < ?`).all(...ids, from, to)) {
      const i = bucket(Number(r.t), starts); if (i >= 0) counts.sent[i]++;
    }
    for (const r of await db.prepare(`SELECT received_at t FROM replies WHERE project_id IN (${marks(ids)}) AND received_at >= ? AND received_at < ?`).all(...ids, from, to)) {
      const i = bucket(Number(r.t), starts); if (i >= 0) counts.rep[i]++;
    }
  }
  for (const r of await db.prepare('SELECT starts_at t FROM calendar_events WHERE user_id = ? AND starts_at >= ? AND starts_at < ?').all(Number(userId), from, to)) {
    const i = bucket(Number(r.t), starts); if (i >= 0) counts.rdv[i]++;
  }
  const weeks = starts.slice(0, -1).map((s, i) => ({ label: shortDay(s), sent: counts.sent[i], rep: counts.rep[i], rdv: counts.rdv[i] }));
  const tot = weeks.reduce((a, w) => [a[0] + w.sent, a[1] + w.rep], [0, 0]);
  return { weeks, totalSent: tot[0], totalReplies: tot[1], replyRate: tot[0] ? `${((tot[1] / tot[0]) * 100).toFixed(1).replace('.', ',')} %` : null };
}

// ---------- Déclaration ----------
/** La déclaration à faire (période, date limite, montant), ou null : réglages incomplets, régime inconnu, ou déjà déclarée. Pure. */
export function declarationNote({ rows, settings, done = new Set(), today = todayIso() }) {
  if (!settings?.complete || settings.regime === 'unknown') return null;
  const period = periodToDeclare(settings.freq, today);
  if (done.has(period)) return null;
  const deadline = deadlineOf(period, settings.regime);
  if (!deadline) return null;
  const r = periodRange(period);
  const totals = computeTotals(rowsInRange(rows, r.from, r.to), { assujetti: settings.vat === 'assujetti' });
  return { period, label: r.label, deadline, deadlineLabel: dayLabel(deadline), left: daysLeft(deadline, today), amount: fmtEur(totals.revenue) };
}

// ---------- Ce qui est dû ----------
async function money(db, userId, today) {
  const month = today.slice(0, 7);
  const prevDate = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const sum = async (m) => {
    const r = await db.prepare(`SELECT
        SUM(CASE WHEN kind = 'payment_in' THEN amount_cents ELSE 0 END) inn, SUM(CASE WHEN kind = 'refund_out' THEN amount_cents ELSE 0 END) outt
      FROM accounting_entries WHERE user_id = ? AND pending = 0 AND entry_date >= ? AND entry_date < ?`).get(Number(userId), `${m}-01`, `${m}-32`);
    return Number(r?.inn || 0) - Number(r?.outt || 0);
  };
  const open = await db.prepare(`SELECT i.id, i.project_id, i.kind, i.number, i.due_date, i.amount_cents, i.client_json FROM billing_invoices i
      JOIN accounting_entries e ON e.id = i.entry_id WHERE i.user_id = ? AND e.pending = 1 AND i.kind <> 'avoir' ORDER BY CASE WHEN i.due_date = '' THEN '9999' ELSE i.due_date END, i.id`).all(Number(userId));
  const invoices = open.map((r) => {
    let client = '';
    try { client = String(JSON.parse(r.client_json || '{}').name || ''); } catch { /* ligne ancienne : pas de nom */ }
    const due = String(r.due_date || '');
    const late = !!due && due < today;
    const days = due ? Math.abs(Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / (DAY * 1000))) : 0;
    return {
      id: Number(r.id), projectId: r.project_id == null ? null : Number(r.project_id), client: client || 'Client', ref: r.number, cents: Number(r.amount_cents), amount: fmtEur(r.amount_cents),
      late, due: !due ? 'sans échéance' : late ? `échue depuis ${plural(days, 'jour', 'jours')}` : `échéance le ${dayLabel(due)}`,
    };
  });
  return {
    month, collected: await sum(month), previous: await sum(prevDate), invoices,
    toCollect: invoices.reduce((a, i) => a + i.cents, 0), lateCount: invoices.filter((i) => i.late).length,
  };
}

// ---------- Liste « À traiter » ----------
const ago = (ts, at) => {
  const s = Math.max(0, at - Number(ts));
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  if (s < DAY) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 2 * DAY) return 'hier';
  return `il y a ${Math.round(s / DAY)} jours`;
};
const excerpt = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

async function toDo(db, userId, ids, names, at, doneKeys) {
  const items = [];
  if (!ids.length) return items;
  const p = (id) => names.get(Number(id)) || '';
  for (const r of await db.prepare(`SELECT r.id, r.project_id, r.prospect_id, r.from_email, r.body, r.intent, r.received_at, x.company
      FROM replies r LEFT JOIN prospects x ON x.id = r.prospect_id WHERE r.project_id IN (${marks(ids)}) AND r.seen_at IS NULL ORDER BY r.received_at DESC LIMIT 30`).all(...ids)) {
    const key = `rep:${r.id}`;
    if (doneKeys.has(key)) continue;
    const [badge, tone, icon] = INTENT[r.intent] || INTENT.other;
    const hot = r.intent === 'interested' || r.intent === 'question';
    items.push({
      key, kind: 'rep', icon: 'reply', title: r.company || r.from_email, badge, tone, badgeIcon: icon, meta: `${p(r.project_id)} · ${ago(r.received_at, at)}`,
      text: excerpt(r.body) ? `« ${excerpt(r.body)} »` : '', quote: true, action: hot ? 'Répondre' : 'Ouvrir la fiche', primary: r.intent === 'interested',
      href: r.prospect_id ? `/clients/p/${Number(r.prospect_id)}` : '/mails', at: Number(r.received_at),
    });
  }
  const p0 = parisParts(new Date(at * 1000));
  const endOfToday = Math.floor(parisTime(p0.year, p0.month, p0.day + 1, 0).getTime() / 1000);
  const startOfToday = Math.floor(parisTime(p0.year, p0.month, p0.day, 0).getTime() / 1000);
  for (const r of await db.prepare(`SELECT id, project_id, company, next_action, next_action_at FROM prospects WHERE project_id IN (${marks(ids)})
      AND next_action IS NOT NULL AND next_action <> '' AND next_action_at IS NOT NULL AND next_action_at < ? AND status NOT IN ('refused', 'bounced') ORDER BY next_action_at LIMIT 30`).all(...ids, endOfToday)) {
    const key = `act:${r.id}:${r.next_action_at}`;
    if (doneKeys.has(key)) continue;
    const late = Number(r.next_action_at) < startOfToday;
    const hhmm = new Date(Number(r.next_action_at) * 1000).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(':00', ' h').replace(':', ' h ');
    items.push({
      key, kind: 'act', icon: 'clock', title: `${r.next_action} : ${r.company}`, badge: late ? 'En retard' : "Prévu aujourd'hui", tone: 'warn', badgeIcon: 'clock',
      meta: `${late ? shortDay(Number(r.next_action_at)) : hhmm} · ${p(r.project_id)}`, text: late ? "L'action prévue n'a pas été marquée comme faite." : 'Action notée sur la fiche du prospect.',
      action: 'Ouvrir la fiche', primary: false, href: `/clients/p/${Number(r.id)}`, at: Number(r.next_action_at),
    });
  }
  for (const r of await db.prepare(`SELECT id, project_id, type, status, error, finished_at FROM jobs WHERE user_id = ? AND status IN ('done', 'error')
      AND finished_at IS NOT NULL AND finished_at >= ? ORDER BY finished_at DESC LIMIT 30`).all(Number(userId), at - 2 * DAY)) {
    const label = JOB_LABELS[r.type];
    if (!label) continue;
    const key = `job:${r.id}`;
    if (doneKeys.has(key)) continue;
    const bad = r.status === 'error';
    items.push({
      key, kind: 'ia', icon: bad ? 'x' : 'spark', title: label, badge: bad ? 'Échec' : 'Terminé', tone: bad ? 'err' : 'ok', badgeIcon: bad ? 'x' : 'check',
      meta: `${p(r.project_id)} · ${ago(r.finished_at, at)}`.replace(/^ · /, ''), text: bad ? excerpt(r.error, 160) || 'La tâche a échoué.' : 'La tâche est terminée : le résultat t\'attend dans le projet.',
      action: bad ? 'Réessayer' : 'Voir le projet', primary: !bad, href: '/projets', at: Number(r.finished_at),
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

// ---------- Agenda du jour ----------
async function agendaOf(db, userId, ids, names, at) {
  const p = parisParts(new Date(at * 1000));
  const list = (await monthEvents(db, ids, p.year, p.month, userId)).get(p.day) || [];
  return list.map((e) => ({
    time: new Date(e.at * 1000).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(/^(\d+):/, '$1:'),
    title: e.label, meta: e.kind === 'event' ? 'Événement' : e.project || '', kind: e.kind, past: e.at < at - 3600, at: e.at,
  }));
}

// ---------- Projets ----------
async function projectsOf(db, userId, ids, names, onboarding, replyCounts) {
  if (!ids.length) return [];
  const pro = new Map(), docs = new Map();
  for (const r of await db.prepare(`SELECT project_id, COUNT(*) n, SUM(CASE WHEN status <> 'new' THEN 1 ELSE 0 END) contacted,
      SUM(CASE WHEN status IN ('replied', 'client') THEN 1 ELSE 0 END) replies, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) fresh
      FROM prospects WHERE project_id IN (${marks(ids)}) GROUP BY project_id`).all(...ids)) pro.set(Number(r.project_id), r);
  for (const r of await db.prepare('SELECT project_id, kind, COUNT(*) n FROM billing_invoices WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id, kind').all(Number(userId))) {
    const m = docs.get(Number(r.project_id)) || docs.set(Number(r.project_id), {}).get(Number(r.project_id));
    m[r.kind] = Number(r.n);
  }
  return ids.map((id) => {
    const s = pro.get(Number(id)) || {}, d = docs.get(Number(id)) || {}, ob = onboarding.get(Number(id));
    const funnel = [['Prospects', Number(s.n || 0)], ['Contactés', Number(s.contacted || 0)], ['Réponses', Number(s.replies || 0)], ['Devis', Number(d.devis || 0)], ['Factures', Number(d.facture || 0)]]
      .map(([label, n]) => ({ label, n }));
    const waiting = replyCounts.get(Number(id)) || 0;
    const step = ob && !ob.ready ? ob.steps.find((x) => !x.done && !x.optional) : null;
    return {
      id: Number(id), name: names.get(Number(id)) || '', state: ob && !ob.ready ? `Mise en route ${ob.done} sur ${ob.total}` : 'Prêt', ready: !ob || ob.ready, funnel,
      next: step ? `Étape suivante : ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}` : waiting ? plural(waiting, 'réponse à traiter', 'réponses à traiter')
        : Number(s.fresh || 0) ? plural(Number(s.fresh), 'prospect à contacter', 'prospects à contacter') : 'Rien en attente',
    };
  });
}

// ---------- Usage du mois ----------
const USAGE_LABEL = { mails: 'Mails envoyés', aiJobs: 'Tâches IA', prospects: 'Contacts', projects: 'Projets' };
const USAGE_ORDER = ['mails', 'aiJobs', 'prospects', 'projects'];
export function usageRows(u, at = now()) {
  if (!u) return [];
  const p = parisParts(new Date(at * 1000));
  const nextMonth = new Date(Date.UTC(p.year, p.month, 1)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return USAGE_ORDER.map((k) => u.items.find((i) => i.kind === k)).filter(Boolean).map((i) => {
    const warn = i.full || (i.limit != null && i.used / i.limit >= 0.8);
    const note = i.limit == null ? 'Sans plafond' : i.full ? 'Plafond atteint pour ton offre'
      : i.kind === 'mails' ? `Repart de zéro le ${nextMonth}` : i.kind === 'aiJobs' ? `${i.pct} % du plafond : ${plural(i.limit - i.used, 'restante', 'restantes')}`
        : i.kind === 'prospects' ? plural(i.limit - i.used, 'place libre', 'places libres') : `${plural(i.limit - i.used, 'place libre', 'places libres')}`;
    return { kind: i.kind, label: USAGE_LABEL[i.kind], used: i.used, max: i.limit, pct: i.pct, warn, note };
  });
}

// ---------- Tout ensemble ----------
/**
 * @param {object} o
 * @param {Array<{id:number,name:string}>} o.projects projets accessibles
 * @param {Map<number, object>} o.onboarding liste de mise en route par projet (src/checklist.js)
 * @param {object} o.settings réglages de comptabilité ; o.accRows lignes validées ; o.declared périodes déjà déclarées
 */
export async function todayData(db, user, { projects, onboarding = new Map(), settings = null, accRows = [], declared = new Set(), at = now() } = {}) {
  const userId = Number(user.id);
  const ids = projects.map((x) => Number(x.id));
  const names = new Map(projects.map((x) => [Number(x.id), String(x.name)]));
  const doneKeys = new Set((await db.prepare('SELECT item_key FROM today_done WHERE user_id = ?').all(userId)).map((r) => r.item_key));
  const today = todayIso(new Date(at * 1000));
  const items = await toDo(db, userId, ids, names, at, doneKeys);
  const replyCounts = new Map(); // réponses non lues par projet (la liste « À traiter » en montre 30 au plus)
  if (ids.length) for (const r of await db.prepare(`SELECT project_id, COUNT(*) n FROM replies WHERE project_id IN (${marks(ids)}) AND seen_at IS NULL GROUP BY project_id`).all(...ids)) replyCounts.set(Number(r.project_id), Number(r.n));
  const starts = weekStarts(at);
  const wk = await weekly(db, userId, ids, starts);
  const agenda = await agendaOf(db, userId, ids, names, at);
  const cash = await money(db, userId, today);
  const usage = await usageView(db, user, { at });
  const mails = usage.items.find((i) => i.kind === 'mails');
  const repOpen = items.filter((i) => i.kind === 'rep').length;
  const last = wk.weeks.at(-1);
  const monthName = (m) => cap(new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' }));
  const nextEvent = agenda.find((e) => e.kind === 'event' && !e.past);
  const bits = [
    repOpen ? plural(repOpen, 'réponse à traiter', 'réponses à traiter') : null,
    nextEvent ? `1 rendez-vous à ${nextEvent.time.replace(':00', ' h').replace(':', ' h ')}` : null,
    cash.toCollect ? `${fmtEur(cash.toCollect)} à encaisser` : null,
  ].filter(Boolean);
  const name = String(user.name || '').trim().split(/\s+/)[0] || cap(String(user.email || '').split('@')[0]);
  return {
    name, dateLabel: cap(new Date(at * 1000).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })),
    summary: bits.length ? `${bits.join(', ')}.` : "Rien d'urgent. Bonne journée.",
    onboarding: [...onboarding.entries()].map(([id, c]) => ({ id, name: names.get(id) || '', ...c })).find((c) => !c.ready) || null,
    kpis: [
      { label: 'Réponses à traiter', value: String(repOpen), sub: repOpen ? 'à lire et à traiter' : 'rien en attente', href: '/mails', tone: '' },
      { label: 'Mails cette semaine', value: last.sent.toLocaleString('fr-FR'), sub: mails ? `${mails.used.toLocaleString('fr-FR')}${mails.limit == null ? '' : ` sur ${mails.limit.toLocaleString('fr-FR')}`} ce mois-ci` : '', href: '/mails', tone: '' },
      { label: 'À encaisser', value: fmtEur(cash.toCollect), sub: cash.invoices.length ? `${plural(cash.invoices.length, 'facture', 'factures')}${cash.lateCount ? `, ${cash.lateCount} en retard` : ''}` : 'aucune facture en attente', href: '/compta', tone: cash.lateCount ? 'warn' : '' },
      { label: `Encaissé en ${monthName(cash.month).toLowerCase()}`, value: fmtEur(cash.collected), sub: `${fmtEur(cash.previous)} le mois dernier`, href: '/compta', tone: '' },
    ],
    items, counts: Object.fromEntries(FILTERS.map(([k]) => [k, items.filter((i) => k === 'all' || i.kind === k).length])),
    agenda, invoices: cash.invoices.slice(0, 5), more: Math.max(0, cash.invoices.length - 5),
    declaration: declarationNote({ rows: accRows, settings, done: declared, today }),
    weeks: wk.weeks, lastWeek: last, replyRate: wk.replyRate, totalSent: wk.totalSent, totalReplies: wk.totalReplies,
    projects: await projectsOf(db, userId, ids, names, onboarding, replyCounts),
    usage: usageRows(usage, at), plan: usage.planLabel,
  };
}
