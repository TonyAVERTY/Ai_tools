// Navigation sans rafraîchissement (public/ajax.js) : règles qui permettent de relancer app.js sans doublons, et pages concernées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const app = read('app.js');
const ajax = read('ajax.js');

test('app.js : tout ce qui est branché sur document, window ou un minuteur passe par le registre (listen / every / later), pour être retiré avant une nouvelle exécution', () => {
  const body = app.split('\n').filter((l) => !/^\s*\/\//.test(l));
  const raw = (re) => body.filter((l) => re.test(l) && !/const listen = |const every = /.test(l));
  assert.deepEqual(raw(/\bdocument\.addEventListener\(/), [], 'document.addEventListener → listen(document, …)');
  assert.deepEqual(raw(/\bwindow\.addEventListener\(/), [], 'window.addEventListener → listen(window, …)');
  assert.deepEqual(raw(/(^|[^\w.])setInterval\(/), [], 'setInterval → every(…)');
  assert.deepEqual(raw(/matchMedia\([^)]*\)\.addEventListener/), [], 'écouteur de matchMedia → listen(…)');
  assert.deepEqual(raw(/\blocation\.reload\(\)/).filter((l) => !/const reload = /.test(l)), [], 'location.reload() → reload()');
  assert.doesNotMatch(app, /\.form\.submit\(\)/, 'form.submit() ne déclenche pas l\'évènement submit : requestSubmit()');
  // les chaînes de rafraîchissement ne sont plus des setTimeout nus
  assert.match(app, /sysTimer = later\(refreshSys,/);
  assert.match(app, /st\.timer = el\.open \? later\(/);
});

test('app.js : la précédente exécution est arrêtée en premier, puis dispose() retire écouteurs, intervalles, minuteurs et animation de fond', () => {
  const start = app.indexOf('(() => {');
  assert.match(app.slice(start, start + 800), /window\.AiTools\?\.dispose\?\.\(\);/, 'premier geste de l\'exécution');
  assert.match(app, /dispose\(\) \{ disposed = true; for \(const f of cleanups\.splice\(0\)\) f\(\); for \(const t of timers\) clearTimeout\(t\);/);
  assert.match(app, /cleanups\.push\(\(\) => cancelAnimationFrame\(raf\)\)/);
  assert.match(app, /const later = \(fn, ms\) => \{\s*if \(disposed\) return 0;/, 'plus aucun minuteur ne part une fois arrêtée');
  assert.match(read('responsive.js'), /window\.AiRt\?\.disconnect\(\)/, 'responsive.js arrête aussi son observateur');
});

test('ajax.js : liens et formulaires du même site seulement, repli sur la navigation normale, aucun style en ligne', () => {
  assert.doesNotMatch(ajax, /style="/);
  assert.doesNotMatch(ajax, /\beval\(|new Function\(/);
  for (const must of [
    /u\.origin !== location\.origin/,            // autre site : navigation normale
    /form\.querySelector\('input\[type=file\]'\)/, // envoi de fichier : navigation normale
    /e\.defaultPrevented/,                        // un clic ou envoi déjà traité par l'application n'est pas repris
    /location\.assign\(res\.url\)/,               // autre « coque » (site public, connexion, nouvelle version)
    /popstate/,                                   // précédent / suivant
    /history\.scrollRestoration = 'manual'/,
    /attachment/,                                 // téléchargements
  ]) assert.match(ajax, must);
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

test('ajax.js est servi, chargé sur les pages de l\'application après app.js, et jamais sur le site public ni la connexion', async () => {
  const u = await s.newUser();
  const r = await s.anon.get('/static/ajax.js', { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  for (const path of ['/', '/settings', '/chat', '/mails', '/calendar']) {
    const page = await html(u, path);
    assert.match(page, /\/static\/ajax\.js\?v=\w+/, path);
    assert.ok(page.indexOf('/static/app.js') < page.indexOf('/static/ajax.js'), `${path} : app.js avant ajax.js`);
  }
  for (const path of ['/tarifs', '/docs', '/login', '/page-inconnue']) assert.doesNotMatch(await html(s.anon, path), /ajax\.js/, `${path} : pas de navigation douce`);
});

test('le serveur ne change pas : un formulaire envoyé en fetch reçoit la même redirection que le navigateur, l\'erreur est une page lisible', async () => {
  const u = await s.newUser();
  // POST + redirection suivie, comme le fait fetch : on arrive sur la page des Réglages avec ?ok
  const ok = await u.post('/settings', { notify_email: '', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' }, { form: true });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/settings?ok');
  // erreur : statut 400 et un <p> avec le message (c'est ce que ajax.js affiche en notification)
  const bad = await u.post('/settings', { notify_email: 'pas-un-mail' }, { form: true, headers: { accept: 'text/html,application/xhtml+xml' } }); // l'en-tête que ajax.js envoie
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /<section class="card"><h1>400<\/h1><p>Email de réception invalide<\/p>/);
});
