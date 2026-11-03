// Vérifie dans un vrai navigateur que tout contenu qui se charge montre le même cercle de chargement devant « Chargement… » (jamais du texte seul) : les blocs LinkedIn,
// Promotion et Récapitulatif d'un projet, la liste des clients, la liste des projets du chat ; que le cercle tourne, qu'il est remplacé par le contenu à l'arrivée, et qu'il reste
// visible mais immobile avec le mouvement réduit. Requêtes ralenties pour avoir le temps de voir. À 1280 et 390 px.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const PROFILE = JSON.stringify({ resume: 'Un outil de devis.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'], stack: 'node' });
const TARGET = JSON.stringify({ description: 'TPE', secteurs: ['plomberie'], zone: 'Bretagne', requetes: ['q'] });
const SLOW = [/\/api\/projects\/\d+\/(recap|promo|linkedin)(\?|$)/, /\/clients\/projet\/\d+\/liste/, /\/api\/chat\/projects/];

for (const [mode, reduced] of [['normal', 'no-preference'], ['mouvement réduit', 'reduce']]) {
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${mode} ${vp.width}px`;
    const u = await s.newUser();
    const id = Number(await addProject(s.db, u.id, { name: 'Atelier' }));
    await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, id);
    await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'Boulangerie', 'b@boulangerie.fr', 'new', ?)").run(id, now());
    const ctx = await b.newContext({ viewport: vp, reducedMotion: reduced });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('todo-min', '1'); } catch { /* ignore */ } });
    let hold = true;
    await ctx.route('**/*', async (route) => {
      const r = route.request();
      if (r.method() === 'GET' && SLOW.some((re) => re.test(r.url()))) { while (hold) await new Promise((x) => setTimeout(x, 50)); } // la réponse n'arrive que quand on le décide
      return route.continue();
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const ring = (sel) => p.evaluate((q) => { const el = document.querySelector(q); if (!el) return null; const sp = el.querySelector('.spinner, .spin-inline'); if (!sp) return { ring: false, text: el.textContent.trim() }; const c = getComputedStyle(sp); const r = sp.getBoundingClientRect(); return { ring: true, anim: c.animationName, w: Math.round(r.width), visible: r.width > 0 && r.height > 0, text: el.textContent.trim() }; }, sel);

    // 1) les blocs du projet : on ouvre la section, la réponse est retenue
    await p.goto(`${s.base}/`); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { for (const k of ['linkedin', 'promo', 'recap']) { const d = document.querySelector(`details[data-acc="${k}"]`); if (d) d.open = true; } });
    for (const k of ['linkedin', 'promo', 'recap']) {
      await p.locator(`[data-${k}]`).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const r = await ring(`[data-${k}] .loading`);
      ok(r?.ring && r.visible && /^Chargement…/.test(r.text), `${tag} ${k} : cercle devant « Chargement… » (${JSON.stringify(r)})`);
      ok(reduced === 'reduce' ? r?.anim === 'none' : r?.anim === 'spin', `${tag} ${k} : ${reduced === 'reduce' ? 'cercle immobile' : 'le cercle tourne'} (animation « ${r?.anim} »)`);
    }
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal pendant le chargement`);
    hold = false; // les réponses arrivent
    ok(await waitFor(async () => (await p.locator('[data-recap] .loading').count()) === 0), `${tag} le cercle disparaît quand le contenu arrive (Récapitulatif)`);
    ok(await waitFor(async () => (await p.locator('[data-promo] .loading').count()) === 0 && (await p.locator('[data-linkedin] .loading').count()) === 0), `${tag} idem pour Promotion et LinkedIn`);

    // 2) liste des clients
    hold = true;
    await p.goto(`${s.base}/clients`); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { const d = document.querySelector('details[data-cl-project]'); if (d) d.open = true; });
    const cl = await ring('[data-cl-lists] .loading');
    ok(cl?.ring && cl.visible && /^Chargement…/.test(cl.text), `${tag} clients : cercle devant « Chargement… »`);
    hold = false;
    ok(await waitFor(async () => (await p.locator('[data-cl-lists] .loading').count()) === 0), `${tag} clients : remplacé par la liste`);

    // 3) liste des projets du chat
    hold = true;
    await p.goto(`${s.base}/chat`); await p.waitForSelector('html[data-nav="ready"]');
    await p.locator('[data-chat-projmenu] > summary').click();
    const ch = await ring('[data-chat-projlist] .loading');
    ok(ch?.ring && ch.visible && ch.w <= 14 && /^Chargement…/.test(ch.text), `${tag} chat : petit cercle devant « Chargement… » (${ch?.w} px)`);
    hold = false;
    ok(await waitFor(async () => (await p.locator('[data-chat-projlist] .loading').count()) === 0), `${tag} chat : remplacé par la liste des projets`);
    ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    hold = false; await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
