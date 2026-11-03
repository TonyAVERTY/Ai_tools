// Confirmation d'une action sensible : une seule boîte, celle de l'application (confirmBox dans public/app.js). Plus de window.confirm,
// plus de formulaire confirmé par deux gestionnaires, et chaque message du serveur se lit « Question ? Conséquence ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const src = new URL('../src/', import.meta.url);

test('aucun confirm() natif dans le JS : tout passe par confirmBox', () => {
  const offenders = [];
  for (const f of readdirSync(pub).filter((x) => x.endsWith('.js'))) {
    readFileSync(new URL(f, pub), 'utf8').split('\n').forEach((line, i) => { if (/(?<![\w.$])(window\.)?confirm\(/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(offenders, [], 'utilise « await confirmBox(message, { confirm: "Verbe" }) » (public/app.js)');
});

test('un formulaire qui a data-action n\'est confirmé que par le gestionnaire des formulaires (sinon deux boîtes de suite)', () => {
  const js = readFileSync(new URL('app.js', pub), 'utf8');
  assert.match(js, /if \(!msg \|\| form\.dataset\.action \|\| form\.dataset\.confirmed === '1'\) return;/, 'le gestionnaire générique laisse les data-action au gestionnaire des formulaires');
});

test('chaque data-confirm du serveur se lit « Question ? » puis, si besoin, la conséquence', () => {
  const bad = [];
  let n = 0;
  for (const f of readdirSync(src).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(new URL(f, src), 'utf8').matchAll(/data-confirm="([^"]+)"/g)) {
      n++;
      const text = m[1].replace(/\$\{[^}]*\}/g, 'X');
      if (!/\?/.test(text)) bad.push(`${f} : ${m[1].slice(0, 70)}`);
      if (!/^[A-ZÉ]/.test(text)) bad.push(`${f} : commence sans majuscule : ${m[1].slice(0, 60)}`);
    }
  }
  assert.ok(n >= 6, `les 6 formulaires sensibles sont trouvés (${n})`);
  assert.deepEqual(bad, []);
});
