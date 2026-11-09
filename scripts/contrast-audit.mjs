// Audit de lisibilité : chaque texte visible de chaque page, en thème clair et sombre, à plusieurs largeurs. Rapporte :
//   - les textes dont le contraste avec leur fond est inférieur à 3:1 (illisibles) ; sous 4,5:1 ils sont comptés à part ;
//   - les éléments recouverts par la barre fixe du bas sur téléphone (contenu coupé en bas de page) ;
//   - le débordement horizontal de la page.
// Données fictives, base jetable. node scripts/contrast-audit.mjs [3,5] (seuil bloquant, défaut 3)
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « AUCUN PROBLÈME » attendue.
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const MIN = Number(process.argv[2]) || 3;
const s = await startApp({ cfg: { systemSmtp: { host: 'x', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' }, linkedin: null } });
const u = await s.newUser({ email: 'tony@exemple.fr', admin: true });
const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/atelier/agenda-kine.git' });
await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'Un agenda pour les kinés.', proposition_valeur: 'Gagnez du temps.' }), JSON.stringify({ description: 'Cabinets de kinésithérapie', zone: 'Bretagne', taille: '2 à 10', decideur: 'Titulaire', secteurs: ['Santé'], requetes: ['cabinet kiné'] }), pid);
const t = Math.floor(Date.now() / 1000);
// une tâche IA en cours : le bouton « Activité » s'épingle quand on défile, hors de la barre sombre (cas qui était illisible)
await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, params_json, created_at, started_at) VALUES(?, ?, 'prospect', 'running', '{}', ?, ?)").run(u.id, pid, t, t);
let firstProspect = 0;
for (let i = 0; i < 6; i++) {
  const st = ['new', 'sent', 'replied', 'client', 'refused', 'bounced'][i];
  const id = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, website, city, status, score, next_action, next_action_at, hook, created_at, replied_at) VALUES(?, ?, ?, 'https://exemple.fr', 'Quimper', ?, ?, 'Appeler', ?, 'Une accroche', ?, ?)").run(pid, `Cabinet ${i}`, `c${i}@x.fr`, st, 5 + i, t + 86400, t - i * 86400, st === 'replied' ? t : null)).lastInsertRowid);
  if (!firstProspect) firstProspect = id;
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, read_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, id, `c${i}@x.fr`, t - i * 86400, 'initial', 'Un agenda partagé', i % 2 ? t : null);
  if (i % 2) await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, 'Re: Un agenda', 'Bonjour, ça nous intéresse. Pouvez-vous m''appeler jeudi après-midi ?', 'interested', ?)").run(pid, id, i, `c${i}@x.fr`, t - 3600 * i);
}
await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, scheduled_at, created_at) VALUES(?, 'Post programmé', 'scheduled', ?, ?)").run(pid, now() + 86400, now());
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
for (let i = 0; i < 4; i++) await s.db.prepare('INSERT INTO metrics_daily(project_id, day, users, clients, revenue) VALUES(?, ?, ?, ?, ?)').run(pid, day(15 - i * 4), 100 + i * 10, 10 + i, 1000 * (i + 1));

const PUBLIC = ['/', '/fonctionnement', '/tarifs', '/docs', '/mentions-legales', '/login'];
const TABS = ['', '/prospection', '/envoi', '/clients', '/facturation', '/communication', '/outils', '/recap', '/reglages'];
const QUICK = process.env.AUDIT_QUICK === '1'; // AUDIT_QUICK=1 : la page d'un projet à 390 px, pour un essai rapide
const APP = QUICK ? [`/p/${pid}`] : ['/', '/projets', ...TABS.map((x) => `/p/${pid}${x}`), `/p/${pid}/contact/${firstProspect}`, '/mails', '/mails?v=sent', '/calendar', '/compta', '/facturation', '/clients', '/account', '/settings', '/team', '/chat', '/support', '/developer', '/admin', '/link'];

