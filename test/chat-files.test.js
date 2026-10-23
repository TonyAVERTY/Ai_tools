// Page IA : pièces jointes (images, PDF, texte, vidéos) et projet joint. Types reconnus à la signature, limites, isolation entre comptes,
// outils de lecture seulement quand quelque chose est joint, nettoyage des fichiers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startApp, APP_URL } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject } from './helpers/users.js';
import { now } from '../src/db.js';
import { userChatRoot, userRepoRoot, deleteUser } from '../src/users.js';
import { buildBwrapArgs, prepareLaunch } from '../src/services/sandbox.js';
import { sniff, displayName, FILES, TEXT_EXT, splitJpegs, purgePendingUploads, sweepRunDirs, attachmentDir, videoSupported } from '../src/chatfiles.js';
import { chatContext } from '../src/services/prompts.js';

// ---------- fabriques de fichiers ----------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2), Buffer.from([0xff, 0xd9])]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 3)]);
const ZIP = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(300, 4)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(40)]);

test('sniff : le type vient de la signature du fichier, jamais de son nom', () => {
  assert.deepEqual(sniff(PNG, 'a.png'), { kind: 'image', mime: 'image/png', ext: 'png' });
  assert.deepEqual(sniff(PNG, 'liar.pdf'), { kind: 'image', mime: 'image/png', ext: 'png' }, 'un nom menteur ne change rien');
  assert.equal(sniff(JPG, 'x').mime, 'image/jpeg');
  assert.equal(sniff(Buffer.from('GIF89a......'), 'x').mime, 'image/gif');
  assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'x').mime, 'image/webp');
  assert.deepEqual(sniff(PDF, 'devis.pdf'), { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(sniff(ftyp('isom'), 'v.mp4'), { kind: 'video', mime: 'video/mp4', ext: 'mp4' });
  assert.equal(sniff(ftyp('qt  '), 'v.mov').mime, 'video/quicktime');
  assert.equal(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), 'v.webm').mime, 'video/webm');
  // non pris en charge : exécutable, archive, SVG (peut contenir du script), audio M4A, HEIC, vide
  for (const [what, buf, name] of [['exe', EXE, 'a.png'], ['zip', ZIP, 'a.zip'], ['svg', SVG, 'a.svg'], ['m4a', ftyp('M4A '), 'a.m4a'], ['heic', ftyp('heic'), 'a.heic'], ['vide', Buffer.alloc(0), 'a.txt']]) assert.equal(sniff(buf, name), null, what);
  // texte : extension connue + UTF-8 valide + aucun octet nul
  assert.deepEqual(sniff(Buffer.from('Bonjour, élève.\n'), 'notes.md'), { kind: 'text', mime: 'text/plain; charset=utf-8', ext: 'md' });
  assert.equal(sniff(Buffer.from('a,b\n1,2'), 'data.csv').kind, 'text');
  assert.equal(sniff(Buffer.from('texte'), 'script.exe'), null, 'extension inconnue');
  assert.equal(sniff(Buffer.from('texte'), 'sans-extension'), null);
  assert.equal(sniff(Buffer.from('a\0b'), 'a.txt'), null, 'octet nul : binaire déguisé');
  assert.equal(sniff(Buffer.from([0xff, 0xfe, 0xfd, 0x41]), 'a.txt'), null, 'UTF-8 invalide');
  const cut = Buffer.from('é'.repeat(10)).subarray(0, 19); // dernier caractère coupé par la limite de lecture
  assert.equal(sniff(cut, 'a.txt').kind, 'text', 'un caractère coupé à la fin n\'est pas une erreur');
  assert.ok(TEXT_EXT.has('py') && !TEXT_EXT.has('svg') && !TEXT_EXT.has('exe') && !TEXT_EXT.has('php5'.slice(0, 3) + 'x'));
});

