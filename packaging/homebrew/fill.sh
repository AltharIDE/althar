#!/usr/bin/env bash
# Fills the cask template in with a release's version and the sha256 of its arm64 dmg, and prints the result.
#   packaging/homebrew/fill.sh <version> <sha256> [template]
# Only those two lines change; everything else in the cask is the template's. Used by .github/workflows/homebrew-tap.yml,
# and by hand to try a release (apps/desktop/README.md, "The Homebrew tap").
set -euo pipefail

version="${1:?usage: fill.sh <version> <sha256> [template]}"
sha256="${2:?usage: fill.sh <version> <sha256> [template]}"
template="${3:-$(dirname "$0")/althar.rb}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "fill.sh: '$version' is not a plain version (1.2.3)." >&2
  exit 1
fi
if ! [[ "$sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "fill.sh: '$sha256' is not a sha256 (64 lowercase hex digits)." >&2
  exit 1
fi

out="$(sed -E -e "s/^  version \".*\"$/  version \"$version\"/" -e "s/^  sha256 \".*\"$/  sha256 \"$sha256\"/" "$template")"
if [ "$(grep -c "^  version \"$version\"$" <<< "$out")" != 1 ] || [ "$(grep -c "^  sha256 \"$sha256\"$" <<< "$out")" != 1 ]; then
  echo "fill.sh: $template has no single version and sha256 line to fill in." >&2
  exit 1
fi
printf '%s\n' "$out"
