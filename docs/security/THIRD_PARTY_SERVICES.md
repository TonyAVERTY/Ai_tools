# Inventaire des services externes et sous-traitants

Date : 24 novembre 2026. Établi d'après le code (`src/`), la configuration (`.env.example`) et la politique de confidentialité. La colonne « Contrat / DPA » est à compléter par l'éditeur : je ne peux pas vérifier les contrats signés.

Légende « Rôle » : **ST** sous-traitant de l'éditeur · **ST2** sous-traitant ultérieur (choisi par l'utilisateur) · **RT** responsable de traitement distinct · **Utilisateur** : service de l'utilisateur, auquel iaboss se connecte avec ses identifiants.

| Service | Pourquoi | Données transmises | Rôle | Transfert hors UE | Quand | Contrat / DPA |
|---|---|---|---|---|---|---|
| **Hébergeur** (ElypseCloud, Mérignac) | Serveur, base, fichiers | Toutes | ST | Non indiqué : à confirmer | Toujours | `[À COMPLÉTER : contrat d'hébergement et DPA]` |
| **Cloudflare** (tunnel, TLS, WAF) | Exposition du service | Tout le trafic HTTP | ST | Possible | Si utilisé (le modèle de déploiement le prévoit) | `[À COMPLÉTER]` |
| **Google** (connexion OIDC) | Connexion | E-mail, nom, identifiant | RT (identité) | Possible (États-Unis) | Toujours | Conditions Google |
| **Apple** (connexion) | Connexion | E-mail (éventuellement masqué), nom | RT (identité) | Possible | Si activé | Conditions Apple |
| **Google reCAPTCHA** | Anti-robots sur la page de connexion | IP, informations navigateur ; cookies Google | RT | Possible | Si `RECAPTCHA_*` configuré | Conditions Google ; **position CNIL à valider** |
| **Stripe** (Stripe Payments Europe, Irlande) | Paiement des abonnements | E-mail, offre, données de paiement saisies chez Stripe | RT et ST | Possible | Si `STRIPE_*` configuré | DPA Stripe (conditions en ligne) ; PCI DSS : SAQ A |
| **Anthropic** (Claude) | IA, via l'accès de l'utilisateur | Code du projet, fiche, cible, messages, pièces jointes | ST2 (choisi par l'utilisateur) | Oui (États-Unis) | Si l'utilisateur lie Claude | Conditions Anthropic de l'utilisateur |
| **OpenAI** (ChatGPT / Codex) | IA | Idem | ST2 | Oui | Si l'utilisateur lie ChatGPT | Conditions OpenAI de l'utilisateur |
| **Google** (Gemini) | IA | Idem | ST2 | Oui | Si l'utilisateur lie Gemini | Conditions Google de l'utilisateur |
| **Synthèse vocale** (Google Traduction, ElevenLabs, Google Cloud TTS, Microsoft Azure) | Voix des vidéos de promotion | Texte de narration | ST2 | Possible | Si la voix est cochée | Conditions du service choisi, clé de l'utilisateur |
| **SMTP / IMAP de l'utilisateur** | Envoyer et lire les réponses | Mails, adresses des prospects | Utilisateur | Selon son fournisseur | Toujours pour la prospection | Contrat de l'utilisateur |
| **SMTP du serveur** (`SYSTEM_SMTP_*`) | Alertes d'erreur, rapport hebdomadaire, notifications par e-mail | Adresse de l'utilisateur, texte de la notification | ST | Selon le fournisseur | Si configuré | `[À COMPLÉTER]` |
| **Discord / Slack / Telegram** | Notifications de l'utilisateur | Titre et description des événements | Utilisateur | Possible | Si configuré par l'utilisateur | Contrat de l'utilisateur |
| **LinkedIn** | Publication de posts | Texte des posts, jeton | Utilisateur | Possible | Si lié | Conditions LinkedIn |
| **Instagram (Meta)** | Publication | Image, légende, jeton | Utilisateur | Possible | Si lié | Conditions Meta |
| **Forgejo / Git** (dépôts de l'utilisateur) | Lire le code du projet | Jeton d'accès éventuel | Utilisateur | Selon l'hébergeur du dépôt | Toujours (clone du code) | Contrat de l'utilisateur |
| **GitHub** (dépôt du code d'iaboss, CI, Dependabot) | Développement | Code source d'iaboss, **aucune donnée d'utilisateur** | Développement | Possible | Toujours | Conditions GitHub |

## Règles de maintenance

- Tout nouveau service externe se déclare ici **avant** le déploiement, avec : données transmises, rôle, transferts, contrat. La politique de confidentialité (`src/site/legal.js`, section « Qui reçoit les données ») est mise à jour dans le même changement.
- Aucun script, police, image ni feuille de style n'est chargé depuis un autre site : la CSP (`default-src 'self'`) l'interdit, sauf la vérification reCAPTCHA sur la page de connexion quand elle est activée.
- Les connexions sortantes vers les services de l'utilisateur passent par `src/netguard.js` (ports, DNS résolu, adresses privées refusées, IP épinglée).
