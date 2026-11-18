#!/usr/bin/env bash
# Runs only on an isolated GitHub-hosted Linux runner with its own systemd and SSH daemon.
set -euo pipefail
fixture=$(realpath "$1")
bootstrap=$(realpath "$(dirname "$0")/../bootstrap/ssh.sh")
mapfile -t release < "$fixture/install-args"
port=32239
cert=/usr/local/share/ca-certificates/althar-setup-fixture.crt
wrapper=/usr/local/bin/systemctl
work=$(mktemp -d)
ssh_pid=''
ssh_root=''
https_pid=''
managed=()
cleanup() {
  code=$?
  if [[ $code != 0 ]]; then
    tail -80 "$work/sshd.log" || true
    for user in "${managed[@]}"; do
      sudo journalctl --no-pager -n 50 "_UID=$(id -u "$user")" || true
    done
  fi
  if [[ -n $ssh_pid ]]; then sudo kill "$ssh_pid" 2>/dev/null || true; fi
  if [[ -n $ssh_root ]]; then sudo rm -rf "$ssh_root"; fi
  if [[ -n $https_pid ]]; then kill "$https_pid" 2>/dev/null || true; fi
  for user in "${managed[@]}"; do
    sudo loginctl terminate-user "$user" || true
    sudo loginctl disable-linger "$user" || true
    sudo userdel --remove "$user" || true
  done
  if [[ -f $work/installed-wrapper ]]; then sudo rm -f "$wrapper"; fi
  if [[ -f $work/installed-cert ]]; then sudo rm -f "$cert"; sudo update-ca-certificates --fresh >/dev/null; fi
  if [[ -f $work/created-root-state ]]; then sudo rm -rf /var/lib/althar-host-bootstrap; fi
  rm -rf "$work"
  exit "$code"
}
trap cleanup EXIT

# Prevent the fixture from touching any account or policy that already exists.
[[ $(ps -p 1 -o comm=) == systemd ]]
[[ ! -e $wrapper && ! -e $cert ]]
! getent passwd althar >/dev/null
! getent passwd althar-operator >/dev/null
sudo test ! -e /var/lib/althar-host-bootstrap

ssh-keygen -q -t ed25519 -N '' -f "$work/login"
ssh-keygen -q -t ed25519 -N '' -f "$work/host"
cut -d' ' -f1-2 "$work/login.pub" > "$work/root-key"
printf '[127.0.0.1]:%s %s\n' "$port" "$(cut -d' ' -f1-2 "$work/host.pub")" > "$work/known-hosts"
sudo mkdir -p /run/sshd
ssh_root=$(sudo mktemp -d /run/althar-ssh-fixture.XXXXXXXX)
sudo install -m 0600 "$work/root-key" "$ssh_root/authorized_keys"
cat > "$work/sshd.conf" <<CONFIG
Port $port
ListenAddress 127.0.0.1
HostKey $work/host
PidFile $work/sshd.pid
UsePAM yes
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
AllowUsers root althar althar-operator
Subsystem sftp internal-sftp
Match User root
    AuthorizedKeysFile $ssh_root/authorized_keys
CONFIG
sudo /usr/sbin/sshd -f "$work/sshd.conf" -E "$work/sshd.log"
ssh_pid=$(cat "$work/sshd.pid")
ssh_options=(-F /dev/null -o ConnectTimeout=5 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known-hosts" -o BatchMode=yes -o IdentitiesOnly=yes -i "$work/login")
remote() { local user=$1; shift; ssh "${ssh_options[@]}" -p "$port" "$user@127.0.0.1" "$@"; }
boot() { local user=$1; shift; remote "$user" "sh -s -- $*" < "$bootstrap"; }
expect_failure() {
  local code=$1 output
  shift
  if output=$("$@"); then printf '%s\n' "$output"; return 1; fi
  printf '%s\n' "$output" | grep -F "\"code\":\"$code\""
}
status_contains() {
  local user=$1 pattern=$2 status
  for ((i = 0; i < 90; i++)); do
    status=$(boot "$user" status)
    if [[ $status == *"$pattern"* ]]; then printf '%s\n' "$status"; return; fi
    if [[ $status == *'"state":"failed"'* ]]; then break; fi
    sleep 1
  done
  printf '%s\n' "$status"
  return 1
}

# Verify direct SSH as root, its dedicated account, and idempotent key installation.
touch "$work/created-root-state"
managed+=(althar)
key=$(cat "$work/root-key")
boot root "root-login '$key'" | grep -F '"login":"althar","linger":true'
boot root "root-login '$key'" | grep -F '"login":"althar","linger":true'
[[ $(remote althar 'grep -c "^ssh-ed25519 " ~/.ssh/authorized_keys') == 1 ]]
boot althar probe | grep -F '"systemdUserManager":true'
expect_failure NotEnoughDisk boot althar 'probe 9999999999'

# Install a test-only command shim on the disposable VM to stop real setup at checkpoints.
cat > "$work/systemctl" <<'SHIM'
#!/bin/sh
set -eu
if [ -f "$HOME/.althar-fixture-stage" ]; then
  gate=$(cat "$HOME/.althar-fixture-stage")
  case "$gate:$*" in
    'install:--user daemon-reload'|'start:--user enable --now althar-host.service')
      while [ -f "$HOME/.althar-fixture-stage" ]; do sleep 1; done
      ;;
    'identity:--user enable --now althar-host.service')
      /usr/bin/systemctl "$@"
      pid=$(/usr/bin/systemctl --user show -p MainPID --value althar-host.service)
      kill -STOP "$pid"
      printf '%s\n' "$pid" > "$HOME/.althar-fixture-pid"
      exit
      ;;
  esac
