// Canaux de notification Slack, Telegram et e-mail : validation, secrets chiffrés, envoi, plafond, test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting } from '../src/db.js';
import { notify, EVENTS } from '../src/services/notify.js';
import { startApp } from './helpers/server.js';

const SLACK = 'https://hooks.slack.com/services/T0123ABCD/B0123ABCD/' + 'a1B2c3D4'.repeat(3);
const TG_TOKEN = '123456789:' + 'AbC_dEf-1'.repeat(4);
const base = { notify_email: '', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };

const calls = [];
const mails = [];
let s;
before(async () => {
  s = await startApp({
    cfg: { systemSmtp: { host: 'smtp.serveur', port: 587, user: 'srv', pass: 'p', fromEmail: 'aitools@serveur.test' } },
    fetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; },
    createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }),
  });
});
after(async () => { await s.close(); });
const page = async (u) => (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
const stored = (u) => getSetting(s.db, u.id, 'notify_channels_json');

test('enregistrement : adresses et jetons validés, chiffrés en base, jamais réaffichés', async () => {
  const u = await s.newUser();
  assert.equal((await u.post('/settings', { ...base, slack_url: 'https://evil.example/hooks' }, { form: true })).status, 400, 'hôte Slack arbitraire refusé');
  assert.equal((await u.post('/settings', { ...base, telegram_token: 'pas-un-jeton', telegram_chat: '12345' }, { form: true })).status, 400);
  assert.equal((await u.post('/settings', { ...base, telegram_token: TG_TOKEN, telegram_chat: 'pas un id' }, { form: true })).status, 400);
  assert.equal((await u.post('/settings', { ...base, email_to: 'pas-un-mail' }, { form: true })).status, 400);
  assert.equal(await stored(u), null, 'rien n\'est enregistré tant que tout n\'est pas valide');

  const ok = await u.post('/settings', { ...base, slack_url: SLACK, slack_ev_reply: 'on', telegram_token: TG_TOKEN, telegram_chat: '987654', telegram_ev_job_error: 'on', email_to: 'moi@exemple.fr', email_ev_weekly: 'on' }, { form: true });
  assert.equal(ok.status, 303);
  const raw = await stored(u);
  assert.ok(!raw.includes('hooks.slack.com') && !raw.includes(TG_TOKEN) && !raw.includes('AbC_dEf'), 'secrets chiffrés en base');
  const html = await page(u);
  assert.ok(!html.includes(SLACK) && !html.includes(TG_TOKEN), 'jamais réaffichés');
  assert.match(html, /data-chanlist/, 'une seule section Notifications, avec le menu +');
  assert.doesNotMatch(html, /id="canaux"|id="discord"/, 'plus de sections séparées');
  assert.match(html, /value="moi@exemple\.fr"/);
  assert.match(html, /value="987654"/);
  // un enregistrement sans retaper les secrets les conserve ; les événements suivent le formulaire
  await u.post('/settings', { ...base, slack_ev_reply: 'on', slack_ev_abuse: 'on', telegram_chat: '987654', email_to: 'moi@exemple.fr' }, { form: true });
  const cfg = JSON.parse(await stored(u));
  assert.deepEqual(cfg.slack.events, ['reply', 'abuse']);
  assert.ok(cfg.slack.secretEnc && cfg.telegram.secretEnc, 'secrets conservés');
});

test('envoi : seulement aux canaux qui reçoivent l\'événement ; Slack, Telegram et e-mail bien formés', async () => {
  const u = await s.newUser();
  await u.post('/settings', { ...base, slack_url: SLACK, slack_ev_reply: 'on', telegram_token: TG_TOKEN, telegram_chat: '987654', telegram_ev_reply: 'on', telegram_ev_job_error: 'on', email_to: 'moi@exemple.fr', email_ev_weekly: 'on' }, { form: true });
  calls.length = 0; mails.length = 0;
  assert.equal(await notify(s.app, u.id, 'reply', { title: 'Réponse de <b>Atelier</b> & Cie', description: 'Intéressé', level: 'ok' }), true);
  const slack = calls.find((c) => c.url === SLACK);
  assert.ok(slack && /Réponse de &lt;b&gt;Atelier&lt;\/b&gt; &amp; Cie/.test(slack.body.text), 'texte Slack échappé');
  const tg = calls.find((c) => c.url === `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
  assert.equal(tg.body.chat_id, '987654');
  assert.match(tg.body.text, /Intéressé/);
  assert.equal(mails.length, 0, 'l\'e-mail ne reçoit que le rapport hebdo');
  calls.length = 0;
  await notify(s.app, u.id, 'weekly', { title: 'Rapport hebdo\r\nBcc: x@y.fr', description: 'chiffres' });
  assert.equal(calls.length, 0, 'ni Slack ni Telegram ne reçoivent le rapport hebdo');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'moi@exemple.fr');
  assert.equal(mails[0].from, 'aitools@serveur.test', 'depuis le SMTP du serveur');
  assert.doesNotMatch(mails[0].subject, /[\r\n]/, 'pas d\'injection d\'en-tête par le titre');
  // Un événement qu'aucun canal ne reçoit : rien, et pas d'erreur
  assert.equal(await notify(s.app, u.id, 'budget', { title: 't' }), false);
});

test('test d\'envoi par canal, retrait par la corbeille, jamais le canal d\'un autre compte', async () => {
  const u = await s.newUser(), v = await s.newUser();
  await u.post('/settings', { ...base, slack_url: SLACK, email_to: 'moi@exemple.fr' }, { form: true });
  calls.length = 0; mails.length = 0;
  assert.equal((await u.post('/api/notify/test', { channel: 'slack' })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(mails.length, 0, 'un test ne touche que le canal demandé');
  assert.equal((await u.post('/api/notify/test', { channel: 'email' })).status, 200);
  assert.equal(mails.length, 1);
  assert.equal((await u.post('/api/notify/test', { channel: 'telegram' })).status, 502, 'canal non configuré');
  assert.equal((await u.post('/api/notify/test', { channel: 'inconnu' })).status, 400);
  assert.equal((await v.post('/api/notify/test', { channel: 'slack' })).status, 502, 'v n\'a pas de canal');
  assert.equal((await v.post('/api/notify/test', {})).status, 400, 'aucun canal du tout');
  await u.post('/settings', { ...base, slack_del: '1', email_to: 'moi@exemple.fr' }, { form: true });
  const cfg = JSON.parse(await stored(u));
  assert.deepEqual(Object.keys(cfg), ['email'], 'Slack retiré, e-mail conservé');
});

test('e-mail : plafond de 20 notifications par heure, SMTP du serveur requis', async () => {
  const u = await s.newUser();
  await u.post('/settings', { ...base, email_to: 'moi@exemple.fr', email_ev_job_done: 'on' }, { form: true });
  mails.length = 0;
  for (let i = 0; i < 25; i++) await notify(s.app, u.id, 'job_done', { title: `Job ${i}` });
  assert.equal(mails.length, 20);
  const noSmtp = await startApp({ createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }) });
  try {
    const w = await noSmtp.newUser();
    await w.post('/settings', { ...base, email_to: 'moi@exemple.fr', email_ev_job_done: 'on' }, { form: true });
    mails.length = 0;
    assert.equal(await notify(noSmtp.app, w.id, 'job_done', { title: 'x' }), false);
    assert.equal(mails.length, 0);
    assert.match(await (await w.get('/settings', { headers: { accept: 'text/html' } })).text(), /SMTP du serveur n'est pas configuré/);
  } finally { await noSmtp.close(); }
  assert.ok(EVENTS.reply);
});

test('menu « + » : les vrais logos Discord, Slack et Telegram (pas un avion en papier), l\'enveloppe pour l\'e-mail', async () => {
  const u = await s.newUser();
  const html = await page(u);
  const menu = html.slice(html.indexOf('data-addmenu'), html.indexOf('</details>', html.indexOf('data-addmenu')));
  for (const [k, icon] of [['discord', 'discord'], ['slack', 'slack'], ['telegram', 'telegram'], ['email', 'mail']]) {
    assert.match(menu, new RegExp(`data-chan-pick="${k}"[^>]*><svg class="ic"[^>]*><use href="#i-${icon}">`), k);
  }
  assert.doesNotMatch(menu, /#i-send/);
  for (const k of ['discord', 'slack', 'telegram']) assert.match(html, new RegExp(`<symbol id="i-${k}"[^>]*><path fill="currentColor" stroke="none" d="M`), `symbole ${k} dans le sprite`);
  assert.match(html, /<span class="srv-n"><svg class="ic"[^>]*><use href="#i-telegram">/, 'même logo dans l\'en-tête de la carte');
});
