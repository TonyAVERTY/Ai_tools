#!/bin/sh
# Test de restauration : restaure une sauvegarde de la base dans une base TEMPORAIRE, vérifie son contenu, puis la supprime.
# Ne touche jamais à la base de production (refuse si le nom visé est celui de DB_NAME). À lancer au moins chaque trimestre.
#
# Usage : DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… DB_NAME=<base de prod, pour le refus> [AGE_IDENTITY=/chemin/cle-privee.txt] \
#           aitools-restore-check.sh <aitools-…-db.sql.gz[.age]>
# DB_USER doit pouvoir CREATE / DROP des bases ; sur un serveur de prod, prends plutôt un compte dédié ou un serveur de test.
set -eu
umask 077

file=${1:?fichier de sauvegarde manquant}
: "${DB_HOST:?DB_HOST manquant}" "${DB_USER:?DB_USER manquant}" "${DB_NAME:?DB_NAME manquant}"
port=${DB_PORT:-3306}
client=$(command -v mariadb || command -v mysql) || { echo "mariadb / mysql introuvable" >&2; exit 2; }
scratch="aitools_restore_check_$(date +%s)_$$"
[ "$scratch" != "$DB_NAME" ] || { echo "Refus : la base temporaire a le nom de la base de production" >&2; exit 2; }

cnf=$(mktemp); tmp=$(mktemp -d)
cleanup() { "$client" --defaults-extra-file="$cnf" -e "DROP DATABASE IF EXISTS \`$scratch\`" >/dev/null 2>&1 || true; rm -rf "$cnf" "$tmp"; }
trap cleanup EXIT INT TERM
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "${DB_PASSWORD:-}" "$DB_HOST" "$port" > "$cnf"

case "$file" in
  *.age) [ -n "${AGE_IDENTITY:-}" ] || { echo "AGE_IDENTITY (clé privée age) manquante pour déchiffrer" >&2; exit 2; }
         age -d -i "$AGE_IDENTITY" -o "$tmp/db.sql.gz" "$file" ;;
  *) cp "$file" "$tmp/db.sql.gz" ;;
esac
gzip -t "$tmp/db.sql.gz"

"$client" --defaults-extra-file="$cnf" -e "CREATE DATABASE \`$scratch\` CHARACTER SET utf8mb4"
gzip -dc "$tmp/db.sql.gz" | "$client" --defaults-extra-file="$cnf" --default-character-set=utf8mb4 "$scratch"

tables=$("$client" --defaults-extra-file="$cnf" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$scratch' AND table_type='BASE TABLE'")
migrations=$("$client" --defaults-extra-file="$cnf" -N -e "SELECT COUNT(*) FROM \`$scratch\`.schema_migrations")
users=$("$client" --defaults-extra-file="$cnf" -N -e "SELECT COUNT(*) FROM \`$scratch\`.users")
echo "Restauration OK dans $scratch : $tables tables, $migrations migrations appliquées, $users comptes"
[ "$tables" -ge 30 ] && [ "$migrations" -ge 30 ] || { echo "Contenu inattendu : base incomplète" >&2; exit 1; }
echo "RESTAURATION VÉRIFIÉE (la base temporaire est supprimée)"
