#!/bin/sh
# What a worker's release ships for its agents' sandbox beside what Codex's own package carries (bubblewrap, ripgrep):
# socat, which Claude Code's sandbox needs on Linux, built static from its pinned source in a pinned Alpine (musl), for
# this runner's processor. Into $1/bin, its licence into $1/licenses. The release workflow runs it on each processor's
# own runner (.github/workflows/host-release.yml); package-release takes the folder (ALTHAR_WORKER_TOOLS).
set -eu
[ "$#" -eq 1 ] || { echo "Usage: $0 <output-folder>" >&2; exit 64; }
out=$1
version=1.8.1.3
sha256=06602ffd591e98c75b3dc1d66f0f19136cc666b0b2d95caad987d6ab2cb28097
image=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
mkdir -p "$out/bin" "$out/licenses"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Its maker serves it over plain HTTP only: the pinned digest is what vouches for it.
curl --fail --silent --show-error --location --output "$work/socat.tar.gz" \
  "http://www.dest-unreach.org/socat/download/socat-$version.tar.gz"
printf '%s  %s\n' "$sha256" "$work/socat.tar.gz" | sha256sum -c -
docker run --rm -e OWNER="$(id -u):$(id -g)" -e VERSION="$version" -v "$work:/work" -w /work "$image" sh -euc '
  apk add --no-cache build-base linux-headers >/dev/null
  tar -xzf socat.tar.gz
  cd "socat-$VERSION"
  ./configure --disable-openssl --disable-readline --disable-libwrap --disable-fips LDFLAGS=-static >/dev/null
  make -j"$(nproc)" socat >/dev/null
  strip socat
  cp socat COPYING /work/
  chown -R "$OWNER" /work
'
cp "$work/socat" "$out/bin/socat"
cp "$work/COPYING" "$out/licenses/socat-COPYING"
chmod 0755 "$out/bin/socat"
file "$out/bin/socat" | grep -Eq 'static(-pie)? linked|statically linked' || { echo 'socat is not static' >&2; exit 1; }
"$out/bin/socat" -V | head -n 2
