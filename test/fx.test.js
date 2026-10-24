// Animation de lancement d'une tâche (public/fx.js) : toute route qui met un job en file doit la déclencher, et le script est servi sur les pages de l'application.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
const linkedin = readFileSync(new URL('../src/linkedinroutes.js', import.meta.url), 'utf8');
const fx = readFileSync(new URL('../public/fx.js', import.meta.url), 'utf8');
const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('chaque route qui met un job en file déclenche l\'animation (et celles qui n\'en lancent pas, non)', () => {
  const src = /const LAUNCH = \/(.+)\/;/.exec(app)[1];
  const LAUNCH = new RegExp(src);
  const jobRoutes = [...routes.matchAll(/router\.post\('(\/api\/projects\/:id\/[\w-]+)', jobRoute\(/g)].map((m) => m[1]);
  assert.ok(jobRoutes.length >= 6, 'les routes de jobs sont bien repérées');
  for (const r of [...jobRoutes, '/api/projects/:id/linkedin/generate', '/api/prospects/:id/hook']) {
    assert.match(r.replace(':id', '12'), LAUNCH, `${r} doit lancer l'animation`);
  }
  for (const r of ['/api/projects/12/template/save', '/api/projects/12/followup', '/api/projects/12/smtp', '/api/projects/12/linkedin/post', '/api/projects/12/linkedin/publish', '/api/system', '/api/jobs/3/cancel']) {
    assert.doesNotMatch(r, LAUNCH, `${r} ne lance pas de tâche`);
  }
  assert.match(linkedin, /router\.post\('\/api\/projects\/:id\/linkedin\/generate'/);
});

test('fx.js : aucun style en ligne dans le balisage, aucun écouteur global, mouvement coupé si l\'utilisateur le demande', () => {
  assert.doesNotMatch(fx, /style="/);
  assert.doesNotMatch(fx, /\b(document|window)\.addEventListener/, 'le module ne fait rien tant qu\'on ne l\'appelle pas');
  assert.match(fx, /prefers-reduced-motion/);
  assert.match(fx, /window\.AiFx = \{ press, launch, bump \}/);
  // deux traits pointillés bleus tracés au rythme de l'agent : d'abord l'horizontal (H, dans la marge), puis le vertical (V) jusqu'à la cible
  assert.match(fx, /H\$\{end\.x\} V\$\{y\}/);
  assert.doesNotMatch(fx, /V\$\{[^}]+\} H\$\{[^}]+\}/, 'plus de vertical d\'abord : il traversait le contenu de la page');
  assert.match(read('app.css'), /\.fx-trail \.fx-dash \{[^}]*stroke: var\(--accent\)[^}]*stroke-dasharray/);
  assert.match(read('app.js'), /AiFx\?\.launch\(trigger, \$\('\.jitem\.new', jobsPop\)/, 'le trait va jusqu\'à la ligne de la nouvelle tâche, menu ouvert');
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('fx.js est servi et chargé sur les pages de l\'application ; l\'animation n\'existe pas sur le site public', async () => {
  const u = await s.newUser();
  const r = await s.anon.get('/static/fx.js', { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  const page = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(page, /<script src="\/static\/fx\.js\?v=\w+" defer>/);
  assert.doesNotMatch(await (await s.anon.get('/tarifs', { headers: { accept: 'text/html' } })).text(), /fx\.js/);
});
