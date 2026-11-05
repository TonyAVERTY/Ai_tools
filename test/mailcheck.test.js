// Relecture des mails de prospection : variables vides sans reste, contrôle avant validation, relecture de Claude retenue ou refusée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fillBody, fillSubject, tidyTemplateText, reviewMail, acceptReview } from '../src/services/mailcheck.js';
import { buildProspectMail } from '../src/services/mailer.js';
import { Worker, latestJobs, enqueue } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { readFileSync } from 'node:fs';
import { setSetting } from '../src/db.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { getTemplate } from '../src/projects.js';

const V = { entreprise: 'Le Fournil', ville: 'Rennes', accroche: 'Vos fournées sont belles.', expediteur: '', site: '' };

test('variable vide : plus de virgule en tête de ligne, ni de « Pour voir : » sans adresse, ni de ligne vide de texte', () => {
  // le cas de la capture : signature « {{expediteur}}, Produit » sans nom d'expéditeur
  assert.equal(fillBody('Bonjour.\n\n{{expediteur}}, MonEspacePro', V), 'Bonjour.\n\nMonEspacePro');
  assert.equal(fillBody('Salut\nPour voir le produit : {{site}}\nA bientôt', V), 'Salut\nA bientôt');
  assert.equal(fillBody('Salut\n{{expediteur}}\nFin', V), 'Salut\nFin');
  assert.equal(fillBody('Chez {{expediteur}} , à {{ville}}.', V), 'Chez, à Rennes.');
  // variables renseignées : rien n'est touché
  assert.equal(fillBody('{{expediteur}}, MonEspacePro\nPour voir : {{site}}', { ...V, expediteur: 'Tony', site: 'https://x.fr' }), 'Tony, MonEspacePro\nPour voir : https://x.fr');
  // une ligne sans variable vide reste telle quelle, même avec une virgule ou deux-points
  assert.equal(fillBody('Un point :\n, étrange', V), 'Un point :\n, étrange');
  assert.equal(fillSubject('{{expediteur}}, idée pour {{entreprise}}', V), 'idée pour Le Fournil');
});

test('le mail construit pour l\'envoi n\'a plus de ligne cassée (capture : signature « , MonEspacePro »)', () => {
  const mail = buildProspectMail({
    template: { subject: 'Idée pour {{entreprise}}', body: '{{accroche}}\n\nMonEspacePro aide les commerces.\n\nPour voir le produit : {{site}}\n\n{{expediteur}}, MonEspacePro' },
    prospect: { company: 'Le Fournil', email: 'a@b.fr', hook: 'Vos fournées sont belles.' }, smtp: { fromEmail: 'x@y.fr', fromName: '' }, unsubUrl: 'https://u', footer: false,
  });
  assert.ok(!mail.text.split('\n').some((l) => /^\s*,/.test(l)), mail.text);
  assert.doesNotMatch(mail.text, /Pour voir le produit/);
  assert.match(mail.text, /\nMonEspacePro$/);
});

test('relecture avec objet B : l\'objet B ne peut ni apparaître, ni disparaître, ni changer de variables', () => {
  const orig = { subject: 'Idée pour {{entreprise}}', subjectB: 'Carte pour {{entreprise}} ?', body: 'Bonjour {{entreprise}}.\n\n{{expediteur}}\nMonEspacePro' };
  const fixed = { subject: orig.subject, subject_b: 'Une carte pour {{entreprise}} ?', body: orig.body };
  assert.equal(acceptReview(orig, fixed), true);
  assert.equal(acceptReview(orig, { ...fixed, subject_b: 'Une carte ?' }), false, 'variable perdue dans l\'objet B');
  assert.equal(acceptReview(orig, { ...fixed, subject_b: '' }), false, 'objet B disparu');
  assert.equal(acceptReview({ ...orig, subjectB: '' }, fixed), false, 'objet B apparu');
  assert.equal(acceptReview({ ...orig, subjectB: '' }, { subject: orig.subject, body: orig.body }), true);
});

