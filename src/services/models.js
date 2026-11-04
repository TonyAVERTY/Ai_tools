// Modèles proposés dans les Réglages, par fournisseur d'IA (Claude, ChatGPT/OpenAI, Gemini). Un utilisateur ne voit que ceux de son IA. Deux listes :
//  - RECOMMENDED : les alias stables de Claude Code (`haiku`, `sonnet`, `opus` = toujours la dernière version de la gamme), avec une estimation
//    relative du coût (économe, intermédiaire, plus cher) ;
//  - OTHERS : tous les autres modèles utilisables, par leur identifiant exact, sans estimation (les tarifs bougent).
// Modèles volontairement absents : ceux déjà retirés ou en fin de vie, et Mythos (réservé aux participants du programme Glasswing).
// Un identifiant venu d'un formulaire n'est jamais transmis tel quel au CLI : il doit être dans le catalogue de l'IA de l'utilisateur.

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

export const DEFAULT_MODEL = 'haiku';

// ---------- OpenAI (ChatGPT) et Gemini ----------
// Identifiants relevés dans la documentation officielle le 4 novembre 2026 (tarifs OpenAI, modèles Gemini) : à revérifier à chaque ajout.
// `family` = gamme, pour les consignes de la page Prompts (chaque gamme a son onglet ; sans variante écrite, elle reçoit la base commune).
// Un modèle d'un autre fournisseur n'est jamais transmis à `claude --model`, et inversement : chaque liste est propre à son IA.
const OPENAI_RECOMMENDED = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', family: 'luna', tier: 'économe', cost: '$', note: 'Rapide et léger : suffit pour la plupart des projets.' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', family: 'terra', tier: 'intermédiaire', cost: '$$', note: 'Plus précis et plus nuancé, pour des fiches et des textes plus fins.' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', family: 'sol', tier: 'plus cher', cost: '$$$', note: 'Raisonnement poussé, pour les gros projets ou les cas difficiles.' },
];
const OPENAI_OTHERS = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', family: 'astra' },
];
const GEMINI_RECOMMENDED = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', family: 'flash-lite', tier: 'économe', cost: '$', note: 'Le plus rapide et le moins cher : suffit pour la plupart des projets.' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', family: 'flash', tier: 'intermédiaire', cost: '$$', note: 'Plus précis, pour des fiches et des textes plus fins.' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', family: 'flash', tier: 'plus cher', cost: '$$$', note: 'Le plus récent de la gamme Flash, pour les gros projets ou les cas difficiles.' },
];
const GEMINI_OTHERS = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', family: 'flash-lite' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (préversion)', family: 'pro' },
];

const CLAUDE_FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];

/** Catalogue par fournisseur : `default` = modèle des tâches tant que l'utilisateur n'a rien choisi, `families` = onglets de la page Prompts. */
export const CATALOGS = {
  claude: { recommended: RECOMMENDED, others: OTHERS, default: DEFAULT_MODEL, chatDefault: 'sonnet', families: CLAUDE_FAMILIES, familyLabels: { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' } },
  openai: { recommended: OPENAI_RECOMMENDED, others: OPENAI_OTHERS, default: 'gpt-6-luna', chatDefault: 'gpt-6.1-terra', families: ['luna', 'terra', 'sol', 'astra'], familyLabels: { luna: 'Luna', terra: 'Terra', sol: 'Sol', astra: 'Astra' } },
  gemini: { recommended: GEMINI_RECOMMENDED, others: GEMINI_OTHERS, default: 'gemini-3.5-flash-lite', chatDefault: 'gemini-3.6-flash', families: ['flash-lite', 'flash', 'pro'], familyLabels: { 'flash-lite': 'Flash-Lite', flash: 'Flash', pro: 'Pro' } },
};

export const catalogOf = (provider = 'claude') => CATALOGS[provider] ?? CATALOGS.claude;
export const defaultModelOf = (provider = 'claude') => catalogOf(provider).default;

const ALL = new Map();
for (const [provider, c] of Object.entries(CATALOGS)) {
  for (const m of [...c.recommended, ...c.others]) ALL.set(m.id, { ...m, provider });
}

/** Sans `provider` : le modèle existe-t-il chez l'un des fournisseurs ? Avec : chez CE fournisseur. */
export const isModel = (id, provider = null) => typeof id === 'string' && ALL.has(id) && (!provider || ALL.get(id).provider === provider);

// Niveau d'un alias Claude → rang dans la liste « recommandés » des autres IA (économe, intermédiaire, plus cher)
const CLAUDE_TIER = { haiku: 0, sonnet: 1, opus: 2 };

/** Le modèle de même niveau chez `provider` (« sonnet » → l'intermédiaire de l'autre IA). Un identifiant qui n'est pas un alias Claude reste tel quel. */
export const tierEquivalent = (id, provider = 'claude') => (provider === 'claude' || !(id in CLAUDE_TIER) ? id : catalogOf(provider).recommended[CLAUDE_TIER[id]].id);

/** Valeur d'un formulaire → identifiant du catalogue du fournisseur, ou `fallback` (par défaut le modèle par défaut de CE fournisseur). */
export function normalizeModel(id, fallback, provider = 'claude') {
  if (isModel(id, provider)) return id;
  if (provider === 'claude') return fallback === undefined ? DEFAULT_MODEL : fallback; // comportement d'origine
  // Autre IA : un repli écrit en alias Claude (« sonnet ») prend le niveau équivalent ; tout autre repli étranger au catalogue ne passe jamais
  const fb = tierEquivalent(fallback, provider);
  return fb === '' || isModel(fb, provider) ? fb : defaultModelOf(provider);
}

export const modelLabel = (id) => ALL.get(id)?.label ?? String(id);

/** Gamme d'un modèle : sert à choisir ses prompts. Claude : par son nom (Fable est un palier à part, au-dessus d'Opus) ; les autres : par leur catalogue. */
export function modelFamily(id) {
  const known = ALL.get(id)?.family;
  if (known) return known;
  const s = String(id || '').toLowerCase();
  if (s.includes('fable')) return 'fable';
  if (s.includes('opus')) return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  return 'haiku';
}

/** Gammes de Claude (historique) : le test des consignes par défaut s'y rapporte. */
export const FAMILIES = CLAUDE_FAMILIES;

/** Onglets de la page Prompts de CE fournisseur : « tous les modèles » (`*`), puis une gamme chacun. */
export const scopesOf = (provider = 'claude') => ['*', ...catalogOf(provider).families];

/** Tous les onglets possibles, tous fournisseurs confondus : ce qui est enregistré (les consignes d'une autre IA restent gardées, masquées). */
export const PROMPT_SCOPES = ['*', ...new Set(Object.values(CATALOGS).flatMap((c) => c.families))];
export const FAMILY_LABELS = { '*': 'Tous les modèles', ...Object.assign({}, ...Object.values(CATALOGS).map((c) => c.familyLabels)) };
