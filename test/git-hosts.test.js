// Hôtes Git : GitHub accepté d'office, serveur Git personnel facultatif dans les Réglages, et le token de ce serveur ne part jamais ailleurs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { testTokenLink, addProject } from './helpers/users.js';
import { validateGitUrl, DEFAULT_GIT_HOSTS } from '../src/services/git.js';
import { gitTokenFor } from '../src/projects.js';
import { makeHandlers } from '../src/handlers.js';
import { encrypt } from '../src/crypto.js';
import { setSetting } from '../src/db.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const user = () => s.newUser({ admin: false, link: testTokenLink() });
const create = (u, gitUrl, name = 'Projet') => u.post('/api/projects', { name, gitUrl });

test('validation : GitHub accepté d\'office, un hôte perso s\'y ajoute, le reste est refusé', () => {
  assert.deepEqual(DEFAULT_GIT_HOSTS, ['github.com']);
  assert.equal(validateGitUrl('https://github.com/TonyAVERTY/Ai_tools.git', DEFAULT_GIT_HOSTS), 'https://github.com/TonyAVERTY/Ai_tools.git');
  assert.equal(validateGitUrl('https://github.com/TonyAVERTY/Ai_tools', DEFAULT_GIT_HOSTS), 'https://github.com/TonyAVERTY/Ai_tools');
  assert.equal(validateGitUrl('https://git.mon-serveur.fr/Tony/App.git', [...DEFAULT_GIT_HOSTS, 'git.mon-serveur.fr']), 'https://git.mon-serveur.fr/Tony/App.git');
  // pas d'hôte perso renseigné (undefined, null ou vide) : seul GitHub
  for (const none of [undefined, null, '']) assert.throws(() => validateGitUrl('https://git.mon-serveur.fr/Tony/App.git', [...DEFAULT_GIT_HOSTS, none]), /doit être sur github\.com$/);
  assert.throws(() => validateGitUrl('https://gitlab.com/a/b.git', [...DEFAULT_GIT_HOSTS, 'git.mon-serveur.fr']), /doit être sur github\.com ou git\.mon-serveur\.fr/);
  // les autres garde-fous restent
  assert.throws(() => validateGitUrl('http://github.com/a/b.git', DEFAULT_GIT_HOSTS), /https/);
  assert.throws(() => validateGitUrl('https://tok@github.com/a/b.git', DEFAULT_GIT_HOSTS), /identifiants/);
  assert.throws(() => validateGitUrl('https://github.com/a/b/tree/main', DEFAULT_GIT_HOSTS), /Format/);
  // un hôte ressemblant n'est pas GitHub
  assert.throws(() => validateGitUrl('https://github.com.evil.fr/a/b.git', DEFAULT_GIT_HOSTS), /doit être/);
  assert.throws(() => validateGitUrl('https://github.com:8443/a/b.git', DEFAULT_GIT_HOSTS), /doit être/);
});

test('création : un lien GitHub passe sans aucun réglage', async () => {
  const u = await user();
  const r = await create(u, 'https://github.com/TonyAVERTY/Ai_tools.git', 'Ai_tools');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).id);
  assert.equal((await create(u, 'https://github.com/TonyAVERTY/Ai_tools.git', 'Encore')).status, 409, 'même dépôt : déjà un projet');
});

test('création : sans serveur perso, un autre hôte est refusé et le message dit où aller', async () => {
  const u = await user();
  const r = await create(u, 'https://git.mon-serveur.fr/Tony/App.git');
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /doit être sur github\.com$/);
});

test('réglages : le serveur Git perso s\'ajoute à GitHub, il ne le remplace pas', async () => {
  const u = await user();
  assert.equal((await u.post('/settings', { forgejo_host: 'https://git.mon-serveur.fr/', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' }, { form: true })).status, 303);
  const row = await s.db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'forgejo_host'").get(u.id);
  assert.equal(row.value, 'git.mon-serveur.fr');
  const r = await create(u, 'https://git.mon-serveur.fr/Tony/App.git', 'App');
  assert.equal(r.status, 200, 'le serveur perso passe');
  // GitHub passe toujours, et un troisième hôte reste refusé
  const bad = await create(u, 'https://gitlab.com/a/b.git');
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /github\.com ou git\.mon-serveur\.fr/);
  // la page d'accueil le dit
  const html = await (await u.get('/', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /GitHub \(dépôts publics\) et git\.mon-serveur\.fr sont acceptés/);
  // les réglages décrivent les deux
  const set = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(set, /Dépôts Git/);
  assert.match(set, /Mon serveur Git \(facultatif\)/);
});

test('la page d\'accueil annonce GitHub par défaut et renvoie vers les Réglages', async () => {
  const u = await user();
  const html = await (await u.get('/', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /placeholder="https:\/\/github\.com\/utilisateur\/projet\.git"/);
  assert.match(html, /GitHub est accepté \(dépôts publics\)/);
  assert.match(html, /<a href="\/settings">Réglages<\/a>/);
});

test('token : réservé au serveur Git perso, jamais présenté à GitHub ni à un autre hôte', async () => {
  const u = await user();
  const key = s.app.cfg.secretKey;
  // jeton enregistré mais aucun serveur perso : il ne part nulle part
  await setSetting(s.db, u.id, 'forgejo_token_enc', encrypt(key, 'tok-secret'));
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), null);
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), null);
  await setSetting(s.db, u.id, 'forgejo_host', 'git.mon-serveur.fr');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), 'tok-secret');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), null, 'GitHub ne reçoit jamais le token');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr.evil.fr/a/b.git'), null);
  assert.equal(await gitTokenFor(s.app, u.id, 'pas une url'), null);
});

test('analyse : le token n\'accompagne pas un clone GitHub, il accompagne un clone du serveur perso', async () => {
  const u = await user();
  await setSetting(s.db, u.id, 'forgejo_host', 'git.mon-serveur.fr');
  await setSetting(s.db, u.id, 'forgejo_token_enc', encrypt(s.app.cfg.secretKey, 'tok-secret'));
  const seen = [];
  s.app.syncRepo = async (url, dir, token) => { seen.push({ url, token }); throw new Error('stop'); };
  try {
    // insérés directement : le plan gratuit n'autorise qu'un projet par la route de création
    const gh = await addProject(s.db, u.id, { name: 'gh', gitUrl: 'https://github.com/TonyAVERTY/Ai_tools.git' });
    const own = await addProject(s.db, u.id, { name: 'own', gitUrl: 'https://git.mon-serveur.fr/Tony/App.git' });
    const handlers = makeHandlers(s.app);
    for (const id of [gh, own]) {
      await assert.rejects(handlers.analyze({ job: { user_id: u.id, project_id: id }, progress: async () => {}, signal: new AbortController().signal }), /stop/);
    }
    assert.deepEqual(seen.map((x) => [new URL(x.url).host, x.token]), [['github.com', null], ['git.mon-serveur.fr', 'tok-secret']]);
  } finally { delete s.app.syncRepo; }
});
