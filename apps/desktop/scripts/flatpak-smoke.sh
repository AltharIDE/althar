#!/bin/bash
# The Flatpak smoke test: the checks that are its own environment's — git and
# the window's entry inside the sandbox, the device outside it (the person's
# own OpenCode and Codex, through the permission the manifest asks for),
# data that persists beside the profile (its home is fresh each run), and
# the narrow permissions (no host filesystem). The window's own behavior is
# the same X11 smoke the other packages use: ALTHAR_BIN=/usr/bin/althar
# ALTHAR_ARGS=--ozone-platform=x11 scripts/x11-smoke.sh. Needs the app
# installed: scripts/flatpak.sh.
set -u
APP=dev.althar.app
pass=0; fail=0
ok() { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
run() { flatpak run --command=sh "$APP" -c "$1" 2>/dev/null; }

version=$(run 'git --version')
case "$version" in git\ version*) ok "git is in the sandbox ($version)";; *) bad "git is in the sandbox";; esac
run 'cd /tmp && rm -rf smoke && mkdir smoke && cd smoke && git init -q && git -c user.email=a@b -c user.name=a commit -q --allow-empty -m x && test -f .git/HEAD' && ok "git works on a repository" || bad "git works on a repository"

run 'test ! -e "$HOME/projects"' && ok "no host filesystem: the person's folders aren't visible" || bad "no host filesystem"
run '[ ! -e "$HOME/.config" ] || [ -z "$(ls -A "$HOME/.config" 2>/dev/null | grep -v '^@althar$')" ]' && ok "no host config beyond the app's own" || bad "no host config"

perms=$(flatpak info --show-permissions "$APP" 2>/dev/null)
echo "$perms" | grep -qE '(^|[=;])network(;|$)' && ok "network shared" || bad "network shared"
echo "$perms" | grep -qE '(^|[=;])ipc(;|$)' && ok "shared memory allowed (ipc)" || bad "shared memory (ipc)"
echo "$perms" | grep -q 'wayland' && ok "wayland allowed" || bad "wayland allowed"
echo "$perms" | grep -q 'org.freedesktop.secrets' && ok "the keyring is reachable (org.freedesktop.secrets)" || bad "keyring reachable"
echo "$perms" | grep -q 'org.freedesktop.Flatpak' && ok "the device is reachable (org.freedesktop.Flatpak)" || bad "device reachable"
echo "$perms" | grep -q 'ssh-auth' && ok "the ssh agent is reachable (ssh-auth)" || bad "ssh agent reachable"
echo "$perms" | grep -q 'filesystems=host' && bad "no host filesystem in permissions" || ok "no host filesystem in permissions"

# The device outside the sandbox: a command runs there, the person's own agents are found and run there, and the ssh agent's socket is there.
run 'flatpak-spawn --host true' && ok "a command runs on the device" || bad "a command runs on the device"
run 'test -S "$SSH_AUTH_SOCK"' && ok "the ssh agent's socket is there (ssh-auth)" || bad "the ssh agent's socket"
run 'test -x /app/bin/althar-host-codex' && ok "the Codex host bridge is installed" || bad "the Codex host bridge"
device_bin() { run "flatpak-spawn --host sh -c 'command -v $1'"; }
opencode=$(device_bin opencode)
if [ -n "$opencode" ]; then
  said=$(run 'flatpak-spawn --host opencode --version' | head -1)
  case "$said" in *[0-9]*) ok "the person's OpenCode runs on the device ($said)";; *) bad "the person's OpenCode runs on the device";; esac
else
  echo "SKIP: no OpenCode on this device"
fi
codex=$(device_bin codex)
if [ -n "$codex" ]; then
  # The bridge itself, end to end: the adapter's handshake is answered by the device's Codex over flatpak-spawn.
  bridge=$(run "{ printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":1,\"clientCapabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"title\":\"Smoke\",\"version\":\"0\"}}}'; sleep 8; } | timeout 25 /app/bin/althar-host-codex app-server" | head -c 500)
  case "$bridge" in *'"result"'*) ok "the Codex bridge answers over flatpak-spawn (ACP initialize)";; *) bad "the Codex bridge answers";; esac
else
  echo "SKIP: no Codex on this device"
fi

run 'test -f /app/share/applications/dev.althar.app.desktop && grep -q "StartupWMClass=dev.althar.app" /app/share/applications/dev.althar.app.desktop' && ok "the desktop entry is there, with the right class" || bad "desktop entry"
run 'test -f /app/share/metainfo/dev.althar.app.metainfo.xml && test -f /app/share/icons/hicolor/512x512/apps/dev.althar.app.png' && ok "metainfo and icon are there" || bad "metainfo and icon"

run 'mkdir -p "$XDG_DATA_HOME/althar" && echo kept > "$XDG_DATA_HOME/althar/.smoke"'
run 'grep -q kept "$XDG_DATA_HOME/althar/.smoke" && rm "$XDG_DATA_HOME/althar/.smoke"' && ok "data beside the profile persists across instances" || bad "data persists"

echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
