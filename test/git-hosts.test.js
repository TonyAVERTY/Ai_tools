// Hôtes Git : GitHub accepté d'office, serveur Git personnel facultatif dans les Réglages, et le token de ce serveur ne part jamais ailleurs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { testTokenLink, addProject } from './helpers/users.js';
import { validateGitUrl, DEFAULT_GIT_HOSTS, gitEnv, syncRepo } from '../src/services/git.js';
import { gitTokenFor } from '../src/projects.js';
import { makeHandlers } from '../src/handlers.js';
import { encrypt } from '../src/crypto.js';
import { setSetting, getSetting } from '../src/db.js';
import { decrypt } from '../src/crypto.js';

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
  assert.match(html, /GitHub et git\.mon-serveur\.fr sont acceptés/);
  // les réglages décrivent les deux
  const set = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(set, /Dépôts Git/);
  assert.match(set, /Mon serveur Git \(facultatif\)/);
});

test('la page d\'accueil annonce GitHub par défaut et renvoie vers les Réglages', async () => {
  const u = await user();
  const html = await (await u.get('/', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /placeholder="https:\/\/github\.com\/utilisateur\/projet\.git"/);
  assert.match(html, /GitHub est accepté\. Dépôt privé ou autre serveur Git : ajoute un token dans <a href="\/settings">Réglages<\/a>/);
});

test('token : chacun ne va qu\'à son hôte, jamais à un autre', async () => {
  const u = await user();
  const key = s.app.cfg.secretKey;
  await setSetting(s.db, u.id, 'forgejo_token_enc', encrypt(key, 'tok-perso'));
  await setSetting(s.db, u.id, 'github_token_enc', encrypt(key, 'tok-github'));
  // aucun serveur perso renseigné : le token perso ne part nulle part, celui de GitHub va à GitHub
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), 'tok-github');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), null);
  await setSetting(s.db, u.id, 'forgejo_host', 'git.mon-serveur.fr');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), 'tok-perso', 'le serveur perso reçoit le sien, pas celui de GitHub');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), 'tok-github', 'GitHub ne reçoit jamais celui du serveur perso');
  for (const evil of ['https://git.mon-serveur.fr.evil.fr/a/b.git', 'https://github.com.evil.fr/a/b.git', 'https://github.com:8443/a/b.git', 'https://gitlab.com/a/b.git', 'pas une url']) {
    assert.equal(await gitTokenFor(s.app, u.id, evil), null, evil);
  }
  // sans token GitHub, GitHub ne reçoit rien (dépôt public)
  const v = await user();
  await setSetting(s.db, v.id, 'forgejo_token_enc', encrypt(key, 'tok-de-v'));
  assert.equal(await gitTokenFor(s.app, v.id, 'https://github.com/a/b.git'), null);
  // cloisonnement : le token d'un compte ne sert jamais à un autre
  assert.equal(await gitTokenFor(s.app, v.id, 'https://git.mon-serveur.fr/a/b.git'), null);
});

test('git : GitHub s\'authentifie en Basic, un autre serveur avec « token », et les erreurs ne montrent ni l\'un ni l\'autre', async () => {
  const basic = gitEnv('tok-github', { scheme: 'basic' });
  assert.equal(basic.GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from('x-access-token:tok-github').toString('base64')}`);
  assert.equal(gitEnv('tok-perso').GIT_CONFIG_VALUE_0, 'Authorization: token tok-perso', 'serveur perso : comportement inchangé');
  assert.equal(gitEnv(null, { scheme: 'basic' }).GIT_CONFIG_COUNT, undefined, 'pas de token : pas d\'en-tête');
  // le jeton passe par l'environnement : jamais dans argv, ni dans les erreurs remontées
  const fakeGit = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'gh-'));
  const { writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const bin = `${fakeGit}/git`;
  writeFileSync(bin, '#!/bin/sh\necho "fatal: sent $GIT_CONFIG_VALUE_0 rejected" >&2\nexit 128\n');
  chmodSync(bin, 0o755);
  try {
    for (const url of ['https://github.com/a/b.git', 'https://git.mon-serveur.fr/a/b.git']) {
      await assert.rejects(syncRepo(url, `${fakeGit}/clone`, 'tok-secret', { gitBin: bin }), (e) => {
        assert.ok(!e.message.includes('tok-secret') && !e.message.includes(Buffer.from('x-access-token:tok-secret').toString('base64')), `fuite dans : ${e.message}`);
        assert.match(e.message, /Authorization: \*\*\*/);
        return true;
      }, url);
    }
  } finally { rmSync(fakeGit, { recursive: true, force: true }); }
});

test('réglages : token GitHub enregistré chiffré, jamais réaffiché, remplaçable et supprimable', async () => {
  const u = await user();
  const save = (extra) => u.post('/settings', { global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60', ...extra }, { form: true });
  const stored = async () => getSetting(s.db, u.id, 'github_token_enc');
  const page = async () => (await u.get('/settings', { headers: { accept: 'text/html' } })).text();

  assert.equal((await save({ github_token: 'github_pat_SECRET123' })).status, 303);
  assert.ok(!(await stored()).includes('SECRET123'), 'chiffré en base');
  assert.equal(decrypt(s.app.cfg.secretKey, await stored()), 'github_pat_SECRET123');
  let html = await page();
  assert.ok(!html.includes('SECRET123'), 'jamais réaffiché');
  assert.match(html, /placeholder="•••••• \(inchangé\)"/);
  assert.match(html, /name="github_token_clear"/);

  // enregistrer sans toucher au champ garde le token
  await save({});
  assert.equal(decrypt(s.app.cfg.secretKey, await stored()), 'github_pat_SECRET123');
  // un nouveau token remplace l'ancien
  await save({ github_token: 'github_pat_AUTRE456' });
  assert.equal(decrypt(s.app.cfg.secretKey, await stored()), 'github_pat_AUTRE456');
  // la case « supprimer » l'efface
  await save({ github_token_clear: '1' });
  assert.equal(await stored(), null);
  html = await page();
  assert.doesNotMatch(html, /name="github_token_clear"/);
  // un autre compte ne voit rien de tout ça
  const other = await user();
  assert.equal(await getSetting(s.db, other.id, 'github_token_enc'), null);
});

test('analyse : GitHub reçoit le token GitHub, le serveur perso le sien, et jamais le contraire', async () => {
  const u = await user();
  const key = s.app.cfg.secretKey;
  await setSetting(s.db, u.id, 'forgejo_host', 'git.mon-serveur.fr');
  await setSetting(s.db, u.id, 'forgejo_token_enc', encrypt(key, 'tok-perso'));
  await setSetting(s.db, u.id, 'github_token_enc', encrypt(key, 'tok-github'));
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
    assert.deepEqual(seen.map((x) => [new URL(x.url).host, x.token]), [['github.com', 'tok-github'], ['git.mon-serveur.fr', 'tok-perso']]);
  } finally { delete s.app.syncRepo; }
});
