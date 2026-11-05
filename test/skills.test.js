// Savoir-faire d'iaboss : les fiches de méthode (knowledge/skills) sont valides, ciblent des tâches qui existent, tiennent dans le plafond,
// arrivent dans les consignes système de chaque tâche, et sont décrites dans la documentation du Support (générée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSkills, parseSkill, skillsFor, skillsBlock, contractGaps, SKILLS_MAX_CHARS } from '../src/services/skills.js';
import { INTENT_RULES } from '../src/services/orchestrator.js';

// Intentions comprises par l'orchestrateur, plus « vague » (ambiguïté détectée par la longueur et le vocabulaire)
const INTENTS = [...INTENT_RULES.map(([i]) => i), 'vague'];
import {
  PROMPT_DEFS, analyzePrompt, prospectPrompt, templatePrompt, followupTemplatePrompt, linkedinPostPrompt, promoPrompt, evolutionPrompt,
  hookPrompt, auditPrompt, rolePrompt, chatPrompt, supportPrompt,
} from '../src/services/prompts.js';
import { ROLES } from '../src/services/roles.js';
import { generatedDocs } from '../src/services/supportdocs.js';

const skills = loadSkills();
const profile = { resume: 'Un outil', proposition_valeur: 'Gagner du temps', arguments: ['rapide'], ton: 'direct' };
const target = { description: 'TPE', decideur: 'gérant', secteurs: ['a'], zone: 'FR', taille: 'TPE', requetes: ['q'] };
const MARK = "Savoir-faire d'iaboss";

test('chaque fiche a ses champs, un nom unique, et vise des tâches qui existent', () => {
  assert.ok(skills.length >= 8);
  assert.equal(new Set(skills.map((s) => s.name)).size, skills.length, 'noms uniques');
  for (const s of skills) {
    assert.ok(s.body.length > 400, `${s.name} : trop court pour servir`);
    assert.ok(s.tasks.length || s.intents.length, `${s.name} : ni tâche ni intention visée`);
    for (const t of s.tasks) assert.ok(PROMPT_DEFS[t], `${s.name} : tâche inconnue « ${t} »`);
    assert.deepEqual(contractGaps(s), [], `${s.name} : contrat incomplet`);
    if (s.level !== 'metier') for (const i of s.intents) assert.ok(INTENTS.includes(i), `${s.name} : intention inconnue « ${i} »`);
  }
  assert.throws(() => parseSkill('---\nnom: a\ntitre: A\nresume: r\nniveau: bizarre\ntaches: chat\n---\ncorps', 'x.md'), /niveau inconnu/);
  assert.throws(() => parseSkill('---\nnom: a\ntitre: A\nresume: r\nniveau: base\n---\ncorps', 'x.md'), /taches/);
  assert.throws(() => parseSkill('sans en-tête', 'x.md'), /en-tête/);
  assert.throws(() => parseSkill('---\nnom: a\n---\ncorps', 'x.md'), /titre/);
});

test('chaque tâche IA (hors support) reçoit au moins une fiche, sans dépasser le plafond', () => {
  for (const key of Object.keys(PROMPT_DEFS)) {
    if (key === 'support') continue;
    assert.ok(skillsFor(key).length > 0, `${key} : aucune fiche`);
    assert.ok(skillsBlock(key).length <= SKILLS_MAX_CHARS + 600, `${key} : bloc trop gros (${skillsBlock(key).length})`);
  }
  const big = [{ name: 'a', title: 'A', summary: 's', level: 'metier', tasks: ['chat'], body: 'x'.repeat(SKILLS_MAX_CHARS - 10) }, { name: 'b', title: 'B', summary: 's', level: 'metier', tasks: ['chat'], body: 'y'.repeat(200) }];
  const block = skillsBlock('chat', big);
  assert.match(block, /## A/);
  assert.doesNotMatch(block, /## B/, 'une fiche qui ferait dépasser le plafond est écartée entière, jamais coupée');
  assert.equal(skillsBlock('inconnue'), '');
});

test('les fiches arrivent dans les consignes système, le format de réponse reste intact', () => {
  const systems = {
    analyze: analyzePrompt('P').system,
    prospect: prospectPrompt({ profile, target, count: 3, exclude: [] }).system,
    template: templatePrompt({ profile, target, senderName: 'Tony' }).system,
    followup: followupTemplatePrompt({ profile, senderName: 'Tony' }).system,
    linkedin: linkedinPostPrompt({ profile, target }).system,
    promo: promoPrompt({ projectName: 'P', profile, target, seconds: 10, fps: 30, format: 'x', width: 1920, height: 1080 }).system,
    evolution: evolutionPrompt({ projectName: 'P', profile, count: 3, level: 'rapide' }).system,
    hook: hookPrompt({ profile, prospect: { company: 'F' } }).system,
    audit: auditPrompt({ projectName: 'P', level: 'normal' }).system,
    poste: rolePrompt({ role: ROLES[0], task: ROLES[0].tasks[0], projectName: 'P', profile, target }).system,
    chat: chatPrompt({ message: 'Salut' }).system,
  };
  for (const [k, sys] of Object.entries(systems)) assert.ok(sys.includes(MARK), `${k} : fiches absentes`);
  assert.match(systems.template, /Rédiger un mail de prospection B2B/);
  assert.match(systems.prospect, /Trouver et qualifier de bons prospects/);
  assert.match(systems.prospect, /Prospection B2B par e-mail en France/);
  assert.match(systems.chat, /Conseiller un utilisateur sur sa prospection/);
  assert.match(systems.audit, /Lire un dépôt/);
  assert.match(templatePrompt({ profile, target }).prompt, /Réponds UNIQUEMENT avec : \{"subject"/);
  assert.match(prospectPrompt({ profile, target, count: 3, exclude: [] }).system, /PROSPECT \{"company"/);
  assert.doesNotMatch(supportPrompt({ message: 'Aide', index: '' }).system, new RegExp(MARK), 'le Support répond d\'après la documentation, pas d\'après les fiches métier');
});

test('la documentation du Support liste chaque fiche et ses tâches', () => {
  const doc = generatedDocs().find((d) => d.name === 'savoir-faire-ia.md');
  assert.ok(doc, 'fichier généré');
  for (const s of skills) assert.ok(doc.content.includes(s.title), `${s.title} absent de la doc`);
  assert.match(doc.content, /Mail de prospection/);
});