test('displayName : sans chemin ni caractère de contrôle, borné', () => {
  assert.equal(displayName('../../etc/passwd'), 'passwd');
  assert.equal(displayName('C:\\Users\\moi\\photo.png'), 'photo.png');
  assert.equal(displayName('a\u0000b\nc<d>"e".txt'), 'abcde.txt');
  assert.equal(displayName('   '), 'fichier');
  assert.equal(displayName('x'.repeat(500)).length, 120);
  assert.equal(displayName('Photo été « vacances ».jpg'), 'Photo été « vacances ».jpg');
});

test('splitJpegs : un flux de JPEG concaténés redonne les images une à une', () => {
  const j = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
  const parts = splitJpegs(Buffer.concat([j(10), j(20), j(30)]));
  assert.deepEqual(parts.map((p) => p.length), [16, 26, 36]);
  assert.deepEqual(splitJpegs(Buffer.from('rien')), []);
});

test('sandbox : les dossiers joints sont montés en lecture seule, et refusés hors du dossier de l\'utilisateur', () => {
  const args = buildBwrapArgs({ workDir: '/data/repos/1/p', command: ['claude'], extraRo: ['/data/chat/1/run/abc'] });
  const i = args.indexOf('/data/chat/1/run/abc');
  assert.equal(args[i - 1], '--ro-bind');
  assert.equal(args[i + 1], '/data/chat/1/run/abc');
  assert.throws(() => buildBwrapArgs({ command: ['x'], extraRo: ['relatif'] }), /absolus/);
  const base = { bin: 'claude', args: [], sandbox: { enabled: false, production: false }, extraRoot: '/data/chat/1' };
  assert.doesNotThrow(() => prepareLaunch({ ...base, extraDirs: ['/data/chat/1/run/abc'] }).cleanup());
  assert.throws(() => prepareLaunch({ ...base, extraDirs: ['/data/chat/2/run/abc'] }), /hors du dossier/);
  assert.throws(() => prepareLaunch({ ...base, extraDirs: ['/data/chat/1/../2/x'] }), /hors du dossier/);
  assert.throws(() => prepareLaunch({ ...base, extraRoot: undefined, extraDirs: ['/data/chat/1'] }), /hors du dossier/);
});

test('chatContext : rien de joint = aucun accès ; sinon la liste des fichiers et du projet, lecture seule', () => {
  assert.equal(chatContext({}), '');
  const c = chatContext({
    project: { name: 'Atelier', profile: { resume: 'Un outil de devis.', stack: 'node' } },
    files: [{ att: { kind: 'image', name: 'photo.png', size: 2048 }, paths: ['/d/1-fichier.png'] }, { att: { kind: 'video', name: 'demo.mp4', size: 9, meta: { duration: 16, frames: 8 } }, paths: ['/d/2-image-1.jpg', '/d/2-image-2.jpg'] }],
  });
  assert.match(c, /Read, Glob et Grep/);
  assert.match(c, /Projet joint « Atelier »[\s\S]*Tu ne peux rien modifier/);
  assert.match(c, /Un outil de devis\./);
  assert.match(c, /\/d\/1-fichier\.png : image « photo\.png » \(2 Ko\)/);
  assert.match(c, /vidéo « demo\.mp4 » \(16 s\) : 2 images extraites[\s\S]*image 2, vers 2 s/);
  assert.match(c, /Rien d'autre n'est accessible/);
});

// ---------- application ----------
let s;
let spy;
before(async () => {
  s = await startApp();
  spy = join(s.tmp, 'files.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: spy } });
});
after(async () => { await s.close(); });
const calls = () => readFileSync(spy, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const events = async (r) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
const send = (u, body) => u.post('/api/chat/send', body);
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());
const upload = (u, body, { name = 'fichier', type = 'application/octet-stream' } = {}) => fetch(`${s.base}/api/chat/upload`, {
  method: 'POST', body, headers: { cookie: u.cookie, origin: APP_URL, 'content-type': type, 'x-file-name': encodeURIComponent(name) },
});
const upOk = async (u, body, o) => { const r = await upload(u, body, o); assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).attachment; };
const flag = (args, f) => args[args.indexOf(f) + 1];

