#!/bin/sh
# Run by piping this complete script into the authenticated SSH user's sh -s.
set -eu
umask 077
unset NODE_OPTIONS NODE_PATH
export LC_ALL=C
PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
export PATH

emit() {
  if [ -n "${journal:-}" ]; then printf '%s\n' "$1" >> "$journal"; fi
  printf '%s\n' "$1"
}
event() { emit "{\"protocol\":1,\"step\":\"$1\",\"state\":\"$2\"${3:-}}"; }
fail() { event "$1" failed ",\"code\":\"$2\""; exit 1; }
number() { case "$1" in ''|0[0-9]*|*[!0-9]*) return 1 ;; esac; [ "${#1}" -le 10 ]; }
digest() { case "$1" in *[!a-f0-9]*) return 1 ;; esac; [ "${#1}" -eq 64 ]; }
json_string() {
  printf '"'
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
  printf '"'
}
archive_size() {
  number "$1" && number "$2" && [ "$1" -gt 0 ] && [ "$1" -le 1073741824 ] &&
    [ "$2" -gt 0 ] && [ "$2" -le 4294967296 ]
}
needed_kib() { printf '%s' "$(( (2 * $2 + $1 + 1023) / 1024 + 262144 ))"; }
private_dir() {
  [ ! -L "$1" ] || return 1
  mkdir -p -m 700 -- "$1" && [ "$(stat -c %u -- "$1")" = "$uid" ] && chmod 700 -- "$1"
}

probe() {
  event reach started
  event reach done
  event look started
  [ "$(uname -s)" = Linux ] || fail look UnsupportedOS
  [ "$(getconf LONG_BIT 2>/dev/null || :)" = 64 ] || fail look UnsupportedArchitecture
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail look UnsupportedArchitecture ;;
  esac
  command -v systemd-run >/dev/null && command -v systemctl >/dev/null && [ -d /run/systemd/system ] || fail look NoSystemd
  user=$(id -un) || fail look InvalidLogin
  case "$user" in ''|*[!a-zA-Z0-9_.-]*) fail look InvalidLogin ;; esac
  uid=$(id -u)
  git=false
  if command -v git >/dev/null; then git=true; fi
  linger=false
  if [ "$(loginctl -p Linger --value show-user -- "$user" 2>/dev/null || :)" = yes ]; then linger=true; fi
  manager=false
  if systemctl --user show-environment >/dev/null 2>&1; then manager=true; fi
  if [ "$manager" = false ] && [ "$uid" != 0 ]; then fail look NoUserManager; fi
  available=$(df -Pk -- "$HOME" | awk 'END {print $4}')
  case "$available" in ''|*[!0-9]*) fail look DiskUnavailable ;; esac
  [ "$available" -ge "$1" ] || fail look NotEnoughDisk
  action=''
  if [ "$uid" != 0 ] && [ "$linger" = false ]; then
    action=",\"action\":{\"code\":\"LingerOff\",\"command\":\"loginctl enable-linger -- $user\"}"
  fi
  event look done ",\"os\":\"linux\",\"arch\":\"$arch\",\"systemdUserManager\":$manager,\"freeKiB\":$available,\"git\":$git,\"login\":\"$user\",\"root\":$([ "$uid" = 0 ] && printf true || printf false),\"linger\":$linger$action"
}

# Newer Ubuntu lets only programs AppArmor names make a user namespace (kernel.apparmor_restrict_unprivileged_userns),
# which bubblewrap, the sandbox of a worker's agents, needs. As root, once: a rule for the worker's own bubblewrap alone,
# at its program folder's releases, as the release's check says it (apps/host/src/workerCheck.ts `apparmorRule`).
sandbox_rule() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || :)" = 1 ] || return 0
  command -v apparmor_parser >/dev/null || return 0
  case "$1" in /*) ;; *) return 0 ;; esac
  case "$1" in *[!A-Za-z0-9._/-]*) return 0 ;; esac
  printf '%s\n' 'abi <abi/4.0>,' 'include <tunables/global>' "profile althar-worker-bwrap $1/bundle-*/**/bwrap flags=(unconfined) {" '  userns,' '  include if exists <local/althar-worker-bwrap>' '}' > /etc/apparmor.d/althar-worker-bwrap.new &&
    mv -f -- /etc/apparmor.d/althar-worker-bwrap.new /etc/apparmor.d/althar-worker-bwrap &&
    apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap
}

