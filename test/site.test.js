// Site public : pages accessibles sans compte, SEO, en-têtes, aucune ressource externe, marqueurs légaux, contrastes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, APP_URL } from './helpers/server.js';
import { LEGAL_MARKERS } from '../src/site/legal.js';
import { PLAN_LIMITS, PLAN_PRICES, PLAN_LABELS, ANNUAL_FREE_MONTHS, annualPrice } from '../src/limits.js';
import { CONSENT_CHECKBOX } from '../src/claudelink.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const PUBLIC_PAGES = ['/', '/fonctionnement', '/tarifs', '/mentions-legales', '/confidentialite', '/cgu'];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Les clients de test envoient accept: application/json ; un navigateur demande du HTML
const page = (p, headers = {}) => s.anon.get(p, { headers: { accept: 'text/html', ...headers } });
const text = async (p) => (await page(p)).text();

test('pages publiques : 200 sans session, complètes (une h1, title, description, canonical, lang)', async () => {
  for (const p of PUBLIC_PAGES) {
    const r = await page(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const h = await r.text();
    assert.match(h, /<html lang="fr">/, p);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${p} : une seule h1`);
    const title = h.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title && title.length >= 10 && title.length <= 70, `${p} : title (${title})`);
    const desc = h.match(/<meta name="description" content="([^"]+)"/)?.[1];
    assert.ok(desc && desc.length >= 50 && desc.length <= 200, `${p} : description`);
    const expected = APP_URL + (p === '/' ? '/' : p);
    assert.ok(h.includes(`<link rel="canonical" href="${expected}">`), `${p} : canonical`);
    assert.ok(h.includes(`<meta property="og:url" content="${expected}">`), `${p} : og:url`);
    assert.match(h, /<meta property="og:title"/);
    assert.match(h, /<meta name="robots" content="index, follow">/);
    assert.match(h, /<a class="skip" href="#contenu">/, `${p} : lien d'évitement`);
    assert.match(h, /<main id="contenu"/);
    assert.match(h, /<header class="site-head">/);
    assert.match(h, /<footer class="site-foot">/);
    assert.match(h, /<link rel="icon" type="image\/svg\+xml" href="\/static\/favicon\.svg">/);
    assert.match(h, /href="\/static\/app\.css\?v=[0-9a-f]{10}"/, `${p} : feuilles de style versionnées`);
    assert.match(h, /href="\/static\/app\.css\?v=[0-9a-f]{10}"/, `${p} : feuilles de style versionnées`);
  }
});

test('connexion et 404 : une h1, noindex, bouton Google', async () => {
  let h = await text('/login');
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(h, /noindex/);
  assert.match(h, /Se connecter avec Google/);
  assert.match(h, /<html lang="fr">/);

  const r = await page('/cette-page-n-existe-pas');
  assert.equal(r.status, 404);
  h = await r.text();
  assert.equal((h.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(h, /Cette page n'existe pas/);
  assert.match(h, /noindex/);
  assert.doesNotMatch(h, /rel="canonical"/);
  // L'API garde ses erreurs JSON
  const j = await s.anon.get('/api/inconnu');
  assert.equal(j.status, 404);
  assert.ok((await j.json()).error);
});

test('pages d\'application : toujours protégées, la racine dépend de la session', async () => {
  for (const p of ['/account', '/settings', '/link']) {
    const r = await page(p);
    assert.equal(r.status, 303, p);
    assert.equal(r.headers.get('location'), '/login');
  }
  assert.equal((await s.anon.get('/api/system')).status, 401);
  assert.equal((await s.anon.post('/account/delete', { confirm: 'x' }, { form: true })).status, 303);

  // Connecté sans liaison Claude : la racine ne montre plus le site, l'onboarding reprend la main
  const linked = await s.newUser({ email: 'lie@x.fr' });
  const dash = await (await linked.get('/', { headers: { accept: 'text/html' } })).text();
  assert.match(dash, /<h1>Projets<\/h1>/, 'compte relié : le tableau de bord');
  assert.doesNotMatch(dash, /Un panel pour prospecter/);
  const u = await s.newUser({ email: 'site@x.fr', admin: false });
  let r = await u.get('/', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/link');
  r = await u.get('/login', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  // Les pages du site restent lisibles connecté
  assert.equal((await u.get('/tarifs', { headers: { accept: 'text/html' } })).status, 200);
});

test('flux de connexion : Google redirige, le retour Apple (POST cross-site) reste accepté', async () => {
  const r = await s.anon.get('/auth/google');
  assert.equal(r.status, 303);
  assert.equal(new URL(r.headers.get('location')).host, 'accounts.google.com');
  // Sans configuration Apple, le POST échoue proprement vers /login (pas de 403 d'origine ni de 404)
  const bare = await s.anon.post('/auth/apple/callback', {}, { origin: null });
  assert.equal(bare.status, 303);
  assert.match(bare.headers.get('location'), /^\/login\?e=/);
});

test('robots.txt et sitemap.xml', async () => {
  let r = await s.anon.get('/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/plain/);
  const robots = await r.text();
  assert.match(robots, /User-agent: \*/);
  for (const p of ['/account', '/settings', '/link', '/api/', '/auth/', '/u/']) assert.match(robots, new RegExp(`Disallow: ${p}\\n`), p);
  assert.match(robots, new RegExp(`Sitemap: ${APP_URL}/sitemap\\.xml`));
  assert.doesNotMatch(robots, /Disallow: \/static/, 'les feuilles de style restent explorables');
  assert.doesNotMatch(robots, /noindex-test/);

  r = await s.anon.get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /xml/);
  const xml = await r.text();
  for (const p of PUBLIC_PAGES) assert.ok(xml.includes(`<loc>${APP_URL}${p === '/' ? '/' : p}</loc>`), p);
  assert.doesNotMatch(xml, /login|account|settings|\/api\//);
});

test('en-têtes de sécurité, HSTS seulement en https, noindex sur l\'application', async () => {
  const r = await page('/');
  const h = (n) => r.headers.get(n);
  assert.equal(h('x-content-type-options'), 'nosniff');
  assert.equal(h('x-frame-options'), 'DENY');
  assert.equal(h('referrer-policy'), 'same-origin');
  assert.match(h('permissions-policy'), /camera=\(\)/);
  assert.match(h('permissions-policy'), /geolocation=\(\)/);
  assert.match(h('strict-transport-security'), /max-age=\d+/);
  const csp = h('content-security-policy');
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(d), d);
  }
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.equal(h('x-robots-tag'), null, 'la page d\'accueil est indexable');
  assert.equal((await page('/tarifs')).headers.get('x-robots-tag'), null);

  for (const p of ['/login', '/account', '/api/system', '/link']) {
    assert.match((await page(p)).headers.get('x-robots-tag'), /noindex/, p);
  }

  const http = await startApp({ cfg: { appUrl: 'http://localhost:3100' } });
  try {
    const hr = await http.anon.get('/tarifs', { headers: { accept: 'text/html' } });
    assert.equal(hr.status, 200);
    assert.equal(hr.headers.get('strict-transport-security'), null, 'pas de HSTS sans https');
    assert.equal(hr.headers.get('x-content-type-options'), 'nosniff');
  } finally { await http.close(); }
});

test('fichiers statiques : cache, ETag, 304, HEAD', async () => {
  for (const [p, type] of [['/static/site.css', /text\/css/], ['/static/app.css', /text\/css/], ['/static/favicon.svg', /image\/svg\+xml/], ['/favicon.ico', /image\/svg\+xml/], ['/static/site.js', /text\/javascript/], ['/static/img/ecran-projet.svg', /image\/svg\+xml/]]) {
    const r = await s.anon.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), type);
    assert.match(r.headers.get('cache-control'), /max-age=\d+/);
    const etag = r.headers.get('etag');
    assert.ok(etag, p);
    const again = await s.anon.get(p, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304, p);
  }
  const head = await fetch(`http://127.0.0.1:${new URL(s.base).port}/tarifs`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.text()), '');
});

test('aucune ressource externe : tout est servi par l\'application, rien en ligne', async () => {
  // Liens sortants explicites (balise <a>) : seuls ceux-ci sont permis
  const outbound = new Set([
    'https://www.anthropic.com/legal/consumer-terms', 'https://www.anthropic.com/legal/privacy',
    'https://policies.google.com/privacy', 'https://www.cnil.fr/fr/plaintes', 'https://www.apple.com/legal/privacy/fr-fr/',
  ]);
  const apple = await startApp({ cfg: { apple: { teamId: 't', keyId: 'k', clientId: 'c', privateKey: 'p' } } });
  try {
    for (const client of [s.anon, apple.anon]) {
      for (const p of [...PUBLIC_PAGES, '/login', '/inexistant']) {
        const h = await (await client.get(p, { headers: { accept: 'text/html' } })).text();
        // Seuls scripts permis : ceux de l'application (mouvement du site, vérification de la connexion), jamais en ligne
        for (const m of h.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)) assert.ok(['/static/site.js', '/static/captcha.js'].includes(m[1].split('?')[0]), `${p} : script ${m[1]}`);
        assert.doesNotMatch(h, /<script(?![^>]*(ld\+json|\ssrc=))/i, `${p} : aucun script en ligne`);
        assert.doesNotMatch(h, /<style[\s>]/i, `${p} : pas de <style>`);
        assert.doesNotMatch(h, /\sstyle="/i, `${p} : pas de style en ligne (CSP)`);
        assert.doesNotMatch(h, /<(img|iframe|video|audio|source|embed|object)[^>]*\s(src|data)="https?:/i, p);
        for (const m of h.matchAll(/<link[^>]+href="([^"]+)"/g)) assert.ok(m[1].startsWith('/') || m[1].startsWith(APP_URL), `${p} : <link> ${m[1]}`);
        for (const m of h.matchAll(/<a [^>]*href="(https?:[^"]+)"/g)) {
          assert.ok(outbound.has(m[1]) || m[1].startsWith(APP_URL), `${p} : lien sortant non listé ${m[1]}`);
        }
        for (const m of h.matchAll(/<a [^>]*href="https?:\/\/(?!ai\.tony-averty\.dev)[^"]+"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/, p);
        for (const m of h.matchAll(/<form[^>]+action="([^"]+)"/g)) assert.ok(m[1].startsWith('/'), p);
      }
    }
    // L'accueil annonce Apple seulement quand il est configuré
    assert.match(await (await apple.anon.get('/', { headers: { accept: 'text/html' } })).text(), /Google ou Apple/);
    assert.doesNotMatch(await text('/'), /Apple/);
  } finally { await apple.close(); }
  assert.doesNotMatch(read('public/site.css'), /@import|url\(\s*["']?https?:/);
});

test('textes : faits réels du statut, tarifs sans prix inventé, aucun terme interdit', async () => {
  const mentions = await text('/mentions-legales');
  for (const f of ['Tony AVERTY', '100 142 819 00018', '62.01Z', 'contact@tony-averty.dev', 'TVA non applicable, art. 293 B du CGI', 'Directeur de la publication']) {
    assert.ok(mentions.includes(f), f);
  }
  const tarifs = await text('/tarifs');
  assert.match(tarifs, /Bientôt/);
  for (const n of Object.values(PLAN_LIMITS.free)) assert.ok(tarifs.includes(`<strong>${n}</strong>`), `plan gratuit : ${n}`);
  // Les seuls montants permis sont ceux de la configuration (prix mensuels, annuels, équivalent mensuel, prix de 12 mois)
  const allowed = new Set(['0']);
  for (const [k, m] of Object.entries(PLAN_PRICES)) for (const v of [m, annualPrice(k), m * 12, (annualPrice(k) / 12).toFixed(2).replace('.', ',')]) allowed.add(String(v).replace(/,00$/, ''));
  for (const m of tarifs.matchAll(/(\d+(?:,\d+)?)\u00a0?\s?€/g)) assert.ok(allowed.has(m[1]), `montant non prévu : ${m[0]}`);
  assert.match(tarifs, /appliqués par le serveur/);
  assert.match(tarifs, /franchise de TVA \(art\. 293 B du CGI\)/);
  assert.doesNotMatch(tarifs, /pas encore appliqu/);
  assert.match(tarifs, /suspendu ou fermé/);

  const cgu = await text('/cgu');
  assert.ok(cgu.includes(CONSENT_CHECKBOX.replace(/'/g, '\'')) || cgu.includes('J\'ai compris et j\'accepte ce risque'));
  assert.match(cgu, /suspendu ou fermé/);
  assert.match(cgu, /n'en est pas responsable/);
  assert.match(cgu, /B2C|particuliers/);
  assert.match(cgu, /droit français/);

  const conf = await text('/confidentialite');
  for (const f of ['responsable de traitement', 'sous-traitant', 'Anthropic', 'Google', 'CNIL', 'strictement nécessaires', '<code>sid</code>', 'Mon compte']) {
    assert.ok(conf.includes(f), f);
  }
  assert.doesNotMatch(conf, /<!--/, 'aucun commentaire HTML (le paragraphe reCAPTCHA reste dans le code)');
  assert.doesNotMatch(conf, /reCAPTCHA/);

  for (const p of [...PUBLIC_PAGES, '/login']) {
    const h = await text(p);
    assert.doesNotMatch(h, /généré par (l')?IA|assistant|(?<!n'est |pas )\bgaranti\b|n'importe quel taux/i, p);
    assert.doesNotMatch(h, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${p} : pas d'emoji`);
  }
});

test('marqueurs légaux : ceux des pages sont exactement ceux listés dans le journal', async () => {
  const journal = read('docs/JOURNAL.md');
  const section = journal.match(/### Marqueurs à compléter[\s\S]*?(?=\n##|$)/)?.[0];
  assert.ok(section, 'section « Marqueurs à compléter » absente du journal');
  const re = /\[À (?:COMPLÉTER|VALIDER) : [^\]]+\]/g;
  const listed = new Set(section.match(re));
  const inPages = new Set();
  for (const p of ['/mentions-legales', '/confidentialite', '/cgu']) {
    for (const m of (await text(p)).match(re) || []) inPages.add(m);
  }
  assert.deepEqual([...inPages].sort(), [...listed].sort(), 'écart entre les pages et la liste du journal');
  assert.deepEqual([...new Set(LEGAL_MARKERS)].sort(), [...listed].sort(), 'écart entre le code et la liste du journal');
  for (const m of ['[À COMPLÉTER : adresse du siège]', '[À COMPLÉTER : hébergeur]']) assert.ok(listed.has(m), m);
  // Pas de marqueur sur les pages commerciales
  for (const p of ['/', '/fonctionnement', '/tarifs', '/login']) assert.doesNotMatch(await text(p), /\[À (COMPLÉTER|VALIDER)/, p);
});

// ---------- Couleurs : mêmes jetons que le tableau de bord, contrastes AA ----------
const hexToRgb = (h) => { let v = h.replace('#', ''); if (v.length === 3) v = [...v].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255); };
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));

test('couleurs : site.css réutilise les jetons du tableau de bord, sans seconde palette', () => {
  const app = read('public/app.css');
  const site = read('public/site.css');
  const code = site.replace(/\/\*[\s\S]*?\*\//g, ''); // les commentaires peuvent citer ce qu'on évite
  for (const t of ['bg', 'card', 'text', 'muted', 'line', 'accent']) {
    assert.match(site, new RegExp(`var\\(--${t}\\)`), `--${t} utilisé par le site`);
    assert.match(app, new RegExp(`--${t}:`), `--${t} défini par le tableau de bord`);
    assert.doesNotMatch(site, new RegExp(`--${t}\\s*:`), `--${t} ne doit pas être redéfini`);
  }
  assert.doesNotMatch(site, /#[0-9a-fA-F]{3,8}\b/, 'aucune couleur en dur dans site.css');
  assert.doesNotMatch(site, /\b(rgb|hsl|oklch)a?\(/, 'aucune couleur calculée hors jetons');
  assert.doesNotMatch(code, /--accent-2|violet|purple/i, 'pas de dégradé violet');
  assert.match(site, /prefers-reduced-motion: no-preference/, 'animations réservées à qui les accepte');
  assert.match(site, /:focus-visible/);
  const layout = readFileSync(new URL('../src/site/layout.js', import.meta.url), 'utf8');
  assert.match(layout, /\/static\/app\.css[\s\S]*\/static\/site\.css/, 'site.css chargé après app.css');
});

test('contrastes AA (4,5:1) des couples texte/fond du site, thèmes clair et sombre', () => {
  const app = read('public/app.css');
  const light = tokens(app.match(/:root\s*\{([^}]*)\}/)[1]);
  const dark = tokens(app.match(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]);
  const themes = {
    clair: { ...light, onAccent: light['accent-text'] }, // bouton principal : --accent-text sur --accent
    sombre: { ...light, ...dark, onAccent: dark.bg }, // thème sombre : site.css passe le texte du bouton en var(--bg)
  };
  for (const [name, t] of Object.entries(themes)) {
    const pairs = [
      ['text/bg', t.text, t.bg], ['text/card', t.text, t.card], ['muted/bg', t.muted, t.bg], ['muted/card', t.muted, t.card],
      ['accent/bg', t.accent, t.bg], ['accent/card', t.accent, t.card], ['bouton principal', t.onAccent, t.accent],
      ['ok/card', t.ok, t.card], ['warn/card', t.warn, t.card], ['err/card', t.err, t.card],
    ];
    for (const [label, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name} : ${label} = ${ratio(fg, bg).toFixed(2)}`);
  }
  assert.match(read('public/site.css'), /prefers-color-scheme: dark\)\s*\{\s*body\.site \.btn\.primary \{ color: var\(--bg\); \}/);
});

test('liens entre pages : chaque lien et chaque image du site mène quelque part, les ancres existent, le parcours est complet', async () => {
  const pages = [...PUBLIC_PAGES, '/login', '/inexistant'];
  const html = {};
  for (const p of pages) html[p.split('#')[0]] = await text(p);
  const checked = new Set();
  for (const [p, h] of Object.entries(html)) {
    for (const m of h.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const [path, hash] = m[1].split('#');
      if (path.startsWith('/link') || path.startsWith('/auth/')) continue; // application et connexion : redirigent
      const target = path.split('?')[0] || p;
      if (!checked.has(target)) {
        const r = await s.anon.get(target, { headers: { accept: 'text/html' } });
        assert.ok(r.status === 200 || (target === '/inexistant' && r.status === 404), `${p} : ${m[1]} répond ${r.status}`);
        checked.add(target);
      }
      if (hash && html[target]) assert.ok(html[target].includes(`id="${hash}"`), `${p} : ancre #${hash} introuvable sur ${target}`);
    }
  }
  // Chaque page du site renvoie vers les autres : accueil, fonctionnement, tarifs, connexion
  for (const p of ['/', '/fonctionnement', '/tarifs', '/login', '/cgu', '/mentions-legales', '/confidentialite']) {
    const links = new Set([...html[p].matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]));
    for (const dest of ['/', '/fonctionnement', '/tarifs', '/login']) assert.ok(links.has(dest), `${p} ne renvoie pas vers ${dest}`);
  }
  // Le bouton « Se connecter avec Claude » de Tarifs ne parle plus de ligne de commande
  const tarifs = html['/tarifs'];
  assert.match(tarifs, /href="\/link\?start=claude"/);
  assert.doesNotMatch(tarifs, /setup-token/);
  // L'accueil est vivant : images, compteurs, galerie
  assert.match(html['/'], /data-gallery/);
  assert.match(html['/'], /data-count="50"/);
  assert.ok((html['/'].match(/<img src="\/static\/img\//g) || []).length >= 5);
  assert.doesNotMatch(html['/'], /<img(?![^>]*\salt="[^"]+")/, 'toutes les images ont un texte alternatif');
});

test('offres : prix de 10 à 100 € TTC, annuel = 2 mois offerts, plafonds tenables par le serveur et croissants', async () => {
  const keys = Object.keys(PLAN_PRICES);
  const prices = keys.map((k) => PLAN_PRICES[k]);
  assert.equal(Math.min(...prices), 10);
  assert.equal(Math.max(...prices), 100);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'prix croissants');
  assert.equal(ANNUAL_FREE_MONTHS, 2);
  const h = await text('/tarifs');
  let prev = PLAN_LIMITS.free;
  for (const k of keys) {
    assert.equal(annualPrice(k), PLAN_PRICES[k] * 10, `${k} : 12 mois pour le prix de 10`);
    const l = PLAN_LIMITS[k];
    for (const kind of ['projects', 'prospects', 'mails', 'aiJobs', 'seats']) assert.ok(l[kind] > prev[kind], `${k} : ${kind} plus large que l'offre précédente`);
    assert.ok(l.mails <= 300 * 30, `${k} : ${l.mails} mails par mois dépasserait le plafond de 300 par 24 h`);
    assert.ok(l.aiJobs >= Math.ceil(l.prospects / 50), `${k} : assez de tâches IA pour trouver ${l.prospects} contacts`);
    prev = l;
    // la page montre le nom, les deux prix, l'équivalent mensuel et les plafonds
    assert.ok(h.includes(`>${PLAN_LABELS[k]} <span class="badge warn">Bientôt`), `${k} : carte`);
    assert.ok(h.includes(`${PLAN_PRICES[k]}\u00a0€ <small>par mois, TTC`), `${k} : prix mensuel`);
    assert.ok(h.includes(`${annualPrice(k)}\u00a0€ <small>par an, TTC`), `${k} : prix annuel`);
    assert.ok(h.includes(`<strong>${l.mails.toLocaleString('fr-FR')}</strong>`), `${k} : mails`);
  }
  assert.match(h, /id="bill-year"/);
  assert.match(h, /2 mois offerts/);
  // L'ancien plan illimité n'est pas vendu ; un plan inconnu retombe sur « gratuit »
  assert.ok(!h.includes('illimité)'));
  assert.deepEqual(Object.keys(PLAN_PRICES).filter((k) => PLAN_LIMITS[k].projects == null), [], 'aucune offre payante illimitée');
});
