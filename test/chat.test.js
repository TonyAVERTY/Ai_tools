// Page IA : conversations privées, messages envoyés à Claude avec le compte de l'utilisateur, réponse en flux, garde-fous.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { setSetting, getSetting, now } from '../src/db.js';
import { budgetState } from '../src/services/budget.js';
import { CHAT, listConversations } from '../src/chat.js';
import { trimHistory, chatPrompt, CHAT_HISTORY, CHAT_MAX_MESSAGE, PROMPT_DEFS } from '../src/services/prompts.js';

let s;
let spy;
before(async () => {
  s = await startApp();
  spy = join(s.tmp, 'chat.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: spy } });
});
after(async () => { await s.close(); });
const calls = () => readFileSync(spy, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } });
const events = async (r) => (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
const send = (u, body) => u.post('/api/chat/send', body);

test('un message : flux meta → delta → done, réponse enregistrée, conversation titrée, Claude appelé sans aucun outil', async () => {
  const u = await s.newUser();
  const r = await send(u, { message: 'ECHO bonjour Claude' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-ndjson/);
  const ev = await events(r);
  assert.deepEqual(ev.map((e) => e.type).filter((t, i, a) => a.indexOf(t) === i), ['meta', 'delta', 'done']);
  const meta = ev[0];
  assert.equal(meta.title, 'ECHO bonjour Claude');
  assert.equal(meta.model, 'sonnet', 'Sonnet par défaut pour le chat');
  assert.equal(ev.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Écho : ECHO bonjour Claude', 'texte reçu au fil de l\'écriture');
  const done = ev.at(-1);
  assert.equal(done.message.role, 'assistant');
  assert.equal(done.message.content, 'Écho : ECHO bonjour Claude');
  assert.match(done.message.html, /Écho/);
  // l'appel à Claude : le compte de l'utilisateur, aucun outil, pas de session enregistrée
  const c = calls().at(-1);
  assert.equal(c.model, 'sonnet');
  assert.equal(c.prompt, 'ECHO bonjour Claude', 'premier message : envoyé tel quel');
  assert.deepEqual(c.args.slice(c.args.indexOf('--tools'), c.args.indexOf('--tools') + 2), ['--tools', ''], 'aucun outil (ni fichiers, ni web, ni commandes)');
  for (const flag of ['--no-session-persistence', '--disable-slash-commands', '--include-partial-messages']) assert.ok(c.args.includes(flag), flag);
  assert.equal(c.args[c.args.indexOf('--max-turns') + 1], '1');
  const system = c.args[c.args.indexOf('--append-system-prompt') + 1];
  assert.match(system, /assistant IA intégré à AiTools/);
  // en base
  const list = await listConversations(s.db, u.id);
  assert.equal(list.length, 1);
  const rows = await s.db.prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(meta.conversationId);
  assert.deepEqual(rows.map((x) => x.role), ['user', 'assistant']);
});

test('suite de la conversation : l\'historique est transmis à Claude ; le modèle choisi est retenu', async () => {
  const u = await s.newUser();
  const first = await events(await send(u, { message: 'ECHO premier', model: 'claude-opus-5-5' }));
  const id = first[0].conversationId;
  assert.equal(first[0].model, 'claude-opus-5-5');
  const second = await events(await send(u, { message: 'ECHO second', conversationId: id }));
  assert.equal(second[0].conversationId, id, 'même conversation');
  assert.equal(second[0].model, 'claude-opus-5-5', 'le modèle de la conversation est conservé');
  const c = calls().at(-1);
  assert.match(c.prompt, /Utilisateur : ECHO premier\n\nAssistant : Écho : ECHO premier\n\nUtilisateur : ECHO second$/);
  assert.equal(c.model, 'claude-opus-5-5');
  assert.equal(await getSetting(s.db, u.id, 'chat_model'), 'claude-opus-5-5', 'dernier modèle choisi = celui des prochaines conversations');
  // modèle hors catalogue : jamais transmis à Claude
  const bad = await events(await send(u, { message: 'ECHO x', model: '--dangerously-skip-permissions' }));
  assert.equal(bad[0].model, 'claude-opus-5-5', 'identifiant inconnu : on garde le dernier modèle valide, jamais la valeur envoyée');
  assert.ok(!calls().at(-1).args.includes('--dangerously-skip-permissions'));
  // l'API redonne la conversation
  const got = await (await u.get(`/api/chat/conversations/${id}`)).json();
  assert.deepEqual(got.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(got.messages[1].html, /Écho/);
});

test('messages invalides et garde-fous : vide, trop long, conversation d\'un autre, modèle inconnu, sans compte', async () => {
  const u = await s.newUser(), v = await s.newUser();
  assert.equal((await send(u, { message: '   ' })).status, 400);
  const long = await send(u, { message: 'x'.repeat(CHAT_MAX_MESSAGE + 1) });
  assert.equal(long.status, 400);
  assert.match((await long.json()).error, /trop long/);
  const ok = await events(await send(u, { message: 'ECHO privé' }));
  assert.equal((await send(v, { message: 'ECHO je me glisse', conversationId: ok[0].conversationId })).status, 404, 'conversation d\'un autre compte');
  assert.equal((await send(u, { message: 'ECHO', conversationId: 999999 })).status, 404);
  assert.equal((await s.anon.post('/api/chat/send', { message: 'ECHO' })).status, 401);
  // rien n'a été écrit pour les messages refusés
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.user_id = ?').get(u.id)).n), 2);
});

test('isolation : liste, lecture, renommage et suppression propres à chaque compte', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const a = (await events(await send(u, { message: 'ECHO à moi' })))[0].conversationId;
  assert.deepEqual((await (await v.get('/api/chat/conversations')).json()).conversations, []);
  assert.equal((await v.get(`/api/chat/conversations/${a}`)).status, 404);
  assert.equal((await html(v, `/chat/${a}`)).status, 404);
  assert.equal((await v.post(`/api/chat/conversations/${a}/rename`, { title: 'volé' })).status, 404);
  assert.equal((await v.post(`/api/chat/conversations/${a}/delete`, {})).status, 404);
  assert.equal((await u.post(`/api/chat/conversations/${a}/rename`, { title: '  Mon  titre  ' })).status, 200);
  assert.equal((await u.post(`/api/chat/conversations/${a}/rename`, { title: '   ' })).status, 400);
  assert.equal((await (await u.get('/api/chat/conversations')).json()).conversations[0].title, 'Mon titre');
  assert.equal((await u.post(`/api/chat/conversations/${a}/delete`, {})).status, 200);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE conversation_id = ?').get(a)).n), 0, 'messages supprimés avec la conversation');
  assert.equal((await u.get(`/api/chat/conversations/${a}`)).status, 404);
});

test('page : conversations à gauche, fil rendu (réponses en Markdown échappé), lien IA dans la barre du haut', async () => {
  const u = await s.newUser();
  const id = (await events(await send(u, { message: 'ECHO <script>alert(1)</script> **gras**' })))[0].conversationId;
  const page = await (await html(u, `/chat/${id}`)).text();
  assert.match(page, /id="chat"[^>]*data-conv="\d+"/);
  assert.match(page, /\/static\/chat\.js/);
  assert.match(page, /class="ia-link" href="\/chat"/, 'lien IA à côté de l\'avatar');
  assert.ok(page.indexOf('class="ia-link"') < page.indexOf('<details class="user">'), 'avant le menu du compte');
  assert.doesNotMatch(page, /<script>alert/, 'tout est échappé');
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page, /<strong>gras<\/strong>/, 'Markdown rendu dans la réponse');
  assert.match(page, /data-chat-del="\d+"/);
  assert.match(page, /Recommandés[\s\S]*Autres modèles/);
  const fresh = await (await html(u, '/chat')).text();
  assert.match(fresh, /data-chat-empty/, 'nouvelle conversation : écran d\'accueil avec des idées');
  assert.match(await (await html(u, '/settings')).text(), /class="ia-link"/, 'le lien est sur toutes les pages de l\'application');
});

test('Claude en erreur (quota atteint) : message lisible, rien d\'enregistré côté assistant, la question reste dans l\'historique', async () => {
  const u = await s.newUser();
  const keep = s.app.cfg.claudeBin;
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js', name: 'claude-direct' }); // la CLI espion ne relaie pas un code de sortie 1
  let ev;
  try { ev = await events(await send(u, { message: 'ECHO QUOTAERR' })); } finally { s.app.cfg.claudeBin = keep; }
  assert.equal(ev.at(-1).type, 'error');
  assert.match(ev.at(-1).error, /quota Claude/);
  const id = ev[0].conversationId;
  assert.deepEqual((await s.db.prepare('SELECT role FROM chat_messages WHERE conversation_id = ?').all(id)).map((m) => m.role), ['user']);
  // le compte n'est pas bloqué pour autant
  assert.equal((await events(await send(u, { message: 'ECHO encore' }))).at(-1).type, 'done');
});

test('une seule réponse à la fois par compte ; serveur trop chargé : refus poli', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const slow = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', name: 'claude-slow', env: { PROMPT_SPY_FILE: spy, FAKE_DELAY_MS: '600' } });
  const keep = s.app.cfg.claudeBin;
  s.app.cfg.claudeBin = slow;
  try {
    const first = send(u, { message: 'ECHO lent' });
    await new Promise((r) => setTimeout(r, 200));
    const second = await send(u, { message: 'ECHO pressé' });
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /déjà en cours/);
    assert.equal((await events(await first)).at(-1).type, 'done');
    // une fois terminée, le compte peut reparler
    assert.equal((await events(await send(u, { message: 'ECHO libre' }))).at(-1).type, 'done');
    // charge machine
    s.app.loadRatio = () => CHAT.loadMax + 1;
    const hot = await send(v, { message: 'ECHO chaud' });
    assert.equal(hot.status, 503);
    assert.match((await hot.json()).error, /sollicité/);
  } finally { s.app.cfg.claudeBin = keep; delete s.app.loadRatio; }
});