root_login() {
  [ "$uid" = 0 ] || fail setup InvalidLogin
  key=$1
  case "$key" in
    'ssh-ed25519 '*|'ssh-rsa '*|'ecdsa-sha2-nistp256 '*|'ecdsa-sha2-nistp384 '*|'ecdsa-sha2-nistp521 '*) ;;
    *) fail setup InvalidPublicKey ;;
  esac
  data=${key#* }
  case "$data" in ''|*[!A-Za-z0-9+/=]*) fail setup InvalidPublicKey ;; esac
  [ "${#key}" -le 4096 ] && printf '%s\n' "$key" | ssh-keygen -lf /dev/stdin >/dev/null 2>&1 || fail setup InvalidPublicKey
  root_state=/var/lib/althar-host-bootstrap
  private_dir "$root_state" || fail setup UnsafeState
  (
    flock -n 9 || fail setup LockHeld
    event setup started
    marker=$root_state/account
    if [ ! -f "$marker" ]; then
      if getent passwd althar >/dev/null; then fail setup AccountConflict; fi
      printf '%s\n' pending > "$root_state/account.new"
      mv -f -- "$root_state/account.new" "$marker"
    fi
    if ! getent passwd althar >/dev/null; then
      [ "$(cat "$marker")" = pending ] || fail setup AccountConflict
      useradd --create-home --shell /bin/sh -- althar || fail setup AccountCreationFailed
    fi
    account_id=$(id -u althar) || fail setup AccountCreationFailed
    [ "$account_id" -gt 0 ] || fail setup AccountConflict
    previous=$(cat "$marker")
    [ "$previous" = pending ] || [ "$previous" = "$account_id" ] || fail setup AccountConflict
    printf '%s\n' "$account_id" > "$root_state/account.new"
    mv -f -- "$root_state/account.new" "$marker"
    runuser -u althar -- /bin/sh -c '
      set -eu
      umask 077
      cd "$HOME"
      [ ! -L .ssh ] && mkdir -p -m 700 .ssh && chmod 700 .ssh
      [ ! -L .ssh/authorized_keys ]
      temporary=$(mktemp .ssh/.authorized-keys.XXXXXXXX)
      trap '\''rm -f -- "$temporary"'\'' EXIT
      if [ -f .ssh/authorized_keys ]; then cat .ssh/authorized_keys > "$temporary"; fi
      if ! grep -Fqx -- "$1" "$temporary"; then printf "\n%s\n" "$1" >> "$temporary"; fi
      mv -f -- "$temporary" .ssh/authorized_keys
    ' sh "$key" || fail setup AccountKeyFailed
    loginctl enable-linger althar || fail setup AccountLingerFailed
    account_home=$(getent passwd althar | cut -d: -f6)
    sandbox=true
    sandbox_rule "$account_home/.local/share/althar-worker-program" || sandbox=false
    event setup done ",\"login\":\"althar\",\"linger\":true,\"sandboxRule\":$sandbox"
  ) 9>"$root_state/lock"
}

operation=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
if [ "$operation" = probe ]; then
  [ "$#" -le 1 ] && number "${1:-1}" || fail look InvalidRequest
  probe "${1:-1}"
  exit
fi
if [ "$operation" = root-login ]; then
  [ "$#" -eq 1 ] || fail setup InvalidRequest
  probe 1
  root_login "$1"
  exit
fi

