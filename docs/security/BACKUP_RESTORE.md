# Sauvegarde et restauration

Date : 24 novembre 2026. Ce qui est **testé** : la logique des scripts (`test/backup-scripts.test.js`) et une sauvegarde puis restauration **réelles** sur MariaDB 10.11 à chaque PR (job « backup » du workflow « Sécurité »). Ce qui **ne l'est pas** : l'installation sur ton serveur et une restauration de tes vraies données : c'est à toi de la jouer une fois (§5) avant d'ouvrir au public.

## 1. Ce qu'il faut sauvegarder (et ce qu'il ne faut PAS mettre au même endroit)

| Élément | Comment | Où le garder |
|---|---|---|
| **Base MySQL/MariaDB** | `deploy/aitools-backup-mysql.sh` (dump complet, chiffré) | Hors du serveur (autre machine, stockage objet) |
| **Fichiers des comptes** (`DATA_DIR` : justificatifs, pièces jointes, vidéos, PDF) | Même script avec `DATA_DIR` (archive chiffrée ; les clones Git et `run/` sont exclus, ils se refont) | Idem |
| **`SECRET_KEY`** (de `.env`) | **À la main, dans un gestionnaire de mots de passe.** Jamais dans la sauvegarde, jamais dans le dépôt | Séparé de tout le reste |
| **Clé privée `age`** | Générée une fois (`age-keygen`), rangée dans le gestionnaire de mots de passe, **jamais sur le serveur** | Hors du serveur |
| `.env` complet | À la main, dans le gestionnaire de mots de passe (contient les mots de passe) | Séparé |

**Pourquoi `SECRET_KEY` séparée ?** Sans elle, les secrets chiffrés de la base (clés d'IA, SMTP des projets, jetons) sont **définitivement illisibles**, même avec une sauvegarde parfaite : les utilisateurs devraient tout reconnecter. Avec elle **et** la base, un voleur lit tout : ne les stocke pas ensemble.

## 2. Installation (une fois)

```bash
# 1. Sur une machine de confiance (pas le serveur) : créer la paire de clés
age-keygen -o cle-privee-sauvegarde.txt        # affiche « Public key: age1… » : c'est la clé publique à mettre sur le serveur
# Range cle-privee-sauvegarde.txt dans le gestionnaire de mots de passe, puis supprime-la de cette machine.

# 2. Sur le serveur : installer les outils
sudo apt install age mariadb-client            # ou mysql-client ; sqlite3 n'est pas nécessaire

# 3. Créer un compte MySQL dédié à la sauvegarde (lecture seule)
#    CREATE USER 'sauvegarde'@'localhost' IDENTIFIED BY '…';
#    GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER ON aitools.* TO 'sauvegarde'@'localhost';
```

## 3. Lancer une sauvegarde

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=sauvegarde DB_PASSWORD='…' DB_NAME=aitools \
BACKUP_AGE_RECIPIENT='age1…clé publique…' DATA_DIR=/chemin/vers/data \
  deploy/aitools-backup-mysql.sh /var/backups/iaboss 14
```

Le script **refuse** de tourner sans `BACKUP_AGE_RECIPIENT` (une sauvegarde non chiffrée contient toutes les données personnelles). Il produit, par exécution, `aitools-<date>-db.sql.gz.age` et `aitools-<date>-files.tar.gz.age`, affiche leurs empreintes SHA-256, et supprime celles de plus de 14 jours (durée annoncée dans la politique de confidentialité : **ne pas la dépasser** sans mettre la politique à jour).

**Planification** (exemple `cron`, chaque nuit à 3 h, mot de passe lu depuis un fichier `chmod 600` hors du dépôt) :

```
0 3 * * *  . /etc/iaboss-backup.env && /opt/iaboss/deploy/aitools-backup-mysql.sh /var/backups/iaboss 14 >> /var/log/iaboss-backup.log 2>&1
```

Ensuite **copie `/var/backups/iaboss` hors du serveur** (rsync, rclone, stockage objet). Une sauvegarde sur la même machine ne protège pas d'une perte de la machine.

## 4. Restaurer

### 4.1 Test de restauration (sans toucher à la production)

```bash
DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD='…' DB_NAME=aitools AGE_IDENTITY=/chemin/cle-privee-sauvegarde.txt \
  deploy/aitools-restore-check.sh /var/backups/iaboss/aitools-<date>-db.sql.gz.age
```

Le script restaure dans une **base temporaire** (`aitools_restore_check_…`, **jamais** la base de production : il refuse sinon), vérifie qu'elle contient les tables, les migrations et des comptes, puis la supprime. Sortie attendue : `RESTAURATION VÉRIFIÉE`. **À jouer chaque trimestre** et après tout changement de la procédure. Le compte utilisé doit pouvoir créer et supprimer des bases : utilise un serveur de test ou un compte dédié.

### 4.2 Restauration réelle après un sinistre

1. Arrêter l'application : `pm2 stop iaboss`.
2. Sur le nouveau serveur : installer Node 22.13+, récupérer le code (`git checkout <tag déployé>`), `npm ci --omit=dev`.
3. Retrouver `.env` et `SECRET_KEY` dans le gestionnaire de mots de passe.
4. Déchiffrer : `age -d -i cle-privee-sauvegarde.txt -o db.sql.gz aitools-<date>-db.sql.gz.age` (idem pour les fichiers).
5. Créer la base vide : `CREATE DATABASE aitools CHARACTER SET utf8mb4;` puis `gzip -dc db.sql.gz | mysql aitools`.
6. Restaurer les fichiers : `tar -C "$DATA_DIR" -xzf files.tar.gz`.
7. Démarrer : `pm2 start …` ; les migrations manquantes s'appliquent toutes seules ; vérifier la connexion, un projet, un justificatif, un mail de test.
8. **Informer** les utilisateurs de la perte de données depuis la dernière sauvegarde (perte maximale : 24 heures avec la planification ci-dessus).

## 5. Contrôle avant ouverture au public (à cocher)

- [ ] Paire de clés `age` créée, clé privée **hors du serveur** et testée (déchiffrement réussi).
- [ ] `SECRET_KEY` et `.env` rangés dans le gestionnaire de mots de passe.
- [ ] Sauvegarde automatique planifiée **et** copiée hors du serveur.
- [ ] `aitools-restore-check.sh` joué sur une sauvegarde réelle : `RESTAURATION VÉRIFIÉE` obtenu le ___ / ___ / ______.
- [ ] Restauration complète répétée une fois sur une machine de test.
- [ ] Alerte si la sauvegarde ne s'est pas produite depuis 36 heures.

## 6. Cas particulier : SQLite

`deploy/aitools-backup.sh` ne couvre que SQLite (développement) : il n'est **pas** la sauvegarde de production.

## 7. Limites connues

- Le compte `sauvegarde` doit avoir lu toutes les tables : une nouvelle table est couverte automatiquement (dump complet).
- Une base de plusieurs Go prolonge la sauvegarde ; `--single-transaction` évite de bloquer l'application (tables InnoDB).
- La date de dernière réussite n'est pas surveillée par l'application : voir `MAINTENANCE_PLAN.md`.
