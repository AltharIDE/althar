#!/usr/bin/env bash
set -euo pipefail
preview=$(cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(cd -- "$preview/../../.." && pwd -P)
if [[ $# != 1 || "$1" != /* || -e "$1" ]]; then
  echo "Usage: $0 <new absolute output directory>" >&2
  exit 2
fi
output=$1
mkdir -m 0755 -- "$output"
(
  cd "$repo"
  cargo build --locked --release -p althar-worker --bin althar-worker
)
# The host's release carries node-pty built for this machine. Linux has no prebuild of it, and an install that skipped
# its script (as CI's does) left it uncompiled, so compile it here, with the host's own locked node-gyp.
pty=$(cd "$repo/apps/host" && node -p 'require("path").dirname(require.resolve("node-pty/package.json"))')
gyp=$(cd "$repo/apps/host" && node -p 'require.resolve("node-gyp/bin/node-gyp.js")')
own=$(node -p 'process.platform + "-" + process.arch')
if [[ ! -e "$pty/build/Release/pty.node" && ! -e "$pty/prebuilds/$own/pty.node" ]]; then
  (cd "$pty" && node "$gyp" rebuild)
fi
target=$(cd "$repo" && cargo metadata --no-deps --format-version 1 | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory')
(
  cd "$repo/apps/host"
  ALTHAR_HOST_PREVIEW_DIRECTORY="$output/host" bun run release:smoke
)
install -m 0755 "$target/release/althar-worker" "$output/althar-worker"
install -m 0755 "$preview/althar-host" "$preview/demo" "$output"
install -m 0644 "$preview/demo.mjs" "$preview/README.md" "$output"
install -m 0644 "$repo/LICENSE" "$output/LICENSE"
platform=$(rustc -vV | sed -n 's/^host: //p')
(
  cd "$repo"
  cargo metadata --locked --filter-platform "$platform" --format-version 1
) | node "$preview/notices.mjs" "$output"
