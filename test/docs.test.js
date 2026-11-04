// Documentation développeur du site : pages publiques, complétude (routes, outils), exemples fidèles à la vraie API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { setDeveloperMode, createApiToken } from '../src/apitokens.js';
import { API_ENDPOINTS } from '../src/apiv1.js';
import { API_DOCS, GROUPS } from '../src/apidocs.js';
import { TOOLS } from '../mcp/aitools-mcp.js';
import { highlight } from '../src/site/highlight.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
// Texte visible d'une page : balises retirées, entités décodées (le code coloré est découpé en <span>)
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const page = async (p) => (await s.anon.get(p, { headers: { accept: 'text/html' } })).text();

test('coloration : jetons reconnus, tout est échappé, langage inconnu = texte brut', () => {
  const json = highlight('{"a": "<b>x</b>", "n": 12, "ok": true, "z": null}', 'json');
  assert.match(json, /<span class="tk-k">&quot;a&quot;<\/span>/);
  assert.match(json, /<span class="tk-s">&quot;&lt;b&gt;x&lt;\/b&gt;&quot;<\/span>/);
  assert.match(json, /<span class="tk-n">12<\/span>/);
  assert.match(json, /<span class="tk-b">true<\/span>/);
  assert.doesNotMatch(json, /<b>/);
  assert.match(highlight('curl -H "A: b" https://x # note', 'bash'), /tk-k">curl[\s\S]*tk-f">-H[\s\S]*tk-c"># note/);
  assert.equal(highlight('<script>alert(1)</script>', 'inconnu'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.match(highlight('const a = `x${y}`; // c', 'js'), /tk-k">const[\s\S]*tk-s">`x\$\{y\}`[\s\S]*tk-c">\/\/ c/);
  assert.match(highlight('import os\nprint(True)  # ok', 'python'), /tk-k">import[\s\S]*tk-b">True[\s\S]*tk-c"># ok/);
});

test('pages /docs, /docs/api, /docs/mcp : publiques, structurées, dans le sitemap, avec la navigation du site', async () => {
  for (const [path, h1] of [['/docs', 'Documentation développeur'], ['/docs/api', 'Référence de l’API'], ['/docs/mcp', 'Serveur MCP']]) {
    const r = await s.anon.get(path, { headers: { accept: 'text/html' } });
    assert.equal(r.status, 200, path);
    const html = await r.text();
    assert.match(html, new RegExp(`<h1[^>]*>${h1}</h1>`), path);
    assert.match(html, /<details class="toc" open>/, 'sommaire');
    assert.match(html, /href="\/docs" aria-current="page"|href="\/docs\/(api|mcp)" aria-current="page"/);
    assert.match(html, /<a href="\/docs"[^>]*>Docs<\/a>/, 'lien dans la navigation du site');
    assert.match(html, /\/static\/site\.js/);
    assert.doesNotMatch(html, /<script(?![^>]*src=)/i, 'aucun script en ligne (CSP)');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-robots-tag'), null, 'pages indexables');
  }
  const sitemap = await (await s.anon.get('/sitemap.xml')).text();
  for (const p of ['/docs', '/docs/api', '/docs/mcp']) assert.ok(sitemap.includes(`${s.app.cfg.appUrl}${p}`), p);
});

test('démarrage rapide : les trois étapes et les exemples cURL, JavaScript et Python', async () => {
  const html = await page('/docs');
  for (const t of ['Activer le mode développeur', 'Créer un jeton', 'Premier appel']) assert.match(html, new RegExp(t));
  assert.ok(html.includes(`${s.app.cfg.appUrl}/api/v1/me`));
  assert.match(html, /data-label="cURL"[\s\S]*data-label="JavaScript"[\s\S]*data-label="Python"/);
  assert.match(html, /data-copy/);
  assert.match(html, /Authorization: Bearer/);
});

test('référence de l\'API : toutes les routes documentées, avec paramètres, exemples dans trois langages et réponse', async () => {
  const html = await page('/docs/api');
  assert.equal(Object.keys(API_DOCS).length, API_ENDPOINTS.length, 'une fiche de documentation par route, pas une de plus');
  for (const e of API_ENDPOINTS) {
    const key = `${e.method} ${e.path}`;
    const d = API_DOCS[key];
    assert.ok(d, `${key} : fiche manquante`);
    assert.ok(GROUPS.some(([id]) => id === d.group), `${key} : groupe`);
    assert.ok(d.sample?.path && d.response?.json && d.response.status, `${key} : exemples`);
    assert.ok(html.includes(`id="ep-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}"`), `${key} : carte`);
    assert.ok(html.includes(`/api/v1${e.path.replace(/&/g, '&amp;')}`), `${key} : chemin affiché`);
    for (const m of (d.params || []).filter((p) => p[1] === 'path')) assert.ok(e.path.includes(`:${m[0]}`), `${key} : paramètre de chemin ${m[0]}`);
    if (e.scope) assert.ok(['read', 'write', 'jobs'].includes(e.scope));
  }
  for (const t of ['Authentification', 'Droits des jetons', 'Erreurs', 'Limites', 'Bonnes pratiques']) assert.match(html, new RegExp(t));
  for (const c of ['invalid_token', 'insufficient_scope', 'developer_mode_off', 'rate_limited', 'confirmation_required']) assert.ok(html.includes(c), c);
  assert.match(html, /120 requêtes par minute/);
  // exemples de requête : en-tête d'autorisation, corps JSON des POST, jamais un vrai jeton
  const visible = text(html);
  assert.match(visible, /curl -X POST "https:\/\/[^"]+\/api\/v1\/projects\/3\/prospects" \\\n\s+-H "Authorization: Bearer \$AITOOLS_TOKEN" \\\n\s+-H "Content-Type: application\/json" \\\n\s+-d '\{"prospects"/);
  assert.match(visible, /requests\.post\(/);
  assert.match(visible, /method: 'POST'/);
  assert.doesNotMatch(html, /aitk_[A-Za-z0-9_-]{43}/);
});

test('exemples de réponse fidèles : chaque champ documenté existe dans la vraie réponse du serveur', async () => {
  const u = await s.newUser();
  await setDeveloperMode(s.db, u.id, true);
  const { token } = await createApiToken(s.db, u.id, { name: 'doc', scopes: ['read', 'write', 'jobs'] });
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/doc.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'r', proposition_valeur: 'v' }), JSON.stringify({ description: 'd', secteurs: ['s'], zone: 'z' }), pid);
  for (const [i, st] of ['new', 'sent'].entries()) await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(pid, `B${i}`, `b${i}@b.fr`, st, now());
  const x = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, website, city, sector, score, status, sent_at, replied_at, next_action, next_action_at, created_at) VALUES(?, 'A', 'a@a.fr', 'https://a.fr', 'Rennes', 's', 8, 'replied', ?, ?, 'Rappeler', ?, ?)").run(pid, now(), now(), now(), now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, variant) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, x, 'a@a.fr', now(), 'initial', 'Objet', 'A');
  await s.db.prepare("INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, 'n', ?)").run(x, now());
  const rep = Number((await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, 1, 'a@a.fr', 'Re', 'ok', 'interested', ?)").run(pid, x, now())).lastInsertRowid);
  const jobId = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, progress_json, created_at, finished_at) VALUES(?, ?, 'prospect', 'done', '{\"found\":12,\"requested\":12}', '{\"message\":\"Terminé\",\"pct\":100}', ?, ?)").run(u.id, pid, now(), now())).lastInsertRowid);

  const missing = (doc, real, path = '') => {
    if (Array.isArray(doc)) return doc.length && Array.isArray(real) && real.length ? missing(doc[0], real[0], `${path}[0]`) : (doc.length && !(real?.length) ? [`${path} : tableau vide dans la vraie réponse`] : []);
    if (doc && typeof doc === 'object') return Object.keys(doc).flatMap((k) => (real && typeof real === 'object' && k in real ? missing(doc[k], real[k], `${path}.${k}`) : [`${path}.${k}`]));
    return [];
  };
  for (const e of API_ENDPOINTS) {
    const d = API_DOCS[`${e.method} ${e.path}`];
    const path = e.path.replace(':id', String(e.path.startsWith('/projects') ? pid : e.path.startsWith('/prospects') ? x : e.path.startsWith('/replies') ? rep : jobId));
    const query = d.sample.query ? `?${new URLSearchParams(Object.entries(d.sample.query).map(([k, v]) => [k, String(v)]))}` : '';
    // les exemples de requête sont rejoués tels quels (seul l'identifiant est celui des données de test)
    const body = d.sample.body && Object.keys(d.sample.body).length ? d.sample.body : (e.method === 'POST' ? {} : undefined);
    if (e.path === '/projects/:id/jobs' && body.type === 'prospect') body.count = 1;
    const r = await fetch(`${s.base}/api/v1${path}${path === '/replies' ? '' : query}`, {
      method: e.method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, d.response.status, `${e.method} ${e.path} : statut documenté`);
    const real = await r.json();
    assert.deepEqual(missing(d.response.json, real), [], `${e.method} ${e.path} : champs documentés absents de la vraie réponse`);
  }
});

test('serveur MCP : chaque outil est documenté avec son droit et ses paramètres', async () => {
  const html = await page('/docs/mcp');
  for (const t of TOOLS) {
    assert.ok(html.includes(`<code>${t.name}</code>`), `outil ${t.name}`);
    for (const k of Object.keys(t.props || {})) assert.ok(html.includes(`<code>${k}</code>`), `${t.name} : paramètre ${k}`);
  }
  for (const w of ['claude mcp add aitools', 'claude_desktop_config.json', 'AITOOLS_READONLY', 'Node.js 22', 'confirm: true', '-e AITOOLS_TOKEN=aitk_…']) assert.ok(text(html).includes(w), w);
  assert.match(html, /href="\/developer\/mcp\.js"/);
  assert.match(html, /Contenus de tiers/);
});

test('les anciens fichiers Markdown renvoient vers le site (une seule source de vérité)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [f, url] of [['docs/API.md', '/docs/api'], ['docs/MCP.md', '/docs/mcp']]) {
    const txt = readFileSync(f, 'utf8');
    assert.ok(txt.includes(url), f);
    assert.ok(txt.length < 1500, `${f} : un simple renvoi, pas une copie qui dériverait`);
  }
});
