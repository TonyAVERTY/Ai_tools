// Savoir-faire d'AiTools donné à Claude : des fiches de méthode (knowledge/skills/*.md) ajoutées aux consignes système.
// C'est ce qui rend Claude meilleur ICI que dans un Claude Code « nu » : il reçoit la méthode du métier en plus du contexte du projet.
// Les fiches sont versionnées avec le code, jamais modifiables par l'utilisateur.
//
// Deux familles, un seul format :
//  - niveau « metier » : prospection, mails, LinkedIn… Attachées à des tâches par `taches` (clés de PROMPT_DEFS) : choix statique.
//  - niveaux « base », « specialise », « workflow » : développement. Choisies à chaque message par l'orchestrateur (orchestrator.js) d'après
//    `intentions` (ce que veut l'utilisateur) et `signaux` (ce que le profil du dépôt a établi). Elles suivent un contrat de 12 éléments :
//    cinq décrivent la fiche (en-tête : quand, pas_pour, prerequis, outils, reussite) et servent à choisir, à documenter et à tester sans coûter de
//    jetons ; sept sont injectées (Objectif = resume, Méthode, Règles de décision, Contrôles qualité, Résultat attendu, Clarifier quand, Arrêt et escalade).
//
// Format : un en-tête entre `---` (une ligne `clé: valeur`, listes séparées par des virgules), puis le texte. Aucune autre propriété n'est lue.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWLEDGE_DIR = fileURLToPath(new URL('../../knowledge/', import.meta.url));
export const SKILLS_DIR = join(KNOWLEDGE_DIR, 'skills/');
export const STACKS_DIR = join(KNOWLEDGE_DIR, 'stacks/');
/** Taille maximale du bloc ajouté à une tâche : les fiches coûtent des jetons à chaque lancement. */
export const SKILLS_MAX_CHARS = 9000;

export const LEVELS = ['metier', 'base', 'specialise', 'workflow'];
/** Rubriques injectées d'une fiche de développement, dans l'ordre. */
export const DEV_SECTIONS = ['Méthode', 'Règles de décision', 'Contrôles qualité', 'Résultat attendu', 'Clarifier quand', 'Arrêt et escalade'];
/** Éléments du contrat qui vivent dans l'en-tête (non injectés). */
export const DEV_META = ['quand', 'pas_pour', 'prerequis', 'outils', 'reussite'];

const list = (v) => String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean);

function split(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(String(raw).replace(/\r\n?/g, '\n'));
  if (!m) throw new Error(`${file} : en-tête « --- » manquant`);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  return { meta, body: m[2].trim() };
}

/** Rubriques « ### Titre » d'un texte → { titre: contenu }. */
function sections(body) {
  const out = {};
  const parts = body.split(/^### +(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i].trim()] = parts[i + 1].trim();
  return out;
}

export function parseSkill(raw, file = '') {
  const { meta, body } = split(raw, file);
  for (const k of ['nom', 'titre', 'resume']) if (!meta[k]) throw new Error(`${file} : champ « ${k} » manquant`);
  const level = meta.niveau || 'metier';
  if (!LEVELS.includes(level)) throw new Error(`${file} : niveau inconnu « ${level} »`);
  const s = {
    name: meta.nom, title: meta.titre, summary: meta.resume, level, tasks: list(meta.taches), intents: list(meta.intentions), signals: list(meta.signaux),
    meta: Object.fromEntries(DEV_META.map((k) => [k, meta[k] || ''])), body, sections: sections(body),
  };
  if (!s.tasks.length && !s.intents.length && !s.signals.length) throw new Error(`${file} : champ « taches » ou « intentions » manquant`);
  return s;
}

/** Éléments du contrat qui manquent à une fiche de développement (liste vide = conforme). */
export function contractGaps(s) {
  if (s.level === 'metier') return [];
  return [...DEV_META.filter((k) => !s.meta[k]).map((k) => `en-tête « ${k} »`), ...DEV_SECTIONS.filter((t) => !s.sections[t]).map((t) => `rubrique « ${t} »`)];
}

let cache = null;
/** Toutes les fiches, triées par nom (lues une fois). */
export function loadSkills(dir = SKILLS_DIR) {
  if (dir === SKILLS_DIR && cache) return cache;
  const found = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => parseSkill(readFileSync(join(dir, f), 'utf8'), f));
  if (dir === SKILLS_DIR) cache = found;
  return found;
}

/** Fiches attachées à une tâche (clé de PROMPT_DEFS). */
export const skillsFor = (task, skills = loadSkills()) => skills.filter((s) => s.tasks.includes(task));

/** Texte injecté d'une fiche : métier = le texte tel quel ; développement = objectif, critère de réussite et rubriques de méthode. */
export function renderSkill(s) {
  if (s.level === 'metier') return `## ${s.title}\n${s.body}`;
  const parts = DEV_SECTIONS.filter((t) => s.sections[t]).map((t) => `${t} : ${s.sections[t]}`);
  return `## ${s.title}\nObjectif : ${s.summary}\nRéussite : ${s.meta.reussite}\n${parts.join('\n')}`;
}

const INTRO = "Savoir-faire d'AiTools : méthode éprouvée pour cette tâche. Applique-la, elle ne remplace pas les règles de format ni les consignes ci-dessus ; en cas de doute, la consigne de la tâche l'emporte. Si une fiche te pousserait à inventer une information, n'invente pas.";

/** Assemble des fiches dans un bloc de consignes, dans la limite `max` : une fiche qui ferait dépasser est écartée entière, jamais coupée. */
export function assemble(selected, { max = SKILLS_MAX_CHARS, intro = INTRO } = {}) {
  const out = [];
  let size = 0;
  for (const s of selected) {
    const part = typeof s === 'string' ? s : renderSkill(s);
    if (size + part.length > max) continue;
    out.push(part);
    size += part.length;
  }
  return out.length ? `\n\n${intro}\n\n${out.join('\n\n')}` : '';
}

/** Bloc statique d'une tâche (fiches métier attachées par `taches`) ; chaîne vide sans fiche. */
export const skillsBlock = (task, skills = loadSkills()) => assemble(skillsFor(task, skills));

/** Ajoute le bloc d'une tâche à un texte système. */
export const withSkills = (system, task) => `${system}${skillsBlock(task)}`;

// ---------- ressources par pile technique (chargées seulement quand le profil du dépôt détecte le langage) ----------
let stackCache = null;
/** Fiches de pile : { name, title, languages[], body }. */
export function loadStacks(dir = STACKS_DIR) {
  if (dir === STACKS_DIR && stackCache) return stackCache;
  const found = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const { meta, body } = split(readFileSync(join(dir, f), 'utf8'), f);
    for (const k of ['nom', 'titre', 'langages']) if (!meta[k]) throw new Error(`${f} : champ « ${k} » manquant`);
    return { name: meta.nom, title: meta.titre, languages: list(meta.langages), body };
  });
  if (dir === STACKS_DIR) stackCache = found;
  return found;
}
