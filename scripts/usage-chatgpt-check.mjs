// Vérifie dans un vrai navigateur la carte « Consommation ChatGPT » de la page Projets : les deux fenêtres (session 5 h, semaine) avec leur remise à zéro,
// les tokens mesurés par iaboss, aucun montant en $ ; le relevé en direct est simulé (aucun compte réel). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { encrypt } from '../src/crypto.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const jwt = `h.${Buffer.from(JSON.stringify({ exp: now() + 86400 })).toString('base64url')}.s`;
const auth = JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'i'.repeat(30), access_token: jwt, refresh_token: 'r'.repeat(30), account_id: 'acc-1' } });
const u = await s.newUser({ admin: false });
await s.db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(JSON.stringify({ v: 1, provider: 'openai', mode: 'chatgpt_account', valid: true, linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, auth) }), u.id);
await s.db.prepare("INSERT INTO jobs(user_id, type, status, tokens_in, tokens_out, created_at, finished_at) VALUES(?, 'prospect', 'done', 300000, 78750, ?, ?)").run(u.id, now(), now());
s.app.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rate_limit: { primary_window: { used_percent: 61, limit_window_seconds: 18000, reset_after_seconds: 7200 }, secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_after_seconds: 3 * 86400 } } }) });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/projets`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('[data-claude-card]:not([hidden])', { timeout: 8000 });
  const t = await p.locator('[data-claude-card]').innerText();
  ok(/Consommation ChatGPT/.test(t), `${tag} carte « Consommation ChatGPT »`);
  ok(/ChatGPT session 5 h\s*61 %/.test(t) && /ChatGPT semaine\s*12 %/.test(t), `${tag} les deux fenêtres avec leur pourcentage`);
  ok((t.match(/Remise à zéro/g) || []).length === 2, `${tag} l'heure de remise à zéro de chaque fenêtre`);
  ok(/ChatGPT via iaboss 24 h\s*378[\s  ]750 tokens/.test(t), `${tag} tokens mesurés par iaboss`);
  ok(!/\$/.test(t), `${tag} aucun montant en $`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/usage-chatgpt-${vp.width}.png` });
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
