#!/bin/bash
# The Flatpak smoke test: the checks that are its own environment's — git and
# the window's entry inside the sandbox, the bundled Claude Code CLI (its
# sign-in and sessions), the device outside it (the person's own OpenCode and
# Codex, through the permission the manifest asks for), git over SSH (pinned
# code hosts in the sandbox, the person's agent only through the device),
# data that persists beside the profile (its home is fresh each run), and
# permissions (no host filesystem or ssh-agent socket, but the tray watcher
# and keyring are reachable; it checks the Secret portal if present). The window's own
# behavior is
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
echo "$perms" | grep -q 'org.kde.StatusNotifierWatcher' && ok "the tray watcher is reachable (org.kde.StatusNotifierWatcher)" || bad "tray watcher reachable"
echo "$perms" | grep -q 'org.freedesktop.Flatpak' && ok "the device is reachable (org.freedesktop.Flatpak)" || bad "device reachable"
echo "$perms" | grep -q 'ssh-auth' && bad "ssh agent is not exposed" || ok "ssh agent is not exposed"
echo "$perms" | grep -q 'filesystems=host' && bad "no host filesystem in permissions" || ok "no host filesystem in permissions"

# The device outside the sandbox: a command runs there, and the person's own OpenCode and Codex are found and run there.
run 'flatpak-spawn --host true' && ok "a command runs on the device" || bad "a command runs on the device"
# No SSH agent in the sandbox, by its variable or at the path --socket=ssh-auth would put it (ADR-011, ADR-072).
run '{ [ -z "${SSH_AUTH_SOCK:-}" ] || [ ! -S "$SSH_AUTH_SOCK" ]; } && [ ! -e /run/flatpak/ssh-auth ]' && ok "the ssh agent socket is unavailable" || bad "the ssh agent socket is unavailable"
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

# git over SSH (ADR-072). In the sandbox ssh trusts the pinned code hosts and
# never asks, and has no agent to sign in with, as an agent's git doesn't;
# Althar's own git runs the device's ssh, which signs in with the person's
# agent. A host nobody pinned or accepted fails at once, with a sentence
# saying so. Each line runs with no terminal and nothing on stdin, as Althar's
# git does. ALTHAR_SMOKE_SSH_REPO is a repository the person's key may read
# over SSH (any GitHub account may read octocat/Hello-World).
SSH_REPO=${ALTHAR_SMOKE_SSH_REPO:-git@github.com:octocat/Hello-World.git}
said() { flatpak run --command=sh "$APP" -c "$1" </dev/null 2>&1; }
run 'test -s /app/share/althar/ssh/known_hosts && grep -q "^github.com" /app/share/althar/ssh/known_hosts && [ "$(command -v ssh)" = /app/bin/ssh ]' \
  && ok "the pinned code hosts and the sandbox's ssh are installed" || bad "the pinned code hosts and the sandbox's ssh"
sandbox_ssh=$(said 'setsid ssh -o BatchMode=yes -T git@github.com')
case "$sandbox_ssh" in
  *'Host key verification failed'*|*'authenticity of host'*) bad "ssh in the sandbox knows github.com's host key (said: $sandbox_ssh)" ;;
  *'Permission denied'*) ok "ssh in the sandbox gets past github.com's host check, and has no agent to sign in with (ADR-011)" ;;
  *'successfully authenticated'*) bad "ssh in the sandbox signed in: an agent's ssh can reach the person's keys (ADR-011)" ;;
  *) bad "ssh in the sandbox reaches github.com (said: ${sandbox_ssh:-nothing})" ;;
esac
agent_git=$(said "setsid env GIT_TERMINAL_PROMPT=0 git ls-remote '$SSH_REPO' HEAD")
case "$agent_git" in
  *'Permission denied'*) ok "an agent's git over SSH can't sign in with the person's agent (ADR-011)" ;;
  *) bad "an agent's git over SSH can't sign in (said: ${agent_git:-nothing})" ;;
esac
start=$(date +%s)
unknown=$(said 'setsid ssh -o HostKeyAlias=althar-smoke-unknown.invalid -T git@github.com; echo "exit=$?"')
took=$(( $(date +%s) - start ))
case "$unknown" in
  *'althar-smoke-unknown.invalid isn’t one of the code hosts'*exit=255*) [ "$took" -le 20 ] && ok "an unknown host fails in the sandbox in ${took}s, saying why" || bad "an unknown host fails quickly in the sandbox (${took}s)" ;;
  *) bad "an unknown host fails in the sandbox, saying why (said: $unknown)" ;;
esac
start=$(date +%s)
unknown=$(said 'setsid /app/bin/althar-host-ssh -o HostKeyAlias=althar-smoke-unknown.invalid -T git@github.com; echo "exit=$?"')
took=$(( $(date +%s) - start ))
case "$unknown" in
  *'ssh -T althar-smoke-unknown.invalid'*exit=255*) [ "$took" -le 20 ] && ok "an unknown host fails through the device in ${took}s, saying how to trust it" || bad "an unknown host fails quickly through the device (${took}s)" ;;
  *) bad "an unknown host fails through the device, saying how to trust it (said: $unknown)" ;;
