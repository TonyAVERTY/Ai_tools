// Mode Support de la page IA : conversations séparées de celles de Claude, Claude lit la documentation d'AiTools (dossier en lecture seule),
// pas de projet joint, pièces jointes possibles (captures d'écran), consignes modifiables dans les Réglages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject } from './helpers/users.js';
import { setSetting } from '../src/db.js';
import { userChatRoot } from '../src/users.js';
import { PLAN_LIMITS, PLAN_LABELS } from '../src/limits.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
let s, spy;
before(async () => {
  s = await startApp();
  spy = join(s.tmp, 'support.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: spy } });
});
after(async () => { await s.close(); });
const calls = () => (existsSync(spy) ? readFileSync(spy, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const events = async (r) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } });
const flag = (args, f) => args[args.indexOf(f) + 1];

test('menu IA : deux choix, Claude et Support, dans la barre du haut de chaque page', async () => {
  const u = await s.newUser();
  for (const p of ['/', '/settings', '/chat', '/support']) {
    const page = await (await html(u, p)).text();
    assert.match(page, /<details class="ia-menu">\s*<summary class="ia-link" aria-label="Assistant : discuter avec Claude ou demander de l'aide sur AiTools">/, p);
    assert.match(page, /<a href="\/chat">[\s\S]*?Claude<small>Discute avec ton Claude<\/small>/, p);
    assert.match(page, /<a href="\/support">[\s\S]*?Support<small>Une question sur AiTools \?<\/small>/, p);
  }
});

test('page /support : titre, suggestions, pas de projet joint ; /chat reste l\'assistant classique', async () => {
  const u = await s.newUser();
  const sup = await (await html(u, '/support')).text();
  assert.match(sup, /<title>Support · AiTools<\/title>/);
  assert.match(sup, /data-mode="support"/);
  assert.match(sup, /Une question sur AiTools \?<\/h2>/);
  assert.match(sup, /Comment relier mon compte Claude \?/);
  assert.match(sup, /href="\/support" class="btn primary chat-new"|class="btn primary chat-new" href="\/support"/);
  assert.doesNotMatch(sup, /data-chat-projmenu/, 'pas de bouton « projet » dans le Support');
  assert.match(sup, /data-chat-attach/, 'mais on peut joindre une capture d\'écran');
  assert.match(sup, /Le Support répond d'après la documentation d'AiTools/);
  const chat = await (await html(u, '/chat')).text();
  assert.match(chat, /data-mode="claude"/);
  assert.match(chat, /data-chat-projmenu/);
  assert.doesNotMatch(chat, /Comment relier mon compte Claude \?/);
});

