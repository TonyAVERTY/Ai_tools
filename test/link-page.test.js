import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../src/crypto.js';
import { AI_CARDS } from '../src/linkviews.js';
import { availableProviders } from '../src/services/providers/availability.js';
import { SPRITE } from '../src/icons.js';
import { startApp } from './helpers/server.js';

// Page « Relier mon IA » : trois cartes avec le logo de chaque IA, un clic ouvre les options de connexion de l'IA choisie, l'IA reliée est signalée,
// une IA dont l'outil manque sur le serveur est grisée, et jamais un secret dans la page.
let s;
const BIN = process.execPath; // un exécutable qui existe, pour que les cartes ChatGPT et Gemini soient proposées
before(async () => { s = await startApp({ cfg: { codexBin: BIN, geminiBin: BIN } }); });
after(async () => { await s.close(); });

const page = async (u, path = '/link') => (await u.get(path, { headers: { accept: 'text/html' } })).text();
const panelOf = (html, id) => new RegExp(`<div class="ai-panel" id="ai-panel-${id}" data-ai-panel="${id}"[^>]*?(hidden)?>`).exec(html);
const visible = (html, id) => { const m = panelOf(html, id); return !!m && !m[1]; };

test('trois cartes, dans l\'ordre Claude, ChatGPT, Gemini, chacune avec son logo et son fournisseur', async () => {
  const u = await s.newUser({ admin: false });
  const html = await page(u);
  const hrefs = [...html.matchAll(/data-ai-card="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['claude', 'openai', 'gemini']);
  assert.deepEqual(AI_CARDS.map((c) => c.name), ['Claude', 'ChatGPT', 'Gemini']);
  for (const [id, name, company] of [['claude', 'Claude', 'Anthropic'], ['openai', 'ChatGPT', 'OpenAI'], ['gemini', 'Gemini', 'Google']]) {
    assert.match(html, new RegExp(`data-ai-card="${id}"[^>]*>[^]*?href="#i-${id}"[^]*?<b>${name}</b><small>${company}</small>`), `${name} : logo, nom, fournisseur`);
    assert.ok(SPRITE.includes(`id="i-${id}"`), `${name} : le logo existe dans le sprite de la page`);
  }
  assert.match(html, /<h1 class="h1">Relier mon IA<\/h1>/);
  assert.match(html, /<title>Relier mon IA · AiTools<\/title>/);
});

test('rien n\'est ouvert tant qu\'on n\'a pas cliqué ; ?ia= ouvre les options de cette IA seulement', async () => {
  const u = await s.newUser({ admin: false });
  const none = await page(u);
  for (const id of ['claude', 'openai', 'gemini']) assert.equal(visible(none, id), false, `${id} fermée`);
  assert.match(none, /Clique sur une IA pour voir comment t'y connecter|Clique sur une IA pour voir comment t&#39;y connecter/);
  for (const id of ['claude', 'openai', 'gemini']) {
    const h = await page(u, `/link?ia=${id}`);
    for (const other of ['claude', 'openai', 'gemini']) assert.equal(visible(h, other), other === id, `?ia=${id} : ${other}`);
    assert.match(h, new RegExp(`data-ai-card="${id}"[^>]*aria-pressed="true"`));
    assert.doesNotMatch(h, /ai-pick/);
  }
  const evil = await page(u, '/link?ia=<script>alert(1)</script>&e=<img src=x>');
  assert.doesNotMatch(evil, /<script>alert|<img src=x>/, 'ni l\'IA ni le message ne sont injectables');
  for (const id of ['claude', 'openai', 'gemini']) assert.equal(visible(evil, id), false);
});

test('Claude : clé API Anthropic, puis abonnement avec le risque annoncé', async () => {
  const h = await page(await s.newUser({ admin: false }), '/link?ia=claude');
  assert.match(h, /<h2 id="h-key">Clé API Anthropic<\/h2>/);
  assert.match(h, /name="provider" value="claude"/);
  assert.match(h, /placeholder="sk-ant-…"/);
  assert.match(h, /<h2 id="h-alt">Avec ton abonnement Claude \(Pro, Max\)<\/h2>/);
});

test('ChatGPT : clé API OpenAI, connexion guidée avec son avertissement, fichier collé', async () => {
  const h = (await page(await s.newUser({ admin: false }), '/link?ia=openai')).replace(/&#39;/g, "'");
  assert.match(h, /<h2 id="h-key-openai">Clé API OpenAI<\/h2>/);
  assert.match(h, /name="provider" value="openai"/);
  assert.match(h, /<h2 id="h-alt-openai">Avec ton compte ChatGPT \(Plus, Pro, Business\)<\/h2><span class="badge warn">[^]*?Risque pour ton compte/);
  assert.match(h, /<h3>Se connecter avec ChatGPT<\/h3>[^]*?data-open-dialog="chatgpt-dialog"/);
  assert.match(h, /<h3>Fichier de connexion collé<\/h3>[^]*?action="\/link\/chatgpt\/auth"[^]*?<textarea name="authJson"/);
  assert.match(h, /<dialog[^>]*id="chatgpt-dialog"/);
  assert.match(h, /contrevenir aux conditions d'utilisation d'OpenAI/);
  assert.match(h, /Tes tâches passent l'une après l'autre/);
  assert.match(h, /data-chatgpt-login data-consent-form/);
  assert.match(h, /data-chatgpt-code/);
  assert.match(h, /connexion par code d'appareil/);
});

test('Gemini : clé API seulement, pourquoi, et l\'avertissement sur la clé gratuite toujours affiché', async () => {
  const h = (await page(await s.newUser({ admin: false }), '/link?ia=gemini')).replace(/&#39;/g, "'");
  assert.match(h, /<h2 id="h-key-gemini">Clé API Google AI Studio<\/h2>/);
  assert.match(h, /name="provider" value="gemini"/);
  assert.match(h, /Google ne permet plus de se connecter avec un compte/);
  assert.match(h, /Une clé gratuite suffit pour essayer/);
  assert.match(h, /Avec une clé gratuite, Google peut utiliser les données envoyées pour améliorer ses produits, et des personnes peuvent les relire/);
  assert.match(h, /N'y mets pas de données de prospects/);
  assert.match(h, /active la facturation/);
  assert.doesNotMatch(h, /data-open-dialog="[^"]*"[^>]*>[^<]*Gemini/, 'pas de connexion par compte pour Gemini');
});

test('l\'IA reliée est signalée « Connectée », ouverte d\'office, et le texte dit ce qui change si on en choisit une autre', async () => {
  const u = await s.newUser({ admin: false, link: { v: 1, provider: 'gemini', mode: 'api_key', valid: true, last4: 'WXYZ', secret_enc: encrypt(s.app.cfg.secretKey, `AIzaSy${'A'.repeat(33)}`) } });
  const h = (await page(u)).replace(/&#39;/g, "'");
  assert.match(h, /data-ai-card="gemini"[^>]*>[^]*?Connectée/);
  assert.equal(visible(h, 'gemini'), true, 'son IA est ouverte d\'office');
  assert.match(h, /Ton IA actuelle : <strong>Gemini<\/strong> · Clé API Google AI Studio/);
  assert.match(h, /tes choix de modèle repartent du modèle par défaut de la nouvelle IA ; tes consignes personnalisées sont gardées/);
  assert.doesNotMatch(h, /AIzaSy|WXYZ/, 'jamais le secret ni sa fin dans cette page');
  assert.doesNotMatch(h, /data-nolink/, 'liaison valide : les relevés continuent');
});

test('une IA dont l\'outil manque sur le serveur est grisée, sans options, et ?ia= ne l\'ouvre pas', async () => {
  const off = await startApp({ cfg: { codexBin: '/nulle/part/codex', geminiBin: BIN } });
  try {
    const u = await off.newUser({ admin: false });
    const h = await (await u.get('/link?ia=openai', { headers: { accept: 'text/html' } })).text();
    assert.match(h, /<div class="ai-card" aria-disabled="true">[^]*?<b>ChatGPT<\/b>[^]*?Pas encore disponible sur ce serveur/);
    for (const gone of [/id="ai-panel-openai"/, /id="chatgpt-dialog"/, /h-key-openai/]) assert.doesNotMatch(h, gone, `${gone} absent quand Codex manque`);
    assert.match(h, /data-ai-card="claude"/);
    assert.match(h, /data-ai-card="gemini"/);
  } finally { await off.close(); }
  assert.deepEqual(availableProviders({ codexBin: '/nulle/part/codex', geminiBin: BIN }), { claude: true, openai: false, gemini: true });
  assert.deepEqual(availableProviders({ codexBin: 'codex', geminiBin: 'gemini' }, { resolveBin: (b) => (b === 'gemini' ? '/usr/bin/gemini' : null) }), { claude: true, openai: false, gemini: true });
});

test('abonnement désactivé sur le service : seules les clés API sont proposées, rien ne parle d\'abonnement ni de compte', async () => {
  const off = await startApp({ cfg: { codexBin: BIN, geminiBin: BIN, cliModeEnabled: false } });
  try {
    const u = await off.newUser({ admin: false });
    const h = await (await u.get('/link?ia=openai', { headers: { accept: 'text/html' } })).text();
    assert.doesNotMatch(h, /consent-dialog|chatgpt-dialog|setup-token|abonnement|compte ChatGPT|auth\.json/);
    assert.match(h, /data-ai-card="openai"[^>]*>[^]*?<span class="ai-how">Clé API<\/span>/);
    assert.match(h, /id="h-key-openai"/);
  } finally { await off.close(); }
});

test('une erreur de clé revient sur la page avec les options de l\'IA concernée ouvertes', async () => {
  const u = await s.newUser({ admin: false });
  for (const provider of ['gemini', 'openai', 'claude']) {
    const r = await fetch(`${s.base}/link/api-key`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ provider, apiKey: 'pas une clé' }).toString(),
    });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), new RegExp(`^/link\\?ia=${provider}&e=`));
  }
  const r = await fetch(`${s.base}/link/chatgpt/auth`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ authJson: '{}', accept: 'on' }).toString(),
  });
  assert.match(r.headers.get('location'), /^\/link\?ia=openai&e=/);
});
