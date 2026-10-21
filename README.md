# AiTools

Panel perso pour piloter Claude Code (headless) sur mes projets : prospection client par email,
idées d'évolutions et récap business. Pensé pour un **Raspberry Pi 4 sans ventilateur**.

## Choix techniques

- **Node 22, zéro framework** : `node:http`, `node:sqlite` intégré (rien à compiler sur ARM). 3 dépendances : `nodemailer`, `mysql2`, `pg`.
- **Rendu serveur + JS vanilla**, pas de build.
- **Un seul job IA à la fois** (file SQLite). Le process Claude tourne en `nice 10`. Pause automatique si le CPU dépasse `THERMAL_MAX`.
- **Économie de tokens** :
  - outils Claude restreints à chaque job (lecture seule pour le code, WebSearch/WebFetch pour la prospection) ;
  - `--max-turns` borné ;
  - fiche projet générée une fois, puis seulement sur « Réanalyser » ;
  - Haiku par défaut pour la prospection et les mails.
- **Sécurité** :
  - login Google avec whitelist d'emails ;
  - PKCE + state + nonce ;
  - anti-CSRF par contrôle d'`Origin` ;
  - secrets chiffrés en AES-256-GCM en base ;
  - token Forgejo jamais écrit sur disque.

## Suivi des réponses, relances et test A/B

- **Détection des réponses** : la boîte de réception du projet est lue en IMAP toutes les 15 minutes, et à la demande avec « Vérifier maintenant ».
  - Une réponse fait passer le prospect en « A répondu ». Elle est rattachée par le fil de discussion (Message-ID), puis par l'adresse, puis par le domaine pro s'il est unique.
  - Les absences, réponses automatiques et newsletters sont ignorées.
  - Les mails rejetés (bounces) passent le prospect en « Rejeté » et l'adresse en liste d'opposition.
  - Aucun token Claude n'est consommé : on ne lit que les en-têtes, et le début du corps pour les bounces.
- **Relance automatique** : une seule, après N jours (7 par défaut), dans le même fil (« Re: » + In-Reply-To). Elle part à quatre conditions :
  - le modèle de relance est validé ;
  - la boîte IMAP a été lue avec succès il y a moins de 2 h. Sinon, on relancerait des gens qui ont déjà répondu ;
  - on est en heures ouvrées, du lundi au vendredi de 9h à 18h (heure de Paris). L'heure est revérifiée entre chaque mail ;
  - les plafonds quotidiens ne sont pas atteints (premiers mails et relances confondus).
- **Test A/B de l'objet** : renseigne un « Objet B » et les envois alternent de façon équilibrée. Le taux de réponse de chaque objet s'affiche sous le bouton Envoyer.

> Test IMAP de bout en bout (optionnel) : `IMAP_TEST=hôte:port:utilisateur:motdepasse npm test`. Voir `test/inbox.live.test.js` pour les 4 mails attendus dans la boîte de test.

## Pilotage

- **Jobs de nuit** : Prospecter et Évolution proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris, changements d'heure gérés), quand le Pi est au frais et que ton quota Claude est libre. Il est annulable jusqu'au départ.
- **Budget IA** : plafonds glissants sur 24 h et sur 30 jours, en équivalent $ API remonté par Claude Code. L'abonnement Pro ne facture rien en plus ; c'est un garde-fou pour ton quota.
  - Plafond atteint : les jobs IA **restent en file** et repartent seuls quand la fenêtre glisse. Les envois et relances, qui ne consomment pas d'IA, continuent.
  - Un job en cours n'est jamais coupé : le plafond peut donc être dépassé d'un job.
- **Notifications Discord** via webhook : URL chiffrée, validée, sans mention possible. Tu choisis les événements :
  - fin de job ou erreur ;
  - réponses de prospects ;
  - relances envoyées ;
  - pause thermique ;
  - budget atteint ;
  - rapport hebdo.

  Un bouton permet d'envoyer une notification de test.
- **Rapport hebdo** : le lundi à 8h, par mail (SMTP global vers ton email de réception) et en résumé sur Discord. Pour chaque projet, sur 7 jours :
  - prospects trouvés ;
  - mails et relances envoyés ;
  - réponses et taux de réponse ;
  - clients ;
  - adresses invalides ;
  - objet gagnant du test A/B, dès 10 envois par objet ;
  - coût IA.

  Le bouton « Envoyer le rapport maintenant » permet de tester.

## Garde-fous d'envoi

