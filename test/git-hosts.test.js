// Hôtes Git : GitHub accepté d'office, serveur Git personnel facultatif dans les Réglages, et le token de ce serveur ne part jamais ailleurs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { testTokenLink, addProject } from './helpers/users.js';
import { validateGitUrl, DEFAULT_GIT_HOSTS, gitEnv, syncRepo } from '../src/services/git.js';
import { gitTokenFor, gitCredentialFor, listGitServers, publicGitServers, MAX_GIT_SERVERS } from '../src/gitservers.js';
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

test('réglages : un serveur ajouté s\'ajoute à GitHub, il ne le remplace pas', async () => {
  const u = await user();
  assert.equal((await u.post('/settings', { git_type_0: 'forgejo', git_host_0: 'https://git.mon-serveur.fr/', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' }, { form: true })).status, 303);
  assert.deepEqual((await listGitServers(s.db, u.id)).map((x) => [x.type, x.host]), [['forgejo', 'git.mon-serveur.fr']]);
  const r = await create(u, 'https://git.mon-serveur.fr/Tony/App.git', 'App');
  assert.equal(r.status, 200, 'le serveur ajouté passe');
  const bad = await create(u, 'https://gitlab.com/a/b.git');
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /github\.com ou git\.mon-serveur\.fr/);
  const html = await (await u.get('/', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /GitHub et git\.mon-serveur\.fr sont acceptés/);
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
  await setSetting(s.db, u.id, 'github_token_enc', encrypt(key, 'tok-github'));
  // aucun serveur ajouté : seul GitHub a un token
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), 'tok-github');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), null);
  await setSetting(s.db, u.id, 'git_servers_json', JSON.stringify([{ id: 'a', type: 'forgejo', host: 'git.mon-serveur.fr', tokenEnc: encrypt(key, 'tok-perso') }]));
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.mon-serveur.fr/a/b.git'), 'tok-perso', 'le serveur perso reçoit le sien, pas celui de GitHub');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://github.com/a/b.git'), 'tok-github', 'GitHub ne reçoit jamais celui du serveur perso');
  for (const evil of ['https://evil.git.mon-serveur.fr/a/b.git', 'https://evil.github.com/a/b.git', 'https://git.mon-serveur.fr.evil.fr/a/b.git', 'https://github.com.evil.fr/a/b.git', 'https://github.com:8443/a/b.git', 'https://gitlab.com/a/b.git', 'pas une url']) {
    assert.equal(await gitTokenFor(s.app, u.id, evil), null, evil);
  }
  // sans token GitHub, GitHub ne reçoit rien (dépôt public)
  const v = await user();
  await setSetting(s.db, v.id, 'git_servers_json', JSON.stringify([{ id: 'b', type: 'forgejo', host: 'git.de-v.fr', tokenEnc: encrypt(key, 'tok-de-v') }]));
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
  await setSetting(s.db, u.id, 'git_servers_json', JSON.stringify([{ id: 'a', type: 'forgejo', host: 'git.mon-serveur.fr', tokenEnc: encrypt(key, 'tok-perso') }]));
  await setSetting(s.db, u.id, 'github_token_enc', encrypt(key, 'tok-github'));
  const seen = [];
  s.app.syncRepo = async (url, dir, token, opts) => { seen.push({ url, token, scheme: opts.scheme, user: opts.user }); throw new Error('stop'); };
  try {
    // insérés directement : le plan gratuit n'autorise qu'un projet par la route de création
    const gh = await addProject(s.db, u.id, { name: 'gh', gitUrl: 'https://github.com/TonyAVERTY/Ai_tools.git' });
    const own = await addProject(s.db, u.id, { name: 'own', gitUrl: 'https://git.mon-serveur.fr/Tony/App.git' });
    const handlers = makeHandlers(s.app);
    for (const id of [gh, own]) {
      await assert.rejects(handlers.analyze({ job: { user_id: u.id, project_id: id }, progress: async () => {}, signal: new AbortController().signal }), /stop/);
    }
    assert.deepEqual(seen.map((x) => [new URL(x.url).host, x.token, x.scheme, x.user]), [['github.com', 'tok-github', 'basic', 'x-access-token'], ['git.mon-serveur.fr', 'tok-perso', 'token', undefined]]);
  } finally { delete s.app.syncRepo; }
});

// ---------- Liste de serveurs : le « + » des Réglages ----------

