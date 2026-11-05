// Contrôle du sens des mails (src/services/mailsense.js) : l'IA de la personne relit chaque mail rempli, dans l'aperçu (avec une correction proposée,
// jamais appliquée seule) et à l'envoi (par lots de 10 ; un mail sans sens ne part pas ; sans réponse de l'IA, rien ne part).
// Le faux Claude (test/fixtures/fake-claude.js) juge « sans sens » tout mail rempli qui contient SENSEBAD, et ne répond pas lisiblement avec SENSEDOWN.
import { test, before, after } from 'node:test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers, makeClaude } from '../src/handlers.js';
import { saveSecretConfig } from '../src/projects.js';
import { parseSense, acceptRephrase, SenseUnavailable, SENSE_BATCH } from '../src/services/mailsense.js';
import { setSetting, now } from '../src/db.js';

let s;
const sentMails = [];
before(async () => {
  s = await startApp({ cfg: { claudeBin: resolve('test/fixtures/fake-claude.js') }, createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sentMails.push(m); }, close() {} }) });
  s.app.resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
  s.app.resolveMx = async () => [{ exchange: 'mx.test', priority: 10 }];
});
after(async () => { await s.close(); });

const PROFILE = JSON.stringify({ resume: 'Cartes de fidélité.', proposition_valeur: 'Fidéliser sans carton.', arguments: ['simple'], ton: 'direct' });
const ids = (prompt) => [...String(prompt).matchAll(/\[id=(\d+)\]/g)].length;

/** Un compte, un projet avec un modèle validé, un SMTP, et `n` prospects ; `claude` : le lanceur d'IA (compte les appels). */
async function world({ body = 'Bonjour {{entreprise}}.', n = 3, company = (i) => `Fournil ${i}`, claude } = {}) {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, JSON.stringify({ description: 'x' }), pid);
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Bonjour {{entreprise}}', ?, 'validated', ?)").run(pid, body, now());
  await saveSecretConfig(s.app, pid, 'smtp_enc', { host: 'smtp.x', port: 587, user: 'u', pass: 'secret', fromEmail: 'moi@x.fr', fromName: 'Moi' }, 'pass');
  await setSetting(s.db, u.id, 'send_delay_min', '0');
  await setSetting(s.db, u.id, 'send_delay_max', '0');
  const calls = [];
  const runner = claude || ((userId, o) => { calls.push(ids(o.prompt)); return makeClaude(s.app)(userId, o); });
  const worker = new Worker(s.db, makeHandlers(s.app, { claude: runner }), { log: { error() {} } });
  for (let i = 1; i <= n; i++) await s.db.prepare("INSERT INTO prospects(project_id, company, email, source, status, score, created_at) VALUES(?, ?, ?, 'https://fournil.fr/contact', 'new', ?, ?)").run(pid, company(i), `p${i}-${pid}@fournil${i}.fr`, 100 - i, now());
  const send = async (count = n) => { await enqueue(s.db, { userId: u.id, projectId: pid, type: 'send', params: { count } }); await worker.tick(); return (await latestJobs(s.db, pid)).send; };
  return { u, pid, send, calls, mails: () => sentMails.filter((m) => m.to.includes(`-${pid}@`)) };
}

