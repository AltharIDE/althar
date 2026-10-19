#!/bin/bash
# The Windows smoke test: installs the NSIS installer bun run package made, as
# a person would but silently, and checks what it put where: for the person
# alone (their own folders and registry, with no administrator's prompt), a
# Start menu entry and an uninstaller, the updater's settings, and the Node,
# Codex, Claude Code and speech engine the app runs, each run once. Then it
# opens Althar on a profile of its own until its runtime is ready, and
# uninstalls it. Run in Git Bash, from apps/desktop, after bun run package:
#
#   bash scripts/windows-smoke.sh
#
# It says nothing of signing in, a task, dictation or updating, which need a
# person at a Windows machine.
set -u
cd "$(dirname "$0")/.." || exit 1

pass=0; fail=0
ok() { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
wait_for() { for _ in $(seq 1 120); do eval "$1" && return 0; sleep 1; done; return 1; }

version=$(node -p "require('./package.json').version")
installer="out/dist/Althar-$version-x64-setup.exe"
dir="$(cygpath -u "$LOCALAPPDATA")/Programs/althar"
menu="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Althar.lnk"
modules="$dir/resources/app/node_modules"
uninstall_key='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall'

[ -f "$installer" ] || { echo "No $installer: run bun run package first."; exit 1; }
echo "Installing $installer"
# /S: silently. Per user, it asks for no elevation; one that did would hang here, with no one to say yes, until the job's timeout.
# Git Bash would turn /S into a Windows path (C:/Program Files/Git/S) on its way to a Windows program, so it is passed as is.
MSYS_NO_PATHCONV=1 "$installer" /S
if wait_for '[ -f "$dir/Althar.exe" ] && [ -f "$dir/Uninstall Althar.exe" ]'; then ok "installed in $dir, with its uninstaller"; else bad "nothing installed in $dir"; fi
[ -f "$menu" ] && ok "Start menu entry" || bad "no Start menu entry at $menu"
if MSYS_NO_PATHCONV=1 reg query "$uninstall_key" /s /f Althar /d | grep -q DisplayName; then
  ok "in the person's own Apps list (HKCU)"
else
  bad "no uninstall entry under $uninstall_key"
fi
grep -q 'provider: github' "$dir/resources/app-update.yml" 2>/dev/null && ok "the updater reads GitHub Releases" || bad "no app-update.yml naming GitHub"

node="$dir/resources/node/bin/node.exe"
said=$("$node" --version 2>&1) && ok "Node $said" || bad "node.exe doesn't run: $said"
codex="$modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"
said=$("$codex" --version 2>&1) && ok "Codex: $said" || bad "codex.exe doesn't run: $said"
claude="$modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe"
said=$("$claude" --version 2>&1) && ok "Claude Code: $said" || bad "claude.exe doesn't run: $said"
# The speech engine's addon is Node-API, so the app's Node loads it as Electron's utility process does.
said=$("$node" -e "if (typeof require(process.argv[1]).OfflineRecognizer !== 'function') process.exit(1)" "$(cygpath -w "$modules/sherpa-onnx-node")" 2>&1) \
  && ok "the speech engine loads" || bad "sherpa-onnx doesn't load: $said"
for adapter in @agentclientprotocol/claude-agent-acp @agentclientprotocol/codex-acp; do
  [ -f "$modules/$adapter/package.json" ] && ok "$adapter" || bad "no $adapter"
done

# Althar itself, on a profile of its own, until its runtime says it is ready: it has loaded, opened its store and started its
# services in Electron's utility process, on the shipped modules. The main process's "Runtime started" comes before any of that.
profile="$(cygpath -u "${RUNNER_TEMP:-$TEMP}")/althar-smoke-profile"
rm -rf "$profile"
ALTHAR_PROFILE="$(cygpath -w "$profile")" ALTHAR_WORKTREES="$(cygpath -w "$profile/worktrees")" "$dir/Althar.exe" &
if wait_for 'grep -qs "Runtime ready" "$profile"/logs/runtime.log'; then ok "Althar opens and its runtime is ready"; else bad "Althar's runtime didn't get ready"; fi
cat "$profile"/logs/* 2>/dev/null | tail -n 40
MSYS_NO_PATHCONV=1 taskkill /IM Althar.exe /T /F >/dev/null 2>&1
wait_for '! tasklist | grep -qi althar.exe' || true

echo "Uninstalling"
MSYS_NO_PATHCONV=1 "$dir/Uninstall Althar.exe" /S
# The uninstaller copies itself away and returns at once, so its work is waited for.
if wait_for '[ ! -f "$dir/Althar.exe" ]'; then ok "uninstalled"; else bad "Althar.exe is still in $dir"; fi
# The shortcut goes after the program's files, so it too is waited for.
if wait_for '[ ! -f "$menu" ]'; then ok "Start menu entry removed"; else bad "the Start menu entry stayed"; fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