test('téléverser une image : reconnue, rangée dans le dossier de l\'utilisateur, relue par lui seul avec les bons en-têtes', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const a = await upOk(u, PNG, { name: 'Photo é.png', type: 'image/png' });
  assert.deepEqual([a.kind, a.name, a.size, a.mime], ['image', 'Photo é.png', PNG.length, 'image/png']);
  const dir = attachmentDir(s.app.cfg, u.id, a.id);
  assert.ok(dir.startsWith(userChatRoot(s.app.cfg, u.id)), 'dossier propre à l\'utilisateur');
  assert.deepEqual(readdirSync(dir), ['file.png'], 'nom de fichier fixe : le nom d\'origine ne touche jamais le disque');
  const r = await u.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.match(r.headers.get('content-disposition'), /inline; filename\*=UTF-8''Photo%20%C3%A9\.png/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  const part = await u.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*', range: 'bytes=0-9' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-9/${PNG.length}`);
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  assert.equal((await u.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*', range: 'bytes=9999-' } })).status, 416);
  // un autre compte, ou personne : rien
  assert.equal((await v.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*' } })).status, 404);
  assert.equal((await s.anon.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*' } })).status, 401);
  assert.equal((await fetch(`${s.base}/api/chat/upload`, { method: 'POST', body: PNG })).status, 401);
});

test('types refusés (signature) et limites : exécutable renommé, SVG, archive, trop gros, espace plein', async () => {
  const u = await s.newUser();
  for (const [what, body, name] of [['exe renommé en png', EXE, 'virus.png'], ['svg', SVG, 'a.svg'], ['zip', ZIP, 'a.zip'], ['txt binaire', Buffer.from('a\0b'), 'a.txt']]) {
    const r = await upload(u, body, { name, type: 'image/png' });
    assert.equal(r.status, 415, what);
    assert.match((await r.json()).error, /non pris en charge/);
  }
  const filesDir = join(userChatRoot(s.app.cfg, u.id), 'files');
  assert.equal(existsSync(filesDir) ? readdirSync(filesDir).length : 0, 0, 'rien n\'est resté sur le disque');
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_attachments WHERE user_id = ?').get(u.id)).n), 0, 'ni en base');
  const bigImg = await upload(u, Buffer.concat([PNG, Buffer.alloc(FILES.maxBytes.image)]), { name: 'gros.png' });
  assert.equal(bigImg.status, 413);
  assert.match((await bigImg.json()).error, /trop gros pour ce type \(10 Mo/);
  const bigTxt = await upload(u, Buffer.alloc(FILES.maxBytes.text + 10, 97), { name: 'gros.txt' });
  assert.equal(bigTxt.status, 413);
  assert.equal((await upload(u, Buffer.alloc(FILES.maxBytes.video + 1))).status, 413, 'au-delà de toute limite : refusé avant lecture');
  // espace total
  await s.db.prepare("INSERT INTO chat_attachments(user_id, kind, name, size, message_id, created_at) VALUES(?, 'image', 'x', ?, NULL, ?)").run(u.id, FILES.perUser - 100, now());
  const full = await upload(u, PNG, { name: 'p.png' });
  assert.equal(full.status, 413);
  assert.match((await full.json()).error, /Espace plein/);
});

test('retirer une pièce jointe pas encore envoyée : fichier et ligne supprimés ; après l\'envoi, impossible', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const a = await upOk(u, JPG, { name: 'a.jpg' });
  const dir = attachmentDir(s.app.cfg, u.id, a.id);
  assert.equal((await v.post(`/api/chat/attachments/${a.id}/delete`, {})).status, 404, 'pas celle d\'un autre');
  assert.equal((await u.post(`/api/chat/attachments/${a.id}/delete`, {})).status, 200);
  assert.equal(existsSync(dir), false);
  const b = await upOk(u, JPG, { name: 'b.jpg' });
  await events(await send(u, { message: 'ECHO avec photo', attachments: [b.id] }));
  const r = await u.post(`/api/chat/attachments/${b.id}/delete`, {});
  assert.equal(r.status, 409);
});

test('message avec une photo et un PDF : Claude reçoit les outils de lecture, dans un dossier jetable qui ne contient que ces fichiers', async () => {
  const u = await s.newUser();
  const img = await upOk(u, PNG, { name: 'plan.png' });
  const pdf = await upOk(u, PDF, { name: 'devis.pdf' });
  const ev = await events(await send(u, { message: 'ECHO regarde ça', attachments: [img.id, pdf.id] }));
  assert.equal(ev.at(-1).type, 'done');
  assert.deepEqual(ev[0].attachments.map((a) => [a.kind, a.name]), [['image', 'plan.png'], ['pdf', 'devis.pdf']]);
  const c = calls().at(-1);
  assert.equal(flag(c.args, '--tools'), 'Read,Glob,Grep');
  assert.equal(c.args.indexOf('--add-dir'), -1, 'sans projet : le dossier des fichiers est le dossier de travail');
  assert.ok(c.cwd.startsWith(join(userChatRoot(s.app.cfg, u.id), 'run')), `dossier de travail jetable (${c.cwd})`);
  assert.match(c.prompt, /\[Pièces jointes : image « plan\.png », PDF « devis\.pdf »\]\nECHO regarde ça/);
  const system = flag(c.args, '--append-system-prompt');
  assert.match(system, new RegExp(`${c.cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${img.id}-fichier\\.png : image « plan\\.png »`));
  assert.match(system, /PDF « devis\.pdf »/);
  assert.equal(existsSync(c.cwd), false, 'le dossier jetable est supprimé après la réponse');
  assert.equal(readdirSync(join(userChatRoot(s.app.cfg, u.id), 'run')).length, 0);
  // l'historique garde les pièces jointes, et un message suivant les remet à disposition
  const conv = ev[0].conversationId;
  const got = await (await u.get(`/api/chat/conversations/${conv}`)).json();
  assert.deepEqual(got.messages[0].attachments.map((a) => a.id), [img.id, pdf.id]);
  await events(await send(u, { message: 'ECHO et maintenant ?', conversationId: conv }));
  const c2 = calls().at(-1);
  assert.equal(flag(c2.args, '--tools'), 'Read,Glob,Grep', 'les fichiers de la conversation restent lisibles');
  assert.match(flag(c2.args, '--append-system-prompt'), /plan\.png/);
  assert.match(c2.prompt, /Utilisateur : \[Pièces jointes : image « plan\.png », PDF « devis\.pdf »\]\nECHO regarde ça/);
  // la page rend les aperçus
  const page = await html(u, `/chat/${conv}`);
  assert.match(page, new RegExp(`<img src="/api/chat/files/${img.id}" alt="plan\\.png"`));
  assert.match(page, new RegExp(`href="/api/chat/files/${pdf.id}"[^>]*>[\\s\\S]*devis\\.pdf`));
  assert.match(page, /data-chat-attach/);
});

test('sans pièce jointe : toujours aucun outil ; message vide avec pièce jointe accepté ; pièces jointes des autres, déjà envoyées ou trop nombreuses refusées', async () => {
  const u = await s.newUser(), v = await s.newUser();
  await events(await send(u, { message: 'ECHO simple' }));
  assert.equal(flag(calls().at(-1).args, '--tools'), '', 'aucun outil');
  const a = await upOk(u, JPG, { name: 'seule.jpg' });
  const ev = await events(await send(u, { message: '   ', attachments: [a.id] }));
  assert.equal(ev.at(-1).type, 'done');
  assert.match(calls().at(-1).prompt, /Voici les pièces jointes\./);
  // refus : on ne rejoue pas une pièce jointe déjà envoyée, ni celle d'un autre, ni inconnue ; rien n'est écrit
  const before = Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()).n);
  for (const ids of [[a.id], [999999]]) assert.equal((await send(u, { message: 'ECHO non', attachments: ids })).status, 404);
  const mine = await upOk(u, JPG, { name: 'm.jpg' });
  assert.equal((await send(v, { message: 'ECHO volé', attachments: [mine.id] })).status, 404, 'la pièce jointe d\'un autre compte');
  assert.equal((await send(u, { message: 'ECHO trop', attachments: [1, 2, 3, 4, 5, 6, 7] })).status, 400);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_messages').get()).n), before, 'aucun message enregistré pour ces refus');
});

test('supprimer une conversation supprime ses pièces jointes (fichiers et lignes) ; supprimer le compte aussi', async () => {
  const u = await s.newUser();
  const a = await upOk(u, PNG, { name: 'x.png' });
  const conv = (await events(await send(u, { message: 'ECHO bientôt effacé', attachments: [a.id] })))[0].conversationId;
  const dir = attachmentDir(s.app.cfg, u.id, a.id);
  assert.ok(existsSync(dir));
  assert.equal((await u.post(`/api/chat/conversations/${conv}/delete`, {})).status, 200);
  assert.equal(existsSync(dir), false, 'fichier supprimé');
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_attachments WHERE user_id = ?').get(u.id)).n), 0, 'ligne supprimée');
  const b = await upOk(u, PNG, { name: 'y.png' });
  assert.ok(existsSync(userChatRoot(s.app.cfg, u.id)));
  await deleteUser(s.app, u.id);
  assert.equal(existsSync(userChatRoot(s.app.cfg, u.id)), false, 'dossier du compte supprimé avec lui');
  void b;
});

test('nettoyage : pièces jointes jamais envoyées après 24 h, dossiers de travail oubliés après 1 h', async () => {
  const u = await s.newUser();
  const old = await upOk(u, PNG, { name: 'vieux.png' });
  const fresh = await upOk(u, PNG, { name: 'frais.png' });
  await s.db.prepare('UPDATE chat_attachments SET created_at = ? WHERE id = ?').run(now() - 25 * 3600, old.id);
  assert.equal(await purgePendingUploads(s.app), 1);
  assert.equal(existsSync(attachmentDir(s.app.cfg, u.id, old.id)), false);
  assert.ok(existsSync(attachmentDir(s.app.cfg, u.id, fresh.id)));
  const run = join(userChatRoot(s.app.cfg, u.id), 'run', 'oublie');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'x'), 'x');
  utimesSync(run, new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 2 * 3600_000));
  assert.ok(await sweepRunDirs(s.app.cfg) >= 1);
  assert.equal(existsSync(run), false);
});

// ---------- projet joint ----------
const fakeClone = (url, dir) => { mkdirSync(join(dir, '.git'), { recursive: true }); writeFileSync(join(dir, 'README.md'), '# Atelier\n'); return 'abc123'; };

test('projet joint : son dépôt devient le dossier de travail (lecture seule), mis à jour au premier usage ; les projets des autres et les simples membres sont refusés', async () => {
  const owner = await s.newUser(), stranger = await s.newUser(), member = await s.newUser(), admin = await s.newUser();
  const pid = await addProject(s.db, owner.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  await s.db.prepare("UPDATE projects SET profile_json = ? WHERE id = ?").run(JSON.stringify({ resume: 'Un outil de devis pour artisans.', stack: 'node' }), pid);
  let syncs = 0;
  s.app.syncRepo = async (url, dir) => { syncs++; return fakeClone(url, dir); };
  // liste : ses propres projets seulement
  assert.deepEqual((await (await owner.get('/api/chat/projects')).json()).projects.map((p) => [p.id, p.name, p.analyzed]), [[pid, 'Atelier', true]]);
  assert.deepEqual((await (await stranger.get('/api/chat/projects')).json()).projects, []);

  const ev = await events(await send(owner, { message: 'ECHO explique ce projet', projectId: pid }));
  assert.deepEqual(ev.filter((e) => e.type === 'status').map((e) => e.text), ['Mise à jour du dépôt de « Atelier »…']);
  assert.equal(ev.at(-1).type, 'done');
  assert.deepEqual(ev[0].attachments.map((a) => [a.kind, a.name, a.projectId]), [['project', 'Atelier', pid]]);
  const c = calls().at(-1);
  assert.equal(c.cwd, join(userRepoRoot(s.app.cfg, owner.id), String(pid)), 'le dépôt du projet est le dossier de travail');
  assert.equal(flag(c.args, '--tools'), 'Read,Glob,Grep');
  assert.equal(c.args.indexOf('--add-dir'), -1);
  assert.equal(flag(c.args, '--max-turns'), '14', 'plus d\'allers-retours pour explorer');
  const system = flag(c.args, '--append-system-prompt');
  assert.match(system, /Projet joint « Atelier »/);
  assert.match(system, /Un outil de devis pour artisans\./);
  assert.match(c.prompt, /\[Pièces jointes : projet « Atelier »\]/);
  // un second message : le dépôt est frais, pas de nouvelle synchronisation
  const conv = ev[0].conversationId;
  const again = await events(await send(owner, { message: 'ECHO et les routes ?', conversationId: conv, projectId: pid }));
  assert.equal(again.filter((e) => e.type === 'status').length, 0);
  assert.equal(syncs, 1);
  // la page se souvient du projet joint au dernier message
  assert.match(await html(owner, `/chat/${conv}`), new RegExp(`data-project="${pid}" data-project-name="Atelier"`));
  // détacher : plus d'outils
  await events(await send(owner, { message: 'ECHO sans le projet', conversationId: conv }));
  assert.equal(flag(calls().at(-1).args, '--tools'), '');
  assert.doesNotMatch(await html(owner, `/chat/${conv}`), /data-project="\d+"/);

  // refusés
  assert.equal((await send(stranger, { message: 'ECHO je triche', projectId: pid })).status, 404, 'projet d\'un autre compte');
  assert.equal((await send(owner, { message: 'ECHO x', projectId: 999999 })).status, 404);
  const team = Number((await s.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'T', ?)").run(owner.id, now())).lastInsertRowid);
  await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', ?), (?, ?, 'admin', ?)").run(team, member.id, now(), team, admin.id, now());
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team, pid);
  assert.equal((await send(member, { message: 'ECHO x', projectId: pid })).status, 403, 'un simple membre ne lit pas le code');
  assert.deepEqual((await (await member.get('/api/chat/projects')).json()).projects, []);
  // un administrateur d'équipe le peut : le dépôt lu est celui du PROPRIÉTAIRE
  assert.deepEqual((await (await admin.get('/api/chat/projects')).json()).projects.map((p) => p.id), [pid]);
  const adm = await events(await send(admin, { message: 'ECHO je suis admin', projectId: pid }));
  assert.equal(adm.at(-1).type, 'done');
  assert.equal(calls().at(-1).cwd, join(userRepoRoot(s.app.cfg, owner.id), String(pid)));
});

test('projet joint : dépôt introuvable sans copie locale = erreur lisible ; avec une copie, on lit la dernière', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Perdu', gitUrl: 'https://github.com/u/perdu.git' });
  s.app.syncRepo = async () => { throw new Error('authentification refusée'); };
  const bad = await events(await send(u, { message: 'ECHO lis-le', projectId: pid }));
  assert.equal(bad.at(-1).type, 'error');
  assert.match(bad.at(-1).error, /Impossible de récupérer le dépôt de « Perdu » : authentification refusée/);
  fakeClone('', join(userRepoRoot(s.app.cfg, u.id), String(pid)));
  const ok = await events(await send(u, { message: 'ECHO réessaie', projectId: pid }));
  assert.ok(ok.some((e) => e.type === 'status' && /dernière copie/.test(e.text)));
  assert.equal(ok.at(-1).type, 'done');
});

test('projet ET fichiers joints : le dépôt est le dossier de travail, les fichiers sont un dossier supplémentaire en lecture seule', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Les deux', gitUrl: 'https://github.com/u/deux.git' });
  s.app.syncRepo = async (url, dir) => fakeClone(url, dir);
  const a = await upOk(u, PNG, { name: 'capture.png' });
  const ev = await events(await send(u, { message: 'ECHO compare', projectId: pid, attachments: [a.id] }));
  assert.equal(ev.at(-1).type, 'done');
  const c = calls().at(-1);
  assert.equal(c.cwd, join(userRepoRoot(s.app.cfg, u.id), String(pid)));
  const extra = flag(c.args, '--add-dir');
  assert.ok(extra.startsWith(join(userChatRoot(s.app.cfg, u.id), 'run')));
  assert.match(flag(c.args, '--append-system-prompt'), /capture\.png/);
});

