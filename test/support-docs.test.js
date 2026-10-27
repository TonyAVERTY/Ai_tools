// La documentation du Support (docs/support/*.md) doit suivre l'application : tout bouton, toute section, toute page et toute tâche IA
// doit y figurer. Le test relève ces éléments dans le code et dans les pages rendues, et échoue tant qu'un nouvel élément n'est pas documenté.
// Règle de travail (voir CLAUDE.md) : une nouvelle fonctionnalité ou un nouveau bouton = une mise à jour de docs/support dans le même commit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { collectDocs, docMeta, buildIndex, STATIC_DOCS_DIR } from '../src/services/supportdocs.js';
import { CHAT } from '../src/chat.js';
import { FILES } from '../src/chatfiles.js';
import { PROMPT_DEFS } from '../src/services/prompts.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const norm = (t) => String(t).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').replace(/[….:]+$/u, '').trim().toLowerCase();
const docs = collectDocs({ chat: CHAT, files: FILES });
const corpus = norm(docs.map((d) => d.content).join('\n'));
const documented = (label) => corpus.includes(norm(label));

// Libellés génériques : présents partout, inutile de les documenter un par un.
const GENERIC = new Set(['annuler', 'enregistrer', 'fermer', 'copier', 'supprimer', 'envoyer', 'ajouter', 'continuer', 'oui', 'non', 'ok', 'précédent', 'suivant', 'filtrer', 'modifier', 'changer', 'valider', 'retour', 'retirer', 'effacer', 'vide', 'chargement', 'u', '→', '←', 'x', '×', 'ou', 'plus']);

