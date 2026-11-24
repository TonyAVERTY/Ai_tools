import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FIELD_LIMITS, LEN, findTooLong } from '../src/inputlimits.js';
import { startApp } from './helpers/server.js';
import { testTokenLink } from './helpers/users.js';

// Règle (docs/UX.md, « Champs de saisie ») : un champ de N caractères attendus n'en accepte jamais plus de N ; un texte libre a toujours un maximum ; un nombre a un minimum
// et un maximum. Le navigateur aide (attribut), le serveur décide (readBody refuse). Ce test garde l'ensemble de l'application.

const EXEMPT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'range', 'color', 'date', 'time', 'datetime-local']);

/** Tous les champs de saisie écrits dans le code (src/ et public/), hors commentaires. */
function inputs() {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) { walk(`${d}/${e.name}`); continue; }
    if (!e.name.endsWith('.js')) continue;
    const file = `${d}/${e.name}`;
    const s = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const m of s.matchAll(/<(input|textarea)\b[^>]*>/g)) {
      const t = m[0];
      const ls = s.lastIndexOf('\n', m.index) + 1;
      if (/^\s*(\*|\/\/|\/\*)/.test(s.slice(ls, m.index))) continue;
      const type = (t.match(/\stype="([^"]+)"/) || [, m[1] === 'textarea' ? 'textarea' : 'text'])[1];
      if (EXEMPT_TYPES.has(type) || /\sreadonly\b/.test(t)) continue;
      // Valeur numérique de l'attribut ; une valeur calculée (maxlength="${…}") compte comme posée (NaN : non comparable)
      const num = (a) => { const v = t.match(new RegExp(`\\s${a}="([^"]*)"`)); return v ? (/^\d+$/.test(v[1]) ? Number(v[1]) : NaN) : null; };
      out.push({ file, line: s.slice(0, m.index).split('\n').length, type, name: (t.match(/\sname="([^"]+)"/) || [])[1] || '', maxlength: num('maxlength'), min: num('min'), max: num('max'), tag: t });
    }
  } };
  walk('src'); walk('public');
  return out;
}

test('tout champ de texte a une longueur maximale, tout champ numérique un minimum et un maximum', () => {
  const all = inputs();
  assert.ok(all.length > 100, `les champs sont repérés (${all.length})`);
  const bad = all.filter((i) => (i.type === 'number' ? i.min == null || i.max == null : i.maxlength == null));
  assert.deepEqual(bad.map((i) => `${i.file}:${i.line} ${i.type} ${i.name || '(sans nom)'}`), [], 'ajoute maxlength (texte) ou min et max (nombre) : voir LEN dans src/inputlimits.js');
  // Un attribut en double est dangereux : le navigateur retient la PREMIÈRE occurrence, la limite posée ensuite serait ignorée
  const dup = all.filter((i) => ['maxlength', 'min', 'max', 'pattern'].some((a) => (i.tag.match(new RegExp(`\\s${a}=`, 'g')) || []).length > 1));
  assert.deepEqual(dup.map((i) => `${i.file}:${i.line} ${i.name}`), [], 'attribut en double');
});

test('les champs de code sont stricts : 6 chiffres = 6 caractères, secours = 11, et la limite n\'apparaît qu\'une fois dans la balise (un navigateur retient la première)', async () => {
  const { codeField } = await import('../src/mfaviews.js');
  for (const [mode, max] of [['totp', 6], ['secours', 11]]) {
    const tag = codeField({ mode }).match(/<input\b[^>]*>/)[0];
    assert.equal((tag.match(/maxlength=/g) || []).length, 1, `${mode} : un seul maxlength`);
    assert.match(tag, new RegExp(`maxlength="${max}"`));
    assert.match(tag, new RegExp(`data-mode="${mode}"`));
  }
  for (const i of inputs().filter((x) => x.name === 'code')) assert.equal((i.tag.match(/maxlength=/g) || []).length, 1, `${i.file}:${i.line} : maxlength en double`);
  assert.equal(LEN.totp, 6); assert.equal(LEN.recovery, 11);
});

