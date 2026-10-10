#!/bin/sh
# The Codex an adapter drives, out on the device: the person's own install.
# The Flatpak's own sandbox cannot run Codex's sandbox — it needs user
# namespaces, which no Flatpak may make — so Codex runs where its sandbox
# works, on the computer, and Althar speaks to it over flatpak-spawn (the
# manifest's org.freedesktop.Flatpak permission), as it does to the person's
# other own tools. The environment is built here, not inherited: the device
# session's ssh agent and signed-in tools stay out of agents (ADR-011),
# while the account's home, Althar's settings and the names every process
# needs (the device's home, PATH, runtime directory) cross. Without Codex on
# the computer there is nothing to run: that is said, and the session stops.
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
# The usual install places too, as the device lookup names them (`onDevice.ts`'s
# `whereScript`, from provider-adapters' `usualDirs`): a person's Codex may be
# somewhere their session PATH doesn't have.
codex="$(flatpak-spawn --host sh -c '
  found="$(command -v codex 2>/dev/null || true)"
  if [ -z "$found" ]; then
    for dir in "/home/linuxbrew/.linuxbrew/bin" "/usr/local/bin" "$HOME/.local/bin" "$HOME/.opencode/bin" "$HOME/.bun/bin"; do
      if [ -x "$dir/codex" ]; then found="$dir/codex"; break; fi
    done
  fi
  printf "%s" "$found"
' 2>/dev/null)" || true
if [ -z "$codex" ]; then
  echo 'Codex has to be installed on this computer for Althar to run it in its Flatpak. Install Codex there, then try again.' >&2
  exit 1
fi
# The device's own session, so Codex starts where its configuration lives.
session="$(flatpak-spawn --host sh -c 'printf "%s\n" "$HOME" "$PATH"')"
home="$(printf '%s\n' "$session" | sed -n 1p)"
path="$(printf '%s\n' "$session" | sed -n 2p)"
# The working directory the adapter started in, as the device sees it.
cwd="$(portal_path "$(pwd -P)")"
set -- "$codex" "$@"
# What the account and Althar set for the agent, by name, whether or not the value is empty:
# an empty GIT_CONFIG_VALUE_0 is what unsets git's credential helper.
for name in CODEX_HOME CODEX_CONFIG GH_CONFIG_DIR GLAB_CONFIG_DIR GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_TERMINAL_PROMPT; do
  if value="$(printenv "$name" 2>/dev/null)"; then set -- "--env=$name=$value" "$@"; fi
done
set -- --directory="$cwd" --unset-env=SSH_AUTH_SOCK --env="XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  --env="PATH=${path:-/usr/bin:/bin}" --env="HOME=${home:-/home/$(id -un)}" --clear-env --host --watch-bus "$@"
exec flatpak-spawn "$@"
