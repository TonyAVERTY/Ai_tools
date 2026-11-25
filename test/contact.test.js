// Formulaire de contact : l'adresse de l'éditeur n'est écrite dans aucune page publique ; le message part par le SMTP du serveur ; garde-fous.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, APP_URL } from './helpers/server.js';
import { formToken, checkToken, readContact } from '../src/services/contact.js';
import { PUBLIC_PATHS } from './helpers/i18n-pages.js';

const SMTP = { host: 'smtp.serveur', port: 587, user: 'srv', pass: 'p', fromEmail: 'aitools@serveur.test' };
const mails = [];
let s;
before(async () => {
  s = await startApp({ cfg: { systemSmtp: SMTP }, createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }) });
});
after(async () => { await s.close(); });

const key = () => s.app.cfg.secretKey;
const old = () => formToken(key(), Date.now() - 10_000); // affiché il y a 10 secondes
const send = (over = {}, opts = {}) => s.anon.post('/contact', { name: 'Camille Test', email: 'camille@exemple.fr', topic: 'question', message: 'Bonjour, ceci est un message de test assez long.', ts: old(), website: '', ...over }, { form: true, ...opts });

test('aucune page publique ne contient l\'adresse e-mail de l\'éditeur (ni mailto:)', async () => {
  for (const path of [...PUBLIC_PATHS, '/contact', '/accueil']) {
    const body = await (await fetch(s.base + path, { headers: { accept: 'text/html' } })).text();
    assert.doesNotMatch(body, /contact@iaboss\.fr/i, `${path} : adresse visible`);
    assert.doesNotMatch(body, /mailto:/i, `${path} : lien mailto`);
  }
  assert.match(await (await fetch(s.base + '/accueil')).text(), /href="\/contact"/, 'le pied de page mène au formulaire');
});

test('la page de contact est un vrai formulaire borné, avec un champ piège et un jeton daté', async () => {
  const body = await (await fetch(s.base + '/contact', { headers: { accept: 'text/html' } })).text();
  assert.match(body, /<form method="post" action="\/contact"/);
  assert.match(body, /name="name"[^>]*maxlength="100"/);
  assert.match(body, /name="email"[^>]*maxlength="254"/);
  assert.match(body, /<textarea name="message"[^>]*maxlength="3000"/);
  assert.match(body, /name="website"[^>]*tabindex="-1"/);
  assert.match(body, /name="ts" value="\d{10,14}\.[\w-]{24}"/);
  assert.match(await (await fetch(s.base + '/contact?plan=Croissance')).text(), /Prévenez-moi à l&#39;ouverture de l&#39;offre Croissance/);
});

test('un message valide part par e-mail : réponse à l\'adresse du visiteur, aucune donnée du visiteur dans l\'objet', async () => {
  mails.length = 0;
  const r = await send({ topic: 'rights', name: 'Camille\nBcc: pirate@x.test' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Message envoyé/);
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.replyTo, 'camille@exemple.fr');
  assert.equal(m.from, SMTP.fromEmail);
  assert.match(m.subject, /^\[IaBoss\] Formulaire de contact : Mes données personnelles/);
  assert.doesNotMatch(m.subject, /Camille|pirate/);
  assert.doesNotMatch(JSON.stringify(Object.keys(m)), /bcc/i);
  assert.match(m.text, /ceci est un message de test/);
  assert.doesNotMatch(m.text.split('\n').slice(0, 3).join('|'), /\nBcc/, 'un saut de ligne dans le nom ne crée pas d\'en-tête');
});

test('refus : origine étrangère, jeton absent, trop rapide, périmé, champs invalides ou trop longs', async () => {
  mails.length = 0;
  assert.equal((await send({}, { origin: 'https://autre.test' })).status, 403);
  assert.equal((await send({ ts: '' })).status, 400);
  assert.equal((await send({ ts: formToken(key()) })).status, 400, 'envoyé tout de suite : un robot');
  assert.equal((await send({ ts: formToken(key(), Date.now() - 3 * 3600_000) })).status, 400, 'formulaire périmé');
  assert.equal((await send({ ts: `${Date.now() - 9000}.${'a'.repeat(24)}` })).status, 400, 'signature fausse');
  assert.equal((await send({ email: 'pas une adresse' })).status, 400);
  assert.equal((await send({ name: '' })).status, 400);
  assert.equal((await send({ message: 'court' })).status, 400);
  assert.equal((await send({ message: 'x'.repeat(3001) })).status, 400, 'jamais de troncature silencieuse');
  assert.equal((await send({ name: 'n'.repeat(101) })).status, 400);
  assert.equal((await send({ email: `${'a'.repeat(250)}@exemple.fr` })).status, 400);
  assert.equal(mails.length, 0, 'rien n\'est parti');
});

test('le champ piège rempli : réponse de succès, mais aucun mail', async () => {
  mails.length = 0;
  const r = await send({ website: 'http://spam.test' });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Message envoyé/);
  assert.equal(mails.length, 0);
});

test('jeton : signé, daté, et la validation est stricte', () => {
  const k = Buffer.alloc(32, 9);
  const now = 1_800_000_000_000;
  assert.equal(checkToken(k, formToken(k, now - 5000), now), 'ok');
  assert.equal(checkToken(k, formToken(k, now - 500), now), 'trop-tot');
  assert.equal(checkToken(k, formToken(k, now - 3 * 3600_000), now), 'perime');
  assert.equal(checkToken(Buffer.alloc(32, 1), formToken(k, now - 5000), now), 'invalide');
  assert.equal(checkToken(k, undefined, now), 'invalide');
  assert.equal(readContact({ name: ' A  B ', email: 'a@b.fr', topic: 'nimportequoi', message: 'x'.repeat(12) }).values.topic, 'question');
});

test('au-delà de 5 messages par heure et par adresse : 429 ; sans SMTP : message d\'indisponibilité, sans détail', async () => {
  const lim = await startApp({ rateLimit: true, cfg: { systemSmtp: SMTP }, createTransport: () => ({ sendMail: async () => {}, close() {} }) });
  try {
    const post = () => lim.anon.post('/contact', { name: 'A', email: 'a@exemple.fr', topic: 'question', message: 'un message assez long', ts: formToken(lim.app.cfg.secretKey, Date.now() - 9000), website: '' }, { form: true });
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await post()).status);
    assert.equal(codes.filter((c) => c === 429).length >= 2, true, `429 attendus : ${codes}`);
  } finally { await lim.close(); }
  const nomail = await startApp({ cfg: { systemSmtp: null } });
  try {
    const r = await nomail.anon.post('/contact', { name: 'A', email: 'a@exemple.fr', topic: 'question', message: 'un message assez long', ts: formToken(nomail.app.cfg.secretKey, Date.now() - 9000), website: '' }, { form: true });
    assert.equal(r.status, 400);
    const t = await r.text();
    assert.match(t, /n&#39;a pas pu partir pour le moment/);
    assert.doesNotMatch(t, /smtp/i);
  } finally { await nomail.close(); }
});
