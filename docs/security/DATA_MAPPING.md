# Cartographie des données et des traitements

Date : 24 novembre 2026. Établi **d'après le schéma de la base** (`src/migrations.js`) et le code, pas d'après des intentions. `test/dataexport.test.js` oblige à classer chaque table (exportée à la personne ou exclue avec raison) : cette cartographie ne peut pas oublier une table sans faire échouer la CI.

Rôles RGPD annoncés dans la politique de confidentialité : **iaboss est responsable de traitement** pour le compte de l'utilisateur ; l'**utilisateur est responsable de traitement** pour ses prospects (iaboss est son **sous-traitant**).

## 1. Données du compte (iaboss = responsable de traitement)

| Catégorie | Tables et champs | Finalité | Base légale | Conservation | Destinataires | Sécurité |
|---|---|---|---|---|---|---|
| Identité et connexion | `users` : e-mail, nom, fournisseur (Google/Apple), identifiant chez le fournisseur, plan, statut, dates de création et de dernière connexion | Créer le compte, se connecter | Exécution du contrat | Tant que le compte existe ; suppression automatique après 24 mois d'inactivité par défaut (`INACTIVE_ACCOUNT_MONTHS`, 0 = désactivée) | Google / Apple (connexion) | Aucun mot de passe stocké ; OIDC signé |
| Sessions | `sessions` : empreinte SHA-256 de l'identifiant, dates, état « en attente A2F », compteur d'essais | Rester connecté | Exécution du contrat, intérêt légitime | 30 jours, supprimées à la déconnexion et à la suspension | — | Empreinte seule en base |
| A2F | `users` : clé TOTP chiffrée, état, empreintes des codes de secours, dernier pas ; `trusted_devices` : empreinte du cookie, dates | Protéger le compte | Intérêt légitime, exécution du contrat | Jusqu'à la désactivation ou la suppression ; appareil de confiance 30 jours | — | AES-256-GCM, empreintes |
| Liaison de l'IA | `users.claude_link_json` : mode, fournisseur, secret chiffré, 4 derniers caractères, dates, consentement | Piloter l'IA de la personne | Exécution du contrat | Jusqu'à la déliaison ou la suppression | Fournisseur d'IA choisi | Chiffré, jamais réaffiché |
| Réglages | `user_settings` (clé/valeur) : budgets, notifications (adresses de webhooks chiffrées), prompts, profil, état de la visite guidée | Personnaliser le service | Exécution du contrat | Avec le compte | Discord / Slack / Telegram / e-mail si configurés | Secrets chiffrés |
| Abonnement | `subscriptions` : client et abonnement Stripe, offre, période, état, droits | Facturer l'offre | Exécution du contrat, obligation légale | Avec le compte (obligations comptables côté Stripe et éditeur) | Stripe | Aucune donnée de carte chez iaboss |
| Usage et activité | `usage_events`, `jobs` (type, état, durée, coût, tokens, modèle, journal), `metrics_daily` | Appliquer plafonds et budgets, afficher l'activité | Exécution du contrat | Avec le compte | — | Cloisonné par compte |
| Jetons d'API | `api_tokens` : nom, empreinte, préfixe `iaboss_`, droits, dates | Mode développeur | Exécution du contrat | Jusqu'à la suppression du jeton | — | Empreinte seule, affiché une fois |
| Agenda | `calendar_events`, `ical_feeds` (jeton chiffré) | Agenda de l'utilisateur | Exécution du contrat | Avec le compte | Application de calendrier de l'utilisateur (lien secret) | Jeton 256 bits, régénérable |
| Équipes | `teams`, `team_members`, `team_invites` | Partager des projets | Exécution du contrat | Avec le compte ; invitation 7 jours | Autres membres de l'équipe | Rôles vérifiés côté serveur |
| Modération | `admin_audit` : date, action, identifiant, adresse masquée | Sécurité, lutte contre les abus | Intérêt légitime | 12 mois | Administrateurs | Adresse masquée |
| Journal de sécurité | Sortie standard (JSON) : événement, numéro de compte, IP tronquée | Détecter les abus | Intérêt légitime | 12 mois au plus (à configurer, `MAINTENANCE_PLAN.md`) | Exploitant | Jamais de secret, de code ni d'e-mail |
| Mesure d'audience | `page_views`, `page_referrers` : jour, page ou site d'origine, compteur | Savoir quelles pages du site public sont lues | Intérêt légitime (mesure exemptée de consentement, sous réserve de validation) | 13 mois | — | Aucun identifiant, aucun cookie |

