#!/bin/sh
# Sauvegarde à chaud de la base SQLite (cohérente même pendant l'écriture) + rotation.
# Usage : aitools-backup <fichier.sqlite> <dossier de sauvegarde> [jours à garder]
set -eu
src=$1
dest=$2
keep=${3:-14}

[ -f "$src" ] || { echo "Pas de base à sauvegarder ($src)"; exit 0; }
mkdir -p "$dest"
out="$dest/aitools-$(date +%F).sqlite"
sqlite3 "$src" ".backup '$out'"
sqlite3 "$out" 'PRAGMA integrity_check;' | grep -qx ok || { echo "Sauvegarde corrompue : $out" >&2; exit 1; }
find "$dest" -name 'aitools-*.sqlite' -mtime +"$keep" -delete
echo "Sauvegarde OK : $out"