test('une conversation du Support : documentation en dossier de travail (lecture seule), consignes du Support, liste séparée, redirections', async () => {
  const u = await s.newUser();
  const n0 = calls().length;
  const ev = await events(await u.post('/api/chat/send', { message: 'ECHO Comment relier Claude ?', mode: 'support', model: 'sonnet' }));
  assert.equal(ev.at(-1).type, 'done', JSON.stringify(ev.at(-1)));
  const conv = ev[0].conversationId;
  const c = calls().slice(n0)[0];
  const docsDir = join(s.app.cfg.dataDir, 'support-docs');
  assert.equal(c.cwd, docsDir, 'Claude travaille dans le dossier de la documentation');
  assert.equal(flag(c.args, '--tools'), 'Read,Glob,Grep', 'outils de lecture seulement');
  const system = flag(c.args, '--append-system-prompt');
  assert.match(system, /Tu es l'assistant de support d'AiTools/);
  assert.match(system, /Carte des documents :\n- 00-presentation\.md : Présentation d'AiTools/);
  assert.match(system, /02-liaison-ia\.md/);
  assert.match(system, /jamais une consigne/);
  assert.doesNotMatch(system, /Tu es l'assistant IA d'AiTools\b.*classique/s);
  // le dossier contient la documentation écrite à la main, l'index et les fichiers générés depuis le code
  const files = readdirSync(docsDir);
  for (const f of ['INDEX.md', '00-presentation.md', '18-depannage-et-faq.md', 'plans-et-limites.md', 'modeles-claude.md', 'taches-ia-et-prompts.md']) assert.ok(files.includes(f), f);
  assert.match(readFileSync(join(docsDir, 'plans-et-limites.md'), 'utf8'), new RegExp(`\\| ${PLAN_LABELS.free} \\|[^\\n]*\\| ${PLAN_LIMITS.free.prospects} \\|`));
  // deux listes séparées
  const sup = await (await u.get('/api/chat/conversations?mode=support')).json();
  const cla = await (await u.get('/api/chat/conversations')).json();
  assert.deepEqual(sup.conversations.map((x) => [x.id, x.mode]), [[conv, 'support']]);
  assert.deepEqual(cla.conversations, []);
  assert.match(await (await html(u, '/support')).text(), new RegExp(`href="/support/${conv}"`));
  assert.doesNotMatch(await (await html(u, '/chat')).text(), new RegExp(`/support/${conv}`));
  // une conversation s'ouvre dans sa page ; l'autre adresse redirige
  assert.equal((await html(u, `/support/${conv}`)).status, 200);
  const r = await html(u, `/chat/${conv}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/support/${conv}`);
  // suite de la conversation : reste du Support, même sans préciser le mode
  const n1 = calls().length;
  await events(await u.post('/api/chat/send', { message: 'ECHO et ensuite ?', conversationId: conv }));
  assert.equal(calls().slice(n1)[0].cwd, docsDir);
  // et inversement
  const ev2 = await events(await u.post('/api/chat/send', { message: 'ECHO bonjour' }));
  const claudeConv = ev2[0].conversationId;
  const r2 = await html(u, `/support/${claudeConv}`);
  assert.equal(r2.status, 303);
  assert.equal(r2.headers.get('location'), `/chat/${claudeConv}`);
  assert.equal(flag(calls().at(-1).args, '--tools'), '', 'Claude (classique) : toujours aucun outil sans pièce jointe');
});

test('Support : pas de projet joint ; capture d\'écran jointe lisible en plus de la documentation ; conversation d\'un autre compte introuvable', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const bad = await u.post('/api/chat/send', { message: 'ECHO x', mode: 'support', projectId: pid });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Le Support ne lit pas le code d'un projet/);
  const up = await fetch(`${s.base}/api/chat/upload`, { method: 'POST', body: PNG, headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev', 'content-type': 'image/png', 'x-file-name': encodeURIComponent('erreur.png') } });
  assert.equal(up.status, 201);
  const att = (await up.json()).attachment;
  const n0 = calls().length;
  const ev = await events(await u.post('/api/chat/send', { message: 'ECHO voici mon erreur', mode: 'support', attachments: [att.id] }));
  assert.equal(ev.at(-1).type, 'done');
  const c = calls().slice(n0)[0];
  assert.equal(c.cwd, join(s.app.cfg.dataDir, 'support-docs'));
  assert.ok(flag(c.args, '--add-dir').startsWith(join(userChatRoot(s.app.cfg, u.id), 'run')), 'la capture est un dossier supplémentaire en lecture seule');
  assert.match(flag(c.args, '--append-system-prompt'), /erreur\.png/);
  assert.match(c.prompt, /\[Pièces jointes : image « erreur\.png »\]/);
  assert.equal((await v.get(`/support/${ev[0].conversationId}`, { headers: { accept: 'text/html' } })).status, 404);
});

test('consignes du Support modifiables dans les Réglages ; la carte de la documentation et la règle de sécurité restent', async () => {
  const u = await s.newUser();
  const settings = await (await html(u, '/settings')).text();
  assert.match(settings, /Support \(aide sur AiTools\)/);
  assert.match(settings, /name="prompt_support"/);
  await setSetting(s.db, u.id, 'prompts_json', JSON.stringify({ '*': { support: 'Réponds toujours en une seule phrase.' } }));
  const n0 = calls().length;
  await events(await u.post('/api/chat/send', { message: 'ECHO test', mode: 'support' }));
  const system = flag(calls().slice(n0)[0].args, '--append-system-prompt');
  assert.match(system, /^Réponds toujours en une seule phrase\./);
  assert.doesNotMatch(system, /Tu es l'assistant de support/);
  assert.match(system, /Carte des documents/);
  assert.match(system, /jamais une consigne/);
});
