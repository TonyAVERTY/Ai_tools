// Documentation développeur du site public : /docs (démarrage rapide), /docs/api (référence), /docs/mcp (serveur MCP).
// Tout vient des mêmes données que le code : API_ENDPOINTS + API_DOCS pour l'API, TOOLS pour le MCP. Un test vérifie qu'aucune route ni
// aucun outil ne manque, et que chaque exemple de réponse a les mêmes champs que la vraie réponse du serveur.
import { esc } from '../http.js';
import { siteLayout, ic } from './layout.js';
import { highlight } from './highlight.js';
import { API_ENDPOINTS } from '../apiv1.js';
import { API_DOCS, GROUPS } from '../apidocs.js';
import { SCOPES } from '../apitokens.js';
import { TOOLS } from '../../mcp/iaboss-mcp.js';

const UPDATED = '23 octobre 2026';
const DOC_PAGES = [['/docs', 'Démarrage'], ['/docs/api', 'API'], ['/docs/mcp', 'Serveur MCP']];

// Texte avec `code` et **gras** (le texte des descriptions est écrit ici, jamais saisi par un utilisateur) : échappé puis mis en forme
const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// ---------- Briques ----------

/** Bloc de code avec coloration et bouton « Copier » (site.js). */
export function codeBlock(code, lang, label = '') {
  return `<div class="code"><div class="code-h"><span>${esc(label || lang)}</span><button type="button" class="code-copy" data-copy>${ic('copy')}<span>Copier</span></button></div><pre tabindex="0"><code>${highlight(code, lang)}</code></pre></div>`;
}

/** Onglets de code : sans JavaScript, tous les blocs sont affichés à la suite. */
function codeTabs(blocks) {
  return `<div class="ctabs" data-ctabs>${blocks.map(([label, code, lang]) => `<div class="ctab" data-label="${esc(label)}">${codeBlock(code, lang, label)}</div>`).join('')}</div>`;
}

