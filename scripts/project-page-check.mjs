// Vérifie dans un vrai navigateur (Playwright) la barre du haut à cinq onglets (aucun libellé coupé, de 320 à 1920 px, clair et sombre),
// le menu du compte (Facturation, Clients, Équipe) et la page dédiée d'un projet : lien depuis la liste, projet seul et ouvert, retour par le fil d'Ariane.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM si besoin). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const u = await s.newUser({ email: 'tony@x.fr' });
const a = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
await addProject(s.db, u.id, { name: 'Atelier Bois', gitUrl: 'https://github.com/u/bois.git' });

let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const [name, value] = u.cookie.split('=');

for (const scheme of ['light', 'dark']) {
  for (const w of [320, 390, 768, 1024, 1280, 1920]) {
    const tag = `${w}px ${scheme === 'dark' ? 'sombre' : 'clair'}`;
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    await ctx.addCookies([{ name, value, url: s.base }]);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    for (const path of ['/', '/projets', `/projets/${a}`]) {
      await p.goto(`${s.base}${path}`);
      await p.waitForSelector('html[data-nav="ready"]');
      const m = await p.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const tabs = [...document.querySelectorAll('.pills a.pill')].map((e) => { const r = e.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(e); return { t: e.textContent.trim(), cut: e.scrollWidth > e.clientWidth + 1, right: r.right, label: Math.round(rg.getBoundingClientRect().width), box: Math.round(r.width) }; });
        const bigger = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > W + 1 && !e.closest('.pills, svg, dialog') && getComputedStyle(e).position !== 'fixed').slice(0, 3).map((e) => `${e.tagName}.${e.className}`);
        return { tabs, sw: document.documentElement.scrollWidth, W, bigger };
      });
      ok(m.tabs.map((x) => x.t).join('|') === "Aujourd'hui|Projets|Mails|Agenda|Compta", `${tag} ${path} : cinq onglets (${m.tabs.map((x) => x.t).join(', ')})`);
      ok(m.tabs.every((x) => !x.cut && x.label <= x.box + 1), `${tag} ${path} : aucun libellé d'onglet coupé`);
      ok(m.sw <= m.W + 1 && !m.bigger.length, `${tag} ${path} : pas de défilement horizontal${m.bigger.length ? ` : ${m.bigger.join(' ; ')}` : ''}`);
    }
    ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.slice(0, 2).join(' | ')}` : ''}`);
    await ctx.close();
  }
}

// Parcours : liste → page du projet → retour par le fil d'Ariane ; menu du compte
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  await p.goto(`${s.base}/projets`);
  await p.waitForSelector('html[data-nav="ready"]');
  const link = p.locator('a.pname-l', { hasText: 'Page du projet' }).first();
  ok((await link.boundingBox()).height >= 43.5, 'le lien « Page du projet » fait au moins 44 px de haut');
  await link.click();
  await p.waitForFunction((id) => location.pathname === `/projets/${id}`, a);
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('h1').innerText()) === 'Agenda Kiné', 'la page du projet porte son nom');
  ok((await p.locator('.project').count()) === 1 && (await p.locator('.project').getAttribute('open')) !== null, 'un seul projet, ouvert');
  ok((await p.locator('.pills a.pill[aria-current="page"]').count()) === 0 || (await p.locator('.pills a.pill[aria-current="page"]').innerText()).includes('Projets'), 'l\'onglet Projets reste surligné (ou aucun)');
  await p.locator('.crumb a', { hasText: 'Projets' }).click();
  await p.waitForFunction(() => location.pathname === '/projets');
  await p.locator('details.user > summary').click();
  const links = await p.locator('details.user .user-pop a').allInnerTexts();
  ok(['Facturation', 'Clients', 'Équipe'].every((x) => links.some((l) => l.includes(x))), `le menu du compte propose Facturation, Clients, Équipe (${links.join(', ')})`);
  await p.locator('details.user .user-pop a', { hasText: 'Équipe' }).click();
  await p.waitForFunction(() => location.pathname === '/team');
  ok(true, 'Équipe s\'ouvre depuis le menu du compte');
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
