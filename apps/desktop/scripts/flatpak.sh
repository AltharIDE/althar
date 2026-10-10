#!/bin/bash
# Builds the Flatpak from the electron-builder output and installs it for the
# user. The first run fetches the runtime, SDK and Electron base (~1.5 GB).
set -euo pipefail
cd "$(dirname "$0")/.."

flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo
if ! flatpak info --user org.freedesktop.Platform//24.08 >/dev/null 2>&1; then
  flatpak install --user -y --noninteractive flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 org.electronjs.Electron2.BaseApp//24.08
fi

bun run package
flatpak-builder --user --force-clean --install out/flatpak-build flatpak/dev.althar.app.yml

echo
echo "installed; run it with: flatpak run dev.althar.app"