const slug = (key) => `ep-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const METHOD_CLASS = { GET: 'm-get', POST: 'm-post' };

/** URL d'exemple : `/projects/:id` (id déjà remplacé dans sample.path) + query. */
function exampleUrl(base, sample) {
  const q = sample.query ? `?${new URLSearchParams(Object.entries(sample.query).map(([k, v]) => [k, String(v)]))}` : '';
  return `${base}/api/v1${sample.path}${q}`;
}

function curlExample(method, url, body) {
  const lines = [`curl ${method === 'GET' ? '' : '-X POST '}"${url}" \\`, '  -H "Authorization: Bearer $IABOSS_TOKEN"'];
  if (body) { lines[1] += ' \\'; lines.push('  -H "Content-Type: application/json" \\', `  -d '${JSON.stringify(body)}'`); }
  return lines.join('\n');
}

function jsExample(method, url, body) {
  const opts = [`  method: '${method}',`, "  headers: {", "    Authorization: `Bearer ${process.env.IABOSS_TOKEN}`,", ...(body ? ["    'Content-Type': 'application/json',"] : []), '  },', ...(body ? [`  body: JSON.stringify(${JSON.stringify(body)}),`] : [])];
  return method === 'GET'
    ? `const res = await fetch("${url}", {\n  headers: { Authorization: \`Bearer \${process.env.IABOSS_TOKEN}\` },\n});\nconst data = await res.json();`
    : `const res = await fetch("${url}", {\n${opts.join('\n')}\n});\nconst data = await res.json();`;
}

function pyExample(method, url, body) {
  const [u, qs] = url.split('?');
  const params = qs ? `, params=${JSON.stringify(Object.fromEntries(new URLSearchParams(qs)))}` : '';
  return ['import os, requests', '', `r = requests.${method.toLowerCase()}(`, `    "${u}",`, '    headers={"Authorization": f"Bearer {os.environ[\'IABOSS_TOKEN\']}"}' + (body ? ',' : params ? ',' : ''), ...(body ? [`    json=${JSON.stringify(body)},`] : params ? [`    ${params.slice(2)},`] : []), ')', 'data = r.json()'].join('\n');
}

const params = (list) => `<div class="tw"><table><thead><tr><th>Paramètre</th><th>Où</th><th>Type</th><th>Description</th></tr></thead><tbody>${list.map(([name, where, type, required, desc]) => `<tr><td><code>${esc(name)}</code>${required ? ' <span class="req">requis</span>' : ''}</td><td>${esc(where)}</td><td>${inline(type)}</td><td>${inline(desc)}</td></tr>`).join('')}</tbody></table></div>`;

function endpoint(e, base) {
  const key = `${e.method} ${e.path}`;
  const d = API_DOCS[key];
  const sample = d.sample;
  const url = exampleUrl(base, sample);
  const scope = e.scope ? `<span class="scope" title="Droit requis">${esc(e.scope)}</span>` : '<span class="scope none">aucun droit</span>';
  return `<section class="ep" id="${slug(key)}">
  <h3 class="ep-h"><span class="m ${METHOD_CLASS[e.method]}">${e.method}</span><code class="ep-p">/api/v1${esc(e.path)}</code>${scope}</h3>
  <p class="ep-t"><strong>${esc(d.title)}.</strong> ${inline(e.summary)}</p>
  ${d.params ? params(d.params) : ''}
  ${d.notes ? `<p>${inline(d.notes)}</p>` : ''}
  ${codeTabs([['cURL', curlExample(e.method, url, sample.body), 'bash'], ['JavaScript', jsExample(e.method, url, sample.body), 'js'], ['Python', pyExample(e.method, url, sample.body), 'python']])}
  <div class="resp"><span class="status s-${String(d.response.status)[0]}">${d.response.status}</span> Réponse</div>
  ${codeBlock(JSON.stringify(d.response.json, null, 2), 'json', 'JSON')}
  ${d.fields ? `<dl class="fields">${d.fields.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${inline(v)}</dd>`).join('')}</dl>` : ''}
  ${d.errors ? `<p class="errs"><strong>Erreurs propres à cette route :</strong> ${d.errors.map(([s, t]) => `<span class="status s-4">${s}</span> ${inline(t)}`).join(' &nbsp; ')}</p>` : ''}
</section>`;
}

// ---------- Gabarit de page ----------

function docPage({ appUrl, path, title, description, h1, lead, sections }) {
  const toc = sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a>${s.sub?.length ? `<ol>${s.sub.map(([id, label]) => `<li><a href="#${id}">${esc(label)}</a></li>`).join('')}</ol>` : ''}</li>`).join('\n        ');
  const body = sections.map((s) => `<section id="${s.id}" class="doc-s"><h2>${esc(s.title)}</h2>\n${s.html}</section>`).join('\n\n');
  return siteLayout({
    appUrl, path, title, description,
    body: `<div class="wrap">
  <div class="lg-head">
    <nav class="pills" aria-label="Documentation">
      ${DOC_PAGES.map(([href, label]) => `<a class="pill" href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
    </nav>
    <h1 class="h1">${esc(h1)}</h1>
    <p class="maj">Dernière mise à jour : ${UPDATED}</p>
    <p class="lg-intro">${lead}</p>
  </div>
  <div class="lg-body doc-body">
    <details class="toc" open>
      <summary>Sur cette page${ic('chev')}</summary>
      <nav aria-label="Sommaire">
        <ol>
        ${toc}
        </ol>
      </nav>
    </details>
    <article class="art doc">
${body}
    </article>
  </div>
</div>`,
    scripts: [],
  });
}

const callout = (title, text) => `<div class="call"><b>${esc(title)}</b>${text}</div>`;

// ---------- /docs : démarrage ----------

export function docsHomePage({ appUrl }) {
  const base = appUrl;
  const first = [
    ['cURL', `curl "${base}/api/v1/me" \\\n  -H "Authorization: Bearer $IABOSS_TOKEN"`, 'bash'],
    ['JavaScript', `const res = await fetch("${base}/api/v1/me", {\n  headers: { Authorization: \`Bearer \${process.env.IABOSS_TOKEN}\` },\n});\nconsole.log(await res.json());`, 'js'],
    ['Python', `import os, requests\n\nr = requests.get(\n    "${base}/api/v1/me",\n    headers={"Authorization": f"Bearer {os.environ['IABOSS_TOKEN']}"},\n)\nprint(r.json())`, 'python'],
  ];
  return docPage({
    appUrl, path: '/docs', title: 'Documentation développeur : API et MCP · iaboss', description: "Pilote iaboss depuis tes scripts ou depuis Claude : démarrage rapide, API REST et serveur MCP.", h1: 'Documentation développeur',
    lead: "Pilote ton panel iaboss depuis tes scripts, tes outils d'automatisation ou directement depuis Claude. Une API REST en JSON, un serveur MCP, et les mêmes règles que dans le panel.",
    sections: [
      { id: 'apercu', title: 'Vue d’ensemble', html: `<div class="doc-cards">
        <a class="doc-card" href="/docs/api">${ic('link')}<strong>API REST</strong><span>Projets, prospects, réponses, mails et tâches, en JSON, avec un jeton.</span></a>
        <a class="doc-card" href="/docs/mcp">${ic('spark')}<strong>Serveur MCP</strong><span>Relie Claude à ton panel : il lit, classe et agit avec les droits que tu lui donnes.</span></a>
      </div>
      <p>L'API et le serveur MCP sont <strong>réservés au mode développeur</strong> : sans lui, aucun jeton ne fonctionne. Un jeton ne donne accès qu'à <strong>ton</strong> compte (et aux projets que ton équipe partage), avec les droits que tu coches, et il se supprime d'un clic.</p>` },
      { id: 'demarrage', title: 'Démarrage rapide', sub: [['etape-1', 'Activer le mode développeur'], ['etape-2', 'Créer un jeton'], ['etape-3', 'Premier appel']], html: `
        <h3 id="etape-1">1. Activer le mode développeur</h3>
        <p>Dans le panel : <strong>Mon compte</strong> → <em>Mode développeur</em> → <strong>Activer</strong>. Les adresses de l'API et du serveur MCP s'affichent ensuite à cet endroit, ainsi que sur la page <a href="/developer">Développeur</a>.</p>
        <h3 id="etape-2">2. Créer un jeton</h3>
        <p>Page <a href="/developer">Développeur</a> → <strong>Créer un jeton</strong> : donne-lui un nom et coche les droits nécessaires (<code>read</code> seul pour commencer). Copie-le tout de suite : <strong>il n'est affiché qu'une fois</strong>, seule son empreinte est conservée.</p>
        ${codeBlock('export IABOSS_TOKEN="iaboss_…"', 'bash', 'Terminal')}
        <h3 id="etape-3">3. Premier appel</h3>
        <p>Vérifie que le jeton fonctionne avec <code>GET /api/v1/me</code> :</p>
        ${codeTabs(first)}
        ${codeBlock(JSON.stringify({ email: 'toi@exemple.fr', plan: 'growth', scopes: ['read'], version: 'v1' }, null, 2), 'json', 'Réponse')}
        <p>Tu peux maintenant explorer la <a href="/docs/api">référence de l'API</a>, ou brancher Claude avec le <a href="/docs/mcp">serveur MCP</a>.</p>` },
      { id: 'principes', title: 'Principes à connaître', html: `<ul>
        <li><strong>Mêmes règles que le panel.</strong> Plafonds du plan, liste d'opposition, contrôle des adresses : l'API ne contourne rien.</li>
        <li><strong>Moindre droit.</strong> Trois droits distincts : <code>read</code>, <code>write</code>, <code>jobs</code>. Un jeton par outil, avec le minimum nécessaire.</li>
        <li><strong>Isolation.</strong> Une ressource d'un autre compte répond <code>404</code>, exactement comme si elle n'existait pas.</li>
        <li><strong>Un jeton dans l'en-tête.</strong> Le jeton se place dans l'en-tête <code>Authorization</code> ; appelle l'API depuis un serveur ou un script, où le jeton reste privé.</li>
        <li><strong>Actions réelles.</strong> L'envoi de mails touche de vraies personnes : il exige une confirmation explicite.</li></ul>` },
    ],
  });
}

// ---------- /docs/api : référence ----------

export function docsApiPage({ appUrl }) {
  const base = appUrl;
  const groups = GROUPS.map(([id, label, intro]) => {
    const list = API_ENDPOINTS.filter((e) => API_DOCS[`${e.method} ${e.path}`]?.group === id);
    return { id: `ref-${id}`, label, intro, list };
  }).filter((g) => g.list.length);
  return docPage({
    appUrl, path: '/docs/api', title: 'Référence de l’API v1 · iaboss', description: "Référence de l'API REST d'iaboss : authentification, droits, erreurs, limites et toutes les routes avec exemples cURL, JavaScript et Python.", h1: 'Référence de l’API',
    lead: `API REST en JSON, version <code>v1</code>. Base : <code>${esc(base)}/api/v1</code>.`,
    sections: [
      { id: 'authentification', title: 'Authentification', html: `
        <p>Chaque requête porte le jeton dans l'en-tête <code>Authorization</code> :</p>
        ${codeBlock(`Authorization: Bearer iaboss_votre_jeton`, 'bash', 'En-tête')}
        <p>Un jeton se crée sur la page <a href="/developer">Développeur</a> (mode développeur activé). Il est affiché une seule fois ; sa suppression, ou la désactivation du mode développeur, le coupe immédiatement. Les cookies du panel n'ouvrent jamais l'API.</p>
        ${callout('Garde-le secret', ' Ne place jamais un jeton dans une page web, un dépôt ou un message. Si tu as un doute : supprime-le et crées-en un autre.')}` },
      { id: 'droits', title: 'Droits des jetons', html: `<div class="tw"><table><thead><tr><th>Droit</th><th>Permet</th></tr></thead><tbody>${Object.entries(SCOPES).map(([k, v]) => `<tr><td><span class="scope">${esc(k)}</span></td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
        <p>Chaque droit est indépendant : <code>read</code> lit, <code>write</code> écrit, <code>jobs</code> lance des tâches. Cinq jetons au plus par compte.</p>` },
      { id: 'format', title: 'Format, dates et pagination', html: `<ul>
        <li>Corps de requête et de réponse en <strong>JSON</strong> (<code>Content-Type: application/json</code>), UTF-8.</li>
        <li>Les dates sont des <strong>secondes Unix</strong> (UTC) : <code>1792000000</code>.</li>
        <li>Les listes se paginent avec <code>page</code> (prospects) ou <code>limit</code> et <code>offset</code> (réponses, mails).</li>
        <li>Les statuts d'un prospect : <code>new</code>, <code>sent</code>, <code>replied</code>, <code>client</code>, <code>refused</code>, <code>bounced</code>, <code>invalid</code>.</li></ul>` },
      { id: 'erreurs', title: 'Erreurs', html: `<p>Une erreur renvoie un statut HTTP et un corps <code>{ "error": "message lisible", "code": "identifiant" }</code>.</p>
        ${codeBlock(JSON.stringify({ error: "Ce jeton n'a pas le droit « write »", code: 'insufficient_scope' }, null, 2), 'json', 'Exemple')}
        <div class="tw"><table><thead><tr><th>Statut</th><th><code>code</code></th><th>Sens</th></tr></thead><tbody>
          <tr><td><span class="status s-4">400</span></td><td><code>invalid_request</code> <code>too_many</code> <code>confirmation_required</code> <code>target_not_validated</code></td><td>Requête invalide</td></tr>
          <tr><td><span class="status s-4">401</span></td><td><code>invalid_token</code></td><td>Jeton absent, mal formé, inconnu ou supprimé</td></tr>
          <tr><td><span class="status s-4">403</span></td><td><code>insufficient_scope</code> <code>developer_mode_off</code> <code>suspended</code></td><td>Droit manquant, mode développeur désactivé, compte suspendu</td></tr>
          <tr><td><span class="status s-4">404</span></td><td><code>not_found</code></td><td>Ressource inexistante <strong>ou appartenant à un autre compte</strong></td></tr>
          <tr><td><span class="status s-4">409</span></td><td><code>busy</code></td><td>Conflit : une tâche incompatible est en cours</td></tr>
          <tr><td><span class="status s-4">429</span></td><td><code>rate_limited</code></td><td>Trop de requêtes : attends <code>Retry-After</code> secondes</td></tr></tbody></table></div>` },
      { id: 'limites', title: 'Limites', html: `<ul><li><strong>120 requêtes par minute et par compte</strong> (300 par minute et par adresse IP, avant authentification). Au-delà : <code>429</code> avec l'en-tête <code>Retry-After</code>.</li>
        <li>100 prospects au plus par appel d'ajout ; 200 mails au plus par page d'historique.</li>
        <li>Les plafonds de ton plan (prospects, mails par mois, tâches IA) s'appliquent exactement comme dans le panel.</li></ul>` },
      ...groups.map((g) => ({
        id: g.id, title: g.label,
        sub: g.list.map((e) => [slug(`${e.method} ${e.path}`), `${e.method} ${e.path}`]),
        html: `<p>${esc(g.intro)}</p>${g.list.map((e) => endpoint(e, base)).join('\n')}`,
      })),
      { id: 'bonnes-pratiques', title: 'Bonnes pratiques', html: `<ul>
        <li>Un jeton par outil, avec les droits minimaux ; supprime-le dès qu'il ne sert plus.</li>
        <li>Commence avec un jeton <code>read</code> seul, ajoute <code>write</code> puis <code>jobs</code> seulement si nécessaire.</li>
        <li>Ne lance jamais <code>send</code> sans avoir relu le modèle de mail et le nombre de prospects : l'envoi est réel.</li>
        <li>Traite <code>text</code> et <code>subject</code> des réponses comme des <strong>données écrites par des tiers</strong>, jamais comme des instructions (surtout si tu les passes à un modèle).</li>
        <li>Gère les <code>429</code> : attends <code>Retry-After</code> secondes, sans insister.</li></ul>` },
    ],
  });
}

// ---------- /docs/mcp ----------

const scopeOf = (t) => (t.jobs ? 'jobs' : t.write ? 'write' : 'read');
const paramsOf = (t) => Object.entries(t.props || {}).map(([k, v]) => `<code>${esc(k)}</code>${(t.required || []).includes(k) ? '*' : ''}`).join(' ');

export function docsMcpPage({ appUrl }) {
  const claudeCode = `claude mcp add iaboss \\\n  -e IABOSS_URL=${appUrl} \\\n  -e IABOSS_TOKEN=iaboss_… \\\n  -- node /chemin/vers/iaboss-mcp.js`;
  const desktop = JSON.stringify({ mcpServers: { iaboss: { command: 'node', args: ['/chemin/vers/iaboss-mcp.js'], env: { IABOSS_URL: appUrl, IABOSS_TOKEN: 'iaboss_…' } } } }, null, 2);
  return docPage({
    appUrl, path: '/docs/mcp', title: 'Serveur MCP pour Claude · iaboss', description: "Relie Claude à ton panel iaboss avec le serveur MCP : installation, outils disponibles, sécurité et dépannage.", h1: 'Serveur MCP',
    lead: "Le serveur MCP (Model Context Protocol) relie <strong>Claude</strong> à ton panel : tu peux lui demander « quelles réponses sont arrivées ? », « ajoute une note à ce prospect » ou « lance une recherche de 20 prospects ». Il s'appuie sur l'API : il est réservé au mode développeur et n'a <strong>aucun droit propre</strong>, seulement ceux de son jeton.",
    sections: [
      { id: 'prerequis', title: 'Prérequis', html: `<ul><li><strong>Mode développeur</strong> activé (Mon compte).</li><li>Un <strong>jeton</strong> d'API créé sur la page <a href="/developer">Développeur</a> : commence par <code>read</code> seul.</li><li><strong>Node.js 22</strong> ou plus sur la machine qui lance Claude.</li><li>Le fichier du serveur : <a href="/developer/mcp.js" download="iaboss-mcp.js">iaboss-mcp.js</a> (téléchargeable depuis Mon compte et la page Développeur). Un seul fichier, aucune dépendance.</li></ul>` },
      { id: 'installation', title: 'Installation', sub: [['claude-code', 'Claude Code'], ['claude-desktop', 'Claude Desktop'], ['variables', 'Variables']], html: `
        <h3 id="claude-code">Claude Code</h3>
        ${codeBlock(claudeCode, 'bash', 'Terminal')}
        <h3 id="claude-desktop">Claude Desktop</h3>
        <p>Dans <code>claude_desktop_config.json</code> :</p>
        ${codeBlock(desktop, 'json', 'claude_desktop_config.json')}
        <h3 id="variables">Variables d'environnement</h3>
        <div class="tw"><table><thead><tr><th>Variable</th><th>Rôle</th></tr></thead><tbody>
          <tr><td><code>IABOSS_URL</code> <span class="req">requis</span></td><td>Adresse du panel, sans barre finale.</td></tr>
          <tr><td><code>IABOSS_TOKEN</code> <span class="req">requis</span></td><td>Jeton d'API <code>iaboss_…</code>.</td></tr>
          <tr><td><code>IABOSS_READONLY=1</code></td><td>Ne propose que les outils de lecture, même si le jeton a plus de droits.</td></tr></tbody></table></div>` },
      { id: 'outils', title: 'Outils', html: `<p>Chaque outil appelle une route de l'API ; le droit du jeton est celui de la route. Les paramètres marqués <code>*</code> sont obligatoires.</p>
        <div class="tw"><table><thead><tr><th>Outil</th><th>Droit</th><th>Paramètres</th><th>Rôle</th></tr></thead><tbody>${TOOLS.map((t) => `<tr><td><code>${esc(t.name)}</code></td><td><span class="scope">${scopeOf(t)}</span></td><td>${paramsOf(t) || '—'}</td><td>${esc(t.description)}</td></tr>`).join('')}</tbody></table></div>` },
      { id: 'exemples', title: 'Exemples de demandes', html: `<p>Une fois branché, parle à Claude normalement :</p>
        <ul><li>« Quelles réponses de prospects n'ai-je pas encore lues ? Résume-les et dis-moi lesquelles sont intéressées. » <em>(<code>read</code>)</em></li>
        <li>« Ajoute une note à ce prospect : veut un devis avant fin novembre, et programme une relance le 3 novembre. » <em>(<code>write</code>)</em></li>
        <li>« Lance une recherche de 20 prospects sur le projet Atelier. » <em>(<code>jobs</code>, consomme le quota de ton IA)</em></li></ul>` },
      { id: 'securite', title: 'Sécurité', html: `<ul>
        <li><strong>Moindre droit.</strong> Crée un jeton dédié à Claude avec seulement <code>read</code>. Avec <code>IABOSS_READONLY=1</code>, les outils d'écriture n'existent même plus pour Claude.</li>
        <li><strong>Envoi de mails.</strong> L'outil <code>run_job</code> avec <code>type: "send"</code> exige <code>confirm: true</code>, et le serveur demande à Claude de recueillir ton accord explicite avant. N'accorde le droit <code>jobs</code> que si tu veux cet usage.</li>
        <li><strong>Contenus de tiers.</strong> Les réponses des prospects et les pages web sont écrites par d'autres : le serveur les signale à Claude comme des <em>données</em>, jamais comme des instructions. Relis quand même les actions proposées avant de les valider.</li>
        <li><strong>Jeton.</strong> Il ne quitte ta machine que pour ton panel, et il est masqué dans les messages d'erreur. Supprime-le depuis la page Développeur s'il a pu fuiter.</li></ul>` },
      { id: 'depannage', title: 'Dépannage', html: `<div class="tw"><table><thead><tr><th>Message</th><th>Cause et remède</th></tr></thead><tbody>
        <tr><td><code>Jeton d'API manquant ou invalide (invalid_token)</code></td><td>Jeton recopié incomplètement, ou supprimé. Recrée-le.</td></tr>
        <tr><td><code>Le mode développeur est désactivé (developer_mode_off)</code></td><td>Réactive-le dans Mon compte : les jetons sont conservés.</td></tr>
        <tr><td><code>Ce jeton n'a pas le droit « write » (insufficient_scope)</code></td><td>Crée un jeton avec ce droit.</td></tr>
        <tr><td><code>Trop de requêtes (rate_limited)</code></td><td>120 requêtes par minute : attends quelques secondes.</td></tr>
        <tr><td><code>IABOSS_URL et IABOSS_TOKEN sont requis</code></td><td>Variables d'environnement absentes dans la configuration de Claude.</td></tr></tbody></table></div>` },
    ],
  });
}