## 2. Données des prospects et des projets (utilisateur = responsable de traitement, iaboss = sous-traitant)

| Catégorie | Tables et champs | Finalité | Conservation | Destinataires | Sécurité |
|---|---|---|---|---|---|
| Projets | `projects` : nom, dépôt Git, fiche, cible, SMTP/IMAP/base chiffrés | Faire fonctionner le service | Jusqu'à suppression du projet ou du compte | Fournisseur d'IA (code, fiche) | Secrets chiffrés |
| Prospects | `prospects`, `prospect_notes`, `templates` : entreprise, e-mail professionnel, site, ville, secteur, accroche, score, statut, notes | Prospection de l'utilisateur | Jusqu'à suppression ; l'utilisateur doit purger après 3 ans sans contact (conseil affiché) | Fournisseur d'IA (domaines connus) | Cloisonné ; jamais partagé entre comptes |
| Envois et réponses | `mail_log` (texte du mail sans pied de page, raison de rejet), `replies` (expéditeur, objet, corps borné à 3 000 caractères, intention) | Suivi de la prospection | Jusqu'à suppression du projet ou du compte | SMTP/IMAP de l'utilisateur | Texte échappé à l'affichage |
| Liste d'opposition | `blacklist` : e-mail, motif, date (**commune à tous les comptes**) | Ne plus jamais recontacter une personne opposée | Conservée après la suppression d'un compte, tant que l'opposition doit être respectée | Tous les utilisateurs (effet « ne pas contacter » seulement) | Obligation légale, intérêt légitime |
| Publications | `content_drafts`, `linkedin_*`, `instagram_*`, `promo_videos` | Contenus de l'utilisateur | Jusqu'à suppression ; 20 vidéos au plus | LinkedIn / Instagram si publiés | Jetons chiffrés |

## 3. Données financières et conversations (visibles du seul compte)

| Catégorie | Tables | Conservation | Remarque |
|---|---|---|---|
| Comptabilité et justificatifs | `accounting_entries`, `accounting_declarations` + fichiers | Jusqu'à suppression ; **10 ans** d'obligation comptable : l'utilisateur exporte avant de supprimer | Fichiers sous `data/` |
| Facturation | `billing_projects`, `billing_brand`, `billing_docs`, `billing_invoices`, `billing_clients` + PDF | Idem | Clients de l'utilisateur = données de tiers |
| Conversations IA | `chat_conversations`, `chat_messages`, `chat_attachments` + fichiers | Jusqu'à suppression ; 100 conversations au plus | Transmises au fournisseur d'IA choisi |

## 4. Données qui ne sont jamais enregistrées

Adresse IP (en mémoire seulement, pour limiter le débit), numéro de carte (Stripe), mot de passe (aucun), clés et jetons en clair (chiffrés ou en empreinte).

## 5. Données sensibles (art. 9) et mineurs

Aucune catégorie particulière n'est collectée par conception ; l'utilisateur pourrait en saisir dans des notes ou des conversations (zone libre) : les CGU interdisent les usages hors professionnel. Le service est **réservé aux personnes majeures** (CGU) : aucun traitement de données de mineurs n'est prévu.

## 6. Effacement effectif

La suppression du compte est une `DELETE` sur `users` ; toutes les tables descendent par `ON DELETE CASCADE` (vérifié par `test/schema.test.js`), puis les dossiers du compte (clones, conversations, vidéos, comptabilité) sont supprimés du disque. Un abonnement Stripe actif est résilié **avant** l'effacement (sinon rien n'est supprimé). Les sauvegardes expirent à 14 jours : une donnée effacée disparaît des sauvegardes à ce moment-là.