test('plafond de 24 h, nombre de conversations borné, coût compté dans le budget IA', async () => {
  const u = await s.newUser();
  // coût : chaque réponse (0,0123 $ côté fausse CLI) compte dans le budget du compte
  const before = (await budgetState(s.db, u.id)).day.used;
  await events(await send(u, { message: 'ECHO coût' }));
  assert.ok((await budgetState(s.db, u.id)).day.used - before > 0.01, 'le chat consomme du budget');
  // plafond du jour
  const id = (await listConversations(s.db, u.id))[0].id;
  const t = now();
  for (let i = 0; i < CHAT.perDay; i++) await s.db.prepare("INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES(?, 'assistant', 'x', ?)").run(id, t);
  const capped = await send(u, { message: 'ECHO trop', conversationId: id });
  assert.equal(capped.status, 429);
  assert.match((await capped.json()).error, /Limite de 300 réponses/);
  // conversations : la plus ancienne part quand la limite est atteinte
  const w = await s.newUser();
  for (let i = 0; i < CHAT.maxConversations; i++) await s.db.prepare('INSERT INTO chat_conversations(user_id, title, model, created_at, updated_at) VALUES(?, ?, ?, ?, ?)').run(w.id, `c${i}`, 'sonnet', t + i, t + i);
  await events(await send(w, { message: 'ECHO nouvelle' }));
  const titles = (await listConversations(s.db, w.id)).map((c) => c.title);
  assert.equal(titles.length, CHAT.maxConversations);
  assert.ok(!titles.includes('c0'), 'la plus ancienne est supprimée');
  assert.ok(titles.includes('ECHO nouvelle'));
});

