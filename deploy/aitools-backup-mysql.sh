#!/bin/sh
# Sauvegarde chiffrée de la production : base MySQL/MariaDB + fichiers des comptes (justificatifs, pièces jointes, vidéos, PDF).
# Ne sauvegarde PAS le fichier .env ni SECRET_KEY : garde-les à part, dans un gestionnaire de mots de passe (voir docs/security/BACKUP_RESTORE.md).
# Sans SECRET_KEY, les secrets chiffrés de la base (clés d'IA, SMTP des projets…) sont définitivement illisibles, même avec une sauvegarde parfaite.
#
# Usage : DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… DB_NAME=… BACKUP_AGE_RECIPIENT=age1… [DATA_DIR=/chemin/data] \
#           aitools-backup-mysql.sh <dossier de sauvegarde> [jours à garder, 14 par défaut]
# BACKUP_AGE_RECIPIENT : clé PUBLIQUE age (https://age-encryption.org). La clé privée correspondante reste hors du serveur : un voleur du serveur
# ne peut pas lire les sauvegardes. Sans elle, le script refuse de tourner (BACKUP_ALLOW_UNENCRYPTED=1 pour un essai local, jamais en production).
# Le compte DB_USER n'a besoin que de SELECT, LOCK TABLES, SHOW VIEW, TRIGGER (et PROCESS n'est pas utilisé : --no-tablespaces).
set -eu
umask 077

dest=${1:?dossier de sauvegarde manquant}
keep=${2:-14}
: "${DB_HOST:?DB_HOST manquant}" "${DB_USER:?DB_USER manquant}" "${DB_NAME:?DB_NAME manquant}"
port=${DB_PORT:-3306}
recipient=${BACKUP_AGE_RECIPIENT:-}
if [ -z "$recipient" ] && [ "${BACKUP_ALLOW_UNENCRYPTED:-0}" != "1" ]; then
  echo "BACKUP_AGE_RECIPIENT manquant : une sauvegarde non chiffrée contient toutes les données personnelles (refus)." >&2; exit 2
fi
[ -z "$recipient" ] || command -v age >/dev/null || { echo "age introuvable (apt install age)" >&2; exit 2; }
dump=$(command -v mariadb-dump || command -v mysqldump) || { echo "mariadb-dump / mysqldump introuvable" >&2; exit 2; }

mkdir -p "$dest"
cnf=$(mktemp); tmp=$(mktemp -d "$dest/.tmp.XXXXXX")
trap 'rm -rf "$cnf" "$tmp"' EXIT INT TERM
# Le mot de passe passe par un fichier (jamais dans la ligne de commande, visible dans `ps`)
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "${DB_PASSWORD:-}" "$DB_HOST" "$port" > "$cnf"

stamp=$(date +%Y%m%d-%H%M%S)
opts="--single-transaction --routines --triggers --no-tablespaces --default-character-set=utf8mb4"
"$dump" --help 2>/dev/null | grep -q -- '--column-statistics' && opts="$opts --column-statistics=0"

# 1. Base de données
# shellcheck disable=SC2086
"$dump" --defaults-extra-file="$cnf" $opts "$DB_NAME" | gzip -9 > "$tmp/db.sql.gz"
gzip -t "$tmp/db.sql.gz"
gzip -dc "$tmp/db.sql.gz" | tail -n 3 | grep -q "Dump completed" || { echo "Sauvegarde de la base incomplète (pas de « Dump completed »)" >&2; exit 1; }
[ "$(wc -c < "$tmp/db.sql.gz")" -gt 1024 ] || { echo "Sauvegarde de la base trop petite : refus" >&2; exit 1; }

# 2. Fichiers des comptes (le clone des dépôts se refait, il n'est pas sauvegardé)
if [ -n "${DATA_DIR:-}" ] && [ -d "$DATA_DIR" ]; then
  tar -C "$DATA_DIR" --exclude='./repos' --exclude='./run' -czf "$tmp/files.tar.gz" .
  gzip -t "$tmp/files.tar.gz"
fi

# 3. Chiffrement (clé publique), puis suppression du clair
for f in "$tmp"/*.gz; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  if [ -n "$recipient" ]; then age -r "$recipient" -o "$dest/aitools-$stamp-$name.age" "$f"; else cp "$f" "$dest/aitools-$stamp-$name"; fi
done

# 4. Rotation, puis récapitulatif (empreintes à comparer après transfert)
find "$dest" -maxdepth 1 -name 'aitools-*' -type f -mtime +"$keep" -delete
ls -1 "$dest"/aitools-"$stamp"-* | while read -r f; do printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"; done
echo "Sauvegarde OK ($stamp)"