test('le navigateur n\'est jamais plus large que le serveur : maxlength ≤ limite imposée par readBody', () => {
  const wide = inputs().filter((i) => Number.isFinite(i.maxlength)).map((i) => ({ i, lim: FIELD_LIMITS[i.name] || FIELD_LIMITS[i.name.replace(/_\$\{i\}$|_\d{1,2}$/, '')] })).filter((x) => x.lim && x.i.maxlength > x.lim[0]);
  assert.deepEqual(wide.map(({ i, lim }) => `${i.file}:${i.line} ${i.name} : maxlength ${i.maxlength} > ${lim[0]}`), []);
});

test('findTooLong : champs connus mesurés, suffixe numérique ignoré, chaînes seulement', () => {
  assert.equal(findTooLong({ host: 'a'.repeat(255) }), null);
  assert.deepEqual(findTooLong({ host: 'a'.repeat(256) }), { field: 'host', label: 'Hôte', max: 255 });
  assert.equal(findTooLong({ git_host_3: 'x'.repeat(501) }).max, 500);
  assert.equal(findTooLong({ discord_url_0: 'x'.repeat(301) }).field, 'discord_url_0');
  assert.equal(findTooLong({ confirm: true, port: 'x'.repeat(5000), description: 'y'.repeat(50000) }), null, 'booléen, champ inconnu : non mesurés');
  assert.equal(findTooLong(null), null); assert.equal(findTooLong([]), null);
});

test('le serveur REFUSE (400) une valeur trop longue, sans rien enregistrer ni tronquer', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false, link: testTokenLink() });
    const p = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u.id, 'P', 'https://git.test/x.git', 1)).lastInsertRowid);
    const smtp = (b) => u.post(`/api/projects/${p}/smtp`, b);
    for (const [field, max, label] of [['host', 255, 'Hôte'], ['user', 255, 'Utilisateur'], ['pass', 256, 'Mot de passe'], ['fromEmail', 254, "Adresse d'envoi"]]) {
      const r = await smtp({ [field]: 'a'.repeat(max + 1) });
      assert.equal(r.status, 400, field);
      assert.equal((await r.json()).error, `${label} trop long : ${max} caractères au plus`);
    }
    assert.equal((await s.db.prepare('SELECT smtp_enc FROM projects WHERE id = ?').get(p)).smtp_enc, null, 'rien n\'a été enregistré');
    const link = await u.post('/link/api-key', { apiKey: 'k'.repeat(601) });
    assert.equal(link.status, 400); assert.match((await link.json()).error, /^Clé API trop long/);
    const invite = await u.post('/api/teams/invite', { email: `${'a'.repeat(250)}@x.fr` }, { form: true });
    assert.notEqual(invite.status, 500);
    // Une valeur de longueur normale passe la garde (la route répond autre chose qu'une erreur de longueur)
    const ok = await smtp({ host: 'smtp.exemple.fr', user: 'u'.repeat(255), pass: 'p'.repeat(256) });
    assert.ok(!/trop long/.test(JSON.stringify(await ok.json().catch(() => ({})))), 'les valeurs à la limite exacte sont acceptées');
  } finally { await s.close(); }
});

test('la navigation (ajax.js) laisse en place les scripts qui branchent des écouteurs sur document ou écrivent dans la console', () => {
  const ajax = readFileSync(new URL('../public/ajax.js', import.meta.url), 'utf8');
  const stay = ajax.match(/const STAY = (\/.*?\/);/)?.[1] || '';
  for (const f of ['ajax', 'fx', 'code-field', 'console-warning']) assert.ok(stay.includes(f), `${f}.js doit rester en place (sinon ses écouteurs s'accumulent à chaque navigation)`);
});
