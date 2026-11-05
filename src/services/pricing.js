// Estimation du coût d'un job pour les IA dont le CLI ne remonte pas de montant en $ (Gemini, ChatGPT/Codex). Claude donne son propre coût.
// Grille en $ par million de tokens, relevée dans la documentation officielle le 4 novembre 2026 :
//   Gemini : ai.google.dev/gemini-api/docs/pricing (palier payant, prompts de 200 000 tokens au plus)
//   OpenAI : developers.openai.com/api/docs/pricing (tarif Standard)
// À REVÉRIFIER à chaque changement de catalogue : un tarif périmé fausse le budget en $ (plafonds 24 h / 30 j) sans que rien ne casse.
// Une ligne par période : `until` = dernier jour (UTC, inclus) où elle s'applique ; la dernière ligne n'en a pas.
const PRICES = {
  'gemini-3.5-flash-lite': [{ input: 0.30, output: 2.50, cached: 0.03 }],
  'gemini-3.1-flash-lite': [{ input: 0.25, output: 1.50, cached: 0.025 }],
  // Tarif de lancement jusqu'au 31 décembre 2026, puis le tarif normal
  'gemini-3.6-flash': [{ until: '2026-12-31', input: 0.75, output: 3.75, cached: 0.075 }, { input: 1.50, output: 7.50, cached: 0.15 }],
  'gemini-3.8-flash': [{ until: '2026-12-31', input: 0.75, output: 3.75, cached: 0.075 }, { input: 1.50, output: 7.50, cached: 0.15 }],
  'gemini-3.1-pro-preview': [{ input: 2.00, output: 12.00, cached: 0.20 }],
  'gpt-6-luna': [{ input: 0.10, output: 0.50, cached: 0.01 }],
  'gpt-6.1-terra': [{ input: 1.00, output: 5.00, cached: 0.05 }],
  'gpt-6.1-sol': [{ input: 2.00, output: 10.00, cached: 0.10 }],
  'gpt-6-astra': [{ input: 10.00, output: 50.00, cached: 1.00 }],
};

/** Tarif en vigueur pour un modèle à une date (secondes Unix), ou null si le modèle n'est pas dans la grille. */
export function priceOf(model, at = Math.floor(Date.now() / 1000)) {
  const rows = PRICES[model];
  if (!rows) return null;
  const day = new Date(at * 1000).toISOString().slice(0, 10);
  return rows.find((r) => !r.until || day <= r.until) ?? rows[rows.length - 1];
}

/**
 * Coût estimé en $ ; `inputTokens` comprend les tokens lus dans le cache (`cachedTokens`), facturés moins cher.
 * @returns {number|null} null quand le modèle n'a pas de tarif connu : mieux vaut ne rien annoncer qu'un montant inventé
 */
export function estimateCost(model, { inputTokens = 0, outputTokens = 0, cachedTokens = 0 } = {}, at) {
  const p = priceOf(model, at);
  if (!p) return null;
  const cached = Math.min(Math.max(0, cachedTokens), Math.max(0, inputTokens));
  const usd = ((inputTokens - cached) * p.input + cached * p.cached + Math.max(0, outputTokens) * p.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
