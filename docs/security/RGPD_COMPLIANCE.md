# État de conformité RGPD

Date : 24 novembre 2026. Ce document dit **ce que le code fait réellement**. Il n'est **pas une validation juridique** : tout ce qui est marqué « à valider » demande un juriste ou la CNIL. Les textes cités n'ont pas pu être vérifiés en ligne pendant cet audit (pas d'accès à des sources officielles depuis l'environnement de travail) : relis-les sur legifrance.gouv.fr, cnil.fr et eur-lex.europa.eu avant de t'en servir.

Légende : ✅ en place et vérifié (preuve) · 🟡 en place, à valider ou à compléter · ❌ manquant.

## 1. Principes (art. 5, 25)

| Exigence | État | Preuve / remarque |
|---|---|---|
| Minimisation | ✅ | Aucun mot de passe, pas d'IP en base, pas de numéro de carte, e-mail et nom fournis par le fournisseur de connexion seulement (`DATA_MAPPING.md`) |
| Limitation de la conservation | ✅ | Durées annoncées et appliquées : suppression d'inactivité à 24 mois par défaut, journal d'administration 12 mois, mesure d'audience 13 mois, sessions 30 jours, appareils de confiance 30 jours (`test/followup.test.js`, `test/audience.test.js`) |
| Privacy by default | ✅ | Cookies facultatifs absents par défaut ; A2F proposée ; mesure d'audience sans identifiant ; « Ne pas me suivre » respecté |
| Sécurité (art. 32) | 🟡 | Chiffrement, empreintes, A2F, cloisonnement, sauvegardes chiffrées : voir `SECURITY_AUDIT.md`. La configuration réelle du serveur reste à vérifier |
| Transparence (art. 12-14) | 🟡 | Politique de confidentialité à jour (données, durées, destinataires, transferts, droits). Relecture juridique à faire |

## 2. Droits des personnes (art. 15 à 22)

| Droit | État | Comment l'exercer |
|---|---|---|
| Accès et portabilité (15, 20) | ✅ | Mon compte → « Télécharger mes données » : JSON de toutes les tables du compte, sans secret (`test/dataexport.test.js`). Les fichiers (justificatifs, pièces jointes, vidéos) sur demande par e-mail |
| Rectification (16) | ✅ | L'utilisateur modifie ses données dans l'application ; e-mail du compte : celui du fournisseur de connexion |
| Effacement (17) | ✅ | Mon compte → suppression immédiate (cascade vérifiée, dossiers effacés, abonnement résilié avant) ; sauvegardes expirées sous 14 jours |
| Limitation / opposition (18, 21) | 🟡 | Par e-mail à l'adresse de contact, réponse sous un mois. Pas d'outil dédié (volume attendu faible) |
| Prospects (tiers) | ✅ | Lien de désinscription dans chaque mail → liste d'opposition commune à tous les comptes (`test/abuse.test.js`) ; l'expéditeur reste le responsable de traitement |
| Décision automatisée (22) | ✅ | Aucune décision produisant des effets juridiques : un score de prospect est une aide, l'utilisateur décide d'écrire ou non |

Délai : un mois, prolongeable (art. 12). **Preuve de la demande** : conserver l'e-mail reçu et la réponse (procédure : `INCIDENT_RESPONSE.md` §6).

## 3. Responsabilités et sous-traitants (art. 26, 28, 30)

- **iaboss est responsable de traitement** pour les comptes ; **sous-traitant** pour les prospects de l'utilisateur. 🟡 L'art. 28 exige un contrat ou acte juridique entre responsable et sous-traitant : les **CGU** jouent ce rôle pour les prospects, mais **vérifié dans `src/site/legal.js` (CGU, article « Données personnelles »)** : elles se limitent à nommer les rôles (responsable / sous-traitant) et ne contiennent pas les clauses de l'art. 28(3) (traitement sur instructions documentées, confidentialité du personnel, mesures de sécurité, sous-traitance ultérieure et autorisation, assistance pour les droits des personnes, suppression ou restitution en fin de contrat, audits). **Lacune réelle : à faire rédiger par un juriste** (avenant de traitement / DPA annexé aux CGU).
- **Sous-traitants d'iaboss** (`THIRD_PARTY_SERVICES.md`) : hébergeur, Stripe, Google (connexion, reCAPTCHA), Apple (connexion), Cloudflare (si utilisé), fournisseurs d'IA. 🟡 Vérifier que chacun a signé ou accepté son DPA (en général ses conditions en ligne) et qu'il est cité dans la politique de confidentialité (c'est le cas).
- **Registre des traitements (art. 30)** : `DATA_MAPPING.md` sert de base. Une entreprise de moins de 250 personnes en est dispensée **sauf** si le traitement est susceptible de comporter un risque, n'est pas occasionnel ou porte sur des données sensibles : la prospection est un traitement régulier, donc **tenir un registre est la décision prudente** (à valider).

