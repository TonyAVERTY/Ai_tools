// Export complet des données d'un compte (droits d'accès et de portabilité, RGPD art. 15 et 20) : un fichier JSON, une entrée par table.
// Jamais de secret : colonnes chiffrées (`*_enc`), empreintes (`*_hash`), jetons, états de connexion et codes de secours restent côté serveur.
// test/dataexport.test.js oblige à classer CHAQUE table de la base : exportée ici, ou exclue avec une raison.
import { now } from '../db.js';

const OWN = '(SELECT id FROM projects WHERE user_id = ?)';
/** table → { where (un seul paramètre : l'identifiant du compte), cols (liste blanche) ou omit (colonnes retirées en plus des colonnes secrètes) } */
export const EXPORTED = {
  users: { where: 'id = ?', cols: ['id', 'email', 'name', 'provider', 'status', 'plan', 'created_at', 'last_login_at', 'totp_enabled'] },
  user_settings: { where: 'user_id = ?', omit: [] },
  projects: { where: 'user_id = ?', omit: [] },
  prospects: { where: `project_id IN ${OWN}` },
  prospect_notes: { where: `prospect_id IN (SELECT id FROM prospects WHERE project_id IN ${OWN})` },
  templates: { where: `project_id IN ${OWN}` },
  mail_log: { where: `project_id IN ${OWN}` },
  replies: { where: `project_id IN ${OWN}` },
  jobs: { where: 'user_id = ?' },
  evolution_decisions: { where: 'user_id = ?' },
  usage_events: { where: 'user_id = ?' },
  api_tokens: { where: 'user_id = ?' },
  calendar_events: { where: 'user_id = ?' },
  chat_conversations: { where: 'user_id = ?' },
  chat_messages: { where: 'conversation_id IN (SELECT id FROM chat_conversations WHERE user_id = ?)' },
  chat_attachments: { where: 'user_id = ?' },
  content_drafts: { where: `project_id IN ${OWN}`, omit: ['image'] },
  linkedin_accounts: { where: `project_id IN ${OWN}` },
  linkedin_posts: { where: `project_id IN ${OWN}` },
  instagram_accounts: { where: `project_id IN ${OWN}` },
  promo_videos: { where: 'user_id = ?' },
  accounting_entries: { where: 'user_id = ?' },
  accounting_declarations: { where: 'user_id = ?' },
  billing_brand: { where: 'user_id = ?', omit: ['assets_json'] },
  billing_clients: { where: 'user_id = ?' },
  billing_docs: { where: 'user_id = ?' },
  billing_invoices: { where: 'user_id = ?' },
  billing_projects: { where: 'user_id = ?' },
  metrics_daily: { where: `project_id IN ${OWN}` },
  subscriptions: { where: 'user_id = ?', cols: ['plan', 'period', 'status', 'entitled', 'current_period_end', 'cancel_at_period_end', 'created_at', 'updated_at'] },
  today_done: { where: 'user_id = ?' },
  teams: { where: 'owner_id = ?' },
  team_members: { where: 'user_id = ?' },
  ical_feeds: { where: 'user_id = ?', cols: ['created_at'] },
};

/** Tables volontairement absentes de l'export, avec la raison. */
export const EXCLUDED = {
  admin_audit: 'journal des actions des administrateurs (adresses masquées), pas une donnée du compte',
  blacklist: 'liste d\'opposition commune à tous les utilisateurs (adresses de tiers qui ont refusé d\'être contactés)',
  oauth_states: 'états de connexion éphémères (10 minutes), secrets de liaison au navigateur',
  page_referrers: 'compteurs d\'audience anonymes (aucun lien avec une personne)',
  page_views: 'compteurs d\'audience anonymes (aucun lien avec une personne)',
  schema_migrations: 'version technique de la base',
  sessions: 'identifiants de session (empreintes), secrets',
  stripe_events: 'identifiants d\'événements de paiement déjà traités (idempotence), sans donnée de compte',
  team_invites: 'invitations : jetons (empreintes) et adresses de tiers invités',
  trusted_devices: 'empreintes des appareils de confiance A2F, secrets',
};

// Colonnes qui ne sortent jamais : chiffrées, empreintes, jetons, secrets, états de connexion, clé d'IA liée
const SECRET_COL = /(_enc$|secret|password|^pass$|_hash$|^token$|_token$|verifier|binding|nonce|private_key|claude_link_json|totp_)/i;
// Réglages « clé / valeur » (user_settings) : les secrets y sont des LIGNES (jeton chiffré, webhooks, état de quota), pas des colonnes
const SECRET_SETTING_KEY = /(_enc$|token|secret|password|hooks_json|channels_json|servers_json|rate_limit|quota)/i;
// Dernier filet, sur TOUTES les tables : un texte qui contient un secret chiffré (v1:iv:tag:données) n'est jamais exporté, même dans un JSON
const CIPHERTEXT = /v1:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{8,}:[A-Za-z0-9+/=]{2,}/;
const REDACTED = '[secret chiffré : non exporté]';
const ROW_CAP = 100_000;

export async function exportAccount(db, userId, at = now()) {
  const data = {};
  const omitted = {};
  for (const [table, spec] of Object.entries(EXPORTED)) {
    const n = (where) => (where.match(/\?/g) || []).length;
    const rows = await db.prepare(`SELECT * FROM ${table} WHERE ${spec.where} LIMIT ${ROW_CAP}`).all(...Array(n(spec.where)).fill(userId));
    data[table] = rows.filter((r) => table !== 'user_settings' || !SECRET_SETTING_KEY.test(String(r.key))).map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        if (spec.cols ? !spec.cols.includes(k) : (SECRET_COL.test(k) || (spec.omit || []).includes(k))) continue;
        out[k] = typeof v === 'bigint' ? Number(v) : typeof v === 'string' && CIPHERTEXT.test(v) ? REDACTED : v;
      }
      return out;
    });
    if (rows.length >= ROW_CAP) omitted[table] = `limité à ${ROW_CAP} lignes`;
  }
  return {
    format: 'iaboss-export-v1',
    generated_at: at,
    notes: [
      'Ce fichier contient les données de ton compte iaboss, table par table. Les dates sont des secondes Unix (UTC).',
      'Il ne contient aucun secret : clés d\'IA, mots de passe SMTP / IMAP / base, jetons, codes A2F et empreintes restent chiffrés sur le serveur.',
      'Les fichiers (justificatifs, pièces jointes, vidéos, PDF) ne sont pas inclus : leurs métadonnées le sont, écris-nous pour les recevoir.',
      ...Object.entries(omitted).map(([t, m]) => `Table ${t} : ${m}.`),
    ],
    data,
  };
}
