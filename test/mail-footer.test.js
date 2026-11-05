// Réglage « Pied de page des mails de prospection » : actif par défaut ; le retirer exige une confirmation explicite ; l'aperçu et les vrais envois suivent le réglage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { saveSecretConfig } from '../src/projects.js';
import { buildProspectMail } from '../src/services/mailer.js';
import { getSetting, setSetting, now } from '../src/db.js';
import { withSense } from './helpers/sense.js';

let s;
const sentMails = [];
before(async () => {
  s = await startApp({ createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sentMails.push(m); }, close() {} }) });
  s.app.resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
  s.app.resolveMx = async () => [{ exchange: 'mx.test', priority: 10 }];
});
after(async () => { await s.close(); });

const PROFILE = JSON.stringify({ resume: 'Cartes de fidélité.', proposition_valeur: 'Fidéliser sans carton.', arguments: ['simple'], ton: 'direct' });
const FOOT = /publiée publiquement|Ne plus recevoir de messages|Pour ne plus être contacté/;
const toggle = (u, body) => u.post('/api/settings/mail-footer', body);

test('construction du mail : texte simple par défaut, HTML sur demande ; pied de page par défaut, sans lui plus aucun lien de désinscription', () => {
  const args = { template: { subject: 'S', body: 'Bonjour {{entreprise}}' }, prospect: { company: 'Fournil', email: 'a@fournil.fr', source: 'https://fournil.fr/contact' }, smtp: { fromEmail: 'me@x.fr' }, unsubUrl: 'https://ai.test/u/a/b' };
  const withFooter = buildProspectMail(args);
  assert.match(withFooter.text, /publiée publiquement \(https:\/\/fournil\.fr\/contact\)/);
  assert.match(withFooter.text, /Pour ne plus être contacté : https:\/\/ai\.test\/u\/a\/b/);
  assert.equal(withFooter.html, undefined, 'texte simple par défaut');
  assert.match(buildProspectMail({ ...args, html: true }).html, /Ne plus recevoir de messages/);
  const without = buildProspectMail({ ...args, footer: false });
  assert.doesNotMatch(without.text, FOOT);
  assert.doesNotMatch(buildProspectMail({ ...args, footer: false, html: true }).html, FOOT);
  assert.match(without.text, /Bonjour Fournil/);
  assert.equal(without.headers['List-Unsubscribe'], undefined, 'aucun en-tête de désabonnement invisible');
  assert.equal(withFooter.headers['List-Unsubscribe'], undefined);
});