# A worker installs from a signed release of its own, published beside the home's, into a program folder of its own;
# then the release's own worker commands set it up (apps/host/src/workerSetup.ts).
role=host
case "$operation" in worker-*) role=worker; operation=${operation#worker-} ;; esac

uid=$(id -u)
[ "$uid" != 0 ] || fail setup DedicatedUserRequired
case "${XDG_DATA_HOME:-$HOME/.local/share}" in /*) ;; *) fail setup InvalidRequest ;; esac
root=${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program.setup-v1
if [ "$role" = worker ]; then root=${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program; fi
if printf '%s' "$root" | grep -q '[[:cntrl:]]' || [ "$(printf '%s' "$root" | wc -l)" != 0 ]; then fail setup InvalidRequest; fi

# A machine without SSH adds itself with a one-time code (Settings › Computers › Add a worker › With a code): the
# person runs this script there, published beside the release as althar-worker.sh, with `join <code>`. It takes the
# newest release from where the script came from, checks its archive against its manifest, and installs it as the SSH
# setup would; the release then asks the home for its certificate with the code (worker join). The release's key comes
# from the same place: later updates must be signed by it.
join_code=''
if [ "$operation" = join ]; then
  [ "$#" -eq 1 ] || fail enroll InvalidRequest
  case "$1" in althar-worker1.*) ;; *) fail enroll InvalidCode ;; esac
  case "$1" in *[!A-Za-z0-9._-]*) fail enroll InvalidCode ;; esac
  [ "${#1}" -le 8192 ] || fail enroll InvalidCode
  join_code=$1
  role=worker
  root=${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program
  probe 1
  command -v curl >/dev/null || fail get CannotDownload
  base=${ALTHAR_RELEASE_BASE:-https://github.com/AltharIDE/althar/releases/latest/download}
  case "$base" in https://*|http://127.0.0.1*|http://localhost*) ;; *) fail get InvalidRequest ;; esac
  # The worker's own release; from a release before workers had their own, the home's, which carries the worker too.
  fetched=$(curl --fail --silent --show-error --location --max-redirs 5 --max-filesize 262144 -- "$base/althar-worker-linux-$arch.json") ||
    fetched=$(curl --fail --silent --show-error --location --max-redirs 5 --max-filesize 262144 -- "$base/althar-host-linux-$arch.json") ||
    fail get NoRelease
  release_key=$(curl --fail --silent --show-error --location --max-redirs 5 --max-filesize 4096 -- "$base/althar-host-release.pub") || fail get NoRelease
  # The manifest's payload is base64url without padding: as base64, padded, for base64 -d.
  encoded=$(printf '%s' "$fetched" | sed -n 's/.*"payload":"\([A-Za-z0-9_-]*\)".*/\1/p' | tr '_-' '/+')
  case $(( ${#encoded} % 4 )) in 2) encoded="$encoded==" ;; 3) encoded="$encoded=" ;; esac
  payload=$(printf '%s' "$encoded" | base64 -d 2>/dev/null) || fail get ReleaseRejected
  [ -n "$payload" ] || fail get ReleaseRejected
  field() { printf '%s' "$fields" | sed -n "s|.*\"$1\":\($2\).*|\1|p"; }
  # A release in parts: its base, without its agents' own programs, which the release's install then adds. Else the
  # whole archive's fields, which are the payload's last mention of each.
  fields=$(printf '%s' "$payload" | sed -n 's|.*"parts":{"base":{\([^}]*\)}.*|\1|p')
  if [ -z "$fields" ]; then fields=$payload; fi
  set -- download "$(field sha256 '"[a-f0-9]*"' | tr -d '"')" "$(field bytes '[0-9]*')" "$(field unpackedBytes '[0-9]*')" \
    "$(field url '"https://[^"]*"' | tr -d '"')" "$(printf '%s' "$fetched" | base64 | tr -d '\n')" "$(printf '%s\n' "$release_key" | base64 | tr -d '\n')"
  operation=install
fi

# How a release runs its worker's commands: a worker's own release by its own entry; a home's, which workers were
# installed from before they had their own, as `althar-host worker …`. Sets `entry` and `via` for "$entry" ${via:+"$via"}.
worker_entry() {
  if [ -f "$1/dist/althar-worker.js" ]; then entry=$1/dist/althar-worker.js via=''
  elif [ -f "$1/dist/althar-host.js" ]; then entry=$1/dist/althar-host.js via=worker
  else return 1
  fi
}
worker_program() {
  current=$root/current
  [ -x "$current/node/bin/node" ] && worker_entry "$current" || fail start WorkerNotInstalled
}
if [ "$role" = worker ]; then
  case "$operation" in
    enroll)
      [ "$#" -eq 2 ] || fail start InvalidRequest
      case "$1" in *[!A-Za-z0-9_-]*|'') fail start InvalidRequest ;; esac
      [ "${#1}" -le 65536 ] || fail start InvalidRequest
      worker_program
      # Where the window's own home is this SSH client's computer, the address this login came from reaches it.
      first=''
      if [ "$2" = 1 ] && [ -n "${SSH_CONNECTION:-}" ]; then first=${SSH_CONNECTION%% *}; fi
      case "$first" in *[!0-9a-fA-F.:]*) first='' ;; esac
      exec "$current/node/bin/node" "$entry" ${via:+"$via"} enroll --grant "$1" --first "$first"
      ;;
    agents)
      [ "$#" -eq 0 ] || fail agents InvalidRequest
      worker_program
      exec "$current/node/bin/node" "$entry" ${via:+"$via"} agents
      ;;
    sign-in)
      [ "$#" -eq 2 ] || fail sign-in InvalidRequest
      case "$1" in *[!a-z0-9-]*|'') fail sign-in InvalidRequest ;; esac
      case "$2" in browser|device) ;; *) fail sign-in InvalidRequest ;; esac
      worker_program
      exec "$current/node/bin/node" "$entry" ${via:+"$via"} sign-in --agent "$1" --way "$2"
      ;;
    check)
      [ "$#" -eq 0 ] || fail check InvalidRequest
      worker_program
      exec "$current/node/bin/node" "$entry" ${via:+"$via"} check
      ;;
    sandbox)
      # What only root may do to let its agents' sandbox start, with sudo where this login may without a password.
      [ "$#" -eq 0 ] || fail check InvalidRequest
      worker_program
      exec "$current/node/bin/node" "$entry" ${via:+"$via"} sandbox
      ;;
    linger)
      # A worker is a user service: without lingering, the user's service manager, and the worker with it, stops once
      # this login ends. Turned on where this login may without a password; else the line for its administrator.
      [ "$#" -eq 0 ] || fail look InvalidRequest
      user=$(id -un)
      lingers() { [ "$(loginctl -p Linger --value show-user -- "$user" 2>/dev/null || :)" = yes ]; }
      if ! lingers && command -v sudo >/dev/null; then sudo -n loginctl enable-linger -- "$user" >/dev/null 2>&1 || :; fi
      if ! lingers; then
        event look failed ",\"code\":\"LingerOff\",\"command\":$(json_string "sudo loginctl enable-linger -- $user")"
        exit 1
      fi
      event look done ',"linger":true'
      exit
      ;;
    status|resume) fail setup InvalidRequest ;;
  esac
