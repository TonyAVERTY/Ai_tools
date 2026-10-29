// Relecture des mails de prospection : variables vides sans reste, contrôle avant validation, relecture de Claude retenue ou refusée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fillBody, fillSubject, tidyTemplateText, reviewMail, acceptReview } from '../src/services/mailcheck.js';
import { buildProspectMail } from '../src/services/mailer.js';
import { Worker, latestJobs, enqueue } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
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

test('contrôle d\'un modèle : erreurs bloquantes et avertissements', () => {
  assert.deepEqual(reviewMail({ subject: 'Idée', body: 'Bonjour {{entreprise}}.\n\n{{expediteur}}\nMonEspacePro' }), { errors: [], warnings: [] });
  const bad = reviewMail({ subject: 'Offre gratuite {{nom}}', body: 'Bonjour.\n, MonEspacePro\n{{site' });
  assert.ok(bad.errors.some((e) => /\{\{nom\}\}/.test(e)), 'variable inconnue');
  assert.ok(bad.errors.some((e) => /ligne 2 commence par une virgule/.test(e)), 'ligne qui commence par une virgule');
  assert.ok(bad.errors.some((e) => /mal fermée/.test(e)), 'variable mal fermée');
  assert.ok(bad.warnings.some((w) => /anti-spam/.test(w)));
  assert.ok(reviewMail({ subject: 'x', body: '{{expediteur}}, MonEspacePro' }).warnings.some((w) => /signature/.test(w)));
  assert.ok(reviewMail({ subject: 'x', body: 'mot '.repeat(230) }).warnings.some((w) => /230 mots/.test(w)));
  assert.equal(tidyTemplateText('Bonjour \n, Tony ,\n\n\n\nFin  '), 'Bonjour\nTony,\n\nFin');
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
