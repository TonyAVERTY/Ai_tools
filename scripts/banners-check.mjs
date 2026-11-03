// Vérifie dans un vrai navigateur les bandeaux de résultat communs (src/banner.js, .msg msg-ok | msg-err | msg-warn) : même largeur que le panneau voisin
// (le nom .msg était écrasé par les bulles du chat : 760 px au plus et mise en colonne), icône avec le texte, rôle alert / status, et couleurs qui suivent le
// thème sombre. Contrôle aussi que le chat garde ses bulles. À 1280 et 390 px, en clair et en sombre.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

for (const scheme of ['light', 'dark']) {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const tag = `${scheme} ${vp.width}px`;
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const measure = () => p.evaluate(() => {
      const m = document.querySelector('.msg'); const c = getComputedStyle(m);
      const card = [...document.querySelectorAll('.card')].find((x) => x.getBoundingClientRect().width > 100);
      return { dir: c.flexDirection, role: m.getAttribute('role'), icon: !!m.querySelector('svg.ic use'), w: Math.round(m.getBoundingClientRect().width), cardW: Math.round(card.getBoundingClientRect().width), color: c.color, bg: c.backgroundColor, border: c.borderTopColor, right: Math.round(m.getBoundingClientRect().right) };
    });
    for (const [kind, url, role] of [['ok', `/account?t=ok&m=${encodeURIComponent('Réglage enregistré.')}`, 'status'], ['err', `/account?t=ko&m=${encodeURIComponent('Impossible de joindre le serveur de mail.')}`, 'alert']]) {
      await p.goto(s.base + url); await p.waitForSelector('.msg');
      const r = await measure();
      ok(r.dir === 'row', `${tag} ${kind} : l'icône et le texte sont côte à côte (${r.dir})`);
      ok(Math.abs(r.w - r.cardW) <= 1, `${tag} ${kind} : le bandeau a la largeur des panneaux (${r.w} px pour ${r.cardW} px)`);
      ok(r.role === role, `${tag} ${kind} : rôle « ${r.role} » (attendu « ${role} »)`);
      ok(r.icon, `${tag} ${kind} : une icône accompagne le texte (pas la couleur seule)`);
      ok(r.right <= vp.width, `${tag} ${kind} : tient dans l'écran`);
      ok(r.bg !== 'rgba(0, 0, 0, 0)' && r.color !== r.bg, `${tag} ${kind} : fond et texte distincts (${r.color} sur ${r.bg})`);
    }
    await p.goto(`${s.base}/settings?ok`); await p.waitForSelector('.msg');
    const st = await measure();
    ok(st.role === 'status' && st.icon && st.dir === 'row', `${tag} réglages enregistrés : même bandeau que les autres (rôle ${st.role})`);
    ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
}
// le chat garde ses bulles : la bulle de l'utilisateur est alignée à droite, en colonne, et limitée en largeur
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
await p.goto(`${s.base}/chat`); await p.waitForSelector('[data-chat-log]');
await p.evaluate(() => { const log = document.querySelector('[data-chat-log]'); const a = document.createElement('article'); a.className = 'chat-msg user'; a.innerHTML = '<div class="bubble">Bonjour</div>'; log.append(a); });
const bubble = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.chat-msg.user')); return { dir: c.flexDirection, max: c.maxWidth, self: c.alignSelf }; });
ok(bubble.dir === 'column' && bubble.self === 'flex-end' && /760/.test(bubble.max), `chat : la bulle garde sa mise en forme (${JSON.stringify(bubble)})`);
await ctx.close();
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