const settings = (u, fields) => u.post('/settings', { global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60', ...fields }, { form: true });
const rawServers = async (id) => JSON.parse((await getSetting(s.db, id, 'git_servers_json')) ?? '[]');

test('réglages : GitHub et son token d\'abord, puis le « + » avec le choix du type, sans serveur par défaut', async () => {
  const u = await user();
  const html = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /<strong>GitHub<\/strong>/);
  assert.match(html, /name="github_token"/);
  assert.match(html, /data-git-add/);
  for (const t of ['forgejo', 'gitea', 'gitlab']) assert.match(html, new RegExp(`<option value="${t}"`), t);
  assert.doesNotMatch(html, /<option value="github"/, 'GitHub n\'est pas un type à ajouter : il est déjà là');
  // gabarit d'une ligne : mêmes champs URL et token, inerte tant que le « + » ne l'a pas ajouté
  const tpl = html.match(/<template id="git-row-tpl">([\s\S]*?)<\/template>/)[1];
  assert.match(tpl, /name="git_host___I__"/);
  assert.match(tpl, /name="git_token___I__" type="password"/);
  assert.doesNotMatch(html.replace(/<template[\s\S]*?<\/template>/, ''), /git_host_/, 'aucune ligne tant qu\'on n\'a rien ajouté');
});

test('réglages : on ajoute plusieurs serveurs de types différents, chacun avec son URL et son token', async () => {
  const u = await user();
  assert.equal((await settings(u, {
    git_type_0: 'forgejo', git_host_0: 'https://git.a.fr/', git_token_0: 'tok-a',
    git_type_1: 'gitlab', git_host_1: 'gitlab.b.fr', git_token_1: 'tok-b',
    git_type_2: 'gitea', git_host_2: 'git.c.fr', // sans token : dépôts publics
  })).status, 303);
  const list = await listGitServers(s.db, u.id);
  assert.deepEqual(list.map((x) => [x.type, x.host, !!x.tokenEnc]), [['forgejo', 'git.a.fr', true], ['gitlab', 'gitlab.b.fr', true], ['gitea', 'git.c.fr', false]]);
  assert.ok(!JSON.stringify(await rawServers(u.id)).includes('tok-a'), 'chiffrés en base');
  assert.deepEqual((await rawServers(u.id)).map((x) => x.id).filter(Boolean).length, 3, 'chaque serveur a son identifiant');
  // chaque token va à son serveur : forgejo et gitea en « token », gitlab en Basic oauth2
  const cred = (url) => gitCredentialFor(s.app, u.id, url);
  assert.deepEqual(await cred('https://git.a.fr/x/y.git'), { token: 'tok-a', scheme: 'token', user: undefined });
  assert.deepEqual(await cred('https://gitlab.b.fr/x/y.git'), { token: 'tok-b', scheme: 'basic', user: 'oauth2' });
  assert.equal(await cred('https://git.c.fr/x/y.git'), null, 'pas de token : dépôt public');
  assert.equal(await cred('https://github.com/x/y.git'), null);
  // la page les affiche, jamais les tokens
  const html = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /value="git\.a\.fr"/);
  assert.match(html, /<strong>GitLab<\/strong>/);
  assert.ok(!html.includes('tok-a') && !html.includes('tok-b'));
  assert.equal((html.match(/placeholder="•••••• \(inchangé\)"/g) || []).length, 2, 'deux tokens enregistrés, un sans');
  // tous leurs hôtes sont acceptés à la création d'un projet
  const pr = await create(u, 'https://gitlab.b.fr/x/y.git', 'gl');
  assert.equal(pr.status, 200);
});

test('réglages : un token resté vide est conservé, un nouveau remplace, « supprimer » efface, « retirer » enlève le serveur', async () => {
  const u = await user();
  await settings(u, { git_type_0: 'forgejo', git_host_0: 'git.a.fr', git_token_0: 'tok-1', git_type_1: 'gitea', git_host_1: 'git.b.fr', git_token_1: 'tok-2' });
  const [a, b] = await rawServers(u.id);
  const token = async (host) => gitTokenFor(s.app, u.id, `https://${host}/x/y.git`);
  // le formulaire renvoie l'identifiant de chaque ligne ; le token vide ne change rien
  await settings(u, { git_type_0: 'forgejo', git_id_0: a.id, git_host_0: 'git.a.fr', git_token_0: '', git_type_1: 'gitea', git_id_1: b.id, git_host_1: 'git.b.fr', git_token_1: '' });
  assert.equal(await token('git.a.fr'), 'tok-1');
  assert.equal(await token('git.b.fr'), 'tok-2');
  assert.equal((await rawServers(u.id))[0].id, a.id, 'l\'identifiant est stable');
  // un nouveau token remplace
  await settings(u, { git_type_0: 'forgejo', git_id_0: a.id, git_host_0: 'git.a.fr', git_token_0: 'tok-1bis', git_type_1: 'gitea', git_id_1: b.id, git_host_1: 'git.b.fr' });
  assert.equal(await token('git.a.fr'), 'tok-1bis');
  // « supprimer le token » l'efface, le serveur reste
  await settings(u, { git_type_0: 'forgejo', git_id_0: a.id, git_host_0: 'git.a.fr', git_token_clear_0: '1', git_type_1: 'gitea', git_id_1: b.id, git_host_1: 'git.b.fr' });
  assert.equal(await token('git.a.fr'), null);
  assert.equal(await token('git.b.fr'), 'tok-2');
  assert.equal((await listGitServers(s.db, u.id)).length, 2);
  // « retirer » enlève le serveur
  await settings(u, { git_type_0: 'forgejo', git_id_0: a.id, git_host_0: 'git.a.fr', git_del_0: '1', git_type_1: 'gitea', git_id_1: b.id, git_host_1: 'git.b.fr' });
  assert.deepEqual((await listGitServers(s.db, u.id)).map((x) => x.host), ['git.b.fr']);
  assert.equal((await create(u, 'https://git.a.fr/x/y.git')).status, 400, 'hôte retiré : refusé');
});

