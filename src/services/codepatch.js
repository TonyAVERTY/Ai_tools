// Modifications de code proposées par l'IA pour une idée acceptée : tout ce qu'elle écrit est NON FIABLE et revérifié ici avant d'être commité.
// Deux voies, une seule sortie (la liste des fichiers changés dans le clone) :
//   - `applyEdits`  : l'IA a renvoyé des remplacements en texte (écriture directe désactivée) ; le code les applique lui-même ;
//   - `diffTrees`   : l'IA a écrit dans une copie jetable du dépôt (réglage « Écriture directe du code ») ; le code reprend ce qui a changé.
// Dans les deux cas, `checkChanges` refuse les chemins interdits, les secrets, les liens symboliques et les volumes excessifs.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { FORBIDDEN_FILES, scanText } from '../../scripts/secret-scan.js';

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 200_000;
export const MAX_TOTAL_BYTES = 400_000;

// Jamais modifiables par l'IA : le dossier Git, les workflows de CI (ils s'exécutent avec des droits), la configuration de Git, les dépendances installées
const FORBIDDEN_PATH = /(^|\/)(\.git|node_modules)(\/|$)|^\.github\/workflows\/|(^|\/)\.git(modules|attributes)$/i;

export class PatchError extends Error {}

/** Chemin relatif sûr : pas de remontée, pas de chemin absolu, pas de caractère de contrôle ni d'antislash. */
export function safeRel(p) {
  const v = String(p ?? '');
  if (!v || v.length > 300 || /[\0-\x1f\\]/.test(v) || v.startsWith('/') || v.endsWith('/')) throw new PatchError(`Chemin refusé : « ${v.slice(0, 80)} »`);
  if (v.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) throw new PatchError(`Chemin refusé : « ${v.slice(0, 80)} »`);
  if (FORBIDDEN_PATH.test(v) || FORBIDDEN_FILES.test(v)) throw new PatchError(`Fichier interdit : « ${v.slice(0, 80)} » (Git, CI, dépendances, clés et fichiers .env ne sont jamais modifiés)`);
  return v;
}

/** Chemin absolu d'un fichier du clone, jamais en dehors du clone ni à travers un lien symbolique. */
function inside(dir, rel) {
  const root = realpathSync(dir);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new PatchError(`Chemin hors du dépôt : « ${rel.slice(0, 80)} »`);
  // Chaque dossier existant du chemin doit rester dans le clone (un lien symbolique pourrait en sortir)
  let cur = root;
  for (const seg of relative(root, abs).split(sep)) {
    cur = join(cur, seg);
    if (!existsSync(cur)) break;
    if (lstatSync(cur).isSymbolicLink()) throw new PatchError(`Lien symbolique refusé : « ${rel.slice(0, 80)} »`);
  }
  return abs;
}

/**
 * Applique des remplacements ({ path, find, replace } : `find` doit apparaître UNE fois) ou des fichiers entiers ({ path, content }).
 * @returns {string[]} chemins modifiés
 */
export function applyEdits(dir, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new PatchError("L'IA n'a proposé aucune modification");
  if (edits.length > MAX_FILES * 4) throw new PatchError('Trop de modifications demandées');
  const changed = new Set();
  for (const e of edits) {
    const rel = safeRel(e?.path);
    const abs = inside(dir, rel);
    if (typeof e.content === 'string') {
      if (Buffer.byteLength(e.content) > MAX_FILE_BYTES) throw new PatchError(`Fichier trop gros : « ${rel} »`);
      mkdirSync(dirname(abs), { recursive: true });
      inside(dir, rel); // les dossiers créés sont revérifiés
      writeFileSync(abs, e.content);
    } else if (typeof e.find === 'string' && typeof e.replace === 'string' && e.find) {
      if (!existsSync(abs)) throw new PatchError(`Fichier introuvable : « ${rel} »`);
      const text = readFileSync(abs, 'utf8');
      const at = text.indexOf(e.find);
      if (at < 0) throw new PatchError(`Le passage à remplacer est introuvable dans « ${rel} »`);
      if (text.indexOf(e.find, at + 1) >= 0) throw new PatchError(`Le passage à remplacer apparaît plusieurs fois dans « ${rel} »`);
      writeFileSync(abs, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
    } else {
      throw new PatchError(`Modification mal formée pour « ${rel} »`);
    }
    changed.add(rel);
  }
  return [...changed];
}

/** Copie jetable du dépôt, SANS le dossier .git (l'IA n'y a jamais accès). */
export function copyWithoutGit(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (p) => basename(p) !== '.git' });
}

function walk(dir, base = dir, out = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    const rel = relative(base, p).split(sep).join('/');
    if (e.isSymbolicLink()) throw new PatchError(`Lien symbolique refusé : « ${rel.slice(0, 80)} »`);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.set(rel, p);
  }
  return out;
}

/**
 * Reprend dans le clone `repo` ce que l'IA a changé dans sa copie `work` (fichiers ajoutés, modifiés, supprimés).
 * @returns {string[]} chemins changés
 */
export function diffTrees(repo, work) {
  const before = walk(repo), after = walk(work);
  const changed = [];
  for (const [rel, p] of after) {
    if (!before.has(rel) || !readFileSync(p).equals(readFileSync(before.get(rel)))) changed.push(rel);
  }
  for (const rel of before.keys()) if (!after.has(rel)) changed.push(rel);
  if (!changed.length) return [];
  if (changed.length > MAX_FILES) throw new PatchError(`Trop de fichiers modifiés (${changed.length}, ${MAX_FILES} au plus)`);
  for (const rel of changed) {
    safeRel(rel);
    const dst = inside(repo, rel);
    if (after.has(rel)) {
      if (Buffer.byteLength(readFileSync(after.get(rel))) > MAX_FILE_BYTES) throw new PatchError(`Fichier trop gros : « ${rel} »`);
      mkdirSync(dirname(dst), { recursive: true });
      inside(repo, rel);
      writeFileSync(dst, readFileSync(after.get(rel)));
    } else rmSync(dst, { force: true });
  }
  return changed;
}

/** Dernier contrôle avant le commit : volume et secrets dans ce qui a été écrit. Les valeurs trouvées ne sont jamais affichées. */
export function checkChanges(dir, files) {
  if (!files.length) throw new PatchError("L'IA n'a modifié aucun fichier");
  if (files.length > MAX_FILES) throw new PatchError(`Trop de fichiers modifiés (${files.length}, ${MAX_FILES} au plus)`);
  let total = 0;
  for (const rel of files) {
    safeRel(rel);
    const abs = inside(dir, rel);
    if (!existsSync(abs)) continue; // fichier supprimé
    const text = readFileSync(abs, 'utf8');
    total += Buffer.byteLength(text);
    const found = scanText(rel, text)[0];
    if (found) throw new PatchError(`« ${rel} » (ligne ${found.line}) contient ce qui ressemble à un secret (${found.kind}) : rien n'a été poussé`);
  }
  if (total > MAX_TOTAL_BYTES) throw new PatchError(`Modifications trop volumineuses (${Math.round(total / 1000)} Ko, ${MAX_TOTAL_BYTES / 1000} Ko au plus)`);
  return files;
}
