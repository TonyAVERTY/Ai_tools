// Prompts modifiables : seules les consignes changent ; contexte et format de réponse restent imposés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting } from '../src/db.js';
import { startApp } from './helpers/server.js';
import {
  PROMPT_DEFS, parseCustomPrompts, instructions, templatePrompt, followupTemplatePrompt, linkedinPostPrompt, evolutionPrompt, prospectPrompt, analyzePrompt, MAX_CUSTOM,
} from '../src/services/prompts.js';

const profile = { resume: 'Un outil', proposition_valeur: 'Gagner du temps', arguments: ['rapide'], ton: 'direct' };
const target = { description: 'TPE', decideur: 'gérant', secteurs: ['a'], zone: 'FR', taille: 'TPE', requetes: ['q'] };

test('sans réglage : les prompts gardent leurs consignes par défaut et leur format de réponse', () => {
  assert.match(templatePrompt({ profile, target, senderName: 'Tony' }).prompt, /120 mots max[\s\S]*Expéditeur : Tony[\s\S]*Réponds UNIQUEMENT avec : \{"subject"/);
  assert.match(followupTemplatePrompt({ profile, senderName: 'Tony' }).prompt, /RELANCE[\s\S]*Réponds UNIQUEMENT avec : \{"body"/);
  assert.match(linkedinPostPrompt({ profile, target, author: 'Tony' }).prompt, /publié par Tony[\s\S]*\{"post"/);
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 4, level: 'rapide' }).prompt, /Propose 4 évolutions[\s\S]*8 fichiers[\s\S]*Format Markdown/);
  assert.match(prospectPrompt({ profile, target, count: 3, exclude: [] }).system, /Jamais inventés[\s\S]*- hook : 1 phrase[\s\S]*- score : pertinence[\s\S]*Arrête-toi dès que tu as 3 prospects\. Termine par DONE/);
  assert.match(analyzePrompt('P').prompt, /Lis 15 fichiers au maximum[\s\S]*Réponds UNIQUEMENT avec ce JSON/);
});

test('consignes modifiées : remplacent le défaut, [[valeurs]] insérées, format de réponse et règles de collecte intouchés', () => {
  const custom = {
    template: 'Écris un mail très court pour [[expediteur]], ton [[ton]]. Jamais de tutoiement.',
    prospect: 'hook : une question.\nscore : 1 à 5.',
    evolution: 'Donne [[nombre]] idées, [[fichiers]] fichiers.',
  };
  const t = templatePrompt({ profile, target, senderName: 'Tony', custom }).prompt;
  assert.match(t, /Écris un mail très court pour Tony, ton direct\. Jamais de tutoiement\./);
  assert.doesNotMatch(t, /120 mots max/);
  assert.match(t, /Réponds UNIQUEMENT avec : \{"subject":"\.\.\.","body":"\.\.\."\}/, 'format imposé');
  assert.match(t, /Ne mets PAS de lien de désinscription/, 'lien de désinscription : règle imposée');
  const p = prospectPrompt({ profile, target, count: 3, exclude: [], custom }).system;
  assert.match(p, /- hook : une question\.\n- score : 1 à 5\./);
  assert.match(p, /Uniquement des emails PROFESSIONNELS publiés publiquement/, 'règles de collecte imposées');
  assert.match(p, /PROSPECT \{"company"/, 'format de la ligne imposé');
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 4, level: 'normal', custom }).prompt, /Donne 4 idées, 15 fichiers\.[\s\S]*Format Markdown/);
  assert.equal(instructions('hook', { hook: '   ' }, { entreprise: 'X', site: 'y' }), instructions('hook', null, { entreprise: 'X', site: 'y' }), 'vide = défaut');
});

test('parseCustomPrompts : clés inconnues, vides, identiques au défaut et trop longues écartées', () => {
  const raw = JSON.stringify({ template: ' mon texte ', hook: PROMPT_DEFS.hook.text, audit: '', inconnu: 'x', linkedin: 'a'.repeat(MAX_CUSTOM + 500) });
  const out = parseCustomPrompts(raw);
  assert.deepEqual(Object.keys(out).sort(), ['linkedin', 'template']);
  assert.equal(out.template, 'mon texte');
  assert.equal(out.linkedin.length, MAX_CUSTOM);
  assert.deepEqual(parseCustomPrompts('pas du json'), {});
  assert.deepEqual(parseCustomPrompts(null), {});
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('réglages : modifier, retrouver et réinitialiser un prompt ; sans le champ, rien ne bouge ; isolation', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const base = { notify_email: '', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
  const html = async (x) => (await x.get('/settings', { headers: { accept: 'text/html' } })).text();
  let page = await html(u);
  assert.match(page, /id="prompts"/);
  assert.match(page, /name="prompt_template"/);
  assert.doesNotMatch(page, /badge warn">modifié/);

  assert.equal((await u.post('/settings', { ...base, prompt_template: 'Mon mail perso pour [[expediteur]]' }, { form: true })).status, 303);
  assert.deepEqual(parseCustomPrompts(await getSetting(s.db, u.id, 'prompts_json')), { template: 'Mon mail perso pour [[expediteur]]' });
  page = await html(u);
  assert.match(page, /Mon mail perso pour \[\[expediteur\]\]/);
  assert.match(page, /modifié/);
  assert.doesNotMatch(await html(v), /Mon mail perso/, 'les prompts d\'un compte ne passent pas à un autre');

  // un enregistrement sans les champs « prompt_* » ne touche à rien
  await u.post('/settings', base, { form: true });
  assert.match(await getSetting(s.db, u.id, 'prompts_json'), /Mon mail perso/);
  // trop long : refusé
  assert.equal((await u.post('/settings', { ...base, prompt_template: 'x'.repeat(MAX_CUSTOM + 1) }, { form: true })).status, 400);
  // texte par défaut renvoyé tel quel (bouton « revenir ») : plus de personnalisation
  await u.post('/settings', { ...base, prompt_template: PROMPT_DEFS.template.text }, { form: true });
  assert.equal(await getSetting(s.db, u.id, 'prompts_json'), '');
});
