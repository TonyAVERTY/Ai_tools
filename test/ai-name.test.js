import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../src/crypto.js';
import { setSetting } from '../src/db.js';
import { Worker } from '../src/services/jobs.js';
import { aiName, withAiName, forAi, DEFAULT_AI_NAME } from '../src/services/ainame.js';
import { saveLink } from '../src/claudelink.js';
import { startApp } from './helpers/server.js';

// Le nom de l'IA de l'utilisateur (Claude, ChatGPT, Gemini) dans les pages, les réglages et les messages de tâches.
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const html = async (u, path) => (await u.get(path, { headers: { accept: 'text/html' } })).text();
const linked = (provider, mode = 'api_key') => ({ v: 1, provider, mode, valid: true, last4: 'WXYZ', linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, `AIzaSy${'A'.repeat(33)}`) });

test('forAi : « Claude » devient le nom de l\'IA, mot entier seulement, « Claude Code » jamais', () => {
  assert.equal(forAi('Claude rédige trois exemples de devis…', 'Gemini'), 'Gemini rédige trois exemples de devis…');
  assert.equal(forAi('Analyse du code par Claude · Claude n\'a pas produit de post', 'ChatGPT'), 'Analyse du code par ChatGPT · ChatGPT n\'a pas produit de post');
  assert.equal(forAi('Claude Code a répondu', 'Gemini'), 'Claude Code a répondu', 'le nom d\'un logiciel');
  assert.equal(forAi('ClaudeX et SuperClaude', 'Gemini'), 'ClaudeX et SuperClaude', 'mot entier');
  assert.equal(forAi('Claude rédige', 'Claude'), 'Claude rédige', 'aucun effet pour un utilisateur de Claude');
  assert.equal(forAi('Claude rédige', undefined), 'Claude rédige');
  assert.equal(forAi(null, 'Gemini'), '');
});

test('aiName : propre à la requête, « Claude » hors requête, jamais mélangé entre deux requêtes en parallèle', async () => {
  assert.equal(aiName(), DEFAULT_AI_NAME);
  const seen = await Promise.all(['Gemini', 'ChatGPT', 'Claude', null].map((n) => withAiName(n, async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    return aiName();
  })));
  assert.deepEqual(seen, ['Gemini', 'ChatGPT', 'Claude', 'Claude']);
  assert.equal(aiName(), DEFAULT_AI_NAME, 'rien ne fuit après la requête');
});

test('tableau de bord : le nom de l\'IA de l\'utilisateur, dans le menu, les sections et la page', async () => {
  const g = await s.newUser({ admin: false, link: linked('gemini') });
  const c = await s.newUser({ admin: false, link: linked('claude') });
  const gp = await html(g, '/projets');
  assert.match(gp, /<body class="app" data-ai="Gemini">/);
  assert.match(gp, /<span class="pop-t">Gemini<small>Discute avec ton Gemini<\/small><\/span>/, 'menu Assistant');
  assert.match(gp, /aria-label="Assistant : discuter avec Gemini ou demander de l'aide sur iaboss"/);
  assert.match(gp, /Consommation Gemini/);
  assert.doesNotMatch(gp.replace(/<script[^]*?<\/script>/g, ''), /Discute avec ton Claude|Consommation Claude/, 'aucun Claude là où c\'est l\'IA de la personne');
  const cp = await html(c, '/projets');
  assert.match(cp, /data-ai="Claude"/);
  assert.match(cp, /Discute avec ton Claude/);
  assert.match(cp, /Consommation Claude/);
  assert.match(await html(await s.newUser({ admin: false, link: linked('openai') }), '/'), /Discute avec ton ChatGPT/);
});

