// Responsive : le contrat que l'audit navigateur (scripts/responsive-audit.mjs) vérifie en vrai, ici sans navigateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { now } from '../src/db.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('feuille et script responsive : servis, et chargés par le site public comme par l\'application', async () => {
  const u = await s.newUser();
  const get = (p, user) => (user || s.anon).get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());
  for (const [label, html] of [['accueil', await get('/')], ['tarifs', await get('/tarifs')], ['connexion', await get('/login')], ['application', await get('/', u)], ['calendrier', await get('/calendar', u)]]) {
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/, `${label} : viewport`);
    assert.match(html, /\/static\/responsive\.css\?v=/, `${label} : responsive.css`);
    assert.match(html, /\/static\/responsive\.js\?v=/, `${label} : responsive.js`);
  }
  for (const f of ['responsive.css', 'responsive.js']) {
    const r = await fetch(`${s.base}/static/${f}`);
    assert.equal(r.status, 200, f);
    assert.equal(await r.text(), readFileSync(`public/${f}`, 'utf8'));
  }
});

test('règles essentielles : menu sans défilement, champs à 16 px, tableaux en cartes, calendrier et Kanban empilés', () => {
  const css = readFileSync('public/responsive.css', 'utf8');
  assert.match(css, /\.pills \{ overflow: visible;/, 'menu du haut : plus de défilement latéral');
  assert.match(css, /font-size: 16px !important/, 'champs : pas de zoom iOS');
  assert.match(css, /@container rc \(max-width: 700px\)/, 'tableaux, calendrier, Kanban : selon la place réelle');
  assert.match(css, /table\.rt-stack td\[data-label\]::before \{ content: attr\(data-label\)/);
  assert.match(css, /\.cal-cell:not\(\.has\):not\(\.today\) \{ display: none; \}/);
  assert.match(css, /\.kanban \{ display: flex; flex-direction: column;/);
  assert.match(css, /\.reply-pops \{ right: 8px; left: 8px;/);
  const js = readFileSync('public/responsive.js', 'utf8');
  assert.match(js, /dataset\.label = heads\[i\]/);
  assert.match(js, /MutationObserver/, 'les tableaux fabriqués par app.js sont aussi adaptés');
});

test('calendrier : chaque jour porte son nom (affiché sur téléphone) et la classe « has » quand il a des rendez-vous', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { gitUrl: 'https://github.com/u/resp.git' });
  const { parisTime } = await import('../src/services/paris-time.js');
  // Dans deux ans : la cellule n'est jamais « aujourd'hui » ni « passée » (classes today / past), quelle que soit la date de lancement du test
  const year = new Date().getFullYear() + 2;
  const dayName = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'Europe/Paris' }).format(parisTime(year, 11, d, 12)).replace('.', '\\.');
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, next_action, next_action_at, created_at) VALUES(?, 'A', 'a@a.fr', 'sent', 'Rappeler', ?, ?)").run(pid, Math.floor(parisTime(year, 11, 3, 9).getTime() / 1000), now());
  const html = await (await u.get(`/calendar?m=${year}-11`, { headers: { accept: 'text/html' } })).text();
  assert.match(html, new RegExp(`<div class="cal-cell has">\\s*<span class="cal-d">3<span class="cal-wd"> ${dayName(3)} novembre</span>`));
  assert.match(html, new RegExp(`<div class="cal-cell">\\s*<span class="cal-d">4<span class="cal-wd"> ${dayName(4)} novembre`));
});

test('tableaux : aucun nowrap forcé sur les cellules (le texte long passe à la ligne), en-têtes seuls sur une ligne', () => {
  const css = readFileSync('public/responsive.css', 'utf8');
  assert.match(css, /td \{ white-space: normal; overflow-wrap: break-word; \}/);
});

test('classes ajoutées aux tableaux : préfixées rt-, jamais « stack » ni « flow » (.stack est un utilitaire flex de app.css : il casserait tous les tableaux)', () => {
  const js = readFileSync(new URL('../public/responsive.js', import.meta.url), 'utf8');
  const added = [...js.matchAll(/classList\.add\('([\w-]+)'\)/g)].map((m) => m[1]).filter((c) => /stack|flow/.test(c));
  assert.deepEqual(added.sort(), ['rt-flow', 'rt-stack']);
  const css = readFileSync(new URL('../public/responsive.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /table\.(stack|flow)\b/);
});
