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

## Garde-fous d'envoi

- Tu choisis le nombre de mails à chaque envoi, avec une confirmation obligatoire.
- Plafonds sur 24 h : par projet (réglable, max 200) et global (réglable, max 300). Un batch fait 100 mails au plus.
- Délai aléatoire entre deux mails (20–60 s par défaut).
- Un prospect n'est contacté qu'une seule fois.
- Lien de désinscription dans chaque mail, avec en-têtes `List-Unsubscribe` en one-click.
- La liste d'opposition vaut pour tous les projets. Un statut « Refus » y ajoute aussi l'adresse.
- La source publique de l'email est stockée et rappelée dans le pied de mail (RGPD).

## Installation sur le Pi

```bash
# Node 22 LTS (arm64)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Utilisateur dédié + code
sudo useradd -m -s /bin/bash aitools
sudo git clone https://git.tony-averty.dev/Tony/AiTools.git /opt/aitools
sudo chown -R aitools: /opt/aitools
cd /opt/aitools && sudo -u aitools npm ci --omit=dev && sudo -u aitools mkdir -p data

# Claude Code, connecté à TON compte Pro (une seule fois, en interactif)
sudo npm i -g @anthropic-ai/claude-code
sudo -u aitools -i claude      # puis /login, ouvre le lien sur ton PC
```

Configuration :

```bash
sudo -u aitools cp .env.example .env && sudo -u aitools nano .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → SECRET_KEY
```

> Conseil : mets `DATA_DIR` sur un SSD USB. La carte SD n'aime pas les écritures SQLite.

Service :

```bash
sudo cp deploy/aitools.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now aitools
journalctl -u aitools -f
```

### Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create aitools
cloudflared tunnel route dns aitools ai.tony-averty.dev
sudo cp deploy/cloudflared-config.yml /etc/cloudflared/config.yml   # remplacer <TUNNEL_ID>
sudo cloudflared service install
```

Aucun port à ouvrir sur la box. L'app écoute uniquement sur `127.0.0.1`.

### Google OAuth

Dans la console Google Cloud, va dans Identifiants, puis crée un ID client OAuth de type « Application Web ».

- URI de redirection : `https://ai.tony-averty.dev/auth/google/callback`
- Écran de consentement : mode « Test » avec ton email en testeur, ça suffit.

### Forgejo

Le token se crée dans Paramètres → Applications. Donne-lui la portée `read:repository` seulement. Colle-le ensuite dans **Réglages** avec l'hôte `git.tony-averty.dev`.

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