- Tu choisis le nombre de mails à chaque envoi, avec une confirmation obligatoire.
- Plafonds sur 24 h : par projet (réglable, max 200) et global (réglable, max 300). Un batch fait 100 mails au plus.
- Délai aléatoire entre deux mails (20–60 s par défaut).
- Un prospect n'est contacté qu'une seule fois.
- Lien de désinscription dans chaque mail, avec en-têtes `List-Unsubscribe` en one-click.
- La liste d'opposition vaut pour tous les projets. Un statut « Refus » y ajoute aussi l'adresse.
- La source publique de l'email est stockée et rappelée dans le pied de mail (RGPD).

## Installation sur le Pi

Pré-requis : **Raspberry Pi OS Lite 64 bits** fraîchement installé, accès SSH, et ton HDD branché.

```bash
sudo apt install -y git
git clone -b develop https://git.tony-averty.dev/Tony/AiTools.git
cd AiTools
sudo ./install.sh
```

Pour voir ce qui serait fait sans rien toucher : `./install.sh --dry-run`.

### Ce que fait `install.sh`

1. **Questions d'abord** :
   - quel disque pour les données (le disque système est exclu d'office) ;
   - partition existante, ou formatage ext4 ;
   - interface réseau, Wi-Fi et Bluetooth ;
   - nettoyage du système ;
   - config de l'app ;
   - token Cloudflare ;
   - connexion Claude.

   Puis un **récapitulatif à valider**. Rien n'est modifié avant.
2. **Installation sans interruption** :
   - mise à jour du système et du firmware ;
   - nettoyage : services inutiles coupés, swap SD remplacé par zram, journaux en RAM ;
   - montage du HDD par UUID dans `/etc/fstab` (`nofail`, `noatime`) ;
   - Node 22, Claude Code et cloudflared ;
   - déploiement dans `/opt/aitools` avec l'utilisateur système `aitools` et les dépendances de prod uniquement (sans les tests) ;
   - `.env` généré avec `SECRET_KEY` aléatoire, en droits 600 ;
   - services systemd + sauvegarde quotidienne de la base (04:30, 14 jours) ;
   - tunnel Cloudflare.
3. **Connexion Claude** via `claude setup-token`, puis un test réel, et démarrage avec vérification HTTP.

Garde-fous :
- formater un disque exige de **taper son nom** ;
- les partitions exFAT/NTFS sont refusées, car SQLite et les droits Linux ne les supportent pas ;
- `/etc/fstab` et `config.txt` sont sauvegardés (`*.aitools.bak`) avant modification ;
- les tokens ne passent jamais en ligne de commande ni dans le log.

**Mise à jour de l'app** : `git pull` dans ton clone, puis relance `sudo ./install.sh` et garde la config existante. Le script est relançable sans risque.

> Le service ne démarre pas si le HDD n'est pas monté (`RequiresMountsFor`). Ça évite d'écrire une base vide sur la carte SD par erreur.

### Google OAuth

Dans la console Google Cloud, crée un ID client OAuth de type « Application Web » (menu Identifiants).

- URI de redirection : `https://ai.tony-averty.dev/auth/google/callback`
- Écran de consentement : mode « Test » avec ton email en testeur, ça suffit.

### Cloudflare Tunnel

Dans Zero Trust, va dans Networks → Tunnels → Create a tunnel (Cloudflared).

- Public hostname : `ai.tony-averty.dev` → `http://localhost:3100`
- Copie le token, `install.sh` te le demandera.

### Forgejo

Le token se crée dans Paramètres → Applications. Donne-lui la portée `read:repository` seulement, puis colle-le dans **Réglages** du panel avec l'hôte `git.tony-averty.dev`.

## À faire côté mails (sinon spam garanti)

- SPF, DKIM et DMARC sur le domaine d'envoi.
- Idéalement un sous-domaine dédié à la prospection, pour protéger ton domaine principal.
- Commence petit, 10 à 20 mails par jour la première semaine.

## Récapitulatif (BDD des projets)

- Crée un utilisateur **lecture seule** dédié sur chaque base.
- N'expose pas MySQL/Postgres à tout Internet. Autorise uniquement l'IP de ta box, ou passe par un tunnel SSH.
- Seules les requêtes `SELECT` / `WITH` sont acceptées, exécutées dans une transaction read-only. Chacune doit renvoyer un seul nombre.

## Dev

```bash
npm install
npm run hooks     # active le hook pre-commit (refus sur main, secrets, lint + tests)
npm run check     # lint + tests
```

Les tests utilisent un faux binaire Claude (`test/fixtures/fake-claude.js`) : aucun token consommé.

`test/install.test.sh` teste les fonctions d'`install.sh` qui écrivent des fichiers : `.env`, unit systemd, migration, sauvegarde. Il tourne en root et écrit dans `/opt/aitools` et `/etc/systemd`, donc **uniquement dans une VM ou un conteneur jetable**, jamais sur le Pi en service.
