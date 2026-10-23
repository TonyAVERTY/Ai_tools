// Modèles Claude proposés dans les Réglages. Deux listes :
//  - RECOMMENDED : les alias stables de Claude Code (`haiku`, `sonnet`, `opus` = toujours la dernière version de la gamme), avec une estimation
//    relative du coût (économe, intermédiaire, plus cher) ;
//  - OTHERS : tous les autres modèles utilisables, par leur identifiant exact, sans estimation (les tarifs bougent).
// Modèles volontairement absents : ceux déjà retirés ou en fin de vie, et Mythos (réservé aux participants du programme Glasswing).
// Un identifiant venu d'un formulaire n'est jamais transmis tel quel à `claude --model` : il doit être dans ce catalogue.

export const RECOMMENDED = [
  { id: 'haiku', label: 'Haiku', tier: 'économe', cost: '$', note: 'Rapide et léger : suffit pour la plupart des projets.' },
  { id: 'sonnet', label: 'Sonnet', tier: 'intermédiaire', cost: '$$', note: 'Plus précis et plus nuancé, pour des fiches et des textes plus fins.' },
  { id: 'opus', label: 'Opus', tier: 'plus cher', cost: '$$$', note: 'Raisonnement le plus poussé, pour les gros projets ou les cas difficiles.' },
];

export const OTHERS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

const ALL = new Map([...RECOMMENDED, ...OTHERS].map((m) => [m.id, m]));

export const DEFAULT_MODEL = 'haiku';

export const isModel = (id) => typeof id === 'string' && ALL.has(id);

/** Valeur d'un formulaire → identifiant du catalogue, ou `fallback` si elle n'y est pas. */
export const normalizeModel = (id, fallback = DEFAULT_MODEL) => (isModel(id) ? id : fallback);

export const modelLabel = (id) => ALL.get(id)?.label ?? String(id);

/** Gamme d'un modèle : sert à choisir ses prompts. Fable est un palier à part (au-dessus d'Opus). */
export function modelFamily(id) {
  const s = String(id || '').toLowerCase();
  if (s.includes('fable')) return 'fable';
  if (s.includes('opus')) return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  return 'haiku';
}

/** Onglets de la page Prompts : « tous les modèles » (`*`), puis une gamme chacun. */
export const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];
export const PROMPT_SCOPES = ['*', ...FAMILIES];
export const FAMILY_LABELS = { '*': 'Tous les modèles', haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
