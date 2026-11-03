// Retours d'action (docs/UX.md, « Animations ») : la ligne qu'on vient d'ajouter est surlignée un instant (classe row-new), côté serveur pour l'agenda et les notes ;
// et les animations ponctuelles ne s'appliquent que si l'utilisateur n'a pas demandé moins de mouvement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text()).then((t) => t.replaceAll('&#39;', "'"));
const post = (u, p, body = {}) => u.post(p, body, { form: true });
const loc = (r) => r.headers.get('location');

test('agenda : l\'événement qu\'on vient d\'ajouter est surligné, lui seul, et seulement juste après l\'ajout', async () => {
  const u = await s.newUser();
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const add = (title) => post(u, '/calendar/events', { title, date: day, time: '10:00', minutes: '30', notes: '' });
  await add('Premier appel');
  const to = loc(await add('Appel avec Boulangerie Dupont'));
  assert.match(to, /^\/calendar\?m=\d{4}-\d{2}&nouveau=\d+$/, 'la redirection porte le numéro du nouvel événement');
  const h = await html(u, to);
  const marked = [...h.matchAll(/<li class="ag-i row-new">.*?<\/li>/gs)].map((m) => m[0]);
  assert.equal(marked.length, 1, 'un seul événement surligné');
  assert.match(marked[0], /Appel avec Boulangerie Dupont/);
  assert.match(h, /<li class="ag-i"><time[^]*Premier appel/, 'l\'autre reste sans surlignage');
  assert.doesNotMatch(await html(u, '/calendar'), /row-new/, 'sans « nouveau » dans l\'adresse, rien n\'est surligné');
  assert.doesNotMatch(await html(u, '/calendar?nouveau=abc'), /row-new/, 'un numéro invalide ne surligne rien');
});

test('agenda : le numéro d\'un événement d\'un autre compte ne surligne rien et ne montre rien', async () => {
  const a = await s.newUser();
  const b = await s.newUser();
  const day = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  const id = /nouveau=(\d+)/.exec(loc(await post(a, '/calendar/events', { title: 'Rendez-vous secret de A', date: day, time: '09:00', minutes: '30', notes: '' })))[1];
  const h = await html(b, `/calendar?nouveau=${id}`);
  assert.doesNotMatch(h, /row-new/);
  assert.doesNotMatch(h, /Rendez-vous secret de A/);
});

test('note : la plus récente est surlignée juste après l\'ajout (« ?ok=note »), pas les autres, et pas sans « ok »', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const x = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'Cabinet Dupont', 'dupont@cabinet.fr', 'sent', ?)").run(pid, now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, ?, ?)').run(x, 'Appel prévu mardi', now() - 5000);
  const to = loc(await post(u, `/clients/p/${x}/note`, { body: 'Devis envoyé' }));
  assert.match(to, /ok=note/);
  const h = await html(u, `/clients/p/${x}?ok=note`);
  const marked = [...h.matchAll(/<li class="cl-tl-i note row-new">.*?<\/li>/gs)].map((m) => m[0]);
  assert.equal(marked.length, 1, 'une seule note surlignée');
  assert.match(marked[0], /Devis envoyé/, 'c\'est la plus récente');
  assert.match(h, /<li class="cl-tl-i note"><span[^]*Appel prévu mardi/, 'la plus ancienne reste sans surlignage');
  assert.doesNotMatch(await html(u, `/clients/p/${x}`), /row-new/, 'sans « ok=note », rien n\'est surligné');
  assert.doesNotMatch(await html(u, `/clients/p/${x}?ok=maj`), /row-new/, 'un autre message de succès non plus');
});

test('les retours d\'action ne s\'appliquent qu\'avec le mouvement normal, et leurs images clés existent', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const at = css.indexOf('@media (prefers-reduced-motion: no-preference) {\n  .user-pop');
  assert.ok(at > 0, 'le bloc « sans mouvement réduit » est là');
  const block = css.slice(at, css.indexOf('\n}\n', at));
  for (const rule of ['.btn:active:not(:disabled) { transform: scale(.97); }', '.reveal { animation: reveal 150ms', '.setup li.just-done svg { animation: wiz-pop', '.pcfg.pop { animation: wiz-pop', '.row-new { animation: fx-flash']) {
    assert.ok(block.includes(rule), `dans le bloc sans mouvement réduit : ${rule}`);
  }
  for (const name of ['reveal', 'wiz-pop', 'fx-flash']) assert.match(css, new RegExp(`@keyframes ${name}\\b`), `@keyframes ${name}`);
  assert.match(css, /\.btn \{[^}]*transform 80ms var\(--ease\)/s, 'le bouton glisse en 80 ms vers l\'état enfoncé et en revient');
});
