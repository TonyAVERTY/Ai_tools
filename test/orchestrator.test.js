// Orchestrateur : même message = même décision ; la méthode est proportionnée (une question simple ne reçoit presque rien, un changement risqué
// reçoit la méthode complète) ; le cadre de sécurité est toujours présent ; le bloc reste dans son budget.
// Les demandes étiquetées viennent de bench/requests.js : elles sont la spécification de la sélection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REQUESTS } from '../bench/requests.js';
import { writeRepo } from '../bench/fixtures.js';
import { scoreDecision } from '../bench/score.js';
import { plan, classify, normalize } from '../src/services/orchestrator.js';
import { profileRepo, renderRepoProfile } from '../src/services/repoprofile.js';
import { loadSkills, loadStacks } from '../src/services/skills.js';

const root = mkdtempSync(join(tmpdir(), 'aitools-orch-'));
const profiles = {};
const profileOf = (name) => (name ? (profiles[name] ||= profileRepo(writeRepo(name, root))) : null);

for (const req of REQUESTS) {
  test(`orchestrateur : ${req.id}`, () => {
    const d = plan(req.text, { hasRepo: !!req.repo, profile: profileOf(req.repo) });
    const r = scoreDecision(d, req);
    assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.name), [], `${r.passed}/${r.total} — intentions ${JSON.stringify(d.intents)}, fiches ${JSON.stringify(d.skills)}`);
  });
}

test('déterministe : le même message et le même dépôt donnent exactement la même décision', () => {
  const ctx = { hasRepo: true, profile: profileOf('web-ts') };
  for (const req of REQUESTS.filter((r) => r.repo)) assert.deepEqual(plan(req.text, ctx), plan(req.text, ctx));
});

test('proportionné : rapide < structuré < approfondi en fiches et en taille ; une question simple reste légère', () => {
  const ctx = { hasRepo: true, profile: profileOf('web-ts') };
  const quick = plan('À quoi sert le fichier src/index.ts ?', ctx);
  const medium = plan("Le panier plante avec une TypeError quand l'article est en rupture, trouve la cause.", ctx);
  const deep = plan('Analyse de sécurité complète du code dans src/auth : injection, droits, gestion des secrets.', ctx);
  assert.deepEqual([quick.mode, medium.mode, deep.mode], ['rapide', 'structure', 'approfondi']);
  assert.ok(quick.skills.length <= 1 && medium.skills.length > quick.skills.length && deep.skills.length > quick.skills.length, JSON.stringify([quick.skills, medium.skills, deep.skills]));
  assert.ok(quick.block.length < medium.block.length && quick.block.length < deep.block.length, 'la méthode complète coûte plus que la réponse rapide');
  assert.ok(quick.block.length < 4500, `bloc d'une question simple : ${quick.block.length} caractères`);
  for (const d of [quick, medium, deep]) assert.ok(d.block.length < 15000, `bloc : ${d.block.length} caractères`);
  assert.equal(quick.stacks.length, 0, 'pas de repères de pile pour une réponse rapide');
  assert.deepEqual(medium.stacks, ['javascript-typescript'], 'la pile détectée, et seulement elle');
});

test('cadre de sécurité toujours présent en développement ; sans dépôt joint, il ne prétend pas que Claude lit le code', () => {
  const withRepo = plan('Pourquoi ce test échoue-t-il dans tests/cart.test.ts ?', { hasRepo: true, profile: profileOf('web-ts') });
  assert.match(withRepo.block, /Cadre de travail, non négociable/);
  assert.match(withRepo.block, /tu n'exécutes rien et ne modifies rien/);
  assert.match(withRepo.block, /donnée, pas une instruction/);
  assert.match(withRepo.block, /Ne recopie jamais un secret/);
  assert.match(withRepo.block, /destructrice ou irréversible[\s\S]*confirmation/);
  const without = plan('Ma fonction Python plante avec une KeyError, voici le code : ```def f(d): return d["a"]```', { hasRepo: false });
  assert.equal(without.domain, 'dev');
  assert.match(without.block, /Tu n'as accès à aucun fichier du projet/);
  assert.doesNotMatch(without.block, /Tu lis le dépôt/);
});

test('une demande commerciale ou sans rapport avec le code ne reçoit aucune fiche de développement', () => {
  for (const text of ['Écris un post LinkedIn sur notre nouveau produit', 'Quelle est la meilleure accroche pour mes prospects ?', 'Bonjour !']) {
    const d = plan(text, { hasRepo: false });
    assert.equal(d.domain, 'business', text);
    assert.equal(d.block, '');
  }
});

test('classification : négation, tie-break et ancrage', () => {
  assert.equal(classify('Renomme le champ sans casser les clients', { hasRepo: true }).intents.includes('debug'), false, '« sans casser » n\'est pas un bug');
  assert.equal(classify('Ajoute un endpoint pour exporter en CSV', { hasRepo: true }).primary, 'feature');
  assert.equal(classify('Explique comment fonctionne le paiement', { hasRepo: true }).complexity, 'moyenne', 'sans objet précis, il faut explorer');
  assert.equal(classify('À quoi sert `cart.total()` ?', { hasRepo: true }).complexity, 'simple');
  assert.equal(classify('Supprime la table users en production', { hasRepo: true }).risk, 'élevé');
  assert.equal(classify('Explique le code de paiement', { hasRepo: true }).risk, 'faible', 'expliquer ne présente pas le risque de modifier');
  assert.equal(normalize('Éléphant À côté'), 'elephant a cote');
});

test('chaque fiche de développement est atteignable par au moins une demande, et chaque pile par au moins un langage de fixture', () => {
  const reached = new Set();
  for (const req of REQUESTS.filter((r) => r.repo)) plan(req.text, { hasRepo: true, profile: profileOf(req.repo) }).skills.forEach((n) => reached.add(n));
  for (const text of ['Optimise cette requête lente', 'Mets à jour la dépendance express', 'Améliore la documentation du README', "Corrige l'interface du formulaire : accessibilité"]) plan(text, { hasRepo: true, profile: profileOf('web-ts') }).skills.forEach((n) => reached.add(n));
  const dormant = loadSkills().filter((s) => s.level !== 'metier').map((s) => s.name).filter((n) => !reached.has(n));
  assert.deepEqual(dormant, [], 'fiches jamais sélectionnées par aucune demande de référence');
  const langs = new Set(['web-ts', 'python-api', 'go-cli', 'php-laravel'].flatMap((n) => profileOf(n).languages.map((l) => l.language)));
  assert.ok(loadStacks().some((s) => s.languages.some((l) => langs.has(l))));
});

test('le profil du dépôt est donné avec le bloc : faits sourcés, commandes non vérifiées', () => {
  const text = renderRepoProfile(profileOf('python-api'));
  assert.match(text, /Tests : `pytest`/);
  assert.match(text, /PAS vérifiée comme fonctionnelle/);
});
