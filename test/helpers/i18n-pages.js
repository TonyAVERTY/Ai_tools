// Pages utilisées par l'audit de la traduction : un compte garni (projet, prospects, modèles, idées d'évolution…) et la liste des pages à lire.
import { now } from '../../src/db.js';
import { testTokenLink } from './users.js';

/** Un compte avec de quoi remplir les écrans. @returns {{ user, projectId }} */
export async function seedAccount(s) {
  const user = await s.newUser({ admin: false, link: testTokenLink() });
  const t = now();
  const profile = JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidéliser sans papier.', cibles: ['Commerces de proximité'] });
  const target = JSON.stringify({ description: 'Boulangeries', secteurs: ['boulangerie'], zone: 'Bretagne', requetes: ['boulangerie rennes'] });
  const projectId = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)')
    .run(user.id, 'Atelier', 'https://github.com/o/atelier.git', profile, target, t)).lastInsertRowid);
  const prospects = [['Boulangerie Martin', 'martin@boulangerie.fr', 'new'], ['Pâtisserie Durand', 'durand@patisserie.fr', 'sent'], ['Café Leroy', 'leroy@cafe.fr', 'replied']];
  for (const [company, email, status] of prospects) {
    await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(projectId, company, email, status, t);
  }
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Une idée pour {{entreprise}}', 'Bonjour,\n\nUne idée pour vous.', 'validated', ?)").run(projectId, t);
  const md = '### 1. Export CSV\n- **Pourquoi** : pratique\n- **Effort** : S\n\n### 2. Mode sombre\n- **Pourquoi** : confort\n- **Effort** : M\n';
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at, finished_at) VALUES(?, ?, 'evolution', 'done', ?, ?, ?)").run(user.id, projectId, JSON.stringify({ markdown: md, sentTo: 'a@b.fr' }), t, t);
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, error, created_at, finished_at) VALUES(?, ?, 'analyze', 'error', 'Dépôt introuvable', ?, ?)").run(user.id, projectId, t, t);
  return { user, projectId };
}

/** Textes écrits par la personne (noms de projet, de prospects…) dans le compte garni : pas à traduire. */
export const SEED_TEXTS = new Set(['Atelier', 'Boulangerie Martin', 'Pâtisserie Durand', 'Café Leroy', 'Export CSV', 'Mode sombre', 'Une idée pour {{entreprise}}', 'github.com/o/atelier', 'Cartes de fidélité digitales.', 'Boulangeries', 'Boulangeries, Bretagne.']);

/** Pages publiques à lire (les textes juridiques restent en français : ils ne sont pas dans cette liste). */
export const PUBLIC_PATHS = ['/accueil', '/fonctionnement', '/tarifs', '/login', '/docs', '/docs/api', '/docs/mcp'];

/** Toutes les pages HTML de l'application connectée, d'après le routeur (les routes à paramètres reçoivent l'identifiant du projet). */
export function appPaths(s, projectId, tabs = []) {
  const out = new Set(['/']);
  for (const r of s.app.router.routes) {
    if (r.method !== 'GET' || r.public) continue;
    if (/^\/(api|static|auth|u|cal\/|admin|logout|link\/|developer\/mcp)/.test(r.path) || /\.(json|csv|xml|txt|ics|pdf)$/.test(r.path)) continue;
    const params = r.path.match(/:\w+/g) || [];
    if (r.path === '/p/:id/:tab') { for (const t of tabs) out.add(`/p/${projectId}/${t}`); continue; }
    if (params.some((p) => p !== ':id')) continue;
    out.add(r.path.replace(':id', String(projectId)));
  }
  return [...out].sort();
}

/** Lit une page avec un compte : renvoie son HTML (en français) ou null si ce n'est pas une page HTML qui répond 200. */
export async function readPage(s, user, path) {
  const r = await fetch(s.base + path, { redirect: 'manual', headers: { cookie: user ? user.cookie : '', accept: 'text/html' } });
  if (r.status !== 200 || !(r.headers.get('content-type') || '').includes('text/html')) return null;
  return r.text();
}