test('parseSense : un avis par mail ; une correction n\'est gardée que si elle ne change ni variables, ni adresses', () => {
  const tpl = 'Pour {{entreprise}}, un client revient. Voir https://x.fr';
  const ok = parseSense('{"results":[{"id":1,"ok":true},{"id":2,"ok":false,"problem":"La phrase ne veut rien dire","fix_body":"Chez {{entreprise}}, un client revient. Voir https://x.fr"}]}', [1, 2], tpl);
  assert.deepEqual(ok.get(1), { ok: true });
  assert.equal(ok.get(2).ok, false);
  assert.match(ok.get(2).problem, /ne veut rien dire/);
  assert.equal(ok.get(2).fixBody, 'Chez {{entreprise}}, un client revient. Voir https://x.fr');
  const added = parseSense('{"results":[{"id":1,"ok":false,"problem":"p","fix_body":"Chez {{entreprise}} à {{ville}}, un client revient. Voir https://x.fr"}]}', [1], tpl);
  assert.equal(added.get(1).fixBody, undefined, 'une variable ajoutée : pas de correction');
  const unknown = parseSense('{"results":[{"id":1,"ok":false,"problem":"p","fix_body":"Chez {{nom}}, un client revient. Voir https://x.fr"}]}', [1], tpl);
  assert.equal(unknown.get(1).fixBody, undefined, 'une variable inconnue : pas de correction');
  // Retirer une variable est permis : « Bonjour {{entreprise}}, » devient « Bonjour, »
  const greet = 'Bonjour {{entreprise}},\n\nUn client revient et présente sa carte.\n\nBien cordialement,\nTony';
  const dropped = parseSense(JSON.stringify({ results: [{ id: 1, ok: false, problem: 'Bonjour salue une entreprise', fix_body: greet.replace(' {{entreprise}}', '') }] }), [1], greet);
  assert.equal(dropped.get(1).fixBody, 'Bonjour,\n\nUn client revient et présente sa carte.\n\nBien cordialement,\nTony');
  const url = parseSense('{"results":[{"id":1,"ok":false,"problem":"p","fix_body":"Chez {{entreprise}}, un client revient. Voir https://autre.fr"}]}', [1], tpl);
  assert.equal(url.get(1).fixBody, undefined, 'une adresse changée : pas de correction');
  const same = parseSense('{"results":[{"id":1,"ok":false,"problem":"p","fix_body":"Pour {{entreprise}}, un client revient. Voir https://x.fr"}]}', [1], tpl);
  assert.equal(same.get(1).fixBody, undefined, 'une « correction » identique n\'en est pas une');
  for (const bad of ['pas du json', '{"results":[{"id":1,"ok":true}]}', '{"results":[{"id":1,"ok":"oui"},{"id":2,"ok":true}]}']) {
    assert.throws(() => parseSense(bad, [1, 2], tpl), SenseUnavailable, `réponse inutilisable : ${bad}`);
  }
});

test('envoi : tout a un sens → relu par lots de 10 (12 mails = 2 appels), tout part', async () => {
  const w = await world({ n: 12 });
  const job = await w.send();
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.sent, 12);
  assert.equal(w.mails().length, 12);
  assert.deepEqual(w.calls, [SENSE_BATCH, 2], 'un appel pour les 10 premiers, un pour les 2 suivants');
  assert.equal(job.result.unclear, undefined);
});

test('envoi : un mail sans sens ne part pas (« Non envoyé » avec la raison dans Mails), les autres partent', async () => {
  const w = await world({ n: 3, company: (i) => (i === 2 ? 'Fournil SENSEBAD' : `Fournil ${i}`) });
  const job = await w.send();
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.sent, 2);
  assert.equal(job.result.unclear, 1);
  assert.deepEqual(w.mails().map((m) => m.to).sort(), [`p1-${w.pid}@fournil1.fr`, `p3-${w.pid}@fournil3.fr`]);
  const row = await s.db.prepare("SELECT status FROM prospects WHERE project_id = ? AND email = ?").get(w.pid, `p2-${w.pid}@fournil2.fr`);
  assert.equal(row.status, 'new', 'le prospect reste à contacter : rien n\'est perdu');
  const log = await s.db.prepare('SELECT error FROM mail_log WHERE project_id = ? AND error IS NOT NULL').all(w.pid);
  assert.equal(log.length, 1);
  assert.match(log[0].error, /^Non envoyé : le texte n'a pas de sens \(La phrase d'ouverture ne veut rien dire\)/);
});

test('envoi : le modèle lui-même n\'a pas de sens → rien ne part, l\'erreur renvoie vers l\'aperçu', async () => {
  const w = await world({ n: 3, body: 'Pour {{entreprise}} SENSEBAD, un client revient.' });
  const job = await w.send();
  assert.equal(job.status, 'error');
  assert.match(job.error, /Aucun mail n'est parti : ton IA juge que le texte n'a pas de sens/);
  assert.match(job.error, /Ouvre « Aperçu »/);
  assert.equal(w.mails().length, 0);
  assert.equal(Number((await s.db.prepare("SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND status = 'new'").get(w.pid)).n), 3, 'aucun prospect n\'a changé d\'état');
});

