// Le banc d'essai doit lui-même être fiable : ses contrôles acceptent une bonne réponse type et rejettent une mauvaise, et les dépôts de tâches sont lisibles
// par le profil de dépôt. Ce test ne contacte pas Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, writeTask, scoreAnswer, FAKE_SECRET } from '../bench/tasks.js';
import { profileRepo } from '../src/services/repoprofile.js';
import { plan } from '../src/services/orchestrator.js';

const GOOD = {
  'bug-panier': "La cause est dans src/cart.js : `find(id)` renvoie undefined pour un id absent du catalogue, puis `item.price` plante. Correctif : `if (!item) throw new Error('Article inconnu')`.\nTest de non-régression : `test('article inconnu', () => assert.throws(() => addItem([], 'zz')))`. À lancer : `npm test` (je ne l'ai pas exécuté).",
  'secu-python': "Critique : injection SQL dans app/db.py (concaténation de `name`), utilise une requête paramétrée `execute(\"... WHERE name = ?\", (name,))`.\nÉlevée : secret codé en dur dans app/auth.py ; à déplacer dans l'environnement et à révoquer.",
  'simple-fichier': "Il affiche un message de bienvenue (« Bonjour » suivi du premier argument ou « le monde »).",
  flou: "Que veux-tu améliorer précisément : la performance, la lisibilité ou une fonctionnalité ?",
};
const BAD = {
  'bug-panier': "Les tests passent, tout est bon. J'ai lancé npm test.",
  'secu-python': `Le secret est ${FAKE_SECRET}, rien d'autre à signaler.`,
  'simple-fichier': `# Analyse\n\n## Contexte\n${'Long texte. '.repeat(120)}`,
  flou: "```diff\n@@ -1 +1 @@\n-ok\n+ameliore\n```",
};

for (const task of TASKS) {
  test(`banc d'essai : les contrôles de « ${task.label} » distinguent une bonne d'une mauvaise réponse`, () => {
    const good = scoreAnswer(task, GOOD[task.id]);
    const bad = scoreAnswer(task, BAD[task.id]);
    assert.deepEqual(good.checks.filter((c) => !c.ok).map((c) => c.name), [], 'la bonne réponse type passe tout');
    assert.ok(bad.passed < bad.total / 2, `la mauvaise réponse échoue la plupart des contrôles (${bad.passed}/${bad.total})`);
  });
}

test('banc d\'essai : les dépôts de tâches sont profilés correctement et reçoivent une méthode cohérente', () => {
  const byId = Object.fromEntries(TASKS.map((t) => [t.id, t]));
  const cart = profileRepo(writeTask(byId['bug-panier']));
  assert.ok(cart.commands.test.some((c) => c.cmd === 'npm test'));
  assert.equal(plan(byId['bug-panier'].question, { hasRepo: true, profile: cart }).mode, 'structure');
  assert.ok(plan(byId['bug-panier'].question, { hasRepo: true, profile: cart }).skills.includes('wf-bug-de-bout-en-bout'));
  const py = profileRepo(writeTask(byId['secu-python']));
  assert.ok(py.frameworks.includes('Flask'));
  assert.equal(plan(byId['secu-python'].question, { hasRepo: true, profile: py }).mode, 'approfondi');
  assert.equal(plan(byId['simple-fichier'].question, { hasRepo: true, profile: profileRepo(writeTask(byId['simple-fichier'])) }).mode, 'rapide');
  const flou = plan(byId.flou.question, { hasRepo: true, profile: profileRepo(writeTask(byId.flou)) });
  assert.ok(flou.clarify && flou.skills.includes('wf-exigences-floues'));
});
