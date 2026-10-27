// Savoir-faire d'AiTools donné à Claude : des fiches de méthode (knowledge/skills/*.md) ajoutées aux consignes système de chaque tâche.
// C'est ce qui rend Claude meilleur ICI que dans un Claude Code « nu » : il reçoit la méthode du métier (prospection B2B, conformité,
// rédaction, lecture d'un dépôt) en plus du contexte du projet. Les fiches sont versionnées avec le code, jamais modifiables par l'utilisateur.
//
// Format d'une fiche : un en-tête entre `---` (nom, titre, resume, taches = clés de PROMPT_DEFS séparées par des virgules), puis le texte.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_DIR = fileURLToPath(new URL('../../knowledge/skills/', import.meta.url));
/** Taille maximale du bloc ajouté à une tâche : les fiches coûtent des jetons à chaque lancement. */
export const SKILLS_MAX_CHARS = 9000;

export function parseSkill(raw, file = '') {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(String(raw).replace(/\r\n?/g, '\n'));
  if (!m) throw new Error(`${file} : en-tête « --- » manquant`);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['nom', 'titre', 'resume', 'taches']) if (!meta[k]) throw new Error(`${file} : champ « ${k} » manquant`);
  return { name: meta.nom, title: meta.titre, summary: meta.resume, tasks: meta.taches.split(',').map((t) => t.trim()).filter(Boolean), body: m[2].trim() };
}

let cache = null;
/** Toutes les fiches, triées par nom (lues une fois). */
export function loadSkills(dir = SKILLS_DIR) {
  if (dir === SKILLS_DIR && cache) return cache;
  const list = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => parseSkill(readFileSync(join(dir, f), 'utf8'), f));
  if (dir === SKILLS_DIR) cache = list;
  return list;
}

/** Fiches qui s'appliquent à une tâche (clé de PROMPT_DEFS). */
export const skillsFor = (task, skills = loadSkills()) => skills.filter((s) => s.tasks.includes(task));

/** Bloc ajouté aux consignes système d'une tâche ; chaîne vide sans fiche. Les fiches entières passent, sinon on s'arrête avant d'en couper une. */
export function skillsBlock(task, skills = loadSkills()) {
  const out = [];
  let size = 0;
  for (const s of skillsFor(task, skills)) {
    const part = `## ${s.title}\n${s.body}`;
    if (size + part.length > SKILLS_MAX_CHARS) break;
    out.push(part);
    size += part.length;
  }
  if (!out.length) return '';
  return `\n\nSavoir-faire d'AiTools : méthode éprouvée pour cette tâche. Applique-la, elle ne remplace pas les règles de format ni les consignes ci-dessus ; en cas de doute, la consigne de la tâche l'emporte. Si une fiche te pousserait à inventer une information, n'invente pas.\n\n${out.join('\n\n')}`;
}

/** Ajoute le bloc d'une tâche à un texte système. */
export const withSkills = (system, task) => `${system}${skillsBlock(task)}`;
