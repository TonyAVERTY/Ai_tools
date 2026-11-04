// Variables d'environnement qui portent le secret d'un utilisateur, par fournisseur et par mode de connexion.
// Fichier sans import : le bac à sable (services/sandbox.js) le lit sans dépendre des fournisseurs eux-mêmes.
export const SECRET_ENV = {
  claude: { api_key: 'ANTHROPIC_API_KEY', subscription_token: 'CLAUDE_CODE_OAUTH_TOKEN' },
};

/** Seuls secrets qu'un processus enfant peut recevoir, tous fournisseurs confondus. */
export const SECRET_ENV_NAMES = new Set(Object.values(SECRET_ENV).flatMap((modes) => Object.values(modes)));