const probe = ({ min, mobile }) => {
  const parse = (c) => {
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [r, g, b, a]; }
    const k = c.match(/^color\(srgb ([^)]+)\)$/);
    if (k) { const [r, g, b, a = 1] = k[1].split(/[\s/]+/).filter(Boolean).map(Number); return [r * 255, g * 255, b * 255, a]; }
    return null;
  };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const rootBg = parse(getComputedStyle(document.body).backgroundColor);
  const base = rootBg && rootBg[3] ? over(rootBg, [255, 255, 255, 1]) : (parse(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1]);
  // fond effectif : on empile les fonds des ancêtres ; un dégradé ou une image rend la mesure incertaine (on ignore)
  const backdrop = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { chain.push(c); if (c[3] >= 1) break; }
      if (cs.position === 'fixed') break; // un élément fixe flotte au-dessus de la page : ses ancêtres dans le HTML (l'en-tête) ne sont pas derrière lui
    }
    let bg = base;
    for (const c of chain.reverse()) bg = over(c, bg);
    return bg;
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const bad = []; let warn = 0;
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'OPTION'].includes(el.tagName.toUpperCase())) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden], .sr-only, .skip')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg0 = parse(cs.color); const bg = backdrop(el);
    if (!fg0 || !bg) continue;
    const op = opacityOf(el);
    const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
    const cr = ratio(fg, bg);
    const label = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} « ${own[0].textContent.trim().slice(0, 28)} » ${cr.toFixed(2)}:1`;
    if (cr < min) { if (!seen.has(label)) { seen.add(label); bad.push(label); } } else if (cr < 4.5) warn++;
  }
  // contenu masqué par la barre fixe du bas (téléphone) : le bas de la page doit pouvoir défiler au-dessus d'elle
  let hidden = '';
  if (mobile) {
    const bar = document.querySelector('.pills');
    const pos = bar && getComputedStyle(bar).position;
    if (pos === 'fixed') {
      const barTop = bar.getBoundingClientRect().top;
      const last = document.querySelector('.page, main, body > div:last-of-type') || document.body;
      const docBottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo(0, docBottom);
      const lastEl = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && getComputedStyle(e).position !== 'fixed' && e.closest('.pills') === null && !e.closest('.toasts, .reply-pops, dialog, .tour, #tour-root'); }).reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      if (lastEl > barTop + 1) hidden = `la barre du bas recouvre la fin de la page (${Math.round(lastEl - barTop)} px)`;
      window.scrollTo(0, 0);
      void last;
    } else hidden = 'barre du bas absente sur téléphone';
  }
  const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
  return { bad: bad.slice(0, 12), warn, hidden, overflow };
};

const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const out = [];
let warns = 0;
for (const scheme of ['light', 'dark']) {
  for (const w of QUICK ? [390] : [390, 768, 1280]) {
    for (const [label, paths, cookie] of [['public', PUBLIC, null], ['app', APP, u.cookie]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 800 }, colorScheme: scheme, hasTouch: w < 800 });
      if (cookie) await ctx.addCookies([{ name: 'sid', value: cookie.split('=')[1], url: s.base }]);
      const p = await ctx.newPage();
      for (const path of paths) {
        await p.goto(s.base + path, { waitUntil: 'load' }); await p.waitForTimeout(500);
        await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
        if (label === 'app') await p.waitForSelector('#jobs.has-jobs', { timeout: 4000 }).catch(() => {}); // la tâche en cours arrive par sondage
        await p.evaluate(() => window.scrollTo(0, 600)); // la barre se replie : le bouton « Activité » s'épingle
        await p.waitForTimeout(900);
        const r = await p.evaluate(probe, { min: MIN, mobile: w <= 700 && label === 'app' });
        warns += r.warn;
        if (r.bad.length || r.hidden || r.overflow > 0) out.push(`${scheme} ${w}px ${path}${r.overflow > 0 ? ` DÉBORDE +${r.overflow}px` : ''}${r.hidden ? ` ${r.hidden}` : ''}${r.bad.length ? `\n     ${r.bad.join('\n     ')}` : ''}`);
      }
      await ctx.close();
    }
  }
}
await b.close(); await s.close();
console.log(out.length ? out.join('\n') : 'AUCUN PROBLÈME');
console.log(`(textes entre ${MIN}:1 et 4,5:1, à surveiller : ${warns})`);
process.exit(out.length ? 1 : 0);