test('envoi : l\'IA ne répond pas lisiblement → rien ne part, prospects intacts', async () => {
  const w = await world({ n: 3, body: 'Bonjour {{entreprise}} SENSEDOWN.' });
  const job = await w.send();
  assert.equal(job.status, 'error');
  assert.match(job.error, /Relecture par l'IA impossible/);
  assert.match(job.error, /Aucun mail n'est parti/);
  assert.equal(w.mails().length, 0);
});

test('envoi : l\'IA tombe après un premier lot → ce qui est relu part, le reste attend, le résultat le dit', async () => {
  let calls = 0;
  const flaky = (userId, o) => { calls++; if (calls > 1) throw Object.assign(new Error('service indisponible'), { status: 503 }); return makeClaude(s.app)(userId, o); };
  const w = await world({ n: 12, claude: flaky });
  const job = await w.send(12);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.sent, 10, 'le premier lot (10 mails relus) est parti');
  assert.match(job.result.waiting, /l'IA n'a pas pu répondre/);
  assert.equal(w.mails().length, 10);
  assert.equal(Number((await s.db.prepare("SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND status = 'new'").get(w.pid)).n), 2, 'les 2 derniers attendent');
});

// ---------- Aperçu ----------
const sense = (u, pid, body = {}) => u.post(`/api/projects/${pid}/template/sense`, { kind: 'initial', subject: 'Bonjour {{entreprise}}', body: 'Bonjour {{entreprise}}.', ...body });

test('aperçu : un mail qui a du sens est confirmé', async () => {
  const w = await world({ n: 1 });
  const r = await (await sense(w.u, w.pid)).json();
  assert.equal(r.ok, true);
  assert.equal(r.sense, true);
  assert.equal(r.problem, null);
  assert.equal(r.fixBody, null);
});

test('aperçu : un mail sans sens → le problème et une correction du MODÈLE (variables gardées), rien n\'est modifié', async () => {
  const w = await world({ n: 1, company: () => 'Boulangerie Fanet' });
  const body = 'Pour {{entreprise}} SENSEBAD, un client qui revient peut présenter sa carte.';
  const prospect = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(w.pid);
  const r = await (await sense(w.u, w.pid, { body, prospectId: prospect.id })).json();
  assert.equal(r.sense, false);
  assert.match(r.problem, /ne veut rien dire/);
  assert.equal(r.fixBody, 'Pour {{entreprise}} bien, un client qui revient peut présenter sa carte.');
  assert.equal(r.fixedText, 'Pour Boulangerie Fanet bien, un client qui revient peut présenter sa carte.', 'la version corrigée est montrée remplie, comme le prospect la lira');
  const tpl = await s.db.prepare("SELECT body FROM templates WHERE project_id = ? AND kind = 'initial'").get(w.pid);
  assert.equal(tpl.body, 'Bonjour {{entreprise}}.', 'le modèle enregistré n\'a pas bougé');
});

test('aperçu : IA illisible → « indisponible » avec la raison, jamais une erreur serveur ; une relance se contrôle sans objet', async () => {
  const w = await world({ n: 1 });
  const down = await sense(w.u, w.pid, { body: 'Bonjour SENSEDOWN' });
  assert.equal(down.status, 200);
  const d = await down.json();
  assert.equal(d.unavailable, true);
  assert.match(d.reason, /réponse lisible/);
  // Une relance n'a pas d'objet à relire : le corps seul est contrôlé
  assert.equal((await (await sense(w.u, w.pid, { kind: 'followup', subject: '', body: 'Petite relance, {{entreprise}} ?' })).json()).sense, true);
});

test('aperçu : corps vide, projet d\'un autre compte, prospect d\'un autre projet, visiteur', async () => {
  const w = await world({ n: 1 });
  const other = await s.newUser({ admin: false, link: testTokenLink() });
  assert.equal((await sense(w.u, w.pid, { body: '  ' })).status, 400);
  assert.equal((await sense(other, w.pid)).status, 404, 'le projet d\'un autre compte est introuvable');
  const w2 = await world({ n: 1 });
  const foreign = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(w2.pid);
  assert.equal((await sense(w.u, w.pid, { prospectId: foreign.id })).status, 404, 'un prospect d\'un autre projet est introuvable');
  assert.equal((await sense(s.anon, w.pid)).status, 401);
});

test('question posée à l\'IA : « Bonjour Une Bonne Bouteille, » est un défaut, et la correction peut retirer la variable fautive', async () => {
  const { senseMailPrompt } = await import('../src/services/prompts.js');
  const { prompt } = senseMailPrompt({ template: 'Bonjour {{entreprise}},\n\nUne question.', items: [{ id: 7, subject: '', body: 'Bonjour Une Bonne Bouteille,\n\nUne question.' }] });
  assert.match(prompt, /l'appel salue une entreprise comme une personne/);
  assert.match(prompt, /\[id=7\]/);
  assert.match(prompt, /tu peux alors la retirer de cette phrase/);
  assert.match(prompt, /N'ajoute aucune variable/);
});

// ---------- Changer une phrase ----------
const BODY = 'Bonjour,\n\nChez {{entreprise}}, une carte dans le téléphone aide les clients à revenir. Voir https://x.fr\n\nEst-ce un sujet chez vous ?\n\nBien cordialement,\nTony';
const rephrase = (u, pid, body = {}) => u.post(`/api/projects/${pid}/template/rephrase`, { kind: 'followup', body: BODY, ...body });
const at = (text) => ({ start: BODY.indexOf(text), end: BODY.indexOf(text) + text.length });

test('acceptRephrase : même office, aucune variable ajoutée, mêmes adresses, longueur voisine, différente et jamais déjà refusée', () => {
  const orig = 'Chez {{entreprise}}, une carte aide les clients à revenir.';
  assert.equal(acceptRephrase(orig, 'À {{entreprise}}, une carte de fidélité aide les clients à revenir.'), true);
  assert.equal(acceptRephrase(orig, 'Une carte aide les clients à revenir.'), true, 'retirer une variable est permis');
  assert.equal(acceptRephrase(orig, 'Chez {{entreprise}}, une carte aide les clients à revenir.'), false, 'identique');
  assert.equal(acceptRephrase(orig, 'chez {{entreprise}} : une carte aide les clients à revenir !'), false, 'identique à la casse et à la ponctuation près');
  assert.equal(acceptRephrase(orig, 'Une carte à {{ville}} aide les clients.'), false, 'variable ajoutée');
  assert.equal(acceptRephrase(orig, 'Une carte aide les clients à revenir. https://autre.fr'), false, 'adresse ajoutée');
  assert.equal(acceptRephrase(orig, 'Oui.'), false, 'beaucoup trop court');
  assert.equal(acceptRephrase(orig, `${'mot '.repeat(60)}`), false, 'beaucoup trop long');
  assert.equal(acceptRephrase(orig, ', une carte aide les clients à revenir sans souci.'), false, 'virgule en tête de ligne');
  assert.equal(acceptRephrase(orig, 'Une carte de fidélité aide les clients à revenir.', ['Une carte de fidélité aide les clients à revenir']), false, 'déjà refusée');
  assert.equal(acceptRephrase(orig, 42), false);
});

test('changer une phrase : l\'IA en propose une autre, la page reçoit la phrase du modèle et sa version remplie, rien n\'est modifié', async () => {
  const w = await world({ n: 1, company: () => 'Boulangerie Le Fournil' });
  const prospect = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(w.pid);
  const sentence = 'Est-ce un sujet chez vous ?';
  const r = await (await rephrase(w.u, w.pid, { ...at(sentence), prospectId: prospect.id })).json();
  assert.equal(r.ok, true);
  assert.equal(r.sentence, `Autre formulation 1 : ${sentence}`);
  assert.equal(r.shown, `Autre formulation 1 : ${sentence}`);
  // Une phrase avec une variable : la proposition garde son modèle, la version remplie montre le nom du prospect
  const withVar = 'Chez {{entreprise}}, une carte dans le téléphone aide les clients à revenir.';
  const v = await (await rephrase(w.u, w.pid, { ...at(withVar), prospectId: prospect.id })).json();
  assert.match(v.sentence, /^Autre formulation 1 : Chez \{\{entreprise\}\}, une carte/);
  assert.match(v.shown, /^Autre formulation 1 : Chez Boulangerie Le Fournil, une carte/);
  const tpl = await s.db.prepare("SELECT body FROM templates WHERE project_id = ? AND kind = 'initial'").get(w.pid);
  assert.equal(tpl.body, 'Bonjour {{entreprise}}.', 'le modèle enregistré n\'a pas bougé');
});

test('changer une phrase : les propositions déjà refusées sont données à l\'IA et ne reviennent pas', async () => {
  const w = await world({ n: 1 });
  const sentence = 'Est-ce un sujet chez vous ?';
  const first = await (await rephrase(w.u, w.pid, at(sentence))).json();
  const second = await (await rephrase(w.u, w.pid, { ...at(sentence), avoid: [first.sentence] })).json();
  assert.equal(second.sentence, `Autre formulation 2 : ${sentence}`);
  assert.notEqual(second.sentence, first.sentence);
});

test('changer une phrase : proposition inutilisable ou IA illisible → « indisponible » avec la raison, jamais une erreur serveur', async () => {
  const w = await world({ n: 1 });
  const same = await rephrase(w.u, w.pid, { body: `${BODY} REPHRASEBAD`, start: 0, end: 'Bonjour,'.length });
  assert.equal(same.status, 200);
  const a = await same.json();
  assert.equal(a.unavailable, true);
  assert.match(a.reason, /phrase utilisable/);
  const down = await (await rephrase(w.u, w.pid, { body: `${BODY} REPHRASEDOWN`, start: 0, end: 'Bonjour,'.length })).json();
  assert.equal(down.unavailable, true);
  assert.match(down.reason, /réponse lisible/);
});

test('changer une phrase : sélection impossible, prospect ou projet d\'un autre compte, visiteur', async () => {
  const w = await world({ n: 1 });
  const ok = at('Est-ce un sujet chez vous ?');
  for (const bad of [{ start: -1, end: 5 }, { start: 5, end: 5 }, { start: 5, end: 99999 }, { start: 'a', end: 9 }, { start: 0, end: 700 }]) {
    assert.equal((await rephrase(w.u, w.pid, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await rephrase(w.u, w.pid, { start: BODY.indexOf('\n\n'), end: BODY.indexOf('\n\n') + 2 })).status, 400, 'des espaces seuls ne sont pas une phrase');
  const other = await s.newUser({ admin: false, link: testTokenLink() });
  assert.equal((await rephrase(other, w.pid, ok)).status, 404, 'le projet d\'un autre compte est introuvable');
  const w2 = await world({ n: 1 });
  const foreign = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(w2.pid);
  assert.equal((await rephrase(w.u, w.pid, { ...ok, prospectId: foreign.id })).status, 404, 'un prospect d\'un autre projet est introuvable');
  assert.equal((await rephrase(s.anon, w.pid, ok)).status, 401);
});

test('aperçu : renvoie les valeurs des variables, pour retrouver dans le modèle la phrase sélectionnée', async () => {
  const w = await world({ n: 1, company: () => 'Boulangerie Le Fournil' });
  const prospect = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(w.pid);
  const r = await (await w.u.post(`/api/projects/${w.pid}/template/preview`, { kind: 'initial', subject: 'Bonjour {{entreprise}}', body: 'Bonjour {{entreprise}}.', prospectId: prospect.id })).json();
  assert.equal(r.vars.entreprise, 'Boulangerie Le Fournil');
  assert.deepEqual(Object.keys(r.vars).sort(), ['accroche', 'entreprise', 'expediteur', 'site', 'ville']);
  assert.equal(r.vars.expediteur, 'Moi');
});