test('réglage : retirer exige la confirmation explicite, remettre est libre, chaque compte a le sien', async () => {
  const u = await s.newUser();
  const other = await s.newUser();
  const page = async (x) => (await x.get('/settings', { headers: { accept: 'text/html' } })).text();
  let html = await page(u);
  assert.match(html, /Pied de page des mails de prospection/);
  assert.match(html, /data-on="1"/);
  assert.match(html, /Attention, risques si tu le retires\./);
  assert.match(html, /RGPD et la CNIL/);
  assert.match(html, /data-footer-on hidden/);
  assert.equal(await getSetting(s.db, u.id, 'mail_footer', '1'), '1', 'actif par défaut');

  const refused = await toggle(u, { enabled: false });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, 'confirmation_required');
  assert.equal((await toggle(u, { enabled: false, confirmed: 'true' })).status, 400, 'seul true compte');
  assert.equal(await getSetting(s.db, u.id, 'mail_footer', '1'), '1', 'rien n\'a changé');

  const off = await toggle(u, { enabled: false, confirmed: true });
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { ok: true, enabled: false });
  assert.equal(await getSetting(s.db, u.id, 'mail_footer', '1'), '0');
  html = await page(u);
  assert.match(html, /data-on="0"/);
  assert.match(html, /Retiré : tes mails partent sans lien/);
  assert.match(html, /data-footer-off hidden/);
  assert.equal(await getSetting(s.db, other.id, 'mail_footer', '1'), '1', 'les autres comptes ne changent pas');

  assert.equal((await s.anon.post('/api/settings/mail-footer', { enabled: true })).status, 401);
  const on = await toggle(u, { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(await getSetting(s.db, u.id, 'mail_footer', '1'), '1');
  // enregistrer le formulaire des réglages ne touche pas à ce réglage
  await toggle(u, { enabled: false, confirmed: true });
  assert.equal((await u.post('/settings', { global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' }, { form: true, headers: { accept: 'text/html' } })).status < 400, true);
  assert.equal(await getSetting(s.db, u.id, 'mail_footer', '1'), '0', 'le formulaire principal ne le réécrit pas');
});

test('aperçu : montre ce qui partira, pied de page compris ou non, avec un avertissement quand il est retiré', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  const preview = async () => (await u.post(`/api/projects/${pid}/template/preview`, { subject: 'Bonjour {{entreprise}}', body: 'Bonjour {{entreprise}}.\n\n{{expediteur}}', html: 'on' })).json();
  let d = await preview();
  assert.equal(d.footer, true);
  assert.match(d.text, FOOT);
  assert.ok(!d.warnings.some((w) => /pied de page/i.test(w)));
  assert.match(await (await u.get(d.url, { headers: { accept: 'text/html' } })).text(), /Ne plus recevoir de messages/);

  await toggle(u, { enabled: false, confirmed: true });
  d = await preview();
  assert.equal(d.footer, false);
  assert.doesNotMatch(d.text, FOOT);
  assert.ok(d.warnings.some((w) => /pied de page est retiré/i.test(w)), 'l\'aperçu prévient');
  assert.doesNotMatch(await (await u.get(d.url, { headers: { accept: 'text/html' } })).text(), /Ne plus recevoir de messages/);
});

test('envoi réel : le mail part avec ou sans pied de page selon le réglage, en texte simple et sans en-tête List-Unsubscribe', async () => {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, JSON.stringify({ description: 'x' }), pid);
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Bonjour {{entreprise}}', 'Bonjour {{entreprise}}.', 'validated', ?)").run(pid, now());
  await saveSecretConfig(s.app, pid, 'smtp_enc', { host: 'smtp.x', port: 587, user: 'u', pass: 'secret', fromEmail: 'moi@x.fr', fromName: 'Moi' }, 'pass');
  await setSetting(s.db, u.id, 'send_delay_min', '0');
  await setSetting(s.db, u.id, 'send_delay_max', '0');
  const worker = new Worker(s.db, makeHandlers(s.app, { claude: withSense(s.app) }), { log: { error: () => {} } });
  const add = (email) => s.db.prepare("INSERT INTO prospects(project_id, company, email, source, status, created_at) VALUES(?, 'Fournil', ?, 'https://fournil.fr/contact', 'new', ?)").run(pid, email, now());
  const send = async () => { await enqueue(s.db, { userId: u.id, projectId: pid, type: 'send', params: { count: 1 } }); await worker.tick(); return (await latestJobs(s.db, pid)).send; };

  await add('un@fournil.fr');
  let job = await send();
  assert.equal(job.status, 'done', job.error);
  const first = sentMails.at(-1);
  assert.equal(first.to, 'un@fournil.fr');
  assert.match(first.text, /publiée publiquement/);
  assert.match(first.text, /Pour ne plus être contacté/);
  assert.equal(first.html, undefined);

  await setSetting(s.db, u.id, 'mail_footer', '0');
  await add('deux@fournil.fr');
  job = await send();
  assert.equal(job.status, 'done', job.error);
  const second = sentMails.at(-1);
  assert.equal(second.to, 'deux@fournil.fr');
  assert.doesNotMatch(second.text, FOOT);
  assert.equal(second.html, undefined);
  assert.match(second.text, /Bonjour Fournil/);
  assert.equal(second.headers['List-Unsubscribe'], undefined, 'aucun en-tête invisible');
});

test('modèle : la case « Envoyer en HTML » se choisit à la validation, le mail part en texte simple sinon', async () => {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  const save = (b) => u.post(`/api/projects/${pid}/template/save`, { kind: 'initial', subject: 'Bonjour', body: 'Bonjour.', ...b });
  assert.equal((await save({ mode: 'validate' })).status, 200);
  assert.equal((await s.db.prepare("SELECT html FROM templates WHERE project_id = ? AND kind = 'initial'").get(pid)).html, 0, 'texte simple par défaut');
  assert.equal((await save({ mode: 'validate', html: 'on' })).status, 200);
  assert.equal((await s.db.prepare("SELECT html FROM templates WHERE project_id = ? AND kind = 'initial'").get(pid)).html, 1);
  const state = await (await u.get(`/api/projects/${pid}/status`)).json();
  assert.equal(state.templates.initial.html, true, 'le formulaire reçoit le choix');
  assert.equal((await save({ mode: 'save' })).status, 200);
  assert.equal((await s.db.prepare("SELECT html FROM templates WHERE project_id = ? AND kind = 'initial'").get(pid)).html, 0, 'décocher repasse en texte');
});
