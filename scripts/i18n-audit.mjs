// Audit de la traduction : liste les textes de l'interface qui n'ont pas encore de traduction (anglais / espagnol).
//   node scripts/i18n-audit.mjs                 résumé + les premiers textes manquants, page par page
//   node scripts/i18n-audit.mjs --all           tous les textes manquants
//   node scripts/i18n-audit.mjs --json=sortie.json   écrit la liste (texte → pages) dans un fichier
//   node scripts/i18n-audit.mjs --static        textes écrits en dur dans les scripts du navigateur et les messages d'erreur du serveur (ce qui s'affiche après coup)
// Lit les vraies pages de l'application avec un compte garni (test/helpers/i18n-pages.js) : aucune connexion à un service extérieur.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from '../test/helpers/server.js';
import { seedAccount, appPaths, readPage, PUBLIC_PATHS } from '../test/helpers/i18n-pages.js';
import { collectTexts, missingIn } from '../src/i18n/audit.js';
import { ROWS } from '../src/i18n/dictionary.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

if (flag('static')) {
  const FR = /[àâçéèêëîïôùûüœÀÉÈÊ]|\b(le|la|les|un|une|des|du|ton|ta|tes|pas|est|sont|avec|pour|dans|sur|tu|ce|cette|plus|sans)\b/i;
  const found = new Map();
  const files = [...readdirSync('public').filter((f) => f.endsWith('.js')).map((f) => join('public', f)), ...readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => join('src', f))];
  for (const file of files) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      let s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\n/g, ' ').replace(/\$\{[^}]*\}/g, '{x}').replace(/\s+/g, ' ').trim();
      if (s.length < 4 || !FR.test(s) || /^[\w./#:[\]=-]+$/.test(s) || s.startsWith('/') || /^[a-z-]+$/.test(s)) continue;
      if (!found.has(s)) found.set(s, new Set());
      found.get(s).add(file);
    }
  }
  const known = new Set(ROWS.map((r) => r[0]));
  const todo = [...found].filter(([s]) => !known.has(s));
  console.log(`${found.size} textes français dans les scripts et les messages, dont ${todo.length} pas dans le dictionnaire`);
  if (opt('json')) writeFileSync(opt('json'), JSON.stringify(Object.fromEntries(todo.map(([k, v]) => [k, [...v]])), null, 1));
  else for (const [s, f] of todo.slice(0, flag('all') ? Infinity : 40)) console.log(`  ${[...f][0]} · ${s.slice(0, 140)}`);
  process.exit(0);
}

const s = await startApp();
const { user, projectId } = await seedAccount(s);
const pages = new Map(); // texte → pages
let scanned = 0;
for (const [who, paths] of [[null, PUBLIC_PATHS], [user, appPaths(s, projectId)]]) {
  for (const path of paths) {
    const html = await readPage(s, who, path);
    if (html == null) continue;
    scanned++;
    for (const k of missingIn(collectTexts(html), 'en')) {
      if (!pages.has(k)) pages.set(k, new Set());
      pages.get(k).add(path);
    }
  }
}
await s.close();
console.log(`${scanned} pages lues, ${pages.size} textes sans traduction`);
if (opt('json')) writeFileSync(opt('json'), JSON.stringify(Object.fromEntries([...pages].map(([k, v]) => [k, [...v]])), null, 1));
else {
  const byPage = new Map();
  for (const [k, v] of pages) { const p = [...v][0]; if (!byPage.has(p)) byPage.set(p, []); byPage.get(p).push(k); }
  for (const [p, keys] of [...byPage].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${p} : ${keys.length}`);
    for (const k of keys.slice(0, flag('all') ? Infinity : 6)) console.log(`   ${k.slice(0, 150)}`);
  }
}
process.exit(0);
