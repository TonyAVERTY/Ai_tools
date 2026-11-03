// Convention rédactionnelle (docs/UX.md, « Rédaction ») : ce qu'un test peut vérifier sans comprendre le sens.
// Succès « Nom + participe passé » sans « ! » ni « avec succès » ; une erreur finit par un point ; on tutoie l'utilisateur.
// Le reste de la convention (verbes de suppression, structure d'une confirmation…) se relit à la main : voir la doc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const files = (dir, ext = '.js') => readdirSync(new URL(dir, ROOT), { recursive: true }).filter((f) => f.endsWith(ext) && !f.endsWith('.min.js')).map((f) => `${dir}${f}`);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const UI = [...files('src/'), ...files('public/')];

test('jamais « avec succès » ni de point d\'exclamation dans un message de notification, de bandeau ou d\'erreur', () => {
  const offenders = [];
  for (const f of UI) {
    read(f).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) return;
      if (/\bavec succès\b/i.test(line) && /(toast|banner|HttpError|msg)/.test(line)) offenders.push(`${f}:${i + 1} « avec succès »`);
      if (/(toast|banner)\(\s*(['"`])[^'"`]*[\p{L}\p{N}] ?!\2/u.test(line) || /HttpError\(\d+,\s*(['"`])[^'"`]*[\p{L}\p{N}] ?!\1/u.test(line)) offenders.push(`${f}:${i + 1} « ! » : ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], 'un succès se dit « Nom + participe passé » (« Prospect ajouté »), sans « ! » ni « avec succès » : voir docs/UX.md');
});

test('une notification de succès écrite en dur n\'a pas de point final (« Nom + participe passé »)', () => {
  const offenders = [];
  // ajax.js appelle toast() avec le type « error » par défaut : ses messages sont des erreurs, donc des phrases avec un point
  for (const f of files('public/').filter((x) => x !== 'public/ajax.js')) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\btoast\(\s*(['"`])((?:(?!\1).)*)\1\s*\)/g)) if (/[.!]$/.test(m[2])) offenders.push(`${f}:${i + 1} « ${m[2]} »`);
    });
  }
  assert.deepEqual(offenders, [], 'un succès n\'a pas de point final ; une phrase, si : toast(…, \'error\')');
});

test('une erreur de notification se termine par un point : toast() et banner() l\'ajoutent quand le message n\'en a pas', () => {
  const app = read('public/app.js');
  const toast = app.slice(app.indexOf('function toast('), app.indexOf('function toast(') + 1400);
  assert.match(toast, /kind === 'error' && !\/\[\.!\?…\]\$\/\.test\(msg\) \? `\$\{msg\}\.` : msg/, 'toast d\'erreur : point final ajouté si absent');
  assert.match(read('src/banner.js'), /kind === 'err' && !\/\[\.!\?…\]\$\/\.test\(String\(text\)\)/, 'bandeau d\'erreur : point final ajouté si absent');
});

test('on tutoie l\'utilisateur : aucun « vous / votre / vos » dans les textes de l\'interface', () => {
  // « rendez-vous » contient « vous » ; « vos échanges » = les échanges entre toi et lui ; le pied de page des mails aux prospects (« Vous recevez ce message… ») vouvoie à juste titre ;
  // l'exemple d'aperçu de mail (adresse fictive « vous@votre-domaine.fr » et accroche d'un faux prospect) aussi
  const allowed = [/rendez-vous/gi, /vos échanges/gi, /Vous recevez ce message/g, /vous@votre-domaine/g, /Vos fournées/g];
  const scope = [...files('src/').filter((f) => /(views|calendar|tour|banner|handlers|routes)\.js$|^src\/views\.js$/.test(f)), ...files('public/')];
  const offenders = [];
  for (const f of scope) {
    read(f).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) return;
      const clean = allowed.reduce((s, re) => s.replace(re, ''), line);
      if (/(?<![\p{L}-])(vous|votre|vos|veuillez)(?![\p{L}-])/iu.test(clean)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], 'l\'application tutoie (« tes prospects », « ton projet ») ; seuls les mails aux prospects et aux clients vouvoient');
});
