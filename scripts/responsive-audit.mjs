// Audit responsive : débordement horizontal de chaque page à plusieurs largeurs, avec les éléments coupables, les zones qui défilent
// de côté et les champs de moins de 16 px (iOS zoome au focus). Données fictives, base jetable, aucun accès au réseau.
//   node scripts/responsive-audit.mjs [dossier-des-captures] [320,390,768,1280] [shots]
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM=chemin du navigateur si besoin). Sortie « AUCUN PROBLÈME » attendue.
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { setDeveloperMode, createApiToken } from '../src/apitokens.js';
import { createFeed } from '../src/services/ical.js';
import { parisParts, parisTime } from '../src/services/paris-time.js';
import { now } from '../src/db.js';
const S = process.argv[2] || tmpdir();
const WIDTHS = (process.argv[3] || '320,360,390,430,768,1280').split(',').map(Number);
const SHOTS = process.argv[4] === 'shots';
const s = await startApp({ cfg: { systemSmtp: { host: 'x', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' }, linkedin: null } });
const u = await s.newUser({ email: 'tony.averty.exemple@exemple-tres-long.fr', admin: true });
const other = await s.newUser({ email: 'membre@exemple.fr' });
const pid = await addProject(s.db, u.id, { name: 'Atelier Exemple avec un nom de projet vraiment très long', gitUrl: 'https://github.com/utilisateur/atelier-exemple-avec-un-depot-long.git' });
await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'Un outil pour les artisans.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'] }), JSON.stringify({ description: 'TPE', secteurs: ['boulangerie'], zone: 'Bretagne', requetes: ['q'] }), pid);
const t = parisParts(new Date());
for (let i = 0; i < 8; i++) {
  const st = ['new', 'sent', 'replied', 'client', 'refused', 'bounced', 'invalid', 'new'][i];
  const id = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, website, city, status, score, next_action, next_action_at, hook, created_at) VALUES(?, ?, ?, 'https://exemple-tres-long-domaine-de-prospect.fr', 'Saint-Jean-de-la-Ruelle', ?, ?, 'Rappeler', ?, 'Une accroche assez longue pour déborder sur une ligne étroite de téléphone', ?)").run(pid, `Entreprise Dupont-Durand-Martin numéro ${i}`, `contact.longue.adresse.${i}@entreprise-dupont-durand-martin.fr`, st, 5 + i % 5, Math.floor(parisTime(t.year, t.month, 3 + i, 9).getTime() / 1000), now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, read_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, id, `contact.longue.adresse.${i}@entreprise-dupont-durand-martin.fr`, now() - i * 3600, 'initial', 'Un objet de mail suffisamment long pour tester le retour à la ligne', i % 3 ? null : now());
  if (i % 2) await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, 'Re: Un objet de mail suffisamment long', 'Bonjour, ça m''intéresse beaucoup, pouvez-vous m''envoyer un devis détaillé avec https://un-lien-vraiment-tres-long-sans-espace-ni-coupure.example.com/chemin/chemin/chemin ?', 'interested', ?)").run(pid, id, i, `contact.longue.adresse.${i}@entreprise-dupont-durand-martin.fr`, now());
}
await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, scheduled_at, created_at) VALUES(?, 'Post programmé avec un texte', 'scheduled', ?, ?)").run(pid, now() + 86400, now());
await setDeveloperMode(s.db, u.id, true); await createApiToken(s.db, u.id, { name: 'Un jeton avec un nom très long pour tester', scopes: ['read', 'write', 'jobs'] });
await createFeed(s.app, u.id);
const team = Number((await s.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'Équipe', ?)").run(u.id, now())).lastInsertRowid);
await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', ?)").run(team, other.id, now());
const PUBLIC = ['/', '/fonctionnement', '/tarifs', '/docs', '/docs/api', '/docs/mcp', '/mentions-legales', '/confidentialite', '/cgu', '/login', '/page-inconnue'];
const APP = ['/', '/settings', '/account', '/mails', '/mails?v=replies', '/calendar', '/chat', '/team', '/developer', '/admin', '/link'];
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const bad = [];
const probe = (W) => {
  const vw = W;
  const over = Math.max(document.documentElement.scrollWidth - vw, document.body.scrollWidth - vw);
  const culprits = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
      // ignorer ce qui défile volontairement dans son propre conteneur
      let p = el.parentElement, scrolls = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (['auto', 'scroll', 'hidden', 'clip'].includes(o) && p.getBoundingClientRect().right <= vw + 1) { scrolls = true; break; } p = p.parentElement; }
      if (!scrolls) culprits.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} (+${Math.round(r.right - vw)}px)`);
    }
  }
  // Zones qui défilent latéralement toutes seules (tableau, grille…) : à éviter sur téléphone
  const scrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    // un bloc de code qui défile dans son cadre est normal ; une page ou un tableau, non
    if (el.tagName !== 'PRE' && ['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.position !== 'fixed') scrollers.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} (${el.scrollWidth}>${el.clientWidth})`);
  }
  // Champs en dessous de 16 px : iOS zoome au focus et la page se met à défiler de côté
  const small = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')].filter((e) => e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 16).length;
  // Un champ ne doit jamais dépasser de la carte qui le contient (date et heure natives de Safari iOS)
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')) {
    const box = el.closest('.card, section, form'); const r = el.getBoundingClientRect();
    if (box && r.width && r.right > box.getBoundingClientRect().right + 1) culprits.push(`${el.tagName.toLowerCase()}[${el.type || el.name}] sort de sa carte (+${Math.round(r.right - box.getBoundingClientRect().right)}px)`);
  }
  return { over: Math.max(over, culprits.length ? 1 : 0), culprits: culprits.slice(0, 8), scrollers: scrollers.slice(0, 6), small };
};
for (const w of WIDTHS) {
  for (const [label, paths, cookie] of [['public', PUBLIC, null], ['app', APP, u.cookie]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: false });
    if (cookie) await ctx.addCookies([{ name: 'sid', value: cookie.split('=')[1], url: s.base }]);
    const p = await ctx.newPage();
    for (const path of paths) {
      await p.goto(s.base + path, { waitUntil: 'load' }); await p.waitForTimeout(350);
      if (path === '/') await p.evaluate(() => document.querySelectorAll('.project details, details.project').forEach((d) => { d.open = true; }));
      if (path === '/account') await p.evaluate(() => document.querySelectorAll('details.tip').forEach((d) => { d.open = true; }));
      if (path.startsWith('/mails?v=replies')) await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await p.waitForTimeout(600);
      const r = await p.evaluate(probe, w);
      if (r.over > 0 || r.scrollers.length || (w <= 700 && r.small)) bad.push({ w, label, path, ...r });
      if (SHOTS) await p.screenshot({ path: `${S}/r-${label}-${path.replace(/\W+/g, '_')}-${w}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
// éléments de page : fiche prospect, kanban, popup de réponse
for (const w of WIDTHS.filter((x) => x < 800)) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'sid', value: u.cookie.split('=')[1], url: s.base }]);
  const p = await ctx.newPage();
  await p.goto(s.base + '/'); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelectorAll('.project details, details.project').forEach((d) => { d.open = true; }));
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('[data-view-mode="board"]')?.click()); await p.waitForTimeout(700);
  let r = await p.evaluate(probe, w); if (r.over > 0 || r.scrollers.length) bad.push({ w, label: 'app', path: '/ (kanban)', ...r });
  await p.evaluate(() => document.querySelector('[data-view-mode="list"]')?.click()); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-open-prospect]')?.click()); await p.waitForTimeout(700);
  r = await p.evaluate(probe, w); if (r.over > 0 || r.scrollers.length) bad.push({ w, label: 'app', path: '/ (fiche prospect)', ...r });
  if (SHOTS) await p.screenshot({ path: `${S}/r-fiche-${w}.png` });
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad.length ? bad.map((x) => `${x.w}px ${x.label} ${x.path}: ${x.over > 0 ? `DÉBORDE +${x.over}px → ${x.culprits.join(' | ')}` : ''}${x.scrollers.length ? ` DÉFILE: ${x.scrollers.join(' | ')}` : ''}${x.small ? ` CHAMPS<16px: ${x.small}` : ''}`).join('\n') : 'AUCUN PROBLÈME');
