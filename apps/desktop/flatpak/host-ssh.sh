#!/bin/sh
# The ssh Althar's own git runs inside its Flatpak (GIT_SSH_COMMAND, set by
# packages/runtime's git.ts for Althar's fetches and pushes only): the device's
# ssh, over flatpak-spawn, so the person's SSH agent, keys, ~/.ssh/config and
# ~/.ssh/known_hosts sign it in and check the host as a terminal's would, and
# none of them enters the sandbox (docs/decisions/061). git's pack protocol
# goes through stdin and stdout, which flatpak-spawn hands over as they are.
# Nothing asks: BatchMode, no askpass, no new host key accepted, a short
# ConnectTimeout. The code hosts Althar pins count there too, read from the
# app's own files as the device sees them. Agents never run this: they don't
# inherit GIT_SSH_COMMAND, and their rules refuse it by name (rules.ts).
set -u
# Where the device sees /app: the Flatpak's own record of this instance.
info="${ALTHAR_FLATPAK_INFO:-/.flatpak-info}"
app="$(sed -n 's/^app-path=//p' "$info" 2>/dev/null | head -n 1)"
known='/etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2'
if [ -n "$app" ]; then known="$known \"$app/share/althar/ssh/known_hosts\""; fi
if ! flatpak-spawn --host true 2>/dev/null; then
  echo 'Althar can’t reach this computer from inside its Flatpak sandbox, so it can’t use your SSH agent. Give the Flatpak permission to talk to org.freedesktop.Flatpak (flatpak override --user --talk-name=org.freedesktop.Flatpak dev.althar.app), then try again.' >&2
  exit 255
fi
said="$(mktemp)" || exit 255
trap 'rm -f "$said"' EXIT
trap 'rm -f "$said"; exit 143' HUP INT TERM
# The device's session, not the sandbox's, so its SSH_AUTH_SOCK is the agent's.
# Where the session leaves it out, the usual sockets in the runtime directory:
# systemd's ssh-agent, GNOME's gcr and gnome-keyring. git's protocol version
# crosses by name. The command starts in / : the sandbox's folder may be one
# only the sandbox has.
set -- -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o "GlobalKnownHostsFile=$known" "$@"
script='
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
  for socket in "${XDG_RUNTIME_DIR:-}/ssh-agent.socket" "${XDG_RUNTIME_DIR:-}/gcr/ssh" "${XDG_RUNTIME_DIR:-}/keyring/ssh"; do
    if [ -S "$socket" ]; then SSH_AUTH_SOCK="$socket"; export SSH_AUTH_SOCK; break; fi
  done
fi
exec ssh "$@"'
protocol=''
if [ -n "${GIT_PROTOCOL:-}" ]; then protocol="--env=GIT_PROTOCOL=$GIT_PROTOCOL"; fi
flatpak-spawn --host --watch-bus --directory=/ --env=SSH_ASKPASS_REQUIRE=never ${protocol:+"$protocol"} \
  sh -c "$script" ssh "$@" 2>"$said"
code=$?
cat "$said" >&2
host="$(sed -n 's/^No .* host key is known for \(.*\) and you have requested strict checking\.\r*$/\1/p' "$said" | head -n 1)"
if [ "$code" -eq 255 ] && [ -n "$host" ]; then
  echo "Althar: $host’s SSH host key isn’t one Althar trusts by default, nor in your ~/.ssh/known_hosts, and Althar never accepts a new one by itself. Check it and accept it once from a terminal on this computer (ssh -T $host), then try again." >&2
fi
exit "$code"