test('contrôle d\'un modèle : erreurs bloquantes et avertissements', () => {
  assert.deepEqual(reviewMail({ subject: 'Idée', body: 'Bonjour,\n\nUne idée pour {{entreprise}}.\n\nBien cordialement,\n{{expediteur}}\nMonEspacePro' }), { errors: [], warnings: [] });
  // « Bonjour {{entreprise}}, » salue une entreprise comme une personne (« Bonjour Une Bonne Bouteille, »)
  const named = reviewMail({ subject: '', body: 'Bonjour {{entreprise}},\n\nUne question.\n\nBien cordialement,\nTony' });
  assert.deepEqual(named.errors, []);
  assert.ok(named.warnings.some((w) => /salue une entreprise comme une personne/.test(w)));
  assert.ok(!reviewMail({ subject: '', body: 'Bonjour,\n\nChez {{entreprise}}, une question.\n\nBien cordialement,\nTony' }).warnings.some((w) => /salue une entreprise/.test(w)), 'le nom plus loin dans la phrase : rien à signaler');
  // Appel et politesse : signalés quand ils manquent (jamais bloquants), comme sur le modèle de relance de la capture
  const dry = reviewMail({ subject: '', body: 'Au passage en caisse, vos clients retrouvent leur carte.\nEst-ce un sujet chez vous ?\nTony AVERTY | MonEspacePro' });
  assert.deepEqual(dry.errors, []);
  assert.ok(dry.warnings.some((w) => /formule d'appel/.test(w)), 'pas de « Bonjour »');
  assert.ok(dry.warnings.some((w) => /formule de politesse avant la signature/.test(w)), 'pas de formule de politesse');
  assert.ok(!reviewMail({ subject: '', body: 'Bonjour,\n\nUne question.\n\nBonne journée,\nTony' }).warnings.some((w) => /formule/.test(w)), 'appel et politesse présents : rien à signaler');
  assert.ok(!reviewMail({ subject: '', body: 'Bonjour {{entreprise}},\n\nUne question.\n\nMerci' }).warnings.some((w) => /formule/.test(w)), '« Bonjour {{entreprise}}, » est un appel');
  const bad = reviewMail({ subject: 'Offre gratuite {{nom}}', body: 'Bonjour.\n, MonEspacePro\n{{site' });
  assert.ok(bad.errors.some((e) => /\{\{nom\}\}/.test(e)), 'variable inconnue');
  assert.ok(bad.errors.some((e) => /ligne 2 commence par une virgule/.test(e)), 'ligne qui commence par une virgule');
  assert.ok(bad.errors.some((e) => /mal fermée/.test(e)), 'variable mal fermée');
  assert.ok(bad.warnings.some((w) => /anti-spam/.test(w)));
  assert.ok(reviewMail({ subject: 'x', body: '{{expediteur}}, MonEspacePro' }).warnings.some((w) => /signature/.test(w)));
  assert.ok(reviewMail({ subject: 'x', body: 'mot '.repeat(230) }).warnings.some((w) => /230 mots/.test(w)));
  assert.equal(tidyTemplateText('Bonjour \n, Tony ,\n\n\n\nFin  '), 'Bonjour\nTony,\n\nFin');
});

test('promesses : le mail ne doit proposer que ce que la fiche du projet dit exister', () => {
  const facts = JSON.stringify([{ resume: 'Carte de fidélité dématérialisée, dès 19 €/mois, sans engagement', arguments: ['scan du QR code'] }]);
  const mail = { subject: 'Idée', body: 'Répondez « oui » et je vous envoie une démo gratuite, puis un devis ou un rendez-vous. Sans engagement.' };
  const w = reviewMail({ ...mail, facts }).warnings;
  assert.ok(w.some((x) => /une démonstration \(« démo »\)/.test(x)), 'démo non prévue par la fiche');
  assert.ok(w.some((x) => /essai ou une offre gratuite \(« gratuite »\)/.test(x)));
  assert.ok(w.some((x) => /un devis/.test(x)));
  assert.ok(w.some((x) => /un appel ou un rendez-vous/.test(x)));
  assert.ok(!w.some((x) => /garantie ou une absence d'engagement/.test(x)), 'la fiche dit « sans engagement » : pas d\'alerte');
  // la fiche parle de démonstration : plus d'alerte pour elle
  assert.ok(!reviewMail({ ...mail, facts: `${facts} démonstration en ligne` }).warnings.some((x) => /démonstration/.test(x)));
  // sans fiche fournie, aucune alerte de ce type (aucun faux positif)
  assert.deepEqual(reviewMail(mail).warnings.filter((x) => /fiche du projet/.test(x)), []);
});

test('relecture de Claude : retenue seulement si variables, adresses et longueur sont conservées', () => {
  const orig = { subject: 'Idée pour {{entreprise}}', body: 'Bonjour {{entreprise}}, voir https://x.fr maintenant.\n\n{{expediteur}}\nMonEspacePro' };
  const fix = (o = {}) => ({ ...orig, corrections: [], ...o });
  assert.equal(acceptReview(orig, fix({ body: 'Bonjour {{entreprise}}, voir https://x.fr dès maintenant.\n\n{{expediteur}}\nMonEspacePro' })), true);
  assert.equal(acceptReview(orig, fix({ body: orig.body.replace('{{expediteur}}', 'Tony') })), false, 'une variable disparaît');
  assert.equal(acceptReview(orig, fix({ body: `${orig.body}\n{{site}}` })), false, 'une variable apparaît');
  assert.equal(acceptReview(orig, fix({ body: orig.body.replace('https://x.fr', 'https://autre.fr') })), false, 'adresse changée');
  assert.equal(acceptReview(orig, fix({ body: 'Bonjour {{entreprise}} {{expediteur}} https://x.fr' })), false, 'texte trop raccourci');
  assert.equal(acceptReview(orig, fix({ body: `, ${orig.body}` })), false, 'ligne qui commence par une virgule');
  assert.equal(acceptReview(orig, null), false);
  assert.equal(acceptReview(orig, { subject: 5, body: 'x' }), false);
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('modèle généré : relu par Claude avant enregistrement, corrections affichées ; une relecture refusée laisse le texte d\'origine', async () => {
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp);
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'P' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?')
    .run(JSON.stringify({ resume: 'Cartes de fidélité', proposition_valeur: 'v' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), pid);
  const w = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });
  await enqueue(s.db, { userId: u.id, projectId: pid, type: 'template' });
  while (await w.tick()) { /* file */ }
  const job = (await latestJobs(s.db, pid)).template;
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.reviewed, true);
  assert.deepEqual(job.result.corrections, ['signature sans virgule']);
  assert.match((await getTemplate(s.db, pid, 'initial')).body, /\{\{expediteur\}\}$/);
  // objet B généré aussi (test A/B) : différent de l'objet A, conservé par la relecture
  const t = await getTemplate(s.db, pid, 'initial');
  assert.equal(t.subject, 'Idée pour {{entreprise}}');
  assert.equal(t.subject_b, 'Une carte de fidélité pour {{entreprise}} ?');
});

test('le modèle choisi dans les Réglages sert vraiment, et il est affiché : résultat du job et avancement', async () => {
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: `${s.tmp}/models.log` } });
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Modele' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?')
    .run(JSON.stringify({ resume: 'Cartes', proposition_valeur: 'v' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), pid);
  await setSetting(s.db, u.id, 'write_model', 'claude-sonnet-5-5');
  const w = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });
  await enqueue(s.db, { userId: u.id, projectId: pid, type: 'template' });
  while (await w.tick()) { /* file */ }
  const job = (await latestJobs(s.db, pid)).template;
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.model, 'claude-sonnet-5-5', 'le modèle réglé est celui du job');
  assert.match(job.progress.model, /Sonnet/, 'et il figure dans l\'avancement');
  const calls = readFileSync(`${s.tmp}/models.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.length >= 1 && calls.every((c) => c.model === 'claude-sonnet-5-5'), 'le CLI a reçu --model claude-sonnet-5-5 (rédaction et relecture)');
});

test('objet B identique à l\'objet A (réponse de Claude) : abandonné, pas de test A/B bidon', async () => {
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { name: 'claude-sameb' });
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'SameB' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?')
    .run(JSON.stringify({ resume: 'SAMEB cartes', proposition_valeur: 'v' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), pid);
  const w = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });
  await enqueue(s.db, { userId: u.id, projectId: pid, type: 'template' });
  while (await w.tick()) { /* file */ }
  assert.equal((await latestJobs(s.db, pid)).template.status, 'done');
  const t = await getTemplate(s.db, pid, 'initial');
  assert.equal(t.subject, 'Idée pour {{entreprise}}');
  assert.equal(t.subject_b, null);
});

test('validation : un modèle cassé est refusé (400), un modèle correct passe avec ses avertissements', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'V' });
  const save = (b) => u.post(`/api/projects/${pid}/template/save`, { kind: 'initial', mode: 'validate', ...b });
  const bad = await save({ subject: 'Idée', body: 'Bonjour.\n, MonEspacePro' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /commence par une virgule/);
  assert.ok(!(await getTemplate(s.db, pid, 'initial', { validatedOnly: true })), 'rien n\'est validé');
  assert.equal((await save({ subject: 'Idée', body: 'Bonjour {{inconnue}}.' })).status, 400);
  // un brouillon peut rester imparfait : seule la validation (donc l'envoi) est bloquée
  assert.equal((await u.post(`/api/projects/${pid}/template/save`, { kind: 'initial', subject: 'Idée', body: 'Bonjour.\n, X' })).status, 200);
  const ok = await save({ subject: 'Idée', body: 'Bonjour {{entreprise}}.\n\n{{expediteur}}, MonEspacePro' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).warnings.some((w) => /signature/.test(w)));
});