test('sections d\'un projet : « Gemini cherche des entreprises… », « Gemini écrit des posts », « Gemini conçoit une vidéo »', async () => {
  const g = await s.newUser({ admin: false, link: linked('gemini') });
  await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at) VALUES(?, 'P', 'https://git.test/p.git', '{}', '{}', 1, 1)`).run(g.id);
  const page = await html(g, '/projets');
  assert.match(page, /Gemini cherche des entreprises qui collent à la cible/);
  assert.match(page, /Relie un compte, Gemini écrit des posts, tu relis et publies/);
  assert.match(page, /Gemini conçoit une vidéo de design motion/);
  assert.match(page, /Gemini lit le dépôt \(sans rien modifier\)/);
  assert.doesNotMatch(page, /Claude cherche|Claude écrit|Claude conçoit|Claude lit/);
});

test('Mon compte : « Mon IA », l\'IA, son fournisseur, les limites propres à Claude seulement', async () => {
  const g = await s.newUser({ admin: false, link: linked('gemini') });
  const a = (await html(g, '/account')).replace(/&#39;/g, "'");
  assert.match(a, /<h2>Mon IA<\/h2>/);
  assert.match(a, /Ton accès à Gemini est facturé à part, par Google\./);
  assert.match(a, /<dt>IA<\/dt><dd>Gemini<\/dd>/);
  assert.match(a, /href="\/link">Changer d'IA<\/a>/);
  assert.match(a, /<dd>…WXYZ<\/dd>/, 'clé : seulement les 4 derniers caractères, sans le préfixe d\'Anthropic');
  assert.doesNotMatch(a, /sk-ant-|Session de 5 h|Semaine de 7 jours|Anthropic/, 'rien de propre à Claude');
  assert.match(a, /Avec une clé API, Google facture ce que tu consommes, à l'usage\./);
  const cg = await s.newUser({ admin: false, link: linked('openai', 'chatgpt_account') });
  const cgPage = (await html(cg, '/account')).replace(/&#39;/g, "'");
  assert.match(cgPage, /Limites d'utilisation<\/h3><p class="hint">Réponse inattendue du relevé en direct\./, 'compte ChatGPT : ses limites sont relevées chez OpenAI (accès factice : réponse inexploitable, dite honnêtement)');
  assert.doesNotMatch(cgPage, /Anthropic|Session de 5 h/, 'rien de propre à Claude');
  assert.match((await html(await s.newUser({ admin: false, link: linked('gemini', 'subscription_token') }), '/account')).replace(/&#39;/g, "'"), /Avec ton compte Gemini, les limites de ton abonnement s'appliquent\. iaboss ne les mesure pas\./, 'Gemini : non mesurées');
  const c = (await html(await s.newUser({ admin: false, link: linked('claude') }), '/account')).replace(/&#39;/g, "'");
  assert.match(c, /Ton accès à Claude est facturé à part, par Anthropic\./);
  assert.match(c, /<dd>sk-ant-…WXYZ<\/dd>/);
  const none = await html(await s.newUser({ admin: false }), '/account');
  assert.match(none, /Relier mon IA/);
});

test('Réglages : budget, modèles et prompts parlent de l\'IA de l\'utilisateur, avec SES modèles', async () => {
  const g = (await html(await s.newUser({ admin: false, link: linked('gemini') }), '/settings')).replace(/&#39;/g, "'");
  assert.match(g, /Gemini 3\.5 Flash-Lite suffit pour la plupart des projets : passe à Gemini 3\.6 Flash ou Gemini 3\.8 Flash/);
  assert.match(g, /Les consignes que Gemini reçoit pour chaque tâche/);
  assert.match(g, /chaque job est facturé par Google : le coût est estimé d'après les jetons utilisés/);
  assert.doesNotMatch(g, /Haiku suffit|Sonnet ou Opus|quota Claude|Anthropic/, 'aucun modèle ni quota de Claude');
  const o = (await html(await s.newUser({ admin: false, link: linked('openai', 'chatgpt_account') }), '/settings')).replace(/&#39;/g, "'");
  assert.match(o, /Avec ton compte ChatGPT rien n'est facturé en plus par iaboss : les limites de ton abonnement s'appliquent/);
  const c = (await html(await s.newUser({ admin: false, link: linked('claude') }), '/settings')).replace(/&#39;/g, "'");
  assert.match(c, /Haiku suffit pour la plupart des projets : passe à Sonnet ou Opus/);
  assert.match(c, /Les consignes que Claude reçoit pour chaque tâche/);
});

test('Réglages : le changement d\'IA est dit, avec les noms des deux IA', async () => {
  const u = await s.newUser({ admin: false });
  await saveLink(s.app, u.id, { mode: 'api_key', secret_enc: 'x', last4: '1234' });
  assert.doesNotMatch(await html(u, '/settings'), /Tu es passé de/);
  await saveLink(s.app, u.id, { provider: 'gemini', mode: 'api_key', secret_enc: encrypt(s.app.cfg.secretKey, 'k'.repeat(30)), last4: '5678' });
  const page = (await html(u, '/settings')).replace(/&#39;/g, "'");
  assert.match(page, /Tu es passé de Claude à Gemini le .+? : tes choix de modèle sont repartis du modèle par défaut de Gemini\. Tes consignes personnalisées de Claude sont gardées, et reviennent si tu y retournes\./);
  await setSetting(s.db, u.id, 'ai_switch_json', JSON.stringify({ from: 'inconnue', to: 'gemini', at: 1 }));
  assert.doesNotMatch(await html(u, '/settings'), /Tu es passé de/, 'une IA inconnue n\'affiche rien');
});

test('messages de tâches : avancement, journal et erreur parlent de l\'IA du propriétaire du job', async () => {
  const g = await s.newUser({ admin: false, link: linked('gemini') });
  const c = await s.newUser({ admin: false, link: linked('claude') });
  const ins = async (u, type) => Number((await s.db.prepare("INSERT INTO jobs(user_id,type,status,created_at) VALUES(?,?,'running',?)").run(u.id, type, 1)).lastInsertRowid);
  const handlers = {
    say: async (ctx) => { await ctx.progress({ message: 'Claude rédige trois exemples de devis…', pct: 8 }); ctx.log('turn', 'Claude · étape 2'); return { ok: true }; },
    boom: async () => { throw new Error("Claude n'a pas produit de post exploitable : réessaie"); },
  };
  const run = async (u, type) => {
    const id = await ins(u, type);
    await new Worker(s.db, handlers, { log: { error() {} } }).runJob(await s.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
    return { id, row: await s.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id), log: await (await u.get(`/api/jobs/${id}/log`)).json() };
  };
  const a = await run(g, 'say');
  assert.equal(JSON.parse(a.row.progress_json).message, 'Gemini rédige trois exemples de devis…');
  assert.ok(a.log.entries.some((e) => e.text === 'Gemini rédige trois exemples de devis…'));
  assert.ok(a.log.entries.some((e) => e.text === 'Gemini · étape 2'));
  assert.ok(!JSON.stringify(a.log).includes('Claude'), 'plus aucun « Claude » dans le journal d\'un utilisateur de Gemini');
  const b = await run(g, 'boom');
  assert.equal(b.row.error, "Gemini n'a pas produit de post exploitable : réessaie");
  assert.ok(b.log.entries.some((e) => e.kind === 'error' && /^Gemini n'a pas produit/.test(e.text)));
  const d = await run(c, 'say');
  assert.equal(JSON.parse(d.row.progress_json).message, 'Claude rédige trois exemples de devis…', 'pour un utilisateur de Claude, rien ne change');
  assert.equal((await run(c, 'boom')).row.error, "Claude n'a pas produit de post exploitable : réessaie");
});

test('page IA : titre, saisie, avertissement et sélecteur de modèle parlent de l\'IA de l\'utilisateur', async () => {
  const g = (await html(await s.newUser({ admin: false, link: linked('gemini') }), '/chat')).replace(/&#39;/g, "'");
  assert.match(g, /<h2>Discute avec Gemini<\/h2>/);
  assert.match(g, /aria-label="Conversation avec Gemini"/);
  assert.match(g, /aria-label="Modèle Gemini"/);
  assert.match(g, /placeholder="Écris à Gemini…/);
  assert.match(g, /Chaque message est envoyé à Gemini avec ton propre compte\./);
  assert.match(g, /Gemini ne voit que cette conversation/);
  assert.doesNotMatch(g, /Claude/, 'aucun Claude sur la page IA d\'un utilisateur de Gemini');
  const c = await html(await s.newUser({ admin: false, link: linked('claude') }), '/chat');
  assert.match(c, /<h2>Discute avec Claude<\/h2>/);
  assert.match(c, /aria-label="Modèle Claude"/);
  const sup = (await html(await s.newUser({ admin: false, link: linked('openai', 'chatgpt_account') }), '/support')).replace(/&#39;/g, "'");
  assert.match(sup, /ChatGPT lit la documentation d'iaboss pour te répondre/);
});

test('navigateur : <body data-ai> est lu par AiTools.aiName(), et plus aucun « Claude » en dur dans les textes de l\'IA de la personne', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /function aiName\(\) \{ return document\.body\?\.dataset\.ai \|\| 'Claude'; \}/);
  assert.match(app, /sentence, aiName \}\);/, 'exposé aux fichiers app-*.js');
  assert.match(app, /\$\{ai\} est déconnecté/);
  assert.match(app, /La scène écrite par \.\+\? ne passe pas au rendu/, 'le message d\'erreur du serveur porte le nom de l\'IA');
  for (const f of ['app-linkedin.js', 'app-promo.js', 'app-prospects.js', 'chat.js']) {
    const src = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(src, /Claude/, `${f} : le nom vient de aiName()`);
  }
});

test('Facturation, profil, console, mise en route et équipe : le nom de l\'IA de l\'utilisateur, jamais « Claude » pour un utilisateur de Gemini', async () => {
  const g = await s.newUser({ admin: false, link: linked('gemini') });
  const c = await s.newUser({ admin: false, link: linked('claude') });
  const clean = (t) => t.replace(/<script[^]*?<\/script>/g, '').replace(/&#39;/g, "'");
  const billing = clean(await html(g, '/facturation'));
  assert.match(billing, /Gemini/);
  assert.doesNotMatch(billing, /Claude/, 'Facturation');
  const welcome = clean(await html(g, '/welcome'));
  assert.match(welcome, /pour que Gemini s'adapte à toi/);
  assert.doesNotMatch(welcome, /Claude/, 'questionnaire de profil');
  assert.match(clean(await html(c, '/welcome')), /pour que Claude s'adapte à toi/);
  const ins = await s.db.prepare("INSERT INTO jobs(user_id,type,status,created_at) VALUES(?,?,'running',?)").run(g.id, 'x', 1);
  const consolePage = clean(await html(g, `/jobs/${Number(ins.lastInsertRowid)}`));
  assert.match(consolePage, /<h1 data-console-title>Gemini au travail<\/h1>/);
  assert.doesNotMatch(consolePage, /Claude/, 'console de tâche');
  const team = clean(await html(g, '/team'));
  assert.doesNotMatch(team, /Claude/, 'équipe');
});
