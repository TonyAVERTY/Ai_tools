// Agenda : lien iCal secret (format, rotation, isolation), page Calendrier, Mon compte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { buildIcs, createFeed, feedToken } from '../src/services/ical.js';
import { parisTime, parisParts } from '../src/services/paris-time.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } });
const ics = (path) => fetch(`${s.base}${path}`);
const form = (u, p, body = {}) => u.post(p, body, { form: true });

test('fichier iCal : CRLF, lignes de 75 octets au plus, échappement, pas d\'injection de lignes', () => {
  const out = buildIcs([
    { uid: 'a@x', at: 1_800_000_000, title: 'Rappeler, urgent; ok\r\nATTENDEES:evil', description: 'é'.repeat(100) },
  ], { at: 1_790_000_000 });
  assert.ok(out.startsWith('BEGIN:VCALENDAR\r\n') && out.endsWith('END:VCALENDAR\r\n'));
  for (const line of out.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `ligne trop longue : ${line.length}`);
  assert.ok(!/^ATTENDEES:/m.test(out.replace(/\r\n /g, '')), 'un titre ne crée pas de ligne iCal');
  assert.match(out.replace(/\r\n /g, ''), /SUMMARY:Rappeler\\, urgent\; ok\\nATTENDEES:evil/);
  assert.match(out, /DTSTART:20270115T080000Z\r\n/);
  assert.equal(out.replace(/\r\n /g, '').includes('é'.repeat(100)), true, 'repliement sans couper un caractère');
});

test('lien d\'agenda : créé, chiffré en base, réaffichable, régénérable, supprimable ; 404 pour tout lien inconnu', async () => {
  const u = await s.newUser();
  assert.match(await (await html(u, '/account')).text(), /Créer mon lien d'agenda/);
  assert.equal((await form(u, '/calendar/feed', { back: '/account' })).headers.get('location'), '/account');
  const token = await feedToken(s.app, u.id);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = await s.db.prepare('SELECT token_hash, token_enc FROM ical_feeds WHERE user_id = ?').get(u.id);
  assert.ok(!JSON.stringify(row).includes(token), 'jamais en clair en base');
  const page = await (await html(u, '/account')).text();
  assert.ok(page.includes(`${s.app.cfg.appUrl}/cal/${token}.ics`), 'le lien est réaffiché dans Mon compte');
  assert.equal((await ics(`/cal/${token}.ics`)).status, 200);
  assert.equal((await form(u, '/calendar/feed', { back: 'https://evil.example' })).headers.get('location'), '/calendar', 'retour en liste blanche');
  const second = await feedToken(s.app, u.id);
  assert.notEqual(second, token);
  assert.equal((await ics(`/cal/${token}.ics`)).status, 404, 'l\'ancien lien ne marche plus');
  assert.equal((await ics(`/cal/${second}.ics`)).status, 200);
  for (const bad of ['/cal/nimportequoi.ics', `/cal/${'a'.repeat(43)}.ics`, '/cal/.ics']) assert.equal((await ics(bad)).status, 404, bad);
  await form(u, '/calendar/feed/delete');
  assert.equal((await ics(`/cal/${second}.ics`)).status, 404);
  // un compte suspendu n'expose plus son agenda
  const v = await s.newUser(); const t = await createFeed(s.app, v.id);
  await s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(v.id);
  assert.equal((await ics(`/cal/${t}.ics`)).status, 404);
});

test('contenu de l\'agenda : prochaines actions et posts programmés de CE compte seulement, en-têtes sûrs', async () => {
  const a = await s.newUser(), b = await s.newUser();
  const pa = await addProject(s.db, a.id, { name: 'Projet A', gitUrl: 'https://github.com/u/a.git' });
  const pb = await addProject(s.db, b.id, { name: 'Projet B', gitUrl: 'https://github.com/u/b.git' });
  const day = Math.floor(parisTime(2026, 11, 3, 9).getTime() / 1000);
  const mk = (pid, company, action) => s.db.prepare("INSERT INTO prospects(project_id, company, email, status, next_action, next_action_at, created_at) VALUES(?, ?, ?, 'sent', ?, ?, ?)")
    .run(pid, company, `${company}@x.fr`.toLowerCase(), action, now() + 86400, now());
  await mk(pa, 'Atelier', 'Rappeler'); await mk(pb, 'Secret SARL', 'Appel confidentiel');
  await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, scheduled_at, created_at) VALUES(?, 'Mon post à venir', 'scheduled', ?, ?)").run(pa, now() + 7200, now());
  await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, created_at) VALUES(?, 'Brouillon non programmé', 'draft', ?)").run(pa, now());
  assert.ok(day > 0);
  const token = await createFeed(s.app, a.id);
  const r = await ics(`/cal/${token}.ics`);
  assert.match(r.headers.get('content-type'), /^text\/calendar/);
  assert.match(r.headers.get('cache-control'), /private/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  const text = (await r.text()).replace(/\r\n /g, '');
  assert.match(text, /SUMMARY:Rappeler : Atelier/);
  assert.match(text, /SUMMARY:Post LinkedIn programmé : Projet A/);
  assert.doesNotMatch(text, /Secret SARL|confidentiel|Brouillon non programmé/);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('page Calendrier : mois, actions et posts, navigation, échappement, isolation', async () => {
  const a = await s.newUser(), b = await s.newUser();
  const pa = await addProject(s.db, a.id, { name: 'Projet A', gitUrl: 'https://github.com/u/ca.git' });
  const at = Math.floor(parisTime(2026, 11, 3, 9).getTime() / 1000);
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, next_action, next_action_at, created_at) VALUES(?, '<b>Atelier</b>', 'a@x.fr', 'sent', 'Rappeler', ?, ?)").run(pa, at, now());
  await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, scheduled_at, created_at) VALUES(?, 'Post du mercredi', 'scheduled', ?, ?)").run(pa, Math.floor(parisTime(2026, 11, 18, 14, 30).getTime() / 1000), now());
  const page = await (await html(a, '/calendar?m=2026-11')).text();
  assert.match(page, /novembre 2026/);
  assert.match(page, /09:00<\/span> Rappeler : &lt;b&gt;Atelier&lt;\/b&gt;/);
  assert.doesNotMatch(page, /<b>Atelier<\/b>/);
  assert.match(page, /14:30<\/span> Post du mercredi/);
  assert.match(page, /href="\/calendar\?m=2026-10"[^>]*>← octobre/);
  assert.match(page, /href="\/calendar\?m=2026-12"/);
  assert.doesNotMatch(await (await html(a, '/calendar?m=2026-12')).text(), /Atelier|Post du mercredi/);
  assert.doesNotMatch(await (await html(b, '/calendar?m=2026-11')).text(), /Atelier|Post du mercredi/, 'isolation');
  assert.equal((await html(a, '/calendar?m=pas-un-mois')).status, 200);
  const p = parisParts(new Date());
  assert.match(await (await html(a, '/calendar?m=2099-99')).text(), new RegExp(String(p.year)));
  assert.equal((await s.anon.get('/calendar', { headers: { accept: 'text/html' } })).status, 303);
});
