import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { securityCard } from '../src/mfaviews.js';

// Règle d'interface (docs/UX.md, « Formulaires ») : on ne demande JAMAIS deux fois la même saisie à la suite. Plusieurs actions sur une même saisie
// = un seul champ et plusieurs boutons (`formaction`). Ce test échoue si deux formulaires voisins se partagent un champ visible, sauf cas listés ci-dessous.

test('carte A2F : un seul champ « code » par état, et les deux actions de la carte activée le partagent', () => {
  for (const [name, args] of [['activée', { enabled: true }], ['activation en cours', { enabled: false, setup: 'JBSWY3DPEHPK3PXP' }], ['désactivée', { enabled: false }]]) {
    const html = securityCard({ ...args, email: 'a@b.fr', recoveryLeft: 10, devices: 2 });
    assert.ok((html.match(/name="code"/g) || []).length <= 1, `${name} : au plus un champ code`);
  }
  const on = securityCard({ enabled: true, email: 'a@b.fr', recoveryLeft: 10, devices: 0 });
  assert.equal((on.match(/name="code"/g) || []).length, 1);
  assert.match(on, /action="\/account\/2fa\/recovery"[\s\S]*Régénérer les codes de secours/);
  assert.match(on, /formaction="\/account\/2fa\/disable"[^>]*data-confirm=[^>]*>Désactiver l'A2F/);
});

// Couples de formulaires voisins qui partagent un nom de champ pour une BONNE raison (chacun configure autre chose, ou ils ne sont jamais affichés ensemble)
const ALLOWED = [
  ['src/views.js', 'smtp', 'imap', 'deux services distincts : chaque formulaire configure son propre serveur'],
  ['src/views.js', 'smtp', 'db', 'deux services distincts'],
  ['src/views.js', 'imap', 'db', 'deux services distincts'],
  ['src/views.js', 'prospect', 'send', 'deux tâches distinctes : nombre de prospects à chercher / nombre de mails à envoyer'],
  ['src/views.js', 'evolution', 'audit', 'deux tâches distinctes, chacune avec ses propres réglages'],
  ['src/mfaviews.js', '/account/2fa/recovery', '/account/2fa/enable', 'états exclusifs de la carte A2F (activée / activation en cours) : jamais affichés ensemble ; la désactivation partage le champ de la régénération (formaction)'],
];

function adjacentSharedFields() {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) { walk(`${d}/${e.name}`); continue; }
    if (!e.name.endsWith('.js')) continue;
    const file = `${d}/${e.name}`;
    const s = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const forms = [...s.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => ({ at: m.index, end: m.index + m[0].length, html: m[0] }));
    // Champs visibles d'un formulaire : <input|textarea|select name="…"> hors caché / case / bouton, plus les champs produits par un petit assembleur `${code(`
    const fields = (h) => [
      ...[...h.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/type="(hidden|checkbox|radio|submit|button)"/.test(t)).map((t) => (t.match(/name="([^"]+)"/) || [])[1]).filter(Boolean),
      ...[...h.matchAll(/\$\{(code)\(/g)].map((m) => m[1]),
    ];
    const id = (h) => h.match(/\saction="([^"]+)"/)?.[1] || h.match(/data-action="([^"]+)"/)?.[1] || '?';
    for (let i = 0; i < forms.length; i++) for (let j = i + 1; j < forms.length; j++) {
      if (forms[j].at - forms[i].end > 900) break;
      const a = fields(forms[i].html); const b = fields(forms[j].html);
      const common = [...new Set(a.filter((x) => b.includes(x)))];
      if (common.length) out.push({ file, a: id(forms[i].html), b: id(forms[j].html), common });
    }
  } };
  walk('src'); walk('public');
  return out;
}

test('aucun couple de formulaires voisins ne redemande le même champ (sauf cas justifiés)', () => {
  const found = adjacentSharedFields();
  assert.ok(found.length >= 5, 'le scanner repère bien les couples connus (sinon il est cassé)');
  const unknown = found.filter((f) => !ALLOWED.some(([file, a, b]) => f.file === file && f.a === a && f.b === b));
  assert.deepEqual(unknown.map((f) => `${f.file} : ${f.a} / ${f.b} → champs ${f.common}`), [], 'un seul champ pour plusieurs boutons (formaction), jamais deux champs identiques à la suite');
  for (const [, , , why] of ALLOWED) assert.ok(why.length > 20);
});
