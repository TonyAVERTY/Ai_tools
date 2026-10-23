// Prompts : consignes poussées par défaut, variantes par gamme de modèle, personnalisation (tous les modèles / une gamme).
// Seules les consignes changent ; contexte et format de réponse restent imposés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting } from '../src/db.js';
import { startApp } from './helpers/server.js';
import {
  PROMPT_DEFS, parseCustomPrompts, instructions, resolveText, defaultText, promptsView, templatePrompt, followupTemplatePrompt, linkedinPostPrompt, evolutionPrompt,
  prospectPrompt, analyzePrompt, hookPrompt, auditPrompt, MAX_CUSTOM,
} from '../src/services/prompts.js';
import { RECOMMENDED, OTHERS, isModel, normalizeModel, modelFamily, FAMILIES } from '../src/services/models.js';

const profile = { resume: 'Un outil', proposition_valeur: 'Gagner du temps', arguments: ['rapide'], ton: 'direct' };
const target = { description: 'TPE', decideur: 'gérant', secteurs: ['a'], zone: 'FR', taille: 'TPE', requetes: ['q'] };

test('sans réglage : consignes poussées, avec leur format de réponse imposé', () => {
  assert.match(templatePrompt({ profile, target, senderName: 'Tony' }).prompt, /Expéditeur : Tony[\s\S]*120 mots maximum[\s\S]*Objet : 4 à 7 mots[\s\S]*Réponds UNIQUEMENT avec : \{"subject"/);
  assert.match(followupTemplatePrompt({ profile, senderName: 'Tony' }).prompt, /RELANCE[\s\S]*culpabilisation[\s\S]*Réponds UNIQUEMENT avec : \{"body"/);
  assert.match(linkedinPostPrompt({ profile, target, author: 'Tony' }).prompt, /publié par Tony[\s\S]*Ligne 1 : l'accroche[\s\S]*\{"post"/);
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 4, level: 'rapide' }).prompt, /Propose 4 évolutions[\s\S]*8 fichiers[\s\S]*bénéfice utilisateur divisé par l'effort[\s\S]*Format Markdown/);
  assert.match(prospectPrompt({ profile, target, count: 3, exclude: [] }).system, /Jamais inventés[\s\S]*Consignes pour les champs hook et score :[\s\S]*score, pertinence de 1 à 10[\s\S]*Arrête-toi dès que tu as 3 prospects\. Termine par DONE/);
  assert.match(analyzePrompt('P').prompt, /Lis 15 fichiers au maximum[\s\S]*Réponds UNIQUEMENT avec ce JSON/);
  assert.match(hookPrompt({ profile, prospect: { company: 'Fournil', website: 'https://f.fr' } }).prompt, /UNE accroche[\s\S]*Interdits[\s\S]*Réponds UNIQUEMENT avec : \{"hook"/);
  assert.match(auditPrompt({ projectName: 'P', level: 'normal' }).prompt, /Règles de preuve[\s\S]*Gravité[\s\S]*## Résumé/);
  for (const [k, d] of Object.entries(PROMPT_DEFS)) {
    assert.ok(d.text.length > 850, `${k} : consigne poussée (${d.text.length} caractères)`);
    assert.ok(d.text.length + 400 < MAX_CUSTOM, `${k} : tient dans la limite d'édition`);
    for (const f of FAMILIES) assert.ok(d.byModel[f]?.length > 90, `${k} : complément pour ${f}`);
  }
});

test('par modèle : chaque gamme reçoit son complément ; sans modèle, le texte commun seul', () => {
  const t = (model) => templatePrompt({ profile, target, senderName: 'Tony', model }).prompt;
  assert.match(t('haiku'), /Reste sous 100 mots/);
  assert.match(t('claude-haiku-4-5'), /Reste sous 100 mots/, 'un modèle précis suit sa gamme');
  assert.match(t('sonnet'), /Adapte le registre au décideur/);
  assert.match(t('claude-opus-5-5'), /décideur sceptique/);
  assert.match(t('claude-fable-5-1'), /excellent commercial/);
  assert.doesNotMatch(t('opus'), /Reste sous 100 mots/);
  assert.doesNotMatch(t(null), /Reste sous 100 mots|décideur sceptique|excellent commercial|Adapte le registre/);
  // évolution et audit : le modèle vient du niveau choisi quand on ne le donne pas
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 3, level: 'rapide' }).prompt, /nomme d'abord le fichier/);
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 3, level: 'approfondi' }).prompt, /gains rapides des paris structurants/);
  assert.match(auditPrompt({ projectName: 'P', level: 'rapide' }).prompt, /Parcours les six points/);
  assert.match(auditPrompt({ projectName: 'P', level: 'normal', model: 'claude-fable-5' }).prompt, /expert indépendant/);
  assert.equal(defaultText('hook'), PROMPT_DEFS.hook.text);
  assert.equal(defaultText('hook', 'opus'), `${PROMPT_DEFS.hook.text}\n\n${PROMPT_DEFS.hook.byModel.opus}`);
});

