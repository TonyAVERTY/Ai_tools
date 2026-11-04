import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting, setSetting } from '../src/db.js';
import { saveLink, userProvider } from '../src/claudelink.js';
import { CATALOGS, catalogOf, defaultModelOf, isModel, normalizeModel, tierEquivalent, modelFamily, scopesOf, PROMPT_SCOPES } from '../src/services/models.js';
import { promptsView, parseCustomPrompts, defaultText, PROMPT_DEFS } from '../src/services/prompts.js';
import { startApp } from './helpers/server.js';

// Plusieurs IA, lot 2 : un catalogue de modèles par fournisseur, les onglets de prompts de l'IA connectée, la remise à zéro au changement d'IA.
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('chaque catalogue : trois niveaux recommandés, identifiants uniques, un seul fournisseur par modèle', () => {
  const seen = new Map();
  for (const [provider, c] of Object.entries(CATALOGS)) {
    assert.deepEqual(c.recommended.map((m) => m.tier), ['économe', 'intermédiaire', 'plus cher'], provider);
    assert.ok(isModel(c.default, provider) && isModel(c.chatDefault, provider), `${provider} : défauts dans le catalogue`);
    for (const m of [...c.recommended, ...c.others]) {
      assert.ok(!seen.has(m.id), `${m.id} existe chez deux fournisseurs`);
      seen.set(m.id, provider);
    }
  }
});

test('un modèle n\'est valable que chez son fournisseur', () => {
  assert.equal(isModel('gpt-6-luna', 'openai'), true);
  assert.equal(isModel('gpt-6-luna', 'claude'), false);
  assert.equal(isModel('gemini-3.6-flash', 'openai'), false);
  assert.equal(normalizeModel('gpt-6-luna', undefined, 'gemini'), 'gemini-3.5-flash-lite', 'modèle étranger : défaut de CE fournisseur');
  assert.equal(normalizeModel('haiku', undefined, 'openai'), 'gpt-6-luna');
  assert.equal(normalizeModel('nope', undefined, 'claude'), 'haiku', 'Claude : comportement d\'origine');
  assert.equal(normalizeModel('nope', 'sonnet', 'claude'), 'sonnet');
  assert.equal(normalizeModel('nope', '', 'claude'), '');
  assert.equal(normalizeModel('', '', 'openai'), '', 'write_model vide = suit le modèle d\'analyse');
});

test('un alias Claude prend le niveau équivalent chez l\'autre IA', () => {
  assert.equal(tierEquivalent('sonnet', 'openai'), 'gpt-6.1-terra');
  assert.equal(tierEquivalent('opus', 'gemini'), 'gemini-3.8-flash');
  assert.equal(tierEquivalent('haiku', 'claude'), 'haiku');
  assert.equal(normalizeModel('nope', 'sonnet', 'openai'), 'gpt-6.1-terra');
});

test('gamme d\'un modèle : par catalogue pour OpenAI et Gemini, comme avant pour Claude', () => {
  assert.equal(modelFamily('gpt-6.1-sol'), 'sol');
  assert.equal(modelFamily('gemini-3.1-flash-lite'), 'flash-lite');
  assert.equal(modelFamily('gemini-3.1-pro-preview'), 'pro');
  assert.equal(modelFamily('claude-opus-4-8'), 'opus');
  assert.equal(modelFamily('opus'), 'opus');
});

test('page Prompts : seuls les onglets de l\'IA connectée', () => {
  const ids = (p) => promptsView({}, {}, p).scopes.map((x) => x.id);
  assert.deepEqual(ids('claude'), ['*', 'haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(ids('openai'), scopesOf('openai'));
  assert.deepEqual(ids('openai'), ['*', 'luna', 'terra', 'sol', 'astra']);
  assert.deepEqual(ids('gemini'), ['*', 'flash-lite', 'flash', 'pro']);
  assert.deepEqual(promptsView({}, {}).scopes.map((x) => x.id), ids('claude'), 'sans fournisseur : Claude');
  for (const t of promptsView({}, {}, 'openai').tasks) assert.deepEqual(Object.keys(t.scopes), ids('openai'));
});

test('les consignes d\'une autre IA restent gardées, masquées, et reviennent', () => {
  const stored = { haiku: { hook: 'Ma consigne Haiku' }, luna: { hook: 'Ma consigne Luna' } };
  const kept = parseCustomPrompts(stored);
  assert.equal(kept.haiku.hook, 'Ma consigne Haiku');
  assert.equal(kept.luna.hook, 'Ma consigne Luna');
  const openai = promptsView(kept, {}, 'openai').tasks.find((t) => t.key === 'hook');
  assert.equal(openai.scopes.luna.text, 'Ma consigne Luna');
  assert.equal(openai.scopes.haiku, undefined, 'l\'onglet Haiku n\'existe pas pour ChatGPT');
  assert.equal(promptsView(kept, {}, 'claude').tasks.find((t) => t.key === 'hook').scopes.haiku.text, 'Ma consigne Haiku');
});

test('une gamme sans variante écrite reçoit la base commune', () => {
  for (const k of Object.keys(PROMPT_DEFS)) {
    for (const f of ['luna', 'terra', 'sol', 'astra', 'flash-lite', 'flash', 'pro']) assert.equal(defaultText(k, f), PROMPT_DEFS[k].text, `${k} / ${f}`);
  }
  assert.ok(PROMPT_SCOPES.includes('luna') && PROMPT_SCOPES.includes('flash-lite'));
});

test('changer d\'IA remet les modèles au défaut et le dit ; rester sur la même IA ne touche à rien', async () => {
  const u = await s.newUser({ admin: false });
  const keys = ['analyze_model', 'prospect_model', 'write_model', 'chat_model'];
  const fill = async () => { for (const k of keys) await setSetting(s.db, u.id, k, 'opus'); };
  await saveLink(s.app, u.id, { mode: 'api_key', secret_enc: 'x', last4: '1234' });
  await fill();
  await saveLink(s.app, u.id, { mode: 'api_key', secret_enc: 'y', last4: '5678' }); // même IA (Claude)
  for (const k of keys) assert.equal(await getSetting(s.db, u.id, k), 'opus', `${k} intact`);
  assert.equal(await getSetting(s.db, u.id, 'ai_switch_json'), null);

  await saveLink(s.app, u.id, { provider: 'openai', mode: 'api_key', secret_enc: 'z', last4: '9999' }); // autre IA
  for (const k of keys) assert.equal(await getSetting(s.db, u.id, k), null, `${k} remis à zéro`);
  const note = JSON.parse(await getSetting(s.db, u.id, 'ai_switch_json'));
  assert.deepEqual([note.from, note.to], ['claude', 'openai']);
  assert.ok(note.at > 0);
});

test('tant qu\'un fournisseur n\'est pas branché, son utilisateur reste traité comme Claude', async () => {
  const u = await s.newUser({ admin: false });
  assert.equal(await userProvider(s.db, u.id), 'claude', 'aucune liaison');
  await saveLink(s.app, u.id, { provider: 'openai', mode: 'api_key', secret_enc: 'z', last4: '9999' });
  assert.equal(await userProvider(s.db, u.id), 'claude', 'fournisseur absent du registre');
  assert.equal(defaultModelOf('inconnu'), catalogOf().default);
});
