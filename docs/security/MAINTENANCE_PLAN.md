# Programme de maintenance et de surveillance

Date : 24 novembre 2026. Ce qui est **automatique** (CI, Dependabot) et ce qui reste **à faire par une personne**.

## 1. Automatique (aucune action, sauf à lire les échecs)

| Quoi | Fréquence | Où | Que faire en cas d'échec |
|---|---|---|---|
| Lint + tests complets (SQLite) | Chaque PR | CI « check » | Corriger ; ne jamais désactiver un test |
| Mêmes tests sur MariaDB 10.11 | Chaque PR | CI « mysql » | Idem |
| Vérifications d'interface (contrastes clair/sombre, débordements, parcours) | Chaque PR | CI « ui » | Corriger l'interface |
| **Secrets** (fichiers + historique complet) | Chaque PR, chaque push sur `main`, chaque **lundi** | Workflow « Sécurité » | Un secret détecté = **le révoquer** (pas seulement le supprimer), voir `INCIDENT_RESPONSE.md` |
| **Licences** des dépendances | Idem | Idem | Remplacer la dépendance ou documenter une exception validée |
| **Vulnérabilités** (`npm audit`, niveau élevé) | Idem + chaque lundi | Idem | Mettre à jour la dépendance (relire le journal des changements) |
| SBOM (inventaire des composants) | Idem | Artefact « sbom » (30 jours) | — |
| **Sauvegarde + restauration réelles** sur MariaDB | Chaque PR | Workflow « Sécurité », job « backup » | Corriger les scripts de `deploy/` |
| Mises à jour de dépendances et d'actions GitHub | Chaque lundi | Dependabot : PR automatiques | Relire, laisser la CI trancher, fusionner ; une mise à jour **majeure** demande une relecture de compatibilité |

## 2. À faire par une personne

### Chaque jour (2 minutes, ou alerte automatique)
- Courrier d'alerte d'erreur (`ERROR_ALERT_TO`) : traiter ou classer. Une alerte répétée = un bug.
- `pm2 status` : le service est « online », peu de redémarrages.

### Chaque semaine (10 minutes)
- Journal de sécurité : `pm2 logs iaboss --lines 5000 | grep '"type":"security"'`. Chercher : nombreux `mfa_failed` ou `mfa_locked` pour un même compte (tentative de prise de contrôle), `admin_mfa_required` (un administrateur sans A2F), `login_failed` en rafale (sondage de la connexion).
- Page Administration : comptes suspendus, envois en pause, journal d'administration.
- Statistiques globales (`/admin/stats`) : une explosion d'erreurs IA, de mails en échec ou de requêtes est un signal.
- Pull requests Dependabot en attente.

### Chaque mois (30 minutes)
- Vérifier que la **dernière sauvegarde** existe, qu'elle est **copiée hors du serveur** et que sa taille est cohérente.
- Espace disque, mémoire, taille de la base ; `df -h`, `pm2 monit`.
- Relire les comptes administrateurs (`ADMIN_EMAILS`) et les comptes avec jetons d'API actifs anormaux.
- Mises à jour du système (`apt`), de Node 22 (correctifs de sécurité), de `pm2`.

### Chaque trimestre (1 heure)
- **Test de restauration** (`aitools-restore-check.sh`) sur une sauvegarde récente : noter la date et le résultat dans `SECURITY_TESTS.md`.
- Relire `SECURITY_ACTION_PLAN.md` : fermer ou replanifier chaque ligne.
- Relire la politique de confidentialité face au code : toute nouvelle donnée, tout nouveau service externe (`THIRD_PARTY_SERVICES.md`) est-il décrit ?
- Rotation des secrets à durée de vie limitée (clés d'API de services, mot de passe MySQL si une personne qui le connaissait part).
- Vérifier le calendrier des obligations (AI Act, facturation électronique, accessibilité) : `LEGAL_COMPLIANCE.md`.

### Chaque année
- Test d'intrusion ou scan dynamique (ZAP) ; revue complète de ce dossier `docs/security/`.
- Renouveler la vérification des fournisseurs (DPA, transferts hors UE).
- Revoir la durée de conservation de chaque catégorie (`DATA_MAPPING.md`).

## 3. Journaux : conservation et rotation

| Journal | Conservation | Mise en place |
|---|---|---|
| Journal applicatif et de sécurité (`pm2 logs`, sortie standard) | **12 mois au plus** (annoncé dans la politique de confidentialité) | `[À COMPLÉTER : configuration de pm2-logrotate ou de journald : taille, nombre de fichiers, durée]` |
| Journaux du serveur web (Nginx / Cloudflare) | 12 mois au plus | `[À COMPLÉTER : rotation Nginx]` |
| Journal d'administration | 12 mois (purge automatique) | Fait par l'application |
| Compteurs d'audience | 13 mois (purge automatique) | Fait par l'application |
| Sauvegardes | 14 jours (rotation par le script) | Fait par le script |

Règle : **jamais de mot de passe, de secret, de jeton ni de donnée bancaire dans un journal**. Le journal de sécurité n'écrit que l'événement, le numéro de compte et l'IP tronquée (`src/securitylog.js`, testé).

## 4. Alertes à mettre en place (à ta charge)

1. Service arrêté ou redémarré plus de 3 fois par heure.
2. Taux d'erreurs 5xx anormal (Nginx / Cloudflare).
3. Au moins 20 lignes `"event":"mfa_locked"` ou 50 `"event":"login_failed"` en 10 minutes.
4. Aucune sauvegarde réussie depuis 36 heures.
5. Certificat TLS expirant dans moins de 14 jours (si géré hors Cloudflare).
6. Espace disque libre inférieur à 15 %.

## 5. Signalement des vulnérabilités

Point de contact : l'adresse de contact des mentions légales (réponse sous 5 jours ouvrés). `[À COMPLÉTER : publier /.well-known/security.txt]`.
