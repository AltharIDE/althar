#!/bin/sh
# ssh inside Althar's Flatpak, first on its PATH, so git and anything an agent
# runs get it (docs/decisions/061). The sandbox has no ~/.ssh and no SSH agent,
# and nothing in it can answer a question: it trusts the code hosts Althar
# pins (known_hosts, beside it under /app/share), never asks (no askpass, no
# terminal question, nothing added to a known_hosts file), and gives up on a
# host that doesn't answer. Althar's own git runs the device's ssh instead
# (host-ssh.sh), which signs in with the person's agent.
set -u
self="$(cd "$(dirname "$0")" && pwd -P)"
pinned="$(cd "$self/.." && pwd -P)/share/althar/ssh/known_hosts"
# The runtime's own ssh: the next one on PATH after this.
real=''
saved_ifs=$IFS
IFS=:
for dir in $PATH; do
  if [ -n "$dir" ] && [ -x "$dir/ssh" ] && [ "$(cd "$dir" 2>/dev/null && pwd -P)" != "$self" ]; then
    real="$dir/ssh"
    break
  fi
done
IFS=$saved_ifs
if [ -z "$real" ]; then
  echo 'There is no ssh in Althar’s Flatpak sandbox.' >&2
  exit 255
fi
# What ssh says is shown once it ends, so a host it didn't know can be explained.
said="$(mktemp)" || exit 255
trap 'rm -f "$said"' EXIT
trap 'rm -f "$said"; exit 143' HUP INT TERM
SSH_ASKPASS_REQUIRE=never "$real" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  -o UserKnownHostsFile=/dev/null -o "GlobalKnownHostsFile=$pinned" "$@" 2>"$said"
code=$?
cat "$said" >&2
host="$(sed -n 's/^No .* host key is known for \(.*\) and you have requested strict checking\.\r*$/\1/p' "$said" | head -n 1)"
if [ "$code" -eq 255 ] && [ -n "$host" ]; then
  echo "Althar: $host isn’t one of the code hosts Althar trusts by default, and ssh in Althar’s Flatpak doesn’t ask about a new one. Althar’s own fetches and pushes go through this computer’s ssh, which also trusts the hosts in your ~/.ssh/known_hosts." >&2
fi
exit "$code"