test('consignes modifiées : « tous les modèles » ou une gamme ; la gamme prime ; [[valeurs]] insérées ; format et règles intouchés', () => {
  const custom = {
    '*': { template: 'Écris un mail très court pour [[expediteur]], ton [[ton]]. Jamais de tutoiement.', prospect: 'hook : une question.\nscore : 1 à 5.', evolution: 'Donne [[nombre]] idées, [[fichiers]] fichiers.' },
    opus: { template: 'Version Opus pour [[expediteur]].' },
  };
  const t = (model) => templatePrompt({ profile, target, senderName: 'Tony', custom, model }).prompt;
  assert.match(t('haiku'), /Écris un mail très court pour Tony, ton direct\. Jamais de tutoiement\./);
  assert.doesNotMatch(t('haiku'), /120 mots max/);
  assert.match(t('claude-opus-4-8'), /Version Opus pour Tony\./, 'la gamme prime');
  assert.doesNotMatch(t('opus'), /Jamais de tutoiement/);
  assert.match(t('sonnet'), /Jamais de tutoiement/, 'les autres gammes héritent de « tous les modèles »');
  for (const m of ['haiku', 'opus']) {
    assert.match(t(m), /Réponds UNIQUEMENT avec : \{"subject":"\.\.\.","body":"\.\.\."\}/, 'format imposé');
    assert.match(t(m), /Ne mets PAS de lien de désinscription/, 'lien de désinscription : règle imposée');
  }
  const p = prospectPrompt({ profile, target, count: 3, exclude: [], custom, model: 'haiku' }).system;
  assert.match(p, /Consignes pour les champs hook et score :\nhook : une question\.\nscore : 1 à 5\./);
  assert.match(p, /Uniquement des emails PROFESSIONNELS publiés publiquement/, 'règles de collecte imposées');
  assert.match(p, /PROSPECT \{"company"/, 'format de la ligne imposé');
  assert.match(evolutionPrompt({ projectName: 'P', profile, count: 4, level: 'normal', custom }).prompt, /Donne 4 idées, 15 fichiers\.[\s\S]*Format Markdown/);
  assert.equal(instructions('hook', { '*': { hook: '   ' } }, { entreprise: 'X', site: 'y' }), instructions('hook', null, { entreprise: 'X', site: 'y' }), 'vide = défaut');
  // ancien format à plat : compris comme « tous les modèles »
  assert.equal(resolveText('hook', { hook: 'Ancien' }, 'haiku'), 'Ancien');
});

test('parseCustomPrompts : clés inconnues, vides, identiques à ce que la gamme reçoit déjà et trop longues écartées', () => {
  const raw = JSON.stringify({
    '*': { template: ' mon texte ', hook: PROMPT_DEFS.hook.text, audit: '', inconnu: 'x', linkedin: 'a'.repeat(MAX_CUSTOM + 500) },
    haiku: { hook: defaultText('hook', 'haiku'), template: 'mon texte', evolution: 'Haiku : trois idées' },
    opus: { audit: defaultText('audit', 'opus'), analyze: 'Analyse Opus' },
    inconnue: { template: 'x' },
  });
  const out = parseCustomPrompts(raw);
  assert.deepEqual(Object.keys(out).sort(), ['*', 'haiku', 'opus']);
  assert.deepEqual(Object.keys(out['*']).sort(), ['linkedin', 'template']);
  assert.equal(out['*'].template, 'mon texte');
  assert.equal(out['*'].linkedin.length, MAX_CUSTOM);
  assert.deepEqual(out.haiku, { evolution: 'Haiku : trois idées' }, 'défaut de la gamme et texte déjà hérité : écartés');
  assert.deepEqual(out.opus, { analyze: 'Analyse Opus' });
  assert.deepEqual(parseCustomPrompts('pas du json'), {});
  assert.deepEqual(parseCustomPrompts(null), {});
  assert.deepEqual(parseCustomPrompts({ template: 'Ancien format' }), { '*': { template: 'Ancien format' } });
});

test('catalogue : recommandés avec estimation de coût, autres sans ; identifiants vérifiés avant d\'aller à Claude', () => {
  assert.deepEqual(RECOMMENDED.map((m) => [m.id, m.tier, m.cost]), [['haiku', 'économe', '$'], ['sonnet', 'intermédiaire', '$$'], ['opus', 'plus cher', '$$$']]);
  assert.ok(OTHERS.length >= 12);
  for (const m of OTHERS) { assert.match(m.id, /^claude-[a-z0-9-]+$/); assert.equal(m.tier, undefined, `${m.id} : pas d'estimation`); assert.equal(m.cost, undefined); }
  for (const id of ['haiku', 'opus', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-5-5']) assert.equal(isModel(id), true, id);
  for (const bad of ['', 'gpt-4', 'claude-mythos-5-1', 'claude-3-opus-20240229', '--help', 'opus; rm -rf /', null, undefined, 42]) assert.equal(isModel(bad), false, String(bad));
  assert.equal(normalizeModel('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(normalizeModel('n-importe-quoi'), 'haiku');
  assert.equal(normalizeModel('n-importe-quoi', 'sonnet'), 'sonnet');
  assert.deepEqual(['haiku', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-fable-5', 'claude-haiku-5-5'].map(modelFamily), ['haiku', 'sonnet', 'opus', 'fable', 'haiku']);
});

test('promptsView : texte affiché par onglet, défaut, héritage et modèle utilisé par tâche', () => {
  const v = promptsView({ '*': { template: 'Commun' }, opus: { template: 'Opus' } }, { analyze: 'sonnet', prospect: 'haiku', write: 'claude-opus-5-5' });
  assert.deepEqual(v.scopes.map((x) => [x.id, x.count]), [['*', 1], ['haiku', 0], ['sonnet', 0], ['opus', 1], ['fable', 0]]);
  const t = v.tasks.find((x) => x.key === 'template');
  assert.equal(t.uses, 'Opus 5.5');
  assert.deepEqual(t.scopes['*'], { text: 'Commun', def: PROMPT_DEFS.template.text, custom: true });
  assert.deepEqual(t.scopes.haiku, { text: 'Commun', def: defaultText('template', 'haiku'), custom: false }, 'hérite de « tous les modèles »');
  assert.equal(t.scopes.opus.text, 'Opus');
  const a = v.tasks.find((x) => x.key === 'analyze');
  assert.equal(a.scopes.sonnet.text, defaultText('analyze', 'sonnet'));
  assert.equal(v.tasks.find((x) => x.key === 'audit').uses, 'selon le niveau choisi');
});

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const base = { notify_email: '', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
const page = async (x) => (await x.get('/settings', { headers: { accept: 'text/html' } })).text();

test('réglages : un sélecteur de modèle en deux listes (recommandés avec coût, autres sans), pour la prospection, l\'analyse et la rédaction', async () => {
  const u = await s.newUser();
  const html = await page(u);
  for (const f of ['prospect_model', 'analyze_model', 'write_model']) {
    const box = html.slice(html.indexOf(`name="${f}"`) - 400, html.indexOf(`name="${f}"`) + 6000);
    assert.match(html, new RegExp(`id="${f}-l"`));
    for (const m of [...RECOMMENDED, ...OTHERS]) assert.match(html, new RegExp(`name="${f}" value="${m.id}"`), `${f} propose ${m.id}`);
    assert.match(box, /Recommandés/);
    void box;
  }
  const rec = html.slice(html.indexOf('mp-h">Recommandés'), html.indexOf('mp-sep'));
  assert.match(rec, /économe[\s\S]*<i>\$<\/i>[\s\S]*intermédiaire[\s\S]*<i>\$\$<\/i>[\s\S]*plus cher[\s\S]*<i>\$\$\$<\/i>/);
  const others = html.slice(html.indexOf('mp-h mp-h-s">Autres modèles'), html.indexOf('</details>', html.indexOf('mp-h mp-h-s')));
  assert.match(others, /Fable 5\.1/);
  assert.doesNotMatch(others, /économe|intermédiaire|plus cher|<i>\$/, 'aucune estimation dans la liste des autres modèles');
  assert.match(html, /name="prospect_model" value="haiku" checked/, 'Haiku par défaut');
});

test('réglages : choix d\'un modèle précis enregistré ; valeur hors catalogue refusée ; champ absent = inchangé', async () => {
  const u = await s.newUser();
  const get = (k) => getSetting(s.db, u.id, k);
  assert.equal((await u.post('/settings', { ...base, prospect_model: 'claude-opus-5-5', analyze_model: 'sonnet', write_model: 'claude-fable-5-1' }, { form: true })).status, 303);
  assert.deepEqual([await get('prospect_model'), await get('analyze_model'), await get('write_model')], ['claude-opus-5-5', 'sonnet', 'claude-fable-5-1']);
  let html = await page(u);
  assert.match(html, /name="prospect_model" value="claude-opus-5-5" checked/);
  assert.match(html, /name="write_model" value="claude-fable-5-1" checked/);
  await u.post('/settings', { ...base, prospect_model: '--dangerously-skip-permissions', analyze_model: 'claude-mythos-5-1' }, { form: true });
  assert.deepEqual([await get('prospect_model'), await get('analyze_model')], ['haiku', 'haiku'], 'jamais transmis tel quel à claude --model');
  assert.equal(await get('write_model'), 'claude-fable-5-1', 'champ absent : inchangé');
  html = await page(u);
  assert.match(html, /name="prospect_model" value="haiku" checked/);
});

test('réglages : prompts par gamme dans le formulaire, enregistrés, retrouvés, hérités, réinitialisés ; isolation', async () => {
  const u = await s.newUser(), v = await s.newUser();
  let html = await page(u);
  assert.match(html, /id="prompts"/);
  for (const sc of ['*', 'haiku', 'sonnet', 'opus', 'fable']) assert.match(html, new RegExp(`data-pscope-tab="${sc.replace('*', '\\*')}"`), `onglet ${sc}`);
  assert.match(html, /name="prompt_template"/);
  assert.match(html, /name="prompt_haiku_template"/);
  assert.match(html, /name="prompt_fable_audit"/);
  assert.doesNotMatch(html, /badge warn">modifié/);
  // les champs sont bien DANS le formulaire (sinon le bouton « Enregistrer » ne les enverrait pas)
  const form = html.slice(html.indexOf('<form method="post" action="/settings"'), html.indexOf('</form>', html.indexOf('<form method="post" action="/settings"')));
  assert.match(form, /name="prompt_template"/);
  assert.match(form, /name="prompt_opus_hook"/);
  assert.match(html.slice(html.indexOf('id="prompts"')), /modèle : Haiku/);

  // une gamme
  assert.equal((await u.post('/settings', { ...base, prompt_haiku_template: 'Mon mail Haiku pour [[expediteur]]' }, { form: true })).status, 303);
  assert.deepEqual(parseCustomPrompts(await getSetting(s.db, u.id, 'prompts_json')), { haiku: { template: 'Mon mail Haiku pour [[expediteur]]' } });
  html = await page(u);
  assert.match(html, /Mon mail Haiku pour \[\[expediteur\]\]/);
  assert.match(html, /badge warn">modifié/);
  assert.doesNotMatch(await page(v), /Mon mail Haiku/, 'les prompts d\'un compte ne passent pas à un autre');
  // « tous les modèles » en plus : la gamme garde le sien, les autres héritent
  await u.post('/settings', { ...base, prompt_template: 'Commun pour [[expediteur]]' }, { form: true });
  const own = parseCustomPrompts(await getSetting(s.db, u.id, 'prompts_json'));
  assert.deepEqual(own, { '*': { template: 'Commun pour [[expediteur]]' }, haiku: { template: 'Mon mail Haiku pour [[expediteur]]' } });
  assert.match(templatePrompt({ profile, target, senderName: 'T', custom: own, model: 'haiku' }).prompt, /Mon mail Haiku pour T/);
  assert.match(templatePrompt({ profile, target, senderName: 'T', custom: own, model: 'claude-sonnet-5' }).prompt, /Commun pour T/);
  const sonnetBox = (await page(u)).match(/name="prompt_sonnet_template"[^>]*>([^<]*)</)[1];
  assert.match(sonnetBox, /Commun pour \[\[expediteur\]\]/, 'la gamme sans texte propre affiche celui de « tous les modèles »');

  // un enregistrement sans aucun champ « prompt_* » ne touche à rien ; trop long : refusé
  await u.post('/settings', base, { form: true });
  assert.deepEqual(parseCustomPrompts(await getSetting(s.db, u.id, 'prompts_json')), own);
  assert.equal((await u.post('/settings', { ...base, prompt_opus_audit: 'x'.repeat(MAX_CUSTOM + 1) }, { form: true })).status, 400);
  // le texte par défaut renvoyé tel quel (bouton « revenir »), ou un champ vide : plus de personnalisation
  await u.post('/settings', { ...base, prompt_template: PROMPT_DEFS.template.text, prompt_haiku_template: '' }, { form: true });
  assert.equal(await getSetting(s.db, u.id, 'prompts_json'), '');
});
