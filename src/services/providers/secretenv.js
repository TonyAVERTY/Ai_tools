// Variables d'environnement qui portent le secret d'un utilisateur, par fournisseur et par mode de connexion.
// Fichier sans import : le bac à sable (services/sandbox.js) le lit sans dépendre des fournisseurs eux-mêmes.
export const SECRET_ENV = {
  claude: { api_key: 'ANTHROPIC_API_KEY', subscription_token: 'CLAUDE_CODE_OAUTH_TOKEN' },
  gemini: { api_key: 'GEMINI_API_KEY' },
  openai: { api_key: 'CODEX_API_KEY' }, // variable lue par `codex exec` (documentation Codex, « Authenticate in automation »)
};

/** Seuls secrets qu'un processus enfant peut recevoir, tous fournisseurs confondus. */
export const SECRET_ENV_NAMES = new Set(Object.values(SECRET_ENV).flatMap((modes) => Object.values(modes)));

/**
 * Variables non secrètes qu'un fournisseur peut ajouter à l'environnement du processus enfant (hors secret de l'utilisateur) :
 * Gemini CLI lit un fichier de réglages « système » dont le chemin vient de cette variable.
 */
export const EXTRA_ENV_NAMES = new Set(['GEMINI_CLI_SYSTEM_SETTINGS_PATH']);
