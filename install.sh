#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  iaboss — installation sur Raspberry Pi OS Lite 64 bits
#
#  Usage :  sudo ./install.sh            installation / mise à jour
#           ./install.sh --dry-run       montre ce qui serait fait, sans rien toucher
#
#  Phase 1 : questions (disque, réseau, nettoyage, config, tunnel, Claude)
#  Phase 2 : récapitulatif, puis installation sans interruption
#  Relançable sans risque : chaque étape vérifie l'existant.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

readonly APP_USER=aitools
readonly APP_DIR=/opt/aitools
readonly PORT=3100
readonly NODE_MIN=22.13
readonly LOG=/var/log/aitools-install.log
SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SRC_DIR
# ${#var} doit compter des caractères (accents) et pas des octets
export LC_CTYPE=C.UTF-8

DRY_RUN=0

# Réponses (remplies en phase 1)
DATA_MODE=system      # system | existing | format
DISK="" PART="" FSTYPE="" MOUNT_POINT="" DATA_DIR="$APP_DIR/data" BACKUP_DIR=""
BACKUPS=0
IFACE="" DISABLE_WIFI=0 DISABLE_BT=0
DO_CLEAN=0 DO_UPGRADE=0
KEEP_ENV=0 DOMAIN="" ALLOWED="" GOOGLE_ID="" GOOGLE_SECRET="" THERMAL=75
TUNNEL_MODE=later TUNNEL_TOKEN=""
CLAUDE_MODE=later
OTHER_AIS=0
NEED_REBOOT=0
CLEAN_SERVICES=() CLEAN_PACKAGES=() CLEAN_SWAP=0

# ─── Affichage ───────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  B=$'\e[1m' D=$'\e[2m' R=$'\e[0m' RED=$'\e[31m' GRN=$'\e[32m' YLW=$'\e[33m' BLU=$'\e[34m' CYN=$'\e[36m'
else
  B="" D="" R="" RED="" GRN="" YLW="" BLU="" CYN=""
fi

