#!/usr/bin/env bash
# Fills the cask template in with a release's version and the sha256 of each of its dmgs, Apple silicon's (arm64) and
# Intel's (x64), and prints the result.
#   packaging/homebrew/fill.sh <version> <arm64 sha256> <x64 sha256> [template]
# Only those three lines change; everything else in the cask is the template's. Used by .github/workflows/homebrew-tap.yml,
# and by hand to try a release (apps/desktop/README.md, "The Homebrew tap").
set -euo pipefail

usage="usage: fill.sh <version> <arm64 sha256> <x64 sha256> [template]"
version="${1:?$usage}"
arm="${2:?$usage}"
intel="${3:?$usage}"
template="${4:-$(dirname "$0")/althar.rb}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "fill.sh: '$version' is not a plain version (1.2.3)." >&2
  exit 1
fi
for sha256 in "$arm" "$intel"; do
  if ! [[ "$sha256" =~ ^[0-9a-f]{64}$ ]]; then
    echo "fill.sh: '$sha256' is not a sha256 (64 lowercase hex digits)." >&2
    exit 1
  fi
done

out="$(sed -E \
  -e "s/^  version \".*\"$/  version \"$version\"/" \
  -e "s/^  sha256 arm: +\"[0-9a-f]*\",$/  sha256 arm:   \"$arm\",/" \
  -e "s/^ +intel: \"[0-9a-f]*\"$/         intel: \"$intel\"/" \
  "$template")"
if [ "$(grep -c "^  version \"$version\"$" <<< "$out")" != 1 ] ||
  [ "$(grep -c "^  sha256 arm:   \"$arm\",$" <<< "$out")" != 1 ] ||
  [ "$(grep -c "^         intel: \"$intel\"$" <<< "$out")" != 1 ]; then
  echo "fill.sh: $template has no single version, sha256 arm: and intel: line to fill in." >&2
  exit 1
fi
printf '%s\n' "$out"
