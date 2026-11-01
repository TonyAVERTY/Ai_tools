// Captures d'écran de toutes les pages (site public et application) à trois tailles, sur une base de test peuplée de données réalistes.
// Sert au contrôle visuel avant/après d'une refonte (SCHEME=dark pour le thème sombre, TOP=1 pour le haut de page seulement, ELEMENT=<sélecteur> pour un bloc, DEV=1 pour le mode développeur actif, CLOSED=1 pour laisser les projets repliés). Usage : OUT=/chemin PLAYWRIGHT_MODULE=… PLAYWRIGHT_CHROMIUM=… node scripts/design-shots.mjs [filtre]
import { mkdirSync } from 'node:fs';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const out = process.env.OUT || '/tmp/design-shots';
const only = process.argv[2] || '';
mkdirSync(out, { recursive: true });
const s = await startApp();
const u = await s.newUser({ admin: true });
const others = [await s.newUser({ admin: false }), await s.newUser({ admin: false })]; // d'autres comptes pour la page Administration
await s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(others[1].id).catch(() => {});
if (process.env.DEV) { // mode développeur actif avec deux jetons (pour photographier la page Développeur)
  await u.post('/account/developer', { enabled: 'on' }, { form: true });
  await u.post('/developer/tokens', { name: 'Claude Desktop', scope_read: 'on' }, { form: true });
  await u.post('/developer/tokens', { name: 'Script de relance', scope_read: 'on', scope_write: 'on' }, { form: true });
}
const day = 86400;
const profile = { resume: "Un outil de prise de rendez-vous pour les kinésithérapeutes libéraux : agenda partagé, rappels par SMS, paiement en ligne.", proposition_valeur: 'Moins d\'appels manqués, un agenda qui se remplit seul.', fonctionnalites: ['Agenda partagé', 'Rappels SMS', 'Paiement en ligne', 'Facturation'], arguments: ['Installé en 10 minutes', 'Sans engagement'], stack: 'Node.js', ton: 'direct et chaleureux' };
const target = { description: 'Kinésithérapeutes libéraux en cabinet', secteurs: ['Kinésithérapie'], zone: 'Bretagne', taille: 'TPE', decideur: 'Le kiné titulaire', requetes: ['kinésithérapeute Rennes', 'cabinet de kinésithérapie Vannes'] };
const p1 = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/atelier/agenda-kine.git' });
await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify(profile), JSON.stringify(target), p1);
await addProject(s.db, u.id, { name: 'MonEspacePro', gitUrl: 'https://github.com/atelier/monespacepro.git' });
const names = [['Cabinet Le Gall', 'Rennes', 'new', 8], ['Kiné du Port', 'Lorient', 'sent', 7], ['Cabinet Morvan', 'Vannes', 'replied', 9], ['Centre Armor', 'Saint-Malo', 'client', 6], ['Cabinet Kerjean', 'Brest', 'new', 5], ['Kiné Océane', 'Quimper', 'sent', 7]];
let i = 0;
for (const [company, city, status, score] of names) {
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, website, city, sector, score, status, source, hook, created_at) VALUES(?, ?, ?, ?, ?, 'Kinésithérapie', ?, ?, 'https://exemple.fr/contact', ?, ?)")
    .run(p1, company, `contact${++i}@exemple.fr`, 'https://exemple.fr', city, score, status, `Votre cabinet à ${city} propose des séances à domicile, un détail utile pour un agenda partagé.`, now() - i * day);
}
// Historique d'envois (mail_log) pour que la page Mails ait de quoi se montrer : un mail par prospect déjà contacté, dont un en échec
const sentRows = await s.db.prepare("SELECT id, email, status FROM prospects WHERE project_id = ? AND status IN ('sent', 'replied', 'client')").all(p1);
let k = 0;
for (const r of sentRows) {
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, subject) VALUES(?, ?, ?, ?, NULL, 'initial', ?)").run(p1, r.id, r.email, now() - (++k) * day, 'Un agenda partagé pour votre cabinet');
}
await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, subject) VALUES(?, NULL, 'erreur@exemple.fr', ?, 'SMTP : connexion refusée', 'initial', 'Un agenda partagé pour votre cabinet')").run(p1, now() - 5 * day);
await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, progress_json, created_at, started_at) VALUES(?, ?, 'prospect', 'running', ?, ?, ?)").run(p1, u.id, JSON.stringify({ message: 'Lecture du site de Cabinet Morvan…', pct: 42, found: 3, target: 10 }), now(), now());
await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, progress_json, created_at) VALUES(?, ?, 'audit', 'queued', ?, ?)").run(p1, u.id, JSON.stringify({ message: 'En attente : quota de la session Claude (5 h) à 95 %' }), now());
await s.db.prepare("UPDATE prospects SET next_action = 'Relancer par téléphone', next_action_at = ? WHERE project_id = ? AND company = 'Cabinet Le Gall'").run(now() + 3 * day, p1);
try { await s.db.prepare("INSERT INTO calendar_events(user_id, title, starts_at, minutes, notes, created_at) VALUES(?, 'Appel avec Cabinet Morvan', ?, 30, 'Démo agenda partagé', ?)").run(u.id, now() + 2 * day, now()); } catch { /* table absente : ignoré */ }

const PUBLIC = ['/accueil', '/fonctionnement', '/tarifs', '/docs', '/docs/api', '/docs/mcp', '/mentions-legales', '/confidentialite', '/cgu', '/login', '/page-inconnue'];
const APP = ['/', '/mails', '/calendar', '/team', '/settings', '/account', '/chat', '/support', '/developer', '/link', '/admin'];
const SIZES = [{ name: 'bureau', width: 1440, height: 900 }, { name: 'tablette', width: 820, height: 1100 }, { name: 'mobile', width: 390, height: 844 }];
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const slug = (p) => (p === '/' ? 'projets' : p.replace(/^\//, '').replace(/\//g, '-'));
async function run(label, paths, cookie) {
  for (const sz of SIZES) {
    const ctx = await b.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: 1, colorScheme: process.env.SCHEME === 'dark' ? 'dark' : 'light' });
    if (cookie) { const [name, value] = u.cookie.split('='); await ctx.addCookies([{ name, value, url: s.base }]); }
    await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
    const page = await ctx.newPage();
    for (const path of paths) {
      if (only && !(only === 'projets' ? path === '/' : path.includes(only))) continue;
      try {
        await page.goto(`${s.base}${path}`, { waitUntil: 'load' });
        await page.waitForTimeout(700);
        if (path === '/' && cookie && !process.env.CLOSED) { const d = page.locator('details.project').first(); if (!(await d.evaluate((e) => e.open))) await d.locator('> summary').click(); await page.waitForTimeout(400); }
        // Fait défiler la page : les apparitions au défilement (IntersectionObserver) se déclenchent comme pour un visiteur
        await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 500)); });
        if (process.env.ELEMENT) { // capture d'un bloc seulement (ex. ELEMENT=.dash), sans la mise en route flottante
          await page.evaluate(() => document.querySelector('.todo')?.remove());
          await page.locator(process.env.ELEMENT).first().screenshot({ path: `${out}/${label}-${slug(path)}-${sz.name}.png` });
        } else await page.screenshot({ path: `${out}/${label}-${slug(path)}-${sz.name}.png`, fullPage: !process.env.TOP });
      } catch (e) { console.log('échec', path, sz.name, e.message.split('\n')[0]); }
    }
    await ctx.close();
  }
}
await run('pub', PUBLIC, false);
await run('app', APP, true);
await b.close(); await s.close?.();
console.log('captures dans', out);
process.exit(0);
