#!/usr/bin/env bash
# Tests des fonctions d'install.sh qui écrivent des fichiers (lancé en root dans un bac à sable).
# shellcheck disable=SC2034  # variables lues par les fonctions sourcées
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck source=../install.sh
source ./install.sh
set +e; trap - ERR
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

APP_DIR_REAL=$APP_DIR
[[ $APP_DIR_REAL == /opt/aitools && ! -e /opt/aitools/.env ]] || { echo "Bac à sable requis (/opt/aitools vide)"; exit 1; }
id aitools &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin aitools
mkdir -p /opt/aitools

# 1. .env neuf
DOMAIN=ai.test.dev ALLOWED=a@b.fr GOOGLE_ID=cid GOOGLE_SECRET='s3c=ret' THERMAL=72 DATA_DIR=/srv/t/data KEEP_ENV=0
write_env
check ".env créé en 600 pour aitools" '[[ $(stat -c "%a %U" /opt/aitools/.env) == "600 aitools" ]]'
check "APP_URL" 'grep -qx "APP_URL=https://ai.test.dev" /opt/aitools/.env'
check "secret avec = conservé" 'grep -qx "GOOGLE_CLIENT_SECRET=s3c=ret" /opt/aitools/.env'
check "SECRET_KEY 64 hex" 'grep -qE "^SECRET_KEY=[0-9a-f]{64}$" /opt/aitools/.env'
check "config complète" 'config_complete'
check ".env lisible par node --env-file" 'node --env-file=/opt/aitools/.env -e "process.exit(process.env.THERMAL_MAX===\"72\"&&process.env.GOOGLE_CLIENT_SECRET===\"s3c=ret\"?0:1)"'

# 2. set_env : remplacement, ajout, caractères spéciaux
set_env CLAUDE_CODE_OAUTH_TOKEN 'sk-ant-oat01-a/b&c|d\e'
set_env THERMAL_MAX 70
check "token avec & | / \\ intact" 'grep -qxF "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-a/b&c|d\e" /opt/aitools/.env'
check "remplacement sans doublon" '[[ $(grep -c "^THERMAL_MAX=" /opt/aitools/.env) == 1 ]] && grep -qx "THERMAL_MAX=70" /opt/aitools/.env'
check "droits conservés après set_env" '[[ $(stat -c "%a %U" /opt/aitools/.env) == "600 aitools" ]]'

# 3. config conservée + nouveau disque → migration détectée
set_env DATA_DIR ./data
check "old_data_dir relatif → absolu" '[[ $(old_data_dir) == /opt/aitools/data ]]'
KEEP_ENV=1 DATA_DIR=/srv/t/data
write_env
check "KEEP_ENV : DATA_DIR mis à jour, secret gardé" 'grep -qx "DATA_DIR=/srv/t/data" /opt/aitools/.env && grep -qx "GOOGLE_CLIENT_SECRET=s3c=ret" /opt/aitools/.env'
mkdir -p /opt/aitools/data/repos/1 /srv/t/data && echo db > /opt/aitools/data/aitools.sqlite && chown -R aitools: /opt/aitools/data
migrate_data /opt/aitools/data
check "migration des données" '[[ -f /srv/t/data/aitools.sqlite && -d /srv/t/data/repos/1 && $(stat -c %U /srv/t/data/aitools.sqlite) == aitools ]]'

# 4. Rendu de l'unit systemd
systemctl() { :; }
BACKUPS=1 BACKUP_DIR=/srv/t/backups
install_units
u=/etc/systemd/system/aitools.service
check "unit sans placeholder" '! grep -q "@" $u'
check "RequiresMountsFor = disque de données" 'grep -qx "RequiresMountsFor=/srv/t/data" $u'
check "ReadWritePaths" 'grep -qx "ReadWritePaths=/srv/t/data /home/aitools" $u'
check "timer de sauvegarde" 'grep -q "aitools-backup /srv/t/data/aitools.sqlite /srv/t/backups 14" /etc/systemd/system/aitools-backup.service'

# 5. Sauvegarde SQLite réelle
if command -v sqlite3 >/dev/null; then
  rm -f /srv/t/data/aitools.sqlite
  sqlite3 /srv/t/data/aitools.sqlite "PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES (42);" >/dev/null
  touch -d '20 days ago' /srv/t/backups/aitools-2000-01-01.sqlite 2>/dev/null || { mkdir -p /srv/t/backups; touch -d '20 days ago' /srv/t/backups/aitools-2000-01-01.sqlite; }
  /usr/local/sbin/aitools-backup /srv/t/data/aitools.sqlite /srv/t/backups 14 >/dev/null
  check "sauvegarde du jour lisible" '[[ $(sqlite3 /srv/t/backups/aitools-$(date +%F).sqlite "select x from t") == 42 ]]'
  check "rotation > 14 jours" '[[ ! -e /srv/t/backups/aitools-2000-01-01.sqlite ]]'
fi

# 6. Padding UTF-8
check "pad compte les caractères accentués" '[[ $(pad "Données" 10) == "Données   " ]]'

exit $fail