banner() {
  printf '\n%s' "$BLU$B"
  printf '  ╭──────────────────────────────────────────────╮\n'
  printf '  │   iaboss · installation Raspberry Pi        │\n'
  printf '  ╰──────────────────────────────────────────────╯%s\n' "$R"
  (( DRY_RUN )) && printf '  %s[dry-run] rien ne sera modifié%s\n' "$YLW" "$R"
  return 0
}
section() { printf '\n%s━━ %s %s%s\n' "$BLU$B" "$1" "$(printf '━%.0s' $(seq 1 $((44 - ${#1}))))" "$R"; }
info()    { printf '  %s%s%s\n' "$D" "$*" "$R"; }
ok()      { printf '  %s✓%s %s\n' "$GRN" "$R" "$*"; }
warn()    { printf '  %s!%s %s\n' "$YLW" "$R" "$*"; }
pad()     { local s=$1 w=$2 n; n=$((w - ${#s})); (( n < 0 )) && n=0; printf '%s%*s' "$s" "$n" ""; }
row()     { printf '    %s %s\n' "$(pad "$1" 14)" "$2"; }
die()     { printf '\n  %s✗ %s%s\n' "$RED$B" "$*" "$R" >&2; exit 1; }

on_error() {
  local line=$1
  printf '\n  %s✗ Erreur inattendue (ligne %s).%s\n' "$RED$B" "$line" "$R" >&2
  [[ -f $LOG ]] && printf '  Détails : %s\n' "$LOG" >&2
  exit 1
}
trap 'on_error $LINENO' ERR
trap 'printf "\n\n  %sInstallation interrompue.%s\n" "$YLW" "$R"; exit 130' INT

# ─── Saisie ──────────────────────────────────────────────────────────────────
ask() { # ask VAR "Question" [défaut]
  local __v=$1 __q=$2 __d=${3:-} __a
  read -r -p "  $__q${__d:+ ${D}[$__d]${R}} : " __a || die "Saisie interrompue"
  printf -v "$__v" '%s' "${__a:-$__d}"
}

ask_secret() { # ask_secret VAR "Question"   (saisie masquée)
  local __v=$1 __q=$2 __a
  read -r -s -p "  $__q : " __a || die "Saisie interrompue"
  printf '\n'
  printf -v "$__v" '%s' "$__a"
}

confirm() { # confirm "Question" [o|n]   → code retour 0 = oui
  local q=$1 def=${2:-o} a hint
  [[ $def == o ]] && hint="O/n" || hint="o/N"
  while :; do
    read -r -p "  $q ${D}[$hint]${R} " a || die "Saisie interrompue"
    a=${a,,}; a=${a:-$def}
    case $a in o|oui|y|yes) return 0 ;; n|non|no) return 1 ;; esac
    warn "Réponds o ou n."
  done
}

menu() { # menu VAR "Question" option1 option2 …   → VAR = numéro choisi (1…n)
  local __v=$1 __q=$2 __n __i=1 __c __o
  shift 2; __n=$#
  printf '\n  %s%s%s\n' "$B" "$__q" "$R"
  for __o in "$@"; do printf '    %s%2d)%s %s\n' "$CYN" "$__i" "$R" "$__o"; __i=$((__i + 1)); done
  while :; do
    read -r -p "  Choix [1-$__n] : " __c || die "Saisie interrompue"
    if [[ $__c =~ ^[0-9]+$ ]] && (( __c >= 1 && __c <= __n )); then break; fi
    warn "Tape un nombre entre 1 et $__n."
  done
  printf -v "$__v" '%s' "$__c"
}

# ─── Exécution ───────────────────────────────────────────────────────────────
# run "Libellé" commande args…  → spinner, sortie dans le log, arrêt propre si échec
run() {
  local label=$1; shift
  if (( DRY_RUN )); then printf '  %s·%s %s %s→ %s%s\n' "$CYN" "$R" "$label" "$D" "$*" "$R"; return 0; fi
  printf '\n>>> %s\n$ %s\n' "$label" "$*" >>"$LOG"
  "$@" >>"$LOG" 2>&1 &
  local pid=$! i=0 rc=0 frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  if [[ -t 1 ]]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  %s%s%s %s' "$CYN" "${frames[i % 10]}" "$R" "$label"
      i=$((i + 1)); sleep 0.1
    done
    printf '\r\e[K'
  fi
  wait "$pid" || rc=$?
  if (( rc == 0 )); then ok "$label"; return 0; fi
  printf '  %s✗%s %s\n\n' "$RED" "$R" "$label"
  tail -n 15 "$LOG" | sed 's/^/    /'
  die "Échec : $label (log complet : $LOG)"
}

is_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "ok installed"; }
has_unit()     { systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q .; }
kv()           { [[ $1 =~ (^|[[:space:]])$2=\"([^\"]*)\" ]] && printf '%s' "${BASH_REMATCH[2]}"; return 0; }

# ─── Détection ───────────────────────────────────────────────────────────────
system_disks() { # disques qui portent / ou /boot : jamais proposés
  local m src pk
  for m in / /boot/firmware /boot; do
    src=$(findmnt -no SOURCE "$m" 2>/dev/null) || continue
    [[ $src == /dev/* ]] || continue
    pk=$(lsblk -no PKNAME "$src" 2>/dev/null | head -n1)
    printf '/dev/%s\n' "${pk:-${src#/dev/}}"
  done | sort -u
}

DISKS=() DISK_LABELS=()
scan_disks() {
  DISKS=() DISK_LABELS=()
  local sys line name type size tran rota model kind
  sys=$(system_disks)
  while IFS= read -r line; do
    name=$(kv "$line" NAME); type=$(kv "$line" TYPE)
    [[ $type == disk && -n $name ]] || continue
    [[ $name == /dev/zram* || $name == /dev/loop* || $name == /dev/ram* ]] && continue
    grep -qxF "$name" <<<"$sys" && continue
    size=$(kv "$line" SIZE); tran=$(kv "$line" TRAN); rota=$(kv "$line" ROTA); model=$(kv "$line" MODEL)
    kind="SSD/clé"; [[ $rota == 1 ]] && kind="HDD"; [[ $name == /dev/mmcblk* ]] && kind="carte SD"
    tran=${tran^^}
    DISKS+=("$name")
    DISK_LABELS+=("$(printf '%-13s %7s  %s %-5s %s' "$name" "$size" "$(pad "$kind" 8)" "${tran:--}" "${model:-modèle inconnu}")")
  done < <(lsblk -dnpP -o NAME,TYPE,SIZE,TRAN,ROTA,MODEL 2>/dev/null)
}

PARTS=() PART_FS=() PART_LABELS=()
scan_parts() {
  PARTS=() PART_FS=() PART_LABELS=()
  local line name type size fs label mnt
  while IFS= read -r line; do
    name=$(kv "$line" NAME); type=$(kv "$line" TYPE); size=$(kv "$line" SIZE); fs=$(kv "$line" FSTYPE)
    # Partition, ou disque formaté directement sans table de partitions
    [[ $type == part || ( $type == disk && -n $fs ) ]] || continue
    label=$(kv "$line" LABEL); mnt=$(kv "$line" MOUNTPOINT)
    PARTS+=("$name"); PART_FS+=("$fs")
    PART_LABELS+=("$(printf '%-13s %7s  %-6s %s%s' "$name" "$size" "${fs:-vide}" "${label:+« $label » }" "${mnt:+(monté sur $mnt)}")")
  done < <(lsblk -npP -o NAME,TYPE,SIZE,FSTYPE,LABEL,MOUNTPOINT "$1" 2>/dev/null)
}

IFACES=() IFACE_KINDS=() IFACE_LABELS=()
scan_ifaces() {
  IFACES=() IFACE_KINDS=() IFACE_LABELS=()
  local name kind state ip
  for path in /sys/class/net/*; do
    name=${path##*/}
    case $name in lo|docker*|veth*|br-*|virbr*|tun*|wg*|ifb*|dummy*) continue ;; esac
    case $name in wl*) kind="Wi-Fi" ;; eth*|en*) kind="Ethernet" ;; *) kind="autre" ;; esac
    state=$(cat "$path/operstate" 2>/dev/null || echo "?")
    ip=$(ip -4 -o addr show dev "$name" 2>/dev/null | awk '{print $4; exit}' || true)
    IFACES+=("$name"); IFACE_KINDS+=("$kind")
    [[ -n $ip ]] || ip="sans IP"
    IFACE_LABELS+=("$(printf '%-10s %-9s %-5s %s' "$name" "$kind" "${state^^}" "$ip")")
  done
}

ram_mb()      { awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo; }
config_txt()  { [[ -f /boot/firmware/config.txt ]] && echo /boot/firmware/config.txt || echo /boot/config.txt; }
version_ge()  { [[ $(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1) == "$2" ]]; }

# ─── Phase 0 : vérifications ─────────────────────────────────────────────────
preflight() {
  section "Vérifications"
  [[ -f $SRC_DIR/package.json && -f $SRC_DIR/src/server.js ]] || die "Lance ce script depuis le dossier du projet cloné."

  if (( ! DRY_RUN )); then
    [[ $EUID -eq 0 ]] || die "Lance-le avec sudo : sudo ./install.sh"
    mkdir -p "$(dirname "$LOG")"; : >"$LOG"; chmod 600 "$LOG"
  fi

  local arch model os
  arch=$(uname -m)
  model=$(tr -d '\0' 2>/dev/null </proc/device-tree/model || echo "machine inconnue")
  os=$(. /etc/os-release && echo "${PRETTY_NAME:-?}")
  info "$model · $os · $arch · $(ram_mb) Mo de RAM"

  if [[ $arch != aarch64 ]]; then
    (( DRY_RUN )) && warn "Architecture $arch (attendu : aarch64), ignoré en dry-run" \
                  || die "Il faut un OS 64 bits (aarch64). Réinstalle Raspberry Pi OS Lite 64-bit."
  fi
  (( $(ram_mb) < 1800 )) && warn "Moins de 2 Go de RAM : ça marchera, mais un seul job à la fois et MemoryMax réduit."

  if (( ! DRY_RUN )); then
    curl -fsS -m 10 -o /dev/null https://deb.nodesource.com || die "Pas d'accès Internet (deb.nodesource.com injoignable)."
  fi
  ok "Prêt"
}

# ─── Phase 1 : questions ─────────────────────────────────────────────────────
ask_storage() {
  section "Stockage des données"
  info "Base SQLite + clones Git des projets. Un disque externe épargne la carte SD."
  local sys; sys=$(system_disks | tr '\n' ' ')
  [[ -n ${sys// } ]] && info "Disque système (exclu) : $sys"

  local c
  scan_disks
  while (( ${#DISKS[@]} == 0 )); do
    warn "Aucun disque externe détecté."
    menu c "Que faire ?" "J'ai branché le disque, relancer la détection" "Garder les données sur le disque système"
    [[ $c == 2 ]] && { DATA_MODE=system; return; }
    sleep 2; scan_disks
  done

  menu c "Quel disque utiliser pour les données ?" "${DISK_LABELS[@]}" "Aucun — garder les données sur le disque système"
  if (( c > ${#DISKS[@]} )); then DATA_MODE=system; return; fi
  DISK=${DISKS[c - 1]}

  while :; do
    scan_parts "$DISK"
    local opts=() i
    for i in "${!PARTS[@]}"; do opts+=("Utiliser la partition ${PART_LABELS[i]}"); done
    opts+=("Formater tout le disque en ext4 ${RED}(efface tout)${R}")
    menu c "Comment utiliser $DISK ?" "${opts[@]}"

    if (( c <= ${#PARTS[@]} )); then
      PART=${PARTS[c - 1]}; FSTYPE=${PART_FS[c - 1]}
      case $FSTYPE in
        ext4|xfs|btrfs) DATA_MODE=existing; break ;;
        "") warn "$PART n'a pas de système de fichiers : il faut formater." ;;
        *)  warn "$FSTYPE ne gère pas les droits Linux et abîme SQLite. Choisis une partition ext4 ou formate." ;;
      esac
    else
      DATA_MODE=format
      printf '\n'; lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$DISK" | sed 's/^/    /'
      printf '\n  %s⚠  Tout le contenu de %s sera définitivement effacé.%s\n' "$RED$B" "$DISK" "$R"
      local used
      used=$(lsblk -lnpo MOUNTPOINT "$DISK" | grep -vE '^$|^/media/|^/mnt/' || true)
      [[ -n $used ]] && warn "Ce disque est actuellement utilisé sur : $(tr '\n' ' ' <<<"$used")"
      local typed
      ask typed "Pour confirmer, tape le nom du disque (${DISK##*/})"
      [[ $typed == "${DISK##*/}" ]] && break
      warn "Confirmation incorrecte, rien ne sera formaté."
    fi
  done

  while :; do
    ask MOUNT_POINT "Point de montage" "/srv/aitools"
    [[ $MOUNT_POINT == /?* && $MOUNT_POINT != *" "* ]] || { warn "Chemin absolu sans espace attendu."; continue; }
    case $MOUNT_POINT in /|/boot*|/etc*|/usr*|/var|/bin*|/sbin*|/lib*|/proc*|/sys*|/dev*|/home) warn "Dossier système refusé." ;; *) break ;; esac
  done
  MOUNT_POINT=${MOUNT_POINT%/}
  DATA_DIR=$MOUNT_POINT/data
}

ask_backups() {
  local where=$APP_DIR/backups
  [[ $DATA_MODE != system ]] && where=$MOUNT_POINT/backups
  printf '\n'
  if confirm "Sauvegarde quotidienne de la base (04:30, 14 jours gardés, dans $where) ?" o; then
    BACKUPS=1; BACKUP_DIR=$where
  fi
}

ask_network() {
  section "Réseau"
  scan_ifaces
  (( ${#IFACES[@]} )) || { warn "Aucune interface réseau détectée."; return; }
  local c=1
  if (( ${#IFACES[@]} == 1 )); then
    info "Interface détectée : ${IFACE_LABELS[0]}"
  else
    menu c "Quelle interface le Raspberry utilise-t-il pour Internet ?" "${IFACE_LABELS[@]}"
  fi
  IFACE=${IFACES[c - 1]}

  printf '\n'
  if [[ ${IFACE_KINDS[c - 1]} == Ethernet ]] && compgen -G "/sys/class/net/wl*" >/dev/null; then
    confirm "Tu es en Ethernet : désactiver le Wi-Fi (moins de chaleur) ?" o && DISABLE_WIFI=1
  fi
  confirm "Désactiver le Bluetooth (inutile pour un serveur) ?" o && DISABLE_BT=1
  return 0
}

ask_cleanup() {
  section "Nettoyage du système"
  local s p
  for s in triggerhappy ModemManager cups cups-browsed; do has_unit "$s.service" && CLEAN_SERVICES+=("$s"); done
  if (( DISABLE_BT )); then for s in bluetooth hciuart; do has_unit "$s.service" && CLEAN_SERVICES+=("$s"); done; fi
  for p in triggerhappy modemmanager cups cups-daemon man-db; do is_installed "$p" && CLEAN_PACKAGES+=("$p"); done
  is_installed dphys-swapfile && CLEAN_SWAP=1

  info "Ce qui sera fait :"
  (( ${#CLEAN_SERVICES[@]} )) && printf '    • services désactivés : %s\n' "${CLEAN_SERVICES[*]}"
  (( ${#CLEAN_PACKAGES[@]} )) && printf '    • paquets supprimés   : %s\n' "${CLEAN_PACKAGES[*]}"
  (( CLEAN_SWAP )) && printf '    • swap sur carte SD remplacé par zram (swap compressé en RAM)\n'
  printf "    • journaux système en RAM (50 Mo max) : beaucoup moins d'écritures disque\n"
  printf '    • apt autoremove + nettoyage du cache\n'
  printf '\n'
  confirm "Appliquer ce nettoyage ?" o && DO_CLEAN=1
  confirm "Mettre le système à jour (apt full-upgrade + firmware, ~5-15 min) ?" o && DO_UPGRADE=1
  return 0
}

ask_app() {
  section "Configuration de l'application"
  if [[ -f $APP_DIR/.env ]]; then
    if confirm "Une configuration existe déjà ($APP_DIR/.env). La garder ?" o; then KEEP_ENV=1; return; fi
  fi

  while :; do
    ask DOMAIN "Domaine public" "iaboss.fr"
    [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] && break
    warn "Domaine invalide (ex. ai.mondomaine.fr)."
  done

  local def; def=$(sed -n 's/^ADMIN_EMAILS=//p' "$SRC_DIR/.env.example" 2>/dev/null | head -n1)
  while :; do
    ask ALLOWED "Emails administrateurs (séparés par des virgules)" "$def"
    [[ $ALLOWED =~ ^[^,[:space:]]+@[^,[:space:]]+(,[^,[:space:]]+@[^,[:space:]]+)*$ ]] && break
    warn "Format attendu : moi@gmail.com,autre@gmail.com"
  done

  printf '\n'
  info "Google Cloud Console › Identifiants › ID client OAuth (« Application Web »)"
  info "URI de redirection : https://$DOMAIN/auth/google/callback"
  ask GOOGLE_ID "Client ID Google (vide = plus tard)"
  [[ -n $GOOGLE_ID ]] && ask_secret GOOGLE_SECRET "Client secret Google"

  while :; do
    ask THERMAL "Température CPU max avant pause des jobs (°C)" "75"
    [[ $THERMAL =~ ^[0-9]+$ ]] && (( THERMAL >= 60 && THERMAL <= 85 )) && break
    warn "Entre 60 et 85."
  done
}

ask_tunnel() {
  section "Accès public (Cloudflare Tunnel)"
  local c
  if has_unit cloudflared.service; then
    menu c "Un tunnel Cloudflare est déjà installé." "Le garder tel quel" "Le remplacer par un nouveau token"
    [[ $c == 1 ]] && { TUNNEL_MODE=keep; return; }
  else
    menu c "Configurer le tunnel maintenant ?" "Oui, j'ai un token de tunnel (recommandé)" "Plus tard"
    [[ $c == 2 ]] && { TUNNEL_MODE=later; return; }
  fi
  info "Cloudflare Zero Trust › Networks › Tunnels › Create a tunnel (Cloudflared)"
  info "Public hostname : ${DOMAIN:-iaboss.fr} → http://localhost:$PORT"
  info "Copie le token (la longue chaîne après « --token » dans la commande proposée)."
  while :; do
    ask_secret TUNNEL_TOKEN "Token du tunnel"
    [[ $TUNNEL_TOKEN =~ ^[A-Za-z0-9+/=_-]{50,}$ ]] && break
    warn "Ça ne ressemble pas à un token (chaîne base64 de 50+ caractères)."
  done
  TUNNEL_MODE=token
}

ask_claude() {
  section "Connexion à Claude"
  info "Claude Code tourne en headless avec ton abonnement Pro (pas de clé API)."
  local c
  menu c "Comment connecter Claude ?" \
    "Token longue durée via « claude setup-token » (recommandé pour un serveur)" \
    "Connexion interactive (/login)" \
    "Plus tard"
  case $c in 1) CLAUDE_MODE=token ;; 2) CLAUDE_MODE=login ;; *) CLAUDE_MODE=later ;; esac
}

ask_other_ais() {
  section "Autres IA (facultatif)"
  info "Chaque personne choisit son IA dans l'application : Claude, ChatGPT ou Gemini."
  info "Claude est installé d'office. Pour ChatGPT (Codex) et Gemini, il faut aussi leurs outils sur ce serveur."
  info "Sans eux, ces deux IA restent grisées sur la page « Relier mon IA » (tu pourras les installer plus tard)."
  confirm "Installer aussi Codex (ChatGPT) et Gemini CLI ?" o && OTHER_AIS=1
  return 0
}

recap() {
  section "Récapitulatif"
  local line
  case $DATA_MODE in
    system)   line="disque système ($DATA_DIR)" ;;
    existing) line="$PART ($FSTYPE) monté sur $MOUNT_POINT" ;;
    format)   line="${RED}${B}FORMATAGE de $DISK${R} en ext4, monté sur $MOUNT_POINT" ;;
  esac
  local google="Google à faire plus tard"
  [[ -n $GOOGLE_ID ]] && google="Google OK"
  row "Données" "$line"
  row "Sauvegardes" "$( (( BACKUPS )) && echo "$BACKUP_DIR" || echo "non")"
  row "Réseau" "${IFACE:-?}$( (( DISABLE_WIFI )) && echo ", Wi-Fi coupé")$( (( DISABLE_BT )) && echo ", Bluetooth coupé")"
  row "Nettoyage" "$( (( DO_CLEAN )) && echo oui || echo non)"
  row "Mise à jour" "$( (( DO_UPGRADE )) && echo oui || echo non)"
  row "Config" "$( (( KEEP_ENV )) && echo "conservée" || echo "https://$DOMAIN · $google")"
  row "Tunnel" "$TUNNEL_MODE"
  row "Claude" "$CLAUDE_MODE"
  row "Autres IA" "$( (( OTHER_AIS )) && echo "Codex (ChatGPT) et Gemini CLI" || echo "non (Claude seul)")"
  row "Application" "$APP_DIR (utilisateur $APP_USER, port $PORT)"
  printf '\n'
  confirm "Lancer l'installation ?" o || die "Annulé, rien n'a été modifié."
}

# ─── Phase 2 : installation ──────────────────────────────────────────────────
do_upgrade() {
  section "Système"
  export DEBIAN_FRONTEND=noninteractive
  run "Mise à jour de la liste des paquets" apt-get update -q
  if (( DO_UPGRADE )); then
    run "Mise à jour du système" apt-get -y -q -o Dpkg::Options::=--force-confold full-upgrade
    command -v rpi-eeprom-update >/dev/null && run "Mise à jour du firmware (EEPROM)" rpi-eeprom-update -a
  fi
  run "Outils de base (git, curl, sqlite3, fdisk)" apt-get install -y -q --no-install-recommends git curl ca-certificates sqlite3 fdisk openssl
}

apply_cleanup() {
  local s
  for s in "${CLEAN_SERVICES[@]}"; do systemctl disable --now "$s.service" || true; done
  if (( ${#CLEAN_PACKAGES[@]} )); then apt-get purge -y -q "${CLEAN_PACKAGES[@]}"; fi
  if (( CLEAN_SWAP )); then
    dphys-swapfile swapoff || true
    dphys-swapfile uninstall || true
    systemctl disable --now dphys-swapfile || true
    apt-get purge -y -q dphys-swapfile
  fi
  if (( CLEAN_SWAP )) || ! swapon --show=NAME --noheadings | grep -q zram; then
    apt-get install -y -q --no-install-recommends zram-tools
    printf 'ALGO=zstd\nPERCENT=50\nPRIORITY=100\n' >/etc/default/zramswap
    systemctl restart zramswap
  fi
  mkdir -p /etc/systemd/journald.conf.d
  printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=50M\n' >/etc/systemd/journald.conf.d/aitools.conf
  systemctl restart systemd-journald
  apt-get autoremove -y -q --purge
  apt-get clean
}

apply_boot_config() {
  local f; f=$(config_txt)
  [[ -f $f ]] || return 0
  [[ -f $f.aitools.bak ]] || cp "$f" "$f.aitools.bak"
  local line
  for line in "$@"; do grep -qxF "$line" "$f" || printf '\n[all]\n%s\n' "$line" >>"$f"; done
}

do_cleanup() {
  section "Nettoyage"
  (( DO_CLEAN )) && run "Services, paquets, swap et journaux" apply_cleanup
  local lines=() f; f=$(config_txt)
  (( DISABLE_WIFI )) && lines+=("dtoverlay=disable-wifi")
  (( DISABLE_BT ))   && lines+=("dtoverlay=disable-bt")
  if (( ${#lines[@]} )); then
    for l in "${lines[@]}"; do grep -qxF "$l" "$f" 2>/dev/null || NEED_REBOOT=1; done
    run "Wi-Fi / Bluetooth coupés au démarrage (${lines[*]})" apply_boot_config "${lines[@]}"
  fi
  (( DO_CLEAN || ${#lines[@]} )) || info "Rien à faire."
  return 0
}

prepare_disk() {
  local part=$PART fstype=$FSTYPE uuid opts p
  # Formatage : on démonte tout le disque. Partition existante : seulement elle.
  local target=$PART
  [[ $DATA_MODE == format ]] && target=$DISK
  while read -r p; do umount "$p" || true; done < <(lsblk -lnpo NAME,MOUNTPOINT "$target" | awk 'NF==2 {print $1}')

  if [[ $DATA_MODE == format ]]; then
    wipefs -a "$DISK"
    printf 'label: gpt\n,,L\n' | sfdisk --wipe always "$DISK"
    partprobe "$DISK" 2>/dev/null || true
    udevadm settle
    part=$(lsblk -lnpo NAME,TYPE "$DISK" | awk '$2=="part" {print $1; exit}')
    [[ -n $part ]] || { echo "Partition introuvable après partitionnement"; return 1; }
    mkfs.ext4 -F -q -L aitools -m 1 "$part"
    fstype=ext4
  fi

  uuid=$(blkid -s UUID -o value "$part")
  [[ -n $uuid ]] || { echo "UUID introuvable pour $part"; return 1; }
  opts="defaults,noatime,nofail,x-systemd.device-timeout=30s"
  [[ $fstype == ext4 ]] && opts+=",commit=60"

  [[ -f /etc/fstab.aitools.bak ]] || cp /etc/fstab /etc/fstab.aitools.bak
  awk -v mp="$MOUNT_POINT" -v id="UUID=$uuid" '$2 != mp && $1 != id' /etc/fstab >/etc/fstab.tmp
  printf 'UUID=%s  %s  %s  %s  0  2\n' "$uuid" "$MOUNT_POINT" "$fstype" "$opts" >>/etc/fstab.tmp
  mv /etc/fstab.tmp /etc/fstab
  systemctl daemon-reload
  mkdir -p "$MOUNT_POINT"
  mountpoint -q "$MOUNT_POINT" || mount "$MOUNT_POINT"
  findmnt "$MOUNT_POINT"
}

do_storage() {
  section "Stockage"
  if [[ $DATA_MODE == system ]]; then info "Données sur le disque système : $DATA_DIR"; return 0; fi
  local label="Montage de $PART sur $MOUNT_POINT"
  [[ $DATA_MODE == format ]] && label="Formatage de $DISK et montage sur $MOUNT_POINT"
  run "$label" prepare_disk
  (( DRY_RUN )) || ok "Espace libre : $(df -h --output=avail "$MOUNT_POINT" | tail -n1 | tr -d ' ')"
  return 0
}

install_node() {
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  rm -f /tmp/nodesource_setup.sh
  apt-get install -y -q nodejs
}

install_cloudflared() {
  curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
}

do_runtime() {
  section "Node.js, Claude Code, cloudflared"
  local v=""
  command -v node >/dev/null && v=$(node -v | tr -d v)
  if [[ -n $v ]] && version_ge "$v" "$NODE_MIN"; then ok "Node.js $v déjà présent"
  else run "Installation de Node.js 22 LTS" install_node; fi

  if command -v claude >/dev/null; then
    run "Mise à jour de Claude Code" npm install -g --no-audit --no-fund @anthropic-ai/claude-code@latest
  else
    run "Installation de Claude Code" npm install -g --no-audit --no-fund @anthropic-ai/claude-code
  fi

  # ChatGPT et Gemini : facultatif, un échec n'arrête pas l'installation (ces IA restent grisées dans l'application)
  if (( OTHER_AIS )); then
    ( run "Installation de Codex (ChatGPT)" npm install -g --no-audit --no-fund @openai/codex ) || warn "Codex non installé : ChatGPT restera indisponible (npm install -g @openai/codex, puis redémarre)."
    ( run "Installation de Gemini CLI" npm install -g --no-audit --no-fund @google/gemini-cli ) || warn "Gemini CLI non installé : Gemini restera indisponible (npm install -g @google/gemini-cli, puis redémarre)."
  fi

  if [[ $TUNNEL_MODE != keep ]]; then
    if command -v cloudflared >/dev/null; then ok "cloudflared déjà présent"
    else run "Installation de cloudflared" install_cloudflared; fi
  fi
  return 0
}

deploy_app() {
  # root lit un repo appartenant à un autre utilisateur : on lève la protection "dubious ownership"
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'
  id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  local branch origin
  if [[ -d $SRC_DIR/.git ]]; then
    branch=$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD)
    [[ $branch == HEAD ]] && { echo "Le dossier source est en HEAD détachée : fais git checkout develop"; return 1; }
    origin=$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || true)
    # Passage par un bundle : un clone local direct relance git dans un sous-process qui
    # ignore safe.directory, et échoue quand le dossier source appartient à un autre utilisateur.
    local bundle; bundle=$(mktemp /tmp/aitools-XXXXXX.bundle)
    git -C "$SRC_DIR" bundle create "$bundle" "$branch"
    if [[ -d $APP_DIR/.git ]]; then
      git -C "$APP_DIR" fetch "$bundle" "$branch"
      git -C "$APP_DIR" reset --hard FETCH_HEAD
    else
      git clone --branch "$branch" "$bundle" "$APP_DIR"
    fi
    rm -f "$bundle"
    if [[ -n $origin ]]; then git -C "$APP_DIR" remote set-url origin "$origin"; else git -C "$APP_DIR" remote remove origin; fi
    # Le serveur n'a pas besoin des tests ni des hooks de dev
    git -C "$APP_DIR" sparse-checkout set --no-cone '/*' '!/test/' '!/.githooks/'
  else
    mkdir -p "$APP_DIR"
    tar -C "$SRC_DIR" --exclude=./test --exclude=./.githooks --exclude=./node_modules --exclude=./data --exclude=./.env -cf - . | tar -C "$APP_DIR" -xf -
  fi
  chown -R "$APP_USER:" "$APP_DIR"
  (cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" npm_config_cache="/home/$APP_USER/.npm" npm ci --omit=dev --no-audit --no-fund)
  (cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" npm_config_cache="/home/$APP_USER/.npm" npm cache clean --force)
  mkdir -p "$DATA_DIR"; chown "$APP_USER:" "$DATA_DIR"; chmod 750 "$DATA_DIR"
  if (( BACKUPS )); then mkdir -p "$BACKUP_DIR"; chown "$APP_USER:" "$BACKUP_DIR"; chmod 750 "$BACKUP_DIR"; fi
}

set_env() { # set_env clé valeur  (dans $APP_DIR/.env)
  local f=$APP_DIR/.env
  if grep -q "^$1=" "$f"; then
    __V=$2 awk -v k="$1" 'BEGIN { v = ENVIRON["__V"] } index($0, k "=") == 1 { print k "=" v; next } { print }' "$f" >"$f.tmp"
    cat "$f.tmp" >"$f"; rm -f "$f.tmp"
  else
    printf '%s=%s\n' "$1" "$2" >>"$f"
  fi
}

write_env() {
  local f=$APP_DIR/.env claude_bin
  claude_bin=$(command -v claude || echo claude)
  umask 077
  if (( ! KEEP_ENV )); then
    cat >"$f" <<EOF
# Généré par install.sh le $(date '+%F %T')
APP_URL=https://$DOMAIN
PORT=$PORT
HOST=127.0.0.1
GOOGLE_CLIENT_ID=$GOOGLE_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_SECRET
ADMIN_EMAILS=$ALLOWED
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DATA_DIR=$DATA_DIR
CLAUDE_BIN=$claude_bin
THERMAL_MAX=$THERMAL
EOF
  fi
  set_env DATA_DIR "$DATA_DIR"
  set_env CLAUDE_BIN "$claude_bin"
  local bin
  for bin in codex:CODEX_BIN gemini:GEMINI_BIN agy:AGY_BIN; do
    command -v "${bin%%:*}" >/dev/null && set_env "${bin##*:}" "$(command -v "${bin%%:*}")"
  done
  chown "$APP_USER:" "$f"; chmod 600 "$f"
}

old_data_dir() { # DATA_DIR de la config existante, chemin absolu
  local d; d=$(sed -n 's/^DATA_DIR=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1)
  [[ -z $d ]] && return 0
  [[ $d == /* ]] || d="$APP_DIR/${d#./}"
  printf '%s' "${d%/}"
}

migrate_data() {
  local old=$1
  systemctl stop aitools 2>/dev/null || true
  cp -a "$old/." "$DATA_DIR/"
  chown -R "$APP_USER:" "$DATA_DIR"
}

install_units() {
  local mem=900M unit=/etc/systemd/system/aitools.service
  (( $(ram_mb) < 1800 )) && mem=600M
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@APP_USER@|$APP_USER|g" \
      -e "s|^MemoryMax=.*|MemoryMax=$mem|" "$SRC_DIR/deploy/aitools.service" >"$unit"

  if (( BACKUPS )); then
    install -m 755 "$SRC_DIR/deploy/aitools-backup.sh" /usr/local/sbin/aitools-backup
    cat >/etc/systemd/system/aitools-backup.service <<EOF
[Unit]
Description=Sauvegarde quotidienne iaboss
RequiresMountsFor=$DATA_DIR $BACKUP_DIR

[Service]
Type=oneshot
User=$APP_USER
Nice=15
IOSchedulingClass=idle
ExecStart=/usr/local/sbin/aitools-backup $DATA_DIR/aitools.sqlite $BACKUP_DIR 14
EOF
    cat >/etc/systemd/system/aitools-backup.timer <<EOF
[Unit]
Description=Sauvegarde quotidienne iaboss (04:30)

[Timer]
OnCalendar=*-*-* 04:30
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
EOF
  fi
  systemctl daemon-reload
  systemctl enable aitools.service
  (( BACKUPS )) && systemctl enable --now aitools-backup.timer
  return 0
}

config_complete() {
  local id secret
  id=$(sed -n 's/^GOOGLE_CLIENT_ID=//p' "$APP_DIR/.env" | tail -n1)
  secret=$(sed -n 's/^GOOGLE_CLIENT_SECRET=//p' "$APP_DIR/.env" | tail -n1)
  [[ -n $id && -n $secret ]]
}

do_app() {
  section "Application"
  local old=""
  (( KEEP_ENV )) && old=$(old_data_dir)
  run "Déploiement dans $APP_DIR (dépendances de prod uniquement)" deploy_app
  if [[ -n $old && $old != "$DATA_DIR" && -f $old/aitools.sqlite && ! -f $DATA_DIR/aitools.sqlite ]]; then
    run "Migration des données de $old vers $DATA_DIR" migrate_data "$old"
  fi
  run "Configuration (.env, droits 600)" write_env
  run "Services systemd" install_units
}

install_tunnel() { cloudflared service install "$TUNNEL_TOKEN"; }

do_tunnel() {
  [[ $TUNNEL_MODE == token ]] || return 0
  section "Cloudflare Tunnel"
  has_unit cloudflared.service && run "Suppression de l'ancien tunnel" cloudflared service uninstall
  run "Installation du tunnel" install_tunnel
}

do_claude() {
  [[ $CLAUDE_MODE == later ]] && return 0
  section "Connexion à Claude"
  if (( DRY_RUN )); then info "[dry-run] étape interactive ignorée"; return 0; fi
  local bin; bin=$(command -v claude) || { warn "Claude Code introuvable."; return 0; }
  if [[ $CLAUDE_MODE == token ]]; then
    info "Une URL va s'afficher : ouvre-la, connecte-toi avec ton compte Claude Pro,"
    info "puis reviens ici. Le token s'affichera à la fin (il commence par sk-ant-oat)."
    printf '\n'
    runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$bin" setup-token || warn "setup-token a échoué."
    printf '\n'
    local token=""
    while :; do
      ask_secret token "Colle le token ici (vide = plus tard)"
      [[ -z $token ]] && { warn "Token non enregistré, tu pourras relancer l'install."; return 0; }
      [[ $token =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] && break
      warn "Format inattendu (attendu : sk-ant-…)."
    done
    set_env CLAUDE_CODE_OAUTH_TOKEN "$token"
    ok "Token enregistré dans $APP_DIR/.env"
  else
    info "Claude Code va s'ouvrir : tape /login, suis les instructions, puis /exit."
    printf '\n'
    runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$bin" || true
  fi

  printf '\n'
  if confirm "Tester la connexion à Claude (une requête minuscule sur Haiku) ?" o; then
    local out
    if out=$(cd /tmp && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" bash -c \
          'set -a; . '"$APP_DIR"'/.env; exec "$CLAUDE_BIN" -p "Réponds uniquement: OK" --model haiku --max-turns 1' 2>&1); then
      ok "Claude répond : ${out:0:60}"
    else
      warn "Claude ne répond pas : ${out:0:200}"
    fi
  fi
}

do_start() {
  section "Démarrage"
  if (( DRY_RUN )); then info "[dry-run] démarrage ignoré"; return 0; fi
  if ! config_complete; then
    warn "Identifiants Google manquants : le service n'est pas démarré."
    info "Complète $APP_DIR/.env puis : sudo systemctl start aitools"
    return 0
  fi
  run "Démarrage d'iaboss" systemctl restart aitools
  local i code=""
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login" || true)
    [[ $code == 200 ]] && break
    sleep 1
  done
  if [[ $code == 200 ]]; then ok "iaboss répond sur http://127.0.0.1:$PORT"
  else warn "iaboss ne répond pas (HTTP ${code:-aucun}). Voir : journalctl -u aitools -n 50"; fi
}

finish() {
  section "Terminé"
  local domain; domain=$(sed -n 's|^APP_URL=||p' "$APP_DIR/.env" 2>/dev/null | tail -n1 || true)
  row "Panel" "${domain:-https://$DOMAIN}"
  row "Données" "$DATA_DIR"
  (( BACKUPS )) && row "Sauvegardes" "$BACKUP_DIR (tous les jours à 04:30)"
  row "Logs" "journalctl -u aitools -f"
  row "Température" "vcgencmd measure_temp · vcgencmd get_throttled (0x0 = OK)"
  row "Log install" "$LOG"
  [[ $TUNNEL_MODE == later ]] && warn "Tunnel non configuré : relance ./install.sh quand tu as le token."
  [[ $CLAUDE_MODE == later ]] && warn "Claude non connecté : relance ./install.sh pour le faire."
  (( DRY_RUN )) && return 0

  if [[ $SRC_DIR != "$APP_DIR" ]]; then
    printf '\n'
    info "L'application tourne depuis $APP_DIR. Le dossier cloné $SRC_DIR ne sert plus."
    if confirm "Supprimer $SRC_DIR ?" n; then cd / && rm -rf -- "$SRC_DIR" && ok "Dossier source supprimé"; fi
  fi

  if (( NEED_REBOOT )); then
    printf '\n'
    if confirm "Un redémarrage est nécessaire (Wi-Fi/Bluetooth). Redémarrer maintenant ?" o; then
      info "Redémarrage…"; sleep 2; reboot
    else
      warn "Pense à redémarrer : sudo reboot"
    fi
  fi
}

usage() {
  cat <<EOF
Usage : sudo ./install.sh [--dry-run]
  --dry-run   pose les questions et affiche ce qui serait fait, sans rien modifier
EOF
}

main() {
  for arg in "$@"; do
    case $arg in
      --dry-run) DRY_RUN=1 ;;
      -h|--help) usage; exit 0 ;;
      *) usage; die "Option inconnue : $arg" ;;
    esac
  done

  banner
  preflight
  ask_storage
  ask_backups
  ask_network
  ask_cleanup
  ask_app
  ask_tunnel
  ask_claude
  ask_other_ais
  recap

  do_upgrade
  do_cleanup
  do_storage
  do_runtime
  do_app
  do_tunnel
  do_claude
  do_start
  finish
}

# Tout est dans des fonctions : le script est entièrement lu avant de s'exécuter.
# (sourcé = mode test : on charge les fonctions sans lancer l'installation)
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; exit 0; fi