## 4. Transferts hors Espace économique européen (art. 44 à 49)

Fournisseurs d'IA (Anthropic, OpenAI, Google), Google, Apple : traitements possibles aux États-Unis. La politique de confidentialité mentionne les clauses contractuelles types et le cadre de protection des données UE-États-Unis. 🟡 **À vérifier à la date de mise en ligne** que chaque fournisseur est bien certifié ou couvert par des clauses (ces mécanismes évoluent) ; aucune vérification en ligne n'a été faite ici.

## 5. DPO, AIPD (art. 35, 37)

- **DPO** : non désigné ; la politique le dit. 🟡 Une désignation est obligatoire pour une autorité publique, un suivi régulier et systématique à grande échelle, ou des données sensibles à grande échelle. À l'échelle actuelle (un éditeur, service B2B), l'obligation ne paraît pas s'appliquer ; **à valider** si le volume grandit.
- **AIPD** : à décider avec un juriste. Éléments à peser : profilage de prospects (score), croisement de données (recherche web + dépôt), usage d'IA (technologie nouvelle) ; mais pas de données sensibles ni de décision automatisée à effet juridique. Je ne conclus pas : **validation humaine nécessaire**.

## 6. Cookies et traceurs (ePrivacy, lignes directrices CNIL)

Conclusion (à valider) : **aucun consentement n'est requis, aucun bandeau n'est affiché**.

| Traceur | Nature | Consentement ? |
|---|---|---|
| `sid` (session) | Strictement nécessaire | Non |
| `oauth_b` (liaison de la connexion Google/Apple, 10 min), `li_oauth_b` (liaison LinkedIn, 10 min, posé seulement si l'utilisateur relie LinkedIn) | Strictement nécessaire | Non |
| `mfa_td` (appareil de confiance A2F, 30 jours), posé seulement si la case est cochée | Sécurité demandée par la personne | Non |
| `theme` (clair/sombre, 1 an), posé seulement sur choix de la personne | Préférence d'interface choisie | Non |
| Compteurs d'audience par jour et par page, **sans cookie** | Mesure statistique anonyme | Non, sous conditions de la CNIL (finalité statistique, aucun identifiant, pas de recoupement, information, opposition possible) |
| Google reCAPTCHA (page de connexion, si activé) | Sécurité du formulaire ; dépose des cookies Google | Position de la CNIL à vérifier : mentionné dans la politique, **à valider** |

Aucun Google Analytics, pixel publicitaire, session recording ni SDK de suivi (relu : aucune ressource externe n'est chargée, la CSP l'interdit : `default-src 'self'`).

## 7. Violation de données (art. 33-34)

Procédure : `INCIDENT_RESPONSE.md`. Rappel : notification à la CNIL **dans les 72 heures** après en avoir pris connaissance, sauf si la violation n'est pas susceptible d'engendrer un risque ; information des personnes si le risque est élevé. Le journal de sécurité et le journal d'administration servent à reconstituer les faits.

## 8. Ce qu'il reste à faire pour être en règle

1. ❌ Faire rédiger par un juriste l'avenant de traitement (art. 28(3)) et relire les CGU, la politique de confidentialité et les mentions légales.
2. 🟡 Tenir le registre des traitements à partir de `DATA_MAPPING.md` ; décider de l'AIPD.
3. 🟡 Vérifier les DPA et les mécanismes de transfert de chaque fournisseur à la date de mise en ligne.
4. 🟡 Mettre en place la rotation des journaux (12 mois) sur le serveur.
5. 🟡 Écrire la réponse type aux demandes de droits (modèles dans `INCIDENT_RESPONSE.md` §6).
