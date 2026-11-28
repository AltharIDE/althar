#!/bin/sh
# The Codex an adapter drives, out on the device: the person's own install, or Althar's copy.
# The Flatpak's own sandbox cannot run Codex's sandbox — it needs user
# namespaces, which no Flatpak may make — so Codex runs where its sandbox
# works, on the computer, and Althar speaks to it over flatpak-spawn (the
# manifest's org.freedesktop.Flatpak permission), as it does to the person's
# other own tools. The environment is built here, not inherited: the device
# session's ssh agent and signed-in tools stay out of agents (ADR-011),
# while the account's home, Althar's settings and the names every process
# needs (the device's home, PATH, runtime directory) cross. Told no Codex to
# run, there is nothing to run: that is said, and the session stops.
set -u
# A picked folder's path is the document portal's inside the sandbox; the device has its own form of it.
# The translation is also its own small utility (`--portal-path`), so it can be tested on its own.
portal_path() {
  case "$1" in
    /run/flatpak/doc | /run/flatpak/doc/*) printf '/run/user/%s/doc%s' "$(id -u)" "${1#/run/flatpak/doc}" ;;
    *) printf '%s' "$1" ;;
  esac
}
if [ "${1:-}" = '--portal-path' ]; then
  portal_path "${2:?}"
  exit 0
fi
# A host that cannot be reached at all is said as such; "install Codex" is for a reached device with none.
if ! flatpak-spawn --host true 2>/dev/null; then
  echo 'Althar can’t reach this computer from inside its Flatpak sandbox. Give the Flatpak permission to talk to org.freedesktop.Flatpak (flatpak override --user --talk-name=org.freedesktop.Flatpak dev.althar.app), then try again.' >&2
  exit 1
fi
# The Codex to run, as Althar found and checked it (provider-adapters' registry names it here, as `drivenBy`): the
# person's own on the computer where its adapter can drive it, else the copy Althar downloaded, kept in the Flatpak's own
# data folder, which the computer sees at the same path. Never one of this bridge's own finding: one Althar passed over
# (a version its adapter can't drive) never runs, and with none named Althar downloads its own at the first start.
codex="${ALTHAR_CODEX_PROGRAM:-}"
if [ -z "$codex" ]; then
  echo 'Codex isn’t on this computer yet. Download it in Settings › Agents, or install Codex there, then try again.' >&2
  exit 1
fi
# The device's own session, so Codex starts where its configuration lives.
session="$(flatpak-spawn --host sh -c 'printf "%s\n" "$HOME" "$PATH"')"
home="$(printf '%s\n' "$session" | sed -n 1p)"
path="$(printf '%s\n' "$session" | sed -n 2p)"
# The working directory the adapter started in, as the device sees it.
cwd="$(portal_path "$(pwd -P)")"
# A linked worktree's .git file points to its common repository on the
# sandbox-side portal path. Give Git the host-visible paths explicitly; the
# host process must not try to resolve the portal's sandbox-only spelling.
git_dir=''
if [ -f .git ]; then
  IFS= read -r git_pointer < .git || true
  case "$git_pointer" in
    'gitdir: '*)
      git_pointer=${git_pointer#gitdir: }
      case "$git_pointer" in
        /*) git_dir="$git_pointer" ;;
        *) git_dir="$(pwd -P)/$git_pointer" ;;
      esac
      git_dir="$(portal_path "$git_dir")"
      ;;
  esac
fi
set -- "$codex" "$@"
# What the account and Althar set for the agent, by name, whether or not the value is empty:
# an empty GIT_CONFIG_VALUE_0 is what unsets git's credential helper.
for name in CODEX_HOME CODEX_CONFIG GH_CONFIG_DIR GLAB_CONFIG_DIR GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_KEY_1 GIT_CONFIG_VALUE_1 GIT_CONFIG_KEY_2 GIT_CONFIG_VALUE_2 GIT_TERMINAL_PROMPT ANTHROPIC_BASE_URL OPENAI_BASE_URL; do
  if value="$(printenv "$name" 2>/dev/null)"; then set -- "--env=$name=$value" "$@"; fi
done
if [ -n "$git_dir" ]; then
  set -- "--env=GIT_DIR=$git_dir" "--env=GIT_WORK_TREE=$cwd" "$@"
fi
set -- --directory="$cwd" --unset-env=SSH_AUTH_SOCK --env="XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  --env="PATH=${path:-/usr/bin:/bin}" --env="HOME=${home:-/home/$(id -un)}" --clear-env --host --watch-bus "$@"
exec flatpak-spawn "$@"
