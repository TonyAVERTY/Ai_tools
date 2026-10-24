// Aucun montant en $ avec un compte Claude relié par abonnement (rien n'est facturé en plus) : rapport hebdo, récapitulatif, notifications. Les clés API gardent leurs montants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { weeklyStats, weeklyText } from '../src/services/report.js';
import { weeklyMail } from '../src/services/mailhtml.js';
import { isPriced } from '../src/claudelink.js';
import { now } from '../src/db.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const API_LINK = { v: 1, mode: 'api_key', valid: true };
const withCost = async (u, pid) => {
  await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, cost_usd, created_at, finished_at) VALUES(?, ?, 'analyze', 'done', 0.43, ?, ?)").run(pid, u.id, now(), now());
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'F', 'a@f.fr', 'new', ?)").run(pid, now());
};

test('isPriced : seule une clé API est facturée à l\'usage', async () => {
  const api = await s.newUser({ admin: false, link: API_LINK });
  const sub = await s.newUser({ admin: false, link: testTokenLink() });
  const none = await s.newUser({ admin: false, link: null });
  assert.equal(await isPriced(s.db, api.id), true);
  assert.equal(await isPriced(s.db, sub.id), false);
  assert.equal(await isPriced(s.db, none.id), false);
});

test('rapport hebdomadaire : coût IA présent avec une clé API, absent avec un abonnement', async () => {
  for (const [link, priced] of [[API_LINK, true], [testTokenLink(), false]]) {
    const u = await s.newUser({ admin: false, link });
    const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/f.git' });
    await withCost(u, pid);
    const st = await weeklyStats(s.db, u.id);
    assert.equal(st.priced, priced);
    assert.equal(st.totals.cost > 0, true, 'le coût est mesuré dans les deux cas');
    const text = weeklyText(st);
    const html = weeklyMail(st, { period: 'semaine', appUrl: 'https://ai.test' });
    const body = typeof html === 'string' ? html : (html.html || JSON.stringify(html));
    assert.equal(/Coût IA/.test(text), priced, `texte (priced=${priced})`);
    assert.equal(/\d\.\d\d \$/.test(text), priced, 'aucun montant en $ dans le texte');
    assert.equal(/Coût IA/.test(body), priced, `mail HTML (priced=${priced})`);
    assert.equal(/\d\.\d\d \$/.test(body), priced, 'aucun montant en $ dans le mail');
    assert.match(text, /prospect\(s\) trouvé\(s\)/, 'le reste du rapport est intact');
  }
});

test('récapitulatif du projet : le serveur dit si le montant a un sens', async () => {
  for (const [link, priced] of [[API_LINK, true], [testTokenLink(), false]]) {
    const u = await s.newUser({ admin: false, link });
    const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/f.git' });
    const r = await u.get(`/api/projects/${pid}/recap`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).priced, priced);
  }
});