esac
device_ssh=$(said 'setsid /app/bin/althar-host-ssh -T git@github.com')
case "$device_ssh" in
  *'successfully authenticated'*)
    ok "Althar's ssh signs in to github.com with the person's agent, through the device"
    # As Althar's runtime runs it (git.ts): the device's ssh, in a task's repository and as the coordinator's copy is made.
    fetched=$(said "setsid sh -c '
      set -e
      export GIT_SSH_COMMAND=/app/bin/althar-host-ssh GIT_SSH_VARIANT=ssh GIT_TERMINAL_PROMPT=0
      at=\"\$XDG_DATA_HOME/althar/.smoke-ssh\"; rm -rf \"\$at\"; mkdir -p \"\$at\"; cd \"\$at\"
      git init -q task && cd task && git remote add origin \"$SSH_REPO\"
      git fetch -q --depth=1 origin && git rev-parse -q --verify FETCH_HEAD >/dev/null && echo task-fetched
      cd .. && git init -q coordinator && cd coordinator && git remote add origin \"$SSH_REPO\"
      git fetch -q --depth=1 origin && git rev-parse -q --verify FETCH_HEAD >/dev/null && echo coordinator-fetched
      cd / && rm -rf \"\$at\"'")
    case "$fetched" in *task-fetched*) ok "git fetch over SSH works in a task's repository" ;; *) bad "git fetch over SSH in a task (said: $fetched)" ;; esac
    case "$fetched" in *coordinator-fetched*) ok "git fetch over SSH works where the coordinator's copy fetches origin" ;; *) bad "git fetch over SSH for the coordinator (said: $fetched)" ;; esac
    ;;
  *'Permission denied'*) echo "SKIP: the device's ssh got past github.com's host check, but its agent has no key GitHub takes; add one (ssh-add) to check signing in and fetching" ;;
  *) bad "Althar's ssh reaches github.com through the device (said: ${device_ssh:-nothing})" ;;
esac

# The bundled Claude Code CLI: flatpak-builder rewrites ELF files (stripping
# and debug-info extraction), which drops the payload a Bun-compiled binary
# keeps at the end of the file — it would run as plain bun, and sign-in and
# sessions would fail. The manifest keeps that off (dev.althar.app.yml).
claude_bin=$(run 'for cli in /app/main/resources/app/node_modules/@anthropic-ai/claude-agent-sdk-*/claude; do printf "%s" "$cli"; break; done')
if [ -n "$claude_bin" ]; then
  said=$(run "$claude_bin --version" | head -1)
  case "$said" in *"Claude Code"*) ok "the bundled Claude Code CLI runs in the sandbox ($said)";; *) bad "the bundled Claude Code CLI runs (said: ${said:-nothing})";; esac
  # What the sign-in line names for a bundled copy: the same CLI, through the app, from a host terminal.
  host_said=$(flatpak run --command="$claude_bin" "$APP" --version 2>/dev/null | head -1)
  case "$host_said" in *"Claude Code"*) ok "the bundled Claude Code CLI runs through the app from a host terminal ($host_said)";; *) bad "the bundled Claude Code CLI through the app";; esac
else
  bad "the bundled Claude Code CLI is installed"
fi

# The app-scoped key is available through Flatpak's default portal proxy on
# supported desktops. The portal is optional: without it the app uses
# safeStorage's keyring-backed session fallback and may ask for sign-in again
# after restart.
portal_version=$(run "gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.DBus.Properties.Get org.freedesktop.portal.Secret version")
case "$portal_version" in
  *uint32\ [1-9]*) ok "the app-specific Secret portal answers from the sandbox ($portal_version)" ;;
  *) echo "SKIP: no Secret portal response; sign-ins use the session keyring fallback and may need renewing after restart" ;;
esac

run 'test -f /app/share/applications/dev.althar.app.desktop && grep -q "StartupWMClass=dev.althar.app" /app/share/applications/dev.althar.app.desktop' && ok "the desktop entry is there, with the right class" || bad "desktop entry"
run 'test -f /app/share/metainfo/dev.althar.app.metainfo.xml && test -f /app/share/icons/hicolor/512x512/apps/dev.althar.app.png' && ok "metainfo and icon are there" || bad "metainfo and icon"

run 'mkdir -p "$XDG_DATA_HOME/althar" && echo kept > "$XDG_DATA_HOME/althar/.smoke"'
run 'grep -q kept "$XDG_DATA_HOME/althar/.smoke" && rm "$XDG_DATA_HOME/althar/.smoke"' && ok "data beside the profile persists across instances" || bad "data persists"

echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