test('réglages : changer l\'URL d\'un serveur ne lui laisse pas l\'ancien token (il ne suit pas vers un autre hôte)', async () => {
  const u = await user();
  await settings(u, { git_type_0: 'forgejo', git_host_0: 'git.a.fr', git_token_0: 'tok-secret' });
  const [a] = await rawServers(u.id);
  await settings(u, { git_type_0: 'forgejo', git_id_0: a.id, git_host_0: 'git.autre.fr' });
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.autre.fr/x/y.git'), null, 'le token de git.a.fr n\'est pas présenté à git.autre.fr');
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.a.fr/x/y.git'), null);
});

test('réglages : refus nets (GitHub en double, type inconnu, doublon, trop de serveurs, hôte interne)', async () => {
  const u = await user();
  const refused = async (fields, re) => {
    const r = await settings(u, fields);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, re);
  };
  await refused({ git_type_0: 'forgejo', git_host_0: 'https://github.com/' }, /GitHub est déjà là/);
  await refused({ git_type_0: 'svn', git_host_0: 'git.a.fr' }, /Type de serveur Git inconnu/);
  await refused({ git_type_0: 'forgejo', git_host_0: 'git.a.fr', git_type_1: 'gitea', git_host_1: 'GIT.A.FR' }, /deux fois/);
  const many = {};
  for (let i = 0; i <= MAX_GIT_SERVERS; i++) Object.assign(many, { [`git_type_${i}`]: 'forgejo', [`git_host_${i}`]: `git${i}.exemple.fr` });
  await refused(many, new RegExp(`${MAX_GIT_SERVERS} serveurs Git au plus`));
  assert.deepEqual(await listGitServers(s.db, u.id), [], 'un refus n\'enregistre rien');
  // une ligne laissée vide est ignorée
  assert.equal((await settings(u, { git_type_0: 'forgejo', git_host_0: '  ' })).status, 303);
  assert.deepEqual(await listGitServers(s.db, u.id), []);
});

test('compatibilité : l\'ancien réglage unique (forgejo_host + token) reste un serveur Forgejo, puis entre dans la liste à la première sauvegarde', async () => {
  const u = await user();
  const key = s.app.cfg.secretKey;
  await setSetting(s.db, u.id, 'forgejo_host', 'git.ancien.fr');
  await setSetting(s.db, u.id, 'forgejo_token_enc', encrypt(key, 'tok-ancien'));
  assert.deepEqual(publicGitServers(await listGitServers(s.db, u.id)), [{ id: 'legacy', type: 'forgejo', label: 'Forgejo', host: 'git.ancien.fr', hasToken: true }]);
  assert.deepEqual(await gitCredentialFor(s.app, u.id, 'https://git.ancien.fr/a/b.git'), { token: 'tok-ancien', scheme: 'token', user: undefined });
  assert.equal((await create(u, 'https://git.ancien.fr/a/b.git')).status, 200, 'ses dépôts continuent de fonctionner');
  // la page le montre comme une ligne ordinaire, et enregistrer sans rien changer le garde (avec son token)
  const html = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /value="git\.ancien\.fr"/);
  assert.match(html, /name="git_id_0" value="legacy"/);
  await settings(u, { git_type_0: 'forgejo', git_id_0: 'legacy', git_host_0: 'git.ancien.fr' });
  assert.equal(await gitTokenFor(s.app, u.id, 'https://git.ancien.fr/a/b.git'), 'tok-ancien');
  assert.equal(await getSetting(s.db, u.id, 'forgejo_host'), null, 'l\'ancien réglage est rangé dans la liste');
  assert.equal(await getSetting(s.db, u.id, 'forgejo_token_enc'), null);
  // le retirer ensuite le retire pour de bon (il ne ressuscite pas depuis l'ancien réglage)
  await settings(u, { git_type_0: 'forgejo', git_id_0: 'legacy', git_host_0: 'git.ancien.fr', git_del_0: '1' });
  assert.deepEqual(await listGitServers(s.db, u.id), []);
});

test('git : GitLab s\'authentifie en Basic avec oauth2, et le nom d\'utilisateur de l\'auth Basic suit le type', () => {
  assert.equal(gitEnv('tok-gl', { scheme: 'basic', user: 'oauth2' }).GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from('oauth2:tok-gl').toString('base64')}`);
  assert.equal(gitEnv('tok-gh', { scheme: 'basic' }).GIT_CONFIG_VALUE_0, `Authorization: Basic ${Buffer.from('x-access-token:tok-gh').toString('base64')}`);
});