fi

case "$operation" in
  status|resume)
    [ "$#" -eq 0 ] || fail setup InvalidRequest
    if [ -r "$root/ready" ]; then
      release=$(cat "$root/ready")
      digest "$release" || fail setup UnsafeState
      program=$root/bundle-$release
      if [ "$operation" = status ]; then
        exec "$program/node/bin/node" "$program/dist/althar-host.js" setup status --json
      fi
      exec "$program/node/bin/node" "$program/dist/althar-host.js" setup --resume --manifest "$program/.manifest" --release-key "$program/.release-key" --json
    fi
    if [ "$operation" = status ] && [ -r "$root/transfer.jsonl" ]; then
      cat -- "$root/transfer.jsonl"
      exit
    fi
    fail setup SetupNotFound
    ;;
  prepare-upload)
    [ "$#" -eq 2 ] && archive_size "$1" "$2" || fail get InvalidRequest
    probe "$(needed_kib "$1" "$2")"
    private_dir "$root" || fail get UnsafeState
    upload=$(mktemp -d "$root/upload.XXXXXXXX") || fail get CannotDownload
    event get started ",\"uploadId\":\"${upload##*.}\",\"uploadPath\":$(json_string "$upload/archive.partial")"
    exit
    ;;
  install) ;;
  *) fail setup InvalidRequest ;;
esac

