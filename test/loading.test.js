// Contenu qui se charge : toujours le même anneau devant « Chargement… » (voir docs/UX.md), jamais du texte seul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadingBlock } from '../src/loading.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';

test('loadingBlock : l\'anneau (grand ou petit) puis le texte, annoncé en « status », texte échappé', () => {
  assert.equal(loadingBlock(), '<span class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>Chargement…</span></span>');
  assert.match(loadingBlock('Chargement…', { small: true }), /^<span class="loading small" role="status"><span class="spin-inline" aria-hidden="true">/);
  assert.doesNotMatch(loadingBlock('<img src=x onerror=alert(1)>'), /<img/);
});

test('aucun « Chargement… » écrit sans son anneau dans le code', () => {
  const offenders = [];
  for (const [dir, ext] of [['../src/', '.js'], ['../public/', '.js']]) {
    for (const f of readdirSync(new URL(dir, import.meta.url)).filter((x) => x.endsWith(ext))) {
      readFileSync(new URL(f, new URL(dir, import.meta.url)), 'utf8').split('\n').forEach((line, i) => {
        if (/Chargement/.test(line) && !/loadingBlock|loadingHtml|spinner|spin-inline|^\s*(\/\/|\*|\/\*\*)/.test(line)) offenders.push(`${dir}${f}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'utilise loadingBlock() (serveur) ou loadingHtml() (navigateur)');
});

test('un contenu qui se charge après coup propose « Réessayer » quand il échoue (loadFailed), il n\'écrit plus l\'erreur à la main', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  for (const f of ['app.js', 'app-linkedin.js', 'app-promo.js', 'app-recap.js', 'clients.js', 'chat.js']) assert.match(read(f), /loadFailed\(/, `${f} : utilise loadFailed`);
  for (const f of ['app-linkedin.js', 'app-promo.js', 'app-recap.js']) assert.doesNotMatch(read(f), /box\.innerHTML = `<p class="error small">/, `${f} : plus d'erreur de chargement écrite à la main`);
  // l'assistant lui-même : bloc annoncé, bouton « Réessayer » de type button, message mis en texte (jamais en HTML)
  const app = read('app.js');
  const fn = app.slice(app.indexOf('function loadFailed'), app.indexOf('function toast'));
  assert.match(fn, /setAttribute\('role', 'alert'\)/);
  assert.match(fn, /textContent = 'Réessayer'/);
  assert.match(fn, /text\.textContent = message/);
  assert.doesNotMatch(fn, /innerHTML = .*message/);
  assert.match(app, /Object\.assign\(window\.AiTools, \{[^}]*loadFailed/);
});

test('les blocs du projet qui se chargent après coup affichent l\'anneau dès le rendu', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser();
    const id = Number(await addProject(s.db, u.id, { name: 'Atelier' }));
    await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'x', proposition_valeur: 'y', arguments: ['a'], stack: 'node' }), JSON.stringify({ description: 'TPE', secteurs: ['a'], zone: 'z', requetes: ['q'] }), id);
    const html = await (await u.get('/', { headers: { accept: 'text/html' } })).text();
    for (const k of ['linkedin', 'promo', 'recap']) assert.match(html, new RegExp(`data-${k}>\\s*<span class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>Chargement…</span></span>`), `data-${k} : anneau + texte`);
    const chat = await (await u.get('/chat', { headers: { accept: 'text/html' } })).text();
    assert.match(chat, /data-chat-projlist[^>]*>\s*<span class="loading small"/, 'liste des projets du chat');
  } finally { await s.close(); }
});
