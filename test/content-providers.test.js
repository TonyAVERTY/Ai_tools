import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt } from '../src/crypto.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// La recherche d'inspiration avant un contenu public ne vaut pas que pour Claude : elle passe aussi par Codex (ChatGPT), Gemini (clé API) et Antigravity (compte Google).
// Seul le cas « la recherche réussit » est vérifié ici ; la recherche en échec est couverte avec Claude (content.test.js). Les CLI sont simulés (test/fixtures/fake-*.js) : on vérifie que chaque fournisseur reçoit la phase de recherche, qu'elle arrive jusqu'au rédacteur et au brouillon.
let s, tmp;
const PROFILE = { resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'], ton: 'direct' };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-ctprov-'));
  s = await startApp({
    worker: true,
    cfg: {
      googleAccountEnabled: true, sandbox: { enabled: false, production: false },
      codexBin: makeClaudeBin(tmp, { fixture: 'fake-codex.js', name: 'codex-ct' }),
      geminiBin: makeClaudeBin(tmp, { fixture: 'fake-gemini.js', name: 'gemini-ct' }),
      agyBin: makeClaudeBin(tmp, { fixture: 'fake-agy.js', name: 'agy-ct' }),
    },
  });
  s.app.syncRepo = async (url, dir) => { mkdirSync(dir, { recursive: true }); return 'abc123'; };
});
after(async () => { await s.close(); rmSync(tmp, { recursive: true, force: true }); });

const secret = (v) => encrypt(s.app.cfg.secretKey, v);
const LINKS = {
  'ChatGPT (Codex)': () => ({ v: 1, provider: 'openai', mode: 'api_key', valid: true, last4: 'AAAA', secret_enc: secret(`sk-proj-${'A'.repeat(40)}`) }),
  'Gemini (clé API)': () => ({ v: 1, provider: 'gemini', mode: 'api_key', valid: true, last4: 'AAAA', secret_enc: secret(`AIzaSy${'A'.repeat(33)}`) }),
  'Gemini (Antigravity)': () => ({ v: 1, provider: 'gemini', mode: 'google_account', valid: true, linked_at: 1000, secret_enc: secret(JSON.stringify({ refresh_token: `1//${'R'.repeat(40)}` })) }),
};

for (const [name, link] of Object.entries(LINKS)) {
  test(`${name} : la recherche d'inspiration tourne, et la newsletter la reçoit`, async () => {
    const u = await s.newUser({ admin: false, link: link() });
    const p = await addProject(s.db, u.id, { name: 'Cartes Fidèles', gitUrl: 'https://github.com/u/cf.git' });
    await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ? WHERE id = ?').run(JSON.stringify(PROFILE), JSON.stringify({ description: 'commerces' }), p);
    const gen = async (body) => { const r = await u.post(`/api/projects/${p}/content/newsletter/generate`, body); assert.equal(r.status, 200, await r.clone().text()); await s.app.worker.tick(); };
    const job = () => s.db.prepare("SELECT status, error FROM jobs WHERE project_id = ? AND type = 'newsletter' ORDER BY id DESC").get(p);
    await gen({});
    assert.equal((await job()).status, 'done', (await job()).error);
    const list = async () => (await (await u.get(`/api/projects/${p}/content/newsletter`)).json()).drafts;
    const [first] = await list();
    assert.match(first.extra.inspiration, /Secteur : cartes de fidélité/, 'la recherche a tourné chez ce fournisseur');
    assert.match(first.title, /avec recherche/, 'et le rédacteur a reçu ce que la recherche a trouvé');
  });
}