// ---------- vidéos ----------
const ffmpegOk = videoSupported({});
function makeVideo(path, seconds = 3) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=96x64:rate=10`, '-pix_fmt', 'yuv420p', '-y', path]);
  assert.equal(r.status, 0, String(r.stderr));
}

test('vidéo : quelques images sont tirées (sans le son), Claude les lit ; une vidéo abîmée est refusée proprement', { skip: !ffmpegOk && 'ffmpeg absent' }, async () => {
  const u = await s.newUser();
  const file = join(s.tmp, 'demo.mp4');
  makeVideo(file, 4);
  const a = await upOk(u, readFileSync(file), { name: 'demo.mp4', type: 'video/mp4' });
  assert.equal(a.kind, 'video');
  assert.ok(a.meta.frames >= 3 && a.meta.frames <= FILES.frames, `images tirées : ${a.meta.frames}`);
  assert.equal(a.meta.width, 96);
  assert.ok(Math.abs(a.meta.duration - 4) < 0.5);
  const dir = attachmentDir(s.app.cfg, u.id, a.id);
  assert.ok(readdirSync(dir).includes('frame-1.jpg') && readdirSync(dir).includes('file.mp4'));
  assert.deepEqual(readFileSync(join(dir, 'frame-1.jpg')).subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  // la vidéo se relit en entier (aperçu), avec lecture partielle
  assert.equal((await u.get(`/api/chat/files/${a.id}`, { headers: { accept: '*/*', range: 'bytes=0-99' } })).status, 206);
  const ev = await events(await send(u, { message: 'ECHO que montre cette vidéo ?', attachments: [a.id] }));
  assert.equal(ev.at(-1).type, 'done');
  const c = calls().at(-1);
  const system = flag(c.args, '--append-system-prompt');
  assert.match(system, /vidéo « demo\.mp4 » \(4 s\) : \d+ images extraites à intervalles réguliers, sans le son/);
  assert.match(system, new RegExp(`${a.id}-image-1\\.jpg  \\(image 1, vers 0 s\\)`));
  assert.doesNotMatch(system, /file\.mp4/, 'Claude ne reçoit pas la vidéo elle-même');
  // signature de vidéo mais contenu inutilisable
  const bad = await upload(u, Buffer.concat([ftyp('isom'), Buffer.alloc(2000, 9)]), { name: 'abimee.mp4', type: 'video/mp4' });
  assert.equal(bad.status, 415);
  assert.match((await bad.json()).error, /n'a pas pu être lue/);
  assert.equal(readdirSync(join(userChatRoot(s.app.cfg, u.id), 'files')).length, 1, 'rien ne reste de la vidéo refusée');
});