test('chaque fichier de documentation a un titre et un résumé, et l\'index les liste tous', () => {
  const names = readdirSync(STATIC_DOCS_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(names.length >= 15, 'la documentation écrite à la main existe');
  for (const d of docs) {
    const m = docMeta(d.content);
    assert.ok(m.title, `${d.name} : « # Titre » manquant`);
    assert.ok(m.summary, `${d.name} : ligne « Résumé : … » manquante`);
    assert.ok(d.content.length > 400, `${d.name} : trop court pour être utile`);
  }
  const index = buildIndex(docs);
  for (const d of docs) assert.ok(index.includes(d.name), `${d.name} absent de l'index`);
  assert.ok(new Set(docs.map((d) => d.name)).size === docs.length, 'noms de fichiers uniques');
});

test('navigation : la barre du haut et les menus sont documentés', () => {
  const views = read('src/views.js');
  const nav = [...views.matchAll(/const NAV = \[(.*?)\];/gs)][0][1];
  const labels = [...nav.matchAll(/\['[^']*', '[^']*', '([^']+)'\]/g)].map((m) => m[1]);
  assert.ok(labels.length >= 4);
  for (const l of [...labels, 'Mon compte', 'Réglages', 'Déconnexion', 'Site internet', 'Activité', 'Claude', 'Support']) assert.ok(documented(l), `navigation : « ${l} » absent de docs/support`);
});

test('sections d\'un projet : chaque section (acc) est documentée', () => {
  const views = read('src/views.js');
  const titles = [];
  for (const m of views.matchAll(/acc\('(\w+)',\s*'\w+',\s*(['`])([^'`]*?)\2/g)) titles.push([m[1], m[3].replace(/\$\{[^}]*\}/g, '').replace(/<[^>]+>/g, '').trim()]);
  assert.ok(titles.length >= 12, `sections trouvées : ${titles.length}`);
  for (const [key, title] of titles) assert.ok(documented(title), `section « ${title} » (${key}) absente de docs/support`);
});

test('tâches IA : chaque tâche du fichier des consignes et chaque type de job est documenté', () => {
  const labelsSrc = /const LABELS = \{([\s\S]*?)\};/.exec(read('public/app.js'))[1];
  for (const m of labelsSrc.matchAll(/(\w+): '([^']+)'/g)) assert.ok(documented(m[2]), `job « ${m[2]} » (${m[1]}) absent de docs/support`);
  for (const [key, d] of Object.entries(PROMPT_DEFS)) assert.ok(documented(d.label), `consigne « ${d.label} » (${key}) absente de docs/support`);
});

test('réglages : chaque rubrique du sommaire est documentée', () => {
  const src = /const SETTINGS_TOC = \[([\s\S]*?)\];/.exec(read('src/views.js'))[1];
  const toc = [...src.matchAll(/\['[^']*',\s*(['"])(.*?)\1\]/g)].map((m) => m[2]);
  assert.ok(toc.length >= 5, `rubriques : ${toc.length}`);
  for (const t of toc) assert.ok(documented(t), `rubrique des Réglages « ${t} » absente de docs/support`);
});

// Pages de l'application : toute nouvelle page doit être ajoutée ici ET documentée.
const PAGES = {
  '/': 'Projets', '/chat': 'Claude', '/support': 'Support', '/settings': 'Réglages', '/account': 'Mon compte', '/mails': 'Mails', '/calendar': 'Calendrier',
  '/team': 'Équipe', '/compta': 'Comptabilité', '/developer': 'Développeur', '/link': 'Relier Claude', '/admin': 'Administration', '/accueil': 'Site internet',
  '/login': 'Connexion', '/fonctionnement': 'Fonctionnement', '/tarifs': 'Tarifs', '/docs': 'Documentation', '/mentions-legales': 'Mentions légales',
  '/confidentialite': 'Politique de confidentialité', '/cgu': 'CGU',
};
// Routes techniques : jamais une page à documenter pour un utilisateur
const TECHNICAL = /^\/(developer\/mcp|api|auth|static|u|cal|robots\.txt|sitemap\.xml|logout|favicon|linkedin|developer\/tokens|link\/|docs\/|team\/|chat\/|support\/|calendar\/|compta\/|mails\/|admin\/|account\/|settings\/|mcp|health|status|unsub|invite|join|i\/|r\/)/;

test('pages : toute page de l\'application est connue du test et documentée', () => {
  const found = new Set();
  for (const f of ['src/routes.js', 'src/server.js', 'src/site/routes.js', 'src/mailroutes.js', 'src/teamroutes.js', 'src/adminroutes.js', 'src/developerroutes.js', 'src/chat.js', 'src/calendar.js', 'src/linkedinroutes.js', 'src/accountingroutes.js']) {
    for (const m of read(f).matchAll(/router\.get\('([^':]+)'/g)) if (!TECHNICAL.test(m[1]) && m[1] !== '/') found.add(m[1]);
  }
  for (const p of found) assert.ok(PAGES[p], `nouvelle page ${p} : documente-la dans docs/support puis ajoute-la à PAGES dans test/support-docs.test.js`);
  for (const [p, label] of Object.entries(PAGES)) assert.ok(documented(label), `page ${p} : « ${label} » absent de docs/support`);
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

// Boutons et liens-boutons réellement affichés : pages rendues + modèles de public/app.js (LinkedIn, Promotion, Kanban, fiche prospect…).
const labelsOf = (html) => {
  const out = new Set();
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) if (!/data-chat-idea/.test(m[1])) out.add(m[2]); // les idées de départ de la page IA ne sont pas des fonctions
  for (const m of html.matchAll(/<(?:a|label)\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|label)>/g)) out.add(m[1]);
  // Bouton composite (« Discord » + sous-titre) : le premier texte est le libellé
  const first = (t) => t.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<input[^>]*>/g, '').split(/<[^>]+>/).map((x) => x.trim()).find(Boolean) || '';
  return [...out].map(first).map(norm).filter((t) => t && t.length >= 3 && !/[${}]/.test(t) && !/[←→]/.test(t) && !GENERIC.has(t));
};
const check = (label, where, missing) => { if (!documented(label)) missing.add(`${label}   (${where})`); };

test('boutons : tout bouton affiché par l\'application est cité dans la documentation', async () => {
  const u = await s.newUser({ admin: true });
  const pid = await addProject(s.db, u.id, { name: 'Exemple', gitUrl: 'https://github.com/u/ex.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Un produit.', proposition_valeur: 'v', arguments: ['a'], stack: 'node' }), JSON.stringify({ description: 'cible', secteurs: [], zone: '', taille: '', decideur: '', requetes: [] }), pid);
  const missing = new Set();
  for (const p of ['/', '/settings', '/account', '/mails', '/calendar', '/compta', '/compta?declarer=1', '/team', '/developer', '/link', '/chat', '/support']) {
    const html = await (await u.get(p, { headers: { accept: 'text/html' } })).text();
    for (const l of labelsOf(html)) check(l, p, missing);
  }
  // Modèles de boutons écrits en JavaScript (rendus côté navigateur)
  for (const f of ['public/app.js', 'public/chat.js']) {
    const js = read(f);
    for (const m of js.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>|\$\{icon\([^)]*\)\})?([^<>${}`]{3,70})<\/button>/g)) { const l = norm(m[1]); if (l.length >= 3 && !GENERIC.has(l)) check(l, f, missing); }
    for (const m of js.matchAll(/class="btn[^"]*"[^>]*>(?:\$\{icon\([^)]*\)\})?([^<>${}`]{3,70})<\/(?:a|button)>/g)) { const l = norm(m[1]); if (l.length >= 3 && !GENERIC.has(l)) check(l, f, missing); }
  }
  assert.deepEqual([...missing].sort(), [], `Boutons absents de docs/support (documente-les, puis relance le test) :\n${[...missing].sort().join('\n')}`);
});
