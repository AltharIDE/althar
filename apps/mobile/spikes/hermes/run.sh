#!/usr/bin/env bash
# Reruns the spike: bundles with Metro (as `expo export` would, for Hermes),
# compiles with the hermesc React Native 0.88 ships, and runs the bytecode on
# a Hermes VM built from the same Hermes tag; then runs the same bundles on Node.
#   ./run.sh            # build Hermes if missing, bundle, run everything
#   SKIP_BUILD=1 ./run.sh
set -u
cd "$(dirname "$0")"
SPIKE=$PWD
MOBILE=$(cd "$SPIKE/../.." && pwd)/node_modules
HERMESC=$MOBILE/hermes-compiler/hermesc/linux64-bin/hermesc
HERMES=$SPIKE/vendor/hermes-build/bin/hermes
TAG=hermes-v$(sed -n 's/^HERMES_VERSION_NAME=//p' $MOBILE/react-native/sdks/hermes-engine/version.properties)

if [ ! -x "$HERMES" ]; then
  echo "== building the Hermes VM CLI at $TAG (about 5 minutes on 4 cores)"
  mkdir -p vendor/debs vendor/icu
  [ -d vendor/hermes-src ] || git clone --depth 1 --branch "$TAG" https://github.com/facebook/hermes vendor/hermes-src
  if [ ! -d vendor/icu/usr/include/unicode ]; then
    # Hermes needs ICU's headers; the system has the libraries (libicu74) but not libicu-dev.
    curl -fsSL -o vendor/debs/libicu-dev.deb http://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu-dev_74.2-1ubuntu3.1_amd64.deb
    dpkg -x vendor/debs/libicu-dev.deb vendor/icu
  fi
  L=/usr/lib/x86_64-linux-gnu
  cmake -S vendor/hermes-src -B vendor/hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DICU_ROOT=$SPIKE/vendor/icu/usr -DICU_INCLUDE_DIR=$SPIKE/vendor/icu/usr/include \
    -DICU_UC_LIBRARY_RELEASE=$L/libicuuc.so.74 -DICU_I18N_LIBRARY_RELEASE=$L/libicui18n.so.74 -DICU_DATA_LIBRARY_RELEASE=$L/libicudata.so.74 \
    > vendor/cmake-configure.log
  ninja -C vendor/hermes-build -j"$(nproc)" hermes > vendor/ninja-build.log || { tail -20 vendor/ninja-build.log; exit 1; }
fi
echo "== hermesc (RN 0.88's hermes-compiler $(node -p "require('$MOBILE/hermes-compiler/package.json').version")):"; $HERMESC --version | grep -i 'version'
echo "== hermes VM ($TAG, built from source):"; $HERMES --version | grep -i 'version'

mkdir -p out
bundle() { # entry name preset
  node build.cjs "src/$1" "out/$2.js" "$3" || exit 1
  "$HERMESC" -emit-binary -O -max-diagnostic-width=80 -w -out "out/$2.hbc" "out/$2.js" || { echo "hermesc failed on out/$2.js"; exit 1; }
}
run_hermes() { echo; echo "######## Hermes: $1"; timeout 120 "$HERMES" "out/$1.hbc" 2>&1; echo "(exit $?)"; }
run_node() { echo; echo "######## Node $(node --version): $1"; timeout 120 node "out/$1.js" 2>&1; echo "(exit $?)"; }

if [ "${SKIP_BUILD:-0}" != 1 ]; then
  bundle entry.js bundle expo
  echo "== @react-native/babel-preset alone (expected to fail on effect's export * as):"
  node build.cjs src/entry.js out/bundle-rnplain.js rn-plain 2>&1 | grep -m1 -o 'TransformError.*' || echo "(it bundled)"
  bundle entry.js bundle-rnpreset rn
  MINIFY=1 bundle entry.js bundle-minified expo
  bundle entry-timers.js bundle-timers expo
  bundle entry-bare.js bundle-bare expo
  ls -la out/*.js out/*.hbc
fi

echo; echo "######## globals the bare Hermes CLI has"; "$HERMES" probe-globals.js | tr '\n' ' '; echo
run_hermes bundle          # babel-preset-expo (what the app uses), RN's globals provided
run_hermes bundle-rnpreset # @react-native/babel-preset instead
run_hermes bundle-minified # babel-preset-expo, then terser, then hermesc
run_hermes bundle-timers   # only the CLI's timers fixed: which RN globals does Effect need?
run_hermes bundle-bare     # the CLI as it is
run_node bundle            # control

if [ "${EXPERIMENTS:-0}" = 1 ]; then
  echo; echo "######## experiments: one RN global left out at a time, the CLI's setImmediate plus a clearImmediate, and two copies of Effect"
  for e in without-queueMicrotask without-setInterval without-AbortController without-setImmediate cli-plus-clearImmediate; do
    bundle "experiments/$e.js" "$e" expo >/dev/null
    printf '%-28s ' "$e"; timeout 120 "$HERMES" "out/$e.hbc" 2>&1 | grep '^=='
  done
  TWO_EFFECTS=1 bundle entry.js two-effects expo
  printf '%-28s ' "two copies of effect"; timeout 120 "$HERMES" out/two-effects.hbc 2>&1 | grep '^FAIL\|^==' | tr '\n' ' '; echo
fi
