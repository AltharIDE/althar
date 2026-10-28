# ADR-028: Linux windows, packages and the keyring

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** Althar was a Mac app. Off a Mac it has no system title bar and
  no system menu bar, several ways to install exist, Linux sign-ins need a
  keyring Electron does not always find, and a Flatpak grants the app a broad
  host bridge (ADR-027). The window's chrome, the
  packages, the keyring and the sandbox are decided here together, since they
  meet on the same screens.
- **Decision:**
  - **Its own window chrome, and its own buttons.** Off a Mac the window is
    frameless; the tabs' strip is the title bar. The buttons close, minimize
    and maximize or restore the window through the preload and the main
    process, in one `WindowButtons` primitive: at rest the same grey dots a
    Mac shows, with glyphs and colours on hover, focus or focus-within, so
    they never say what they do by colour alone. The screens that have no
    tabs above them — the first screen, a project being formed, and the
    window that couldn't open — carry the same buttons in their own bar.
  - **A trimmed menu, for its accelerators.** Electron draws the application
    menu's bar at the top of every off-Mac window, frameless or not, so the app
    hides the bar on each window and keeps the menu for its roles: the only
    text zoom there is, full screen, and quit, with reload and devtools while
    developing. macOS keeps its system menu bar.
  - **AppImage, deb and rpm from one build,** made by `bun run package` on
    Linux only, with a keyring Recommends on the deb and the rpm. Publishing
    runs from a version tag: the tag must be `v<apps/desktop's version>`. The
    release workflow builds its Linux artifacts once and adds them to the
    shared draft release; the pull-request workflow checks package creation.
  - **Windows gets the same chrome and an NSIS installer** (DEV-78). The
    frameless window, its buttons and the trimmed menu are the same off any
    Mac. `bun run package` on Windows makes a per-user installer for x64,
    with latest.yml for its updates, unsigned for now (ADR-024); its keyring
    is Windows' own (DPAPI), which Electron always finds.
  - **The keyring, refused loudly, and asked for where it is hidden.**
    `basic_text` — Electron's plain-text fallback — is refused with an
    allow-list of real backends (`gnome_libsecret`, `kwallet*`), so anything
    unknown fails closed too. Where Electron would pick plain text because it
    doesn't recognise the desktop (sway, i3, Hyprland, COSMIC and others),
    the app asks for `--password-store=gnome-libsecret` before it is ready:
    libsecret speaks the Secret Service API, which gnome-keyring, KeePassXC
    and KWallet all serve. A `--password-store` the person chose themselves
    is left alone, and in a Flatpak the app asks for it on every desktop to
    avoid Electron's plain-text choice where its desktop detection differs.
    The refusal's words are the only secret error shown verbatim; everything
    else of the keychain's gets the generic sentence. A sealed sign-in the
    keychain can no longer open (`decryptString` throws) is not the keychain
    being away: main marks it `unreadable`, the runtime doesn't ask again, and
    the connection says it needs signing in again, like one its service refused.
    In a Flatpak whose sealing key changes at every start that is what a
    restart does (open questions, "The Flatpak's keyring").
  - **The Flatpak is experimental.** It carries the app and the toolchain for
    its own work with network, display, GPU, the keyring and the device's own
    tools through the broad `flatpak-spawn` permission (ADR-027); its worktrees live
    beside its profile, and `scripts/flatpak-smoke.sh` checks its own
    environment. It is called experimental until a whole task has been run
    under GNOME and KDE.
  - **A Flatpak prefers Chromium's app-specific Secret portal key on every
    Linux desktop, including KDE.** The main process enables
    `SecretPortalKeyProviderUseForEncryption` and accepts only Chromium's
    `v12` format. The portal returns a stable master secret scoped to the
    Flatpak application id; Chromium derives its AES-GCM key from it. The
    default Flatpak portal proxy exposes `org.freedesktop.portal.Secret`, so
    the manifest does not need to grant that bus name. It keeps
    `org.freedesktop.secrets` only for a safe synchronous fallback. This makes
    the normal GNOME and KDE paths app-specific and avoids KWallet's shared
    `Chromium Safe Storage` item.
  - **When the portal is missing, keep the old safe session behavior.** The
    async safeStorage API can report itself available while sealing with the
    shared Secret Service (`v11`) or Chromium's fixed `v10` key, so Althar
    never saves either of those async results. It then tries synchronous
    safeStorage only if `isEncryptionAvailable()` is true,
    `keyringIsSafe()` allows the selected backend, and the selected backend
    is libsecret's sandbox-local `gnome_libsecret` file; it accepts only the
    sync `v11` result, which Chromium makes with a key from the keyring.
    `v10` is its fixed key, used when the keyring gave no password, and is
    refused. We keep this fallback, rather than failing closed without the
    portal, so a sign-in still works for the session. That key may not be found after restart, so the
    person may need to sign in again. On a Linux machine without a safe
    keyring, or with `basic_text`, sealing still fails closed. Existing portal
    seals remain on disk; a prior KDE/KWallet seal may require signing in once
    again after this change. No profile or keyring data is removed.
    `packages/runtime/src/Secrets.ts` still transports opaque base64 seals;
    the runtime never receives a key.
  - **Rollout order:** #207 replaces the standalone KDE/KWallet fix of #201,
    which is closed; do not land #201, since it would restore a second KDE
    sealing path.