fi
exec /usr/bin/systemctl "$@"
SHIM
sudo install -m 0755 "$work/systemctl" "$wrapper"
touch "$work/installed-wrapper"
upload() {
  local file=$1 response path
  response=$(boot althar "prepare-upload ${release[1]} ${release[2]}")
  path=$(printf '%s\n' "$response" | sed -n 's/.*"uploadPath":"\([^"]*\)".*/\1/p')
  [[ $path == /home/althar/.local/share/althar-host-program.setup-v1/upload.*/archive.partial ]]
  scp -q "${ssh_options[@]}" -P "$port" "$file" "althar@127.0.0.1:$path"
  printf '%s\n' "$response" | sed -n 's/.*"uploadId":"\([^"]*\)".*/\1/p'
}
install_upload() {
  boot althar "install upload ${release[0]} ${release[1]} ${release[2]} $1 ${release[4]} ${release[5]}"
}
kill_setup() {
  remote althar '/usr/bin/systemctl --user kill --signal=KILL althar-host-setup.service'
  status_contains althar '"state":"interrupted"'
}
printf 'incomplete archive' > "$work/incomplete"
expect_failure SignatureMismatch install_upload "$(upload "$work/incomplete")"
remote althar 'echo install > ~/.althar-fixture-stage'
ready_upload=$(upload "$fixture/${release[6]}")
install_upload "$ready_upload" | grep -F '"detached":true'
status_contains althar '"step":"setup","state":"started"'
expect_failure LockHeld boot althar resume
kill_setup
remote althar 'echo start > ~/.althar-fixture-stage'
boot althar resume | grep -F '"detached":true'
status_contains althar '"step":"start","state":"started"'
kill_setup
remote althar 'echo identity > ~/.althar-fixture-stage'
boot althar resume | grep -F '"detached":true'
status_contains althar '"step":"identity","state":"started"'
kill_setup
remote althar 'kill -CONT "$(cat ~/.althar-fixture-pid)"; rm ~/.althar-fixture-stage ~/.althar-fixture-pid'
boot althar resume | grep -F '"detached":true'
completed=$(status_contains althar '"state":"done","events":')
identity=$(printf '%s\n' "$completed" | sed -n 's/.*"step":"identity","state":"done","homeId":"\([^"]*\)".*/\1/p')
[[ $identity =~ ^home_[a-f0-9]{32}$ ]]
boot althar resume | grep -F "$identity"
remote althar 'sh ~/.local/share/althar-host-program/launcher status --json' | grep -F "$identity"

# Validate the ordinary login and real HTTPS fetch without installing any prerequisites as that user.
sudo useradd --create-home --shell /bin/sh althar-operator
managed+=(althar-operator)
sudo install -d -o althar-operator -m 0700 /home/althar-operator/.ssh
sudo install -o althar-operator -m 0600 "$work/root-key" /home/althar-operator/.ssh/authorized_keys
boot althar-operator probe | grep -F '"code":"LingerOff"'
sudo loginctl enable-linger althar-operator
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout "$work/https.key" -out "$work/https.crt" 2>/dev/null
sudo install -m 0644 "$work/https.crt" "$cert"
touch "$work/installed-cert"
sudo update-ca-certificates >/dev/null
pushd "$fixture" >/dev/null
openssl s_server -quiet -WWW -accept 127.0.0.1:8443 -cert "$work/https.crt" -key "$work/https.key" > "$work/https.log" 2>&1 &
https_pid=$!
popd >/dev/null
install_download() {
  boot althar-operator "install download ${release[0]} ${release[1]} ${release[2]} $1 ${release[4]} ${release[5]}"
}
expect_failure CannotDownload install_download 'https://127.0.0.1:1/unreachable'
install_download "${release[3]}" | grep -F '"detached":true'
status_contains althar-operator '"state":"done","events":' | grep -F '"step":"identity","state":"done"'
printf 'SSH bootstrap, root handoff, signed upload/download, locking, and kill/resume verified with systemd.\n'
