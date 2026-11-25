import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, APP_URL } from './helpers/server.js';

// Couverture automatique des accès : chaque route déclarée est essayée sans compte, avec un compte ordinaire, puis sans l'en-tête Origin.
// Une NOUVELLE route publique fait échouer ce test tant qu'elle n'est pas ajoutée sciemment à PUBLIC (relecture de sécurité obligatoire).

const PUBLIC = new Set([
  // Site public, pages légales, documentation, SEO, fichiers statiques
  'GET /accueil', 'GET /fonctionnement', 'GET /tarifs', 'GET /mentions-legales', 'GET /confidentialite', 'GET /cgu', 'GET /docs', 'GET /docs/api', 'GET /docs/mcp',
  'GET /robots.txt', 'GET /sitemap.xml',
  // Connexion (OAuth Google / Apple), code A2F de la session « en attente »
  'GET /login', 'GET /auth/google', 'POST /auth/google', 'GET /auth/google/callback', 'GET /auth/apple', 'POST /auth/apple', 'POST /auth/apple/callback',
  'GET /login/2fa', 'POST /login/2fa',
  // Désinscription d'un destinataire (lien signé reçu par mail)
  'GET /u/:email/:token', 'POST /u/:email/:token',
  // Choix de la langue depuis le site public : un cookie de préférence, rien d'autre (l'origine est vérifiée dans la route)
  'POST /lang',
  // Abonnement des agendas (jeton secret de 256 bits dans l'adresse), événements Stripe (signature vérifiée)
  'GET /cal/:file', 'POST /stripe/webhook',
]);

// La racine « / » n'est pas marquée publique : le serveur y montre le site à un visiteur et le tableau de bord à un compte connecté (src/server.js)
const VISITOR_HOME = 'GET /';
const fill = (path) => path.replace(/:\w+/g, '1');
const key = (r) => `${r.method} ${r.path}`;

test('toute route non publique refuse un visiteur sans compte (jamais 200 ni 500)', async () => {
  const s = await startApp();
  try {
    const routes = s.app.router.routes.filter((r) => !PUBLIC.has(key(r)) && key(r) !== VISITOR_HOME);
    assert.ok(routes.length > 150, `le routeur est lu (${routes.length} routes à contrôler)`);
    const bad = [];
    for (const r of routes) {
      const res = await s.anon[r.method === 'GET' ? 'get' : 'post'](fill(r.path), r.method === 'GET' ? {} : {}, r.method === 'GET' ? undefined : { form: true });
      // Visiteur : 401 (API / JSON), 302-303 vers /login, ou 404 (back-office, ressource inconnue). Jamais un contenu, jamais une erreur serveur.
      if (![401, 403, 302, 303, 404].includes(res.status)) bad.push(`${key(r)} → ${res.status}`);
    }
    assert.deepEqual(bad, [], 'routes qui répondent à un visiteur');
  } finally { await s.close(); }
});

test('les routes du back-office répondent 404 à un compte ordinaire', async () => {
  const s = await startApp();
  try {
    const user = await s.newUser({ admin: false });
    const admin = s.app.router.routes.filter((r) => r.admin);
    assert.ok(admin.length >= 7);
    for (const r of admin) {
      const res = await user[r.method === 'GET' ? 'get' : 'post'](fill(r.path), {}, { form: true });
      assert.equal(res.status, 404, key(r));
    }
  } finally { await s.close(); }
});

test('toute écriture authentifiée sans l\'en-tête Origin de l\'application est refusée (CSRF)', async () => {
  const s = await startApp();
  try {
    const user = await s.newUser({ admin: false });
    const writes = s.app.router.routes.filter((r) => r.method === 'POST' && !PUBLIC.has(key(r)) && !r.api && !r.admin);
    assert.ok(writes.length > 60, `${writes.length} routes d'écriture`);
    const bad = [];
    for (const r of writes) {
      const res = await user.post(fill(r.path), {}, { origin: 'https://evil.example', form: true });
      if (res.status !== 403) bad.push(`${key(r)} → ${res.status}`);
    }
    assert.deepEqual(bad, [], 'écritures acceptées depuis une autre origine');
    assert.ok(APP_URL);
  } finally { await s.close(); }
});

test('aucune écriture n\'est possible en GET (les routes GET ne modifient pas l\'état)', async () => {
  const s = await startApp();
  try {
    const gets = s.app.router.routes.filter((r) => r.method === 'GET').map((r) => r.path);
    const verbs = /(delete|revoke|remove|cancel|forget|disable|enable|start|valider|supprimer|create|logout)\b/i;
    // Un GET dont le nom évoque une action ne doit exister que s'il est connu : /logout est une redirection vers la page de connexion après POST seulement
    const suspicious = gets.filter((p) => verbs.test(p));
    assert.deepEqual(suspicious.filter((p) => !['/auth/google', '/auth/apple'].includes(p)), [], 'GET dont le nom évoque une action');
  } finally { await s.close(); }
});

test('la liste des routes publiques est exactement celle qui est déclarée : une nouvelle route publique doit être relue', async () => {
  const s = await startApp();
  try {
    const declared = s.app.router.routes.filter((r) => r.public).map(key).sort();
    assert.deepEqual(declared, [...PUBLIC].sort(), 'routes publiques déclarées et liste blanche du test');
    // Les routes d'API ne servent qu'avec un jeton « Bearer » (jamais de cookie, voir src/apitokens.js)
    const api = s.app.router.routes.filter((r) => r.api);
    assert.equal(api.length, 15);
    for (const r of api) assert.ok(r.path.startsWith('/api/v1/'), key(r));
  } finally { await s.close(); }
});