- **Alternatives considered:** keeping the menu's bar visible on Linux (it
  would sit above the strip's own chrome, and a framed window gives that up);
  publishing on every main push (tagged releases are what people install, and
  a rebuild could ship what verify never saw); accepting `basic_text` (a token
  in plain text); keeping a deny-list for backends (a later Electron's name
  would silently pass); storing with Chromium's async shared Secret Service
  provider (`v11`, which other apps on that service can use); and failing
  entirely when no portal is installed (the synchronous keyring path keeps
  same-session use without claiming restart persistence).
- **Trade-off:** the buttons and the strip are more code than the system's
  chrome, and the Flatpak ships unfinished — its own README says so. Without a
  Secret portal, a sign-in sealed by synchronous safeStorage may need to be
  entered again after restart. The actual portal restart behavior is not yet
  verified on GNOME or KDE.
- **Evidence reviewed 2026-10-15:** libsecret 0.21.7's
  [backend selector](https://github.com/GNOME/libsecret/blob/0.21.7/libsecret/secret-backend.c)
  checks for Flatpak and a Secret portal before consulting `SECRET_BACKEND`,
  then chooses its
  [local file backend](https://github.com/GNOME/libsecret/blob/0.21.7/libsecret/secret-file-backend.c).
  This explains the old key rotation: libsecret writes the Safe Storage item
  to the app-local keyring file, while Chromium's
  [Secret Service provider](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc)
  searches the host's `org.freedesktop.secrets` service. That service cannot
  see libsecret's app-local collection, so Chromium finds no item and creates
  a new key on the next launch. Setting `SECRET_BACKEND=service` cannot align
  the stores because the Flatpak file backend is selected before that
  variable is read.
  GNOME's
  [portal configuration](https://flatpak.github.io/xdg-desktop-portal/docs/configuration-file.html)
  selects the GNOME Keyring backend. The [Secret portal contract](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Secret.html)
  specifies a stable master secret per application id. Electron 44.5.0
  (Chromium 152) includes async safeStorage; Chromium's
  [Secret portal provider](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/components/os_crypt/async/browser/secret_portal_key_provider.cc)
  derives the `v12` key, and its
  [Secret Service provider](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc)
  uses shared `v11`. Electron's
  [safeStorage source](https://github.com/electron/electron/blob/v44.5.0/shell/browser/api/electron_api_safe_storage.cc)
  wires the async methods. As dated comparisons, the Flathub manifests for
  [Mailspring](https://github.com/flathub/com.getmailspring.Mailspring/blob/master/com.getmailspring.Mailspring.yml),
  [Obsidian](https://github.com/flathub/md.obsidian.Obsidian/blob/master/md.obsidian.Obsidian.yml)
  and [Visual Studio Code](https://github.com/flathub/com.visualstudio.code/blob/master/com.visualstudio.code.yaml),
  viewed 2026-10-15, grant `org.freedesktop.secrets`; Obsidian and VS Code
  also grant KWallet bus names. Those common permissions do not align
  libsecret's app-local file with Chromium's host lookup or make the key
  app-specific.
- **GNOME manual restart test (not run in this task):** In a GNOME session or
  GNOME VM, build with `apps/desktop/scripts/flatpak.sh`, launch
  `flatpak run dev.althar.app`, and sign in to GitHub. Then run
  `flatpak kill dev.althar.app` and restart with
  `flatpak run dev.althar.app --enable-logging=stderr --v=1 2>&1 | grep -E 'OSCrypt|Secret|libsecret'`.
  GitHub should still be connected, and the second start should not log
  `OSCrypt generated a new password`. If it prompts once after upgrading,
  sign in again to replace the previous seal and repeat the kill/restart. If
  it prompts again, check that GNOME Keyring's Secret portal backend is
  installed and selected. Do not delete profile or keyring data; report
  whether the portal version check in `apps/desktop/scripts/flatpak-smoke.sh`
  answers.
- **Revisit when:** a whole task has run under GNOME and KDE (the Flatpak
  stops being experimental); Electron recognises the remaining desktops
  itself; or the app gains a real updater and the packages stop being the
  install story.
