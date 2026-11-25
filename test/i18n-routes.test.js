import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting } from '../src/db.js';
import { startApp, APP_URL } from './helpers/server.js';

let s, A, B;
before(async () => { s = await startApp(); A = await s.newUser({ email: 'lang-a@x.fr' }); B = await s.newUser({ email: 'lang-b@x.fr' }); });
after(() => s.close());

const cookiesOf = (r) => (r.headers.getSetCookie?.() ?? []).filter((c) => c.startsWith('lang='));
const page = async (user, path, cookie = '') => (await fetch(s.base + path, { headers: { cookie: [user?.cookie, cookie].filter(Boolean).join('; '), accept: 'text/html' } })).text();

test('par défaut le site reste en français : aucune langue devinée, aucun script de traduction', async () => {
  const home = await page(null, '/accueil');
  assert.match(home, /<html lang="fr"/);
  assert.doesNotMatch(home, /static\/i18n\.js/);
  const r = await fetch(s.base + '/accueil', { headers: { 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' } });
  assert.match(await r.text(), /<html lang="fr"/, 'la langue du navigateur ne change rien');
});

test('Réglages → Langue : le choix pose le cookie, s\'enregistre sur le compte et traduit la page', async () => {
  const r = await A.post('/settings/lang', { lang: 'en' }, { form: true });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /\/settings\?ok=1#langue/);
  const c = cookiesOf(r)[0];
  assert.match(c, /^lang=en;/);
  assert.match(c, /Max-Age=31536000/);
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/);
  assert.equal(await getSetting(s.db, A.id, 'lang'), 'en');
  const settings = await page(A, '/settings', 'lang=en');
  assert.match(settings, /<html lang="en"/);
  assert.match(settings, /static\/i18n\.js/);
  assert.match(settings, /<h2 id="t-langue">Language<\/h2>/, 'les textes connus sont traduits');
  assert.match(settings, /<button class="btn primary" name="lang" value="en" aria-pressed="true">/, 'la langue courante est marquée');
  assert.match(settings, />Français<\/button>/, 'le nom des langues reste dans leur propre langue');
});

test('le choix suit le compte sur un autre appareil (sans cookie), mais pas un autre compte', async () => {
  const mine = await page(A, '/settings');
  assert.match(mine, /<html lang="en"/, 'réglage du compte appliqué sans cookie');
  const other = await page(B, '/settings');
  assert.match(other, /<html lang="fr"/);
  // Le cookie l'emporte sur le réglage du compte
  assert.match(await page(A, '/settings', 'lang=es'), /<html lang="es"/);
  assert.match(await page(A, '/settings', 'lang=fr'), /<html lang="fr"/);
  // Un cookie invalide est ignoré
  assert.match(await page(B, '/settings', 'lang=de'), /<html lang="fr"/);
});

test('langue inconnue, sans compte ou sans origine : refus', async () => {
  assert.equal((await A.post('/settings/lang', { lang: 'de' }, { form: true })).status, 400);
  assert.equal((await A.post('/settings/lang', { lang: 'es' }, { form: true, origin: null })).status, 403);
  const visitor = await s.anon.post('/settings/lang', { lang: 'es' }, { form: true });
  assert.ok([303, 401].includes(visitor.status) && !cookiesOf(visitor).length, 'un visiteur est renvoyé à la connexion, sans cookie posé');
  assert.equal(await getSetting(s.db, A.id, 'lang'), 'en', 'rien n\'a changé');
});

test('site public : choix de la langue par un visiteur (cookie seulement), retour sur la même page, adresse de retour sûre', async () => {
  const r = await s.anon.post('/lang', { lang: 'es', back: '/tarifs' }, { form: true });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/tarifs');
  assert.match(cookiesOf(r)[0], /^lang=es;/);
  for (const evil of ['//evil.example/x', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '/a b']) {
    const e = await s.anon.post('/lang', { lang: 'en', back: evil }, { form: true });
    assert.equal(e.headers.get('location'), '/', `adresse de retour refusée : ${evil}`);
  }
  assert.equal((await s.anon.post('/lang', { lang: 'xx' }, { form: true })).status, 400);
  assert.equal((await s.anon.post('/lang', { lang: 'en' }, { form: true, origin: null })).status, 403, 'l\'origine est vérifiée');
  const es = await page(null, '/tarifs', 'lang=es');
  assert.match(es, /<html lang="es"/);
  assert.match(es, /<form method="post" action="\/lang" class="lang-pick" aria-label="Idioma">/, 'le sélecteur du pied de page est traduit');
  assert.match(es, /<input type="hidden" name="back" value="\/tarifs">/);
});

test('les fichiers de traduction sont servis (noyau, script, dictionnaires)', async () => {
  for (const [path, type] of [['/static/i18n-core.js', 'javascript'], ['/static/i18n.js', 'javascript'], ['/static/i18n/en.json', 'json'], ['/static/i18n/es.json', 'json']]) {
    const r = await fetch(s.base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), new RegExp(type));
  }
  const en = await (await fetch(s.base + '/static/i18n/en.json')).json();
  assert.equal(en['Annuler'], 'Cancel');
});
