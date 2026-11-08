// Page « Aujourd'hui » : ce qui attend la personne, lu dans ses données réelles ; marquage « traité » ; isolation entre comptes ; fonctions pures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { weekStarts, declarationNote, usageRows, setDone, JOB_LABELS } from '../src/today.js';
import { now } from '../src/db.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const text = async (u, p) => (await u.get(p, { headers: { accept: 'text/html' } })).text();

async function prospect(db, pid, company, email, extra = {}) {
  const r = await db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at, next_action, next_action_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
    .run(pid, company, email, extra.status || 'new', now(), extra.action ?? null, extra.at ?? null);
  return Number(r.lastInsertRowid);
}
async function reply(db, pid, prospectId, uid, body, intent = 'interested', at = now() - 3600) {
  const r = await db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, prospectId, uid, 'contact@cabinet.fr', 'Re', body, intent, at);
  return Number(r.lastInsertRowid);
}

test('page « Aujourd\'hui » : la racine d\'un compte connecté, Projets à son adresse, un compte neuf voit des sections vides qui le disent', async () => {
  const u = await s.newUser({ email: 'jour@x.fr' });
  const home = await text(u, '/');
  assert.match(home, /<h1 class="td-title">Bonjour /);
  assert.match(home, /Rien d(?:'|&#39;)urgent\. Bonne journée\./);
  assert.match(home, /Tout est traité/);
  assert.match(home, /Rien de prévu aujourd'hui\./);
  assert.match(home, /Aucune facture en attente d'encaissement\./);
  assert.match(home, /Aucun projet pour l'instant\. <a href="\/projets" data-new-project>/);
  assert.match(home, /<a class="pill" href="\/">[^]*?Aujourd'hui/);
  assert.match(home, /class="td-usage"/);
  // pas de style en ligne (CSP), les barres sont des <rect> SVG
  assert.doesNotMatch(home, /\sstyle="/);
  assert.match(home, /<svg class="td-bars"[^>]*>(<rect[^>]*\/>)+<\/svg>/);
  const projets = await text(u, '/projets');
  assert.match(projets, /<h1[^>]*>Projets<\/h1>/);
});

test('« À traiter » : réponses non lues, actions du jour et tâches IA, chacune avec son bouton ; la liste est propre au compte', async () => {
  const u = await s.newUser({ email: 'liste@x.fr' });
  const other = await s.newUser({ email: 'autre@x.fr' });
  const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
  const p1 = await prospect(s.db, pid, 'Cabinet Le Gall', 'a@legall.fr', { status: 'replied' });
  await reply(s.db, pid, p1, 1, 'Bonjour, ça nous intéresse. Pouvez-vous m\'appeler jeudi ?', 'interested');
  await reply(s.db, pid, null, 2, 'Merci, pas pour le moment.', 'refused', now() - 7200);
  const p2 = await prospect(s.db, pid, 'Kiné du Port', 'b@port.fr', { action: 'Rappeler', at: now() - 60 });
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, error, created_at, finished_at) VALUES(?, ?, 'audit', 'error', 'Dépôt inaccessible', ?, ?)").run(u.id, pid, now() - 600, now() - 300);
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at, finished_at) VALUES(?, ?, 'chat', 'done', ?, ?)").run(u.id, pid, now() - 600, now() - 300);

  const home = await text(u, '/');
  assert.match(home, /Cabinet Le Gall/);
  assert.match(home, /Intéressé/);
  assert.match(home, /« Bonjour, ça nous intéresse/);
  assert.match(home, new RegExp(`href="/clients/p/${p1}"`));
  assert.match(home, /contact@cabinet\.fr/, 'réponse sans prospect connu : l\'adresse sert de titre');
  assert.match(home, /Pas intéressé/);
  assert.match(home, /Rappeler : Kiné du Port/);
  assert.match(home, new RegExp(`href="/clients/p/${p2}"`));
  assert.match(home, /Audit du projet/);
  assert.match(home, /Dépôt inaccessible/);
  assert.match(home, /Réessayer/);
  assert.doesNotMatch(home, /Assistant IA/, 'une conversation n\'est pas une tâche à traiter');
  assert.match(home, /data-today-n="rep">2</);
  assert.match(home, /data-today-n="act">1</);
  assert.match(home, /data-today-n="ia">1</);
  assert.match(home, /data-today-count>4</);
  assert.match(home, /2 réponses à traiter\./);
  // isolation : l'autre compte ne voit rien de tout ça
  const theirs = await text(other, '/');
  assert.doesNotMatch(theirs, /Cabinet Le Gall|Kiné du Port|Audit du projet|contact@cabinet/);
  assert.match(theirs, /Tout est traité/);
});

test('« Marquer traité » : la ligne disparaît au rechargement, « Annuler » la rend, une clé invalide est refusée, un autre compte n\'est pas touché', async () => {
  const u = await s.newUser({ email: 'traite@x.fr' });
  const other = await s.newUser({ email: 'voisin@x.fr' });
  const pid = await addProject(s.db, u.id, { name: 'P', gitUrl: 'https://github.com/u/p.git' });
  const rid = await reply(s.db, pid, null, 1, 'Une question sur le prix.', 'question');
  assert.match(await text(u, '/'), /Une question sur le prix\./);
  assert.equal((await u.post('/api/today/done', { key: `rep:${rid}`, done: true })).status, 200);
  assert.doesNotMatch(await text(u, '/'), /Une question sur le prix\./);
  // la réponse reste non lue ailleurs : ce marquage est propre à la liste
  assert.equal((await s.db.prepare('SELECT seen_at FROM replies WHERE id = ?').get(rid)).seen_at, null);
  assert.equal((await u.post('/api/today/done', { key: `rep:${rid}`, done: false })).status, 200);
  assert.match(await text(u, '/'), /Une question sur le prix\./);
  for (const key of ['', 'rep', 'rep:abc', 'x:1', `rep:${rid}; DROP TABLE replies`, 'rep:1:2:3', `rep:${'9'.repeat(40)}`]) {
    assert.equal((await u.post('/api/today/done', { key, done: true })).status, 400, key);
  }
  // un autre compte qui marque la même clé ne change rien pour le premier
  assert.equal((await other.post('/api/today/done', { key: `rep:${rid}`, done: true })).status, 200);
  assert.match(await text(u, '/'), /Une question sur le prix\./);
  assert.equal((await s.anon.post('/api/today/done', { key: `rep:${rid}` })).status, 401);
});

test('semaines : huit lundis à 0 h (heure de Paris, changement d\'heure compris), la dernière semaine fermée par un neuvième repère', () => {
  const at = Date.UTC(2026, 10, 6, 12) / 1000; // vendredi 6 novembre 2026
  const st = weekStarts(at);
  assert.equal(st.length, 9);
  const fmt = (t) => new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric' });
  assert.match(fmt(st[7]), /^lun\.? 0?2\/11 00/, 'la semaine en cours commence le lundi 2 novembre');
  assert.match(fmt(st[0]), /^lun\.? 14\/0?9 00/, 'huit semaines plus tôt : lundi 14 septembre');
  assert.match(fmt(st[8]), /^lun\.? 0?9\/11 00/);
  // passage à l'heure d'hiver (25 octobre 2026) : les repères restent des minuits locaux, donc 7 jours moins ou plus une heure
  const gaps = st.slice(1).map((t, i) => t - st[i]);
  assert.ok(gaps.every((g) => g === 7 * 86400 || g === 7 * 86400 + 3600), JSON.stringify(gaps));
  assert.ok(gaps.some((g) => g === 7 * 86400 + 3600), 'une semaine de 169 h (retour à l\'heure d\'hiver)');
});

test('graphique et tableau : mails, réponses et rendez-vous par semaine, taux de réponse, même chiffres dans les deux', async () => {
  const u = await s.newUser({ email: 'sem@x.fr' });
  const pid = await addProject(s.db, u.id, { name: 'S', gitUrl: 'https://github.com/u/s.git' });
  for (let i = 0; i < 5; i++) await s.db.prepare('INSERT INTO mail_log(project_id, email, sent_at, kind) VALUES(?, ?, ?, ?)').run(pid, `m${i}@x.fr`, now() - 3600, 'initial');
  await s.db.prepare('INSERT INTO mail_log(project_id, email, sent_at, kind, error) VALUES(?, ?, ?, ?, ?)').run(pid, 'ko@x.fr', now() - 3600, 'initial', 'refusé');
  await reply(s.db, pid, null, 1, 'ok', 'interested', now() - 1800);
  await s.db.prepare('INSERT INTO calendar_events(user_id, title, minutes, starts_at, created_at) VALUES(?, ?, ?, ?, ?)').run(u.id, 'Démo', 30, now() + 600, now()).catch(() => {});
  const home = await text(u, '/');
  assert.match(home, /Cette semaine : <b>5<\/b> mails, <b>1<\/b> réponses?/, 'le mail en erreur ne compte pas');
  assert.match(home, /Taux de réponse sur 8 semaines : <b>20,0 %<\/b>/);
  assert.match(home, /<th scope="col">Semaine<\/th><th scope="col">Mails<\/th>/);
  assert.match(home, /role="img" aria-label="Sur 8 semaines : 5 mails envoyés, 1 réponses?\./);
});

test('argent : factures à encaisser (échues en rouge), encaissé du mois, aucune donnée d\'un autre compte', async () => {
  const u = await s.newUser({ email: 'argent@x.fr' });
  const other = await s.newUser({ email: 'argent2@x.fr' });
  const pid = await addProject(s.db, u.id, { name: 'Compta', gitUrl: 'https://github.com/u/c.git' });
  const day = (delta) => new Date(Date.now() + delta * 86400_000).toISOString().slice(0, 10);
  const entry = async (kind, pending, cents, date) => Number((await s.db.prepare(`INSERT INTO accounting_entries(user_id, project_id, project_name, kind, entry_date, label, amount_cents, doc_name, doc_mime, doc_size, doc_file, created_at, updated_at, pending)
    VALUES(?, ?, 'Compta', ?, ?, 'x', ?, 'd.pdf', 'application/pdf', 1, 'f', ?, ?, ?)`).run(u.id, pid, kind, date, cents, now(), now(), pending)).lastInsertRowid);
  const inv = async (number, cents, due, entryId) => s.db.prepare(`INSERT INTO billing_invoices(user_id, project_id, project_name, kind, number, issue_date, due_date, client_json, amount_cents, entry_id, pdf_file, pdf_size, created_at)
    VALUES(?, ?, 'Compta', 'facture', ?, ?, ?, ?, ?, ?, 'f.pdf', 1, ?)`).run(u.id, pid, number, day(-30), due, JSON.stringify({ name: 'Cabinet Morvan' }), cents, entryId, now());
  await inv('F-2026-0004', 84000, day(-6), await entry('payment_in', 1, 84000, day(-30)));
  await inv('F-2026-0005', 44400, day(10), await entry('payment_in', 1, 44400, day(-3)));
  await entry('payment_in', 0, 64000, day(0));
  const home = await text(u, '/');
  assert.match(home, /Cabinet Morvan/);
  assert.match(home, /F-2026-0004 · échue depuis 6 jours/);
  assert.match(home, /class="late">F-2026-0004/);
  assert.match(home, /2 factures, 1 en retard/);
  assert.match(home, /1\s284,00\s€/, 'total à encaisser');
  assert.match(home, /640,00\s€/, 'encaissé du mois');
  assert.match(home, new RegExp(`href="/facturation/projet/${pid}">Relancer<`));
  assert.doesNotMatch(await text(other, '/'), /Cabinet Morvan|F-2026-0004/);
});

test('déclaration : la période à déclarer, sa date limite et son montant ; rien si les réglages sont incomplets ou la période déjà déclarée', () => {
  const settings = { complete: true, regime: 'micro', freq: 'monthly', activity: 'services', vat: 'franchise' };
  const rows = [
    { kind: 'payment_in', entry_date: '2026-10-05', amount_cents: 150000, vat_cents: 0 },
    { kind: 'payment_in', entry_date: '2026-10-20', amount_cents: 64000, vat_cents: 0 },
    { kind: 'payment_in', entry_date: '2026-11-02', amount_cents: 99900, vat_cents: 0 },
  ];
  const n = declarationNote({ rows, settings, today: '2026-11-06' });
  assert.equal(n.period, '2026-10');
  assert.equal(n.deadline, '2026-11-30');
  assert.equal(n.left, 24);
  assert.match(n.amount, /2\s140,00\s€/);
  assert.equal(declarationNote({ rows, settings, today: '2026-12-05' }).period, '2026-11', 'début décembre : c\'est novembre qu\'on déclare');
  assert.equal(declarationNote({ rows, settings: { ...settings, freq: 'quarterly' }, today: '2026-11-06' }).period, '2026-Q3');
  assert.equal(declarationNote({ rows, settings, done: new Set(['2026-10']), today: '2026-11-06' }), null);
  assert.equal(declarationNote({ rows, settings: { ...settings, complete: false }, today: '2026-11-06' }), null);
  assert.equal(declarationNote({ rows, settings: { ...settings, regime: 'unknown' }, today: '2026-11-06' }), null);
});

test('usage du mois : une barre par plafond, alerte à 80 % et à 100 %, « Sans plafond » pour une offre illimitée', () => {
  const item = (kind, used, limit) => ({ kind, label: kind, used, limit, pct: limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100)), full: limit != null && used >= limit });
  const rows = usageRows({ items: [item('projects', 2, 2), item('prospects', 186, 300), item('mails', 86, 500), item('aiJobs', 16, 20)] }, Date.UTC(2026, 10, 6) / 1000);
  assert.deepEqual(rows.map((r) => r.kind), ['mails', 'aiJobs', 'prospects', 'projects']);
  assert.equal(rows[0].note, 'Repart de zéro le 1 décembre');
  assert.equal(rows[1].warn, true);
  assert.equal(rows[1].note, '80 % du plafond : 4 restantes');
  assert.equal(rows[2].note, '114 places libres');
  assert.equal(rows[3].note, 'Plafond atteint pour ton offre');
  assert.equal(usageRows({ items: [item('mails', 5, null)] })[0].note, 'Sans plafond');
});

test('marquage « traité » : au-delà de 500 lignes, les plus anciennes (plus de 30 jours) sont purgées ; les types de tâche affichés ont un nom', async () => {
  const u = await s.newUser({ email: 'purge@x.fr' });
  const old = now() - 40 * 86400;
  const ins = s.db.prepare('INSERT INTO today_done(user_id, item_key, done_at) VALUES(?, ?, ?)');
  for (let i = 0; i < 500; i++) await ins.run(u.id, `rep:${i}`, old);
  assert.equal(await setDone(s.db, u.id, 'rep:9999', true), true);
  const left = Number((await s.db.prepare('SELECT COUNT(*) n FROM today_done WHERE user_id = ?').get(u.id)).n);
  assert.equal(left, 1, 'les 500 anciennes sont purgées, la nouvelle reste');
  assert.equal(await setDone(s.db, u.id, 'injection', true), false);
  for (const label of Object.values(JOB_LABELS)) assert.ok(label.length > 3);
});
