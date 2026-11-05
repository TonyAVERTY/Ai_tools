// Visite guidée : démarre toute seule une fois après les questions de bienvenue, se relance à la demande, mémorise sa fin par compte,
// et chaque étape vise un élément qui existe vraiment dans la page rendue. Le rendu dans un navigateur est vérifié par scripts/tour-check.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { TOUR_STEPS, needsTour, tourJson } from '../src/tour.js';
import { getSetting } from '../src/db.js';
import { getProfile } from '../src/userprofile.js';
import { generatedDocs } from '../src/services/supportdocs.js';
import { NAV } from '../src/views.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const page = (u, p) => u.get(p, { headers: { accept: 'text/html' } });
const text = async (u, p) => (await page(u, p)).text();

test('les étapes : un titre et un texte chacune, des identifiants uniques, la première et la dernière centrées', () => {
  assert.ok(TOUR_STEPS.length >= 8);
  assert.equal(new Set(TOUR_STEPS.map((x) => x.id)).size, TOUR_STEPS.length);
  for (const x of TOUR_STEPS) assert.ok(x.title && x.text.length > 40, x.id);
  assert.ok(!TOUR_STEPS[0].target && !TOUR_STEPS.at(-1).target);
  assert.doesNotMatch(tourJson(), /</, 'aucun « < » brut dans le JSON placé dans la page');
});

test('chaque onglet de la barre du haut a son étape dans la visite, dans l\'ordre du menu (une nouvelle page sans étape fait échouer ce test)', () => {
  const stepFor = (href) => TOUR_STEPS.findIndex((t) => t.target === `.pills a[href="${href}"]`);
  const missing = NAV.filter(([href]) => stepFor(href) < 0).map(([href, , label]) => `${label} (${href})`);
  assert.deepEqual(missing, [], `ajoute une étape à la visite guidée (src/tour.js) pour : ${missing.join(', ')}`);
  const order = NAV.map(([href]) => stepFor(href));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'les étapes suivent l\'ordre des onglets');
  for (const [href] of NAV) assert.ok(TOUR_STEPS[stepFor(href)].text.length > 80, `${href} : un texte qui explique vraiment la page`);
});

test('chaque cible de la visite existe dans le tableau de bord rendu', async () => {
  const u = await s.newUser();
  const html = await text(u, '/');
  const has = {
    '.pills a[href="/"]': /<nav class="pills"[^]*?href="\/"/, '.pills a[href="/mails"]': /class="pill" href="\/mails"/, '.pills a[href="/calendar"]': /class="pill" href="\/calendar"/, '.pills a[href="/compta"]': /class="pill" href="\/compta"/,
    '.pills a[href="/facturation"]': /class="pill" href="\/facturation"/, '.pills a[href="/clients"]': /class="pill" href="\/clients"/, '.pills a[href="/team"]': /class="pill" href="\/team"/, '.ukpis': /class="ukpis"/, '[data-new-toggle]': /data-new-toggle/, '.ia-menu > summary': /<details class="ia-menu">\s*<summary/,
    '.ia-menu .ia-pop': /class="user-pop ia-pop"/, '[data-claude-card]': /data-claude-card/, 'details.user > summary': /<details class="user">\s*<summary/, 'details.user .user-pop': /<details class="user">[^]*?class="user-pop"/,
  };
  for (const x of TOUR_STEPS.filter((t) => t.target)) {
    assert.ok(has[x.target], `sélecteur non couvert par le test : ${x.target}`);
    assert.match(html, has[x.target], `${x.id} : ${x.target}`);
    if (x.also) assert.match(html, has[x.also], `${x.id} : ${x.also}`);
    if (x.open) assert.ok(TOUR_STEPS.length && x.open.startsWith('details') || x.open.startsWith('.'));
  }
  assert.match(html, /<a href="\/\?tour=1">[^]*?Visite guidée<\/a>/, 'le menu du compte propose de la relancer');
});

test('démarrage automatique : une seule fois, après les questions de bienvenue, par compte', async () => {
  const u = await s.newUser({ firstLogin: true });
  assert.equal(await needsTour(s.db, u.id), false, 'tant que les questions de bienvenue ne sont pas passées, pas de visite');
  assert.equal((await page(u, '/')).status, 303, 'la première arrivée mène aux questions');
  await u.post('/welcome/skip', {});
  assert.equal(await needsTour(s.db, u.id), true);
  const first = await text(u, '/');
  assert.match(first, /<script type="application\/json" id="tour-data" data-mode="auto">/);
  assert.match(first, /Bienvenue dans iaboss/);
  assert.equal((await u.post('/tour/complete', { state: 'skipped' })).status, 200);
  assert.equal(await getSetting(s.db, u.id, 'tour_state'), 'skipped');
  assert.doesNotMatch(await text(u, '/'), /id="tour-data"/, 'elle ne revient plus toute seule');
  // relance à la demande : ne change pas l'état mémorisé
  assert.match(await text(u, '/?tour=1'), /id="tour-data" data-mode="replay"/);
  assert.equal(await getSetting(s.db, u.id, 'tour_state'), 'skipped');
  // isolation : la visite d'un compte ne se termine pas pour un autre
  const other = await s.newUser({ firstLogin: true });
  await other.post('/welcome/skip', {});
  assert.match(await text(other, '/'), /data-mode="auto"/);
  assert.equal((await u.post('/tour/complete', { state: 'nimporte' })).status, 200);
  assert.equal(await getSetting(s.db, u.id, 'tour_state'), 'done', 'un état inconnu est enregistré comme « terminée »');
});

test('fin du questionnaire : l\'enregistrement en arrière-plan (?json=1) répond sans redirection, le formulaire classique redirige', async () => {
  const u = await s.newUser({ firstLogin: true });
  const r = await u.post('/welcome?json=1', { job: 'fondateur', goal_clients: '1' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await getProfile(s.db, u.id)).job, 'fondateur');
  const v = await s.newUser({ firstLogin: true });
  const f = await v.post('/welcome', { job: 'autre' }, { form: true });
  assert.equal(f.status, 303);
  assert.equal(f.headers.get('location'), '/');
});

test('la documentation du Support décrit la visite, ses étapes et la façon de la relancer', () => {
  const doc = generatedDocs().find((d) => d.name === 'visite-guidee.md');
  assert.ok(doc);
  for (const x of TOUR_STEPS) assert.ok(doc.content.includes(x.title), x.title);
  assert.match(doc.content, /Passer la visite[^]*Visite guidée/);
});