[ "$#" -eq 7 ] || fail get InvalidRequest
method=$1 release=$2 bytes=$3 unpacked=$4 source=$5 envelope=$6 public_key=$7
case "$method" in download|upload) ;; *) fail get InvalidRequest ;; esac
digest "$release" && archive_size "$bytes" "$unpacked" || fail get InvalidRequest
[ "${#envelope}" -le 87400 ] && [ "${#public_key}" -le 5464 ] || fail get InvalidRequest
probe "$(needed_kib "$bytes" "$unpacked")"
private_dir "$root" || fail get UnsafeState
(
  flock -n 9 || fail get LockHeld
  journal=$root/transfer.jsonl
  : > "$journal"
  : > "$root/transfer.log"
  chmod 600 -- "$journal" "$root/transfer.log" || fail get UnsafeState
  event get started ",\"bytes\":0,\"totalBytes\":$bytes"
  scratch=$(mktemp -d "$root/transfer.XXXXXXXX") || fail get CannotDownload
  pid=''
  cleanup() {
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || :; fi
    rm -rf -- "$scratch"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  archive=$scratch/archive.partial
  bundle=$root/bundle-$release
  if [ ! -d "$bundle" ]; then
    if [ "$method" = download ]; then
      case "$source" in https://*) ;; *) fail get InvalidRequest ;; esac
      command -v curl >/dev/null || fail get CannotDownload
      (
        ulimit -f "$(( (bytes + 511) / 512 ))"
        exec curl --fail --silent --show-error --location --max-redirs 5 --proto '=https' --proto-redir '=https' \
          --connect-timeout 15 --max-time 180 --max-filesize "$bytes" --output "$archive" -- "$source"
      ) 2>>"$root/transfer.log" &
      pid=$!
      last=0
      while kill -0 "$pid" 2>/dev/null; do
        current=$(stat -c %s -- "$archive" 2>/dev/null || printf 0)
        if [ "$current" != "$last" ]; then
          event get progress ",\"bytes\":$current,\"totalBytes\":$bytes"
          last=$current
        fi
        sleep 1
      done
      if ! wait "$pid"; then pid=''; fail get CannotDownload; fi
      pid=''
    else
      case "$source" in *[!a-zA-Z0-9]*|'') fail get InvalidRequest ;; esac
      [ "${#source}" -eq 8 ] || fail get InvalidRequest
      upload=$root/upload.$source
      [ -d "$upload" ] && [ ! -L "$upload" ] && [ -f "$upload/archive.partial" ] && [ ! -L "$upload/archive.partial" ] || fail get CannotDownload
      mv -T -- "$upload/archive.partial" "$archive" || fail get CannotDownload
      rmdir -- "$upload" || :
    fi
    [ "$(stat -c %s -- "$archive")" = "$bytes" ] || fail get SignatureMismatch
    verified=$(sha256sum -- "$archive") || fail get SignatureMismatch
    [ "${verified%% *}" = "$release" ] || fail get SignatureMismatch
    mkdir -m 700 -- "$scratch/bundle"
    tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$scratch/bundle" 2>>"$root/transfer.log" || fail get ReleaseExtractionFailed
    printf '%s' "$envelope" | base64 -d > "$scratch/bundle/.manifest" || fail get InvalidRequest
    printf '%s' "$public_key" | base64 -d > "$scratch/bundle/.release-key" || fail get InvalidRequest
    # A directory’s default ACL can override the process umask on new files.
    chmod 600 -- "$scratch/bundle/.manifest" "$scratch/bundle/.release-key" || fail get UnsafeState
    mv -T -- "$scratch/bundle" "$bundle" || fail get ReleaseExtractionFailed
  fi
  [ -d "$bundle" ] && [ ! -L "$bundle" ] || fail get UnsafeState
  printf '%s\n' "$release" > "$scratch/ready"
  mv -T -- "$scratch/ready" "$root/ready"
  event get done ",\"bytes\":$bytes,\"totalBytes\":$bytes"
  if [ "$role" = worker ]; then
    worker_entry "$bundle" || fail get NoWorker
    "$bundle/node/bin/node" "$entry" ${via:+"$via"} install --program "$bundle"
    if [ -n "$join_code" ]; then
      "$bundle/node/bin/node" "$entry" ${via:+"$via"} join --code "$join_code" --name "$(hostname)"
    fi
  else
    "$bundle/node/bin/node" "$bundle/dist/althar-host.js" setup --manifest "$bundle/.manifest" --release-key "$bundle/.release-key" --json
  fi
) 9>"$root/transfer.lock"