test('historique envoyé : fin de la conversation seulement, dans les limites de messages et de caractères', () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const kept = trimHistory(msgs);
  assert.equal(kept.length, CHAT_HISTORY.messages);
  assert.equal(kept.at(-1).content, 'm39');
  const big = [{ role: 'user', content: 'a'.repeat(CHAT_HISTORY.chars - 10) }, { role: 'assistant', content: 'b'.repeat(50) }, { role: 'user', content: 'c' }];
  assert.deepEqual(trimHistory(big).map((m) => m.content.slice(0, 1)), ['b', 'c'], 'le message qui ferait dépasser est écarté');
  assert.equal(chatPrompt({ message: 'Salut' }).prompt, 'Salut');
  assert.match(chatPrompt({ history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], message: 'c' }).prompt, /Utilisateur : a\n\nAssistant : b\n\nUtilisateur : c$/);
  // l'assistant a ses consignes, réglables comme les autres (par gamme de modèle)
  assert.ok(PROMPT_DEFS.chat.text.length > 850);
  assert.match(chatPrompt({ message: 'x', model: 'claude-opus-4-8' }).system, /Prends le temps de bien comprendre/);
  assert.match(chatPrompt({ message: 'x', model: 'haiku' }).system, /huit lignes au plus/);
  assert.match(chatPrompt({ message: 'x', custom: { '*': { chat: 'Tu es un pirate.' } } }).system, /^Tu es un pirate\.$/);
});

test('conversations supprimées avec le compte', async () => {
  const u = await s.newUser();
  await events(await send(u, { message: 'ECHO bientôt effacé' }));
  assert.equal((await listConversations(s.db, u.id)).length, 1);
  await s.db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM chat_conversations WHERE user_id = ?').get(u.id)).n), 0);
  void setSetting;
});
