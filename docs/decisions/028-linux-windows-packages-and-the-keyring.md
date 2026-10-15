# ADR-028: Linux windows, packages and the keyring

- **Status:** Accepted
- **Date:** 2026-10-15
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
  - **The keyring, refused loudly, and asked for where it is hidden.**
    `basic_text` — Electron's plain-text fallback — is refused with an
    allow-list of real backends (`gnome_libsecret`, `kwallet*`), so anything
    unknown fails closed too. Where Electron would pick plain text because it
    doesn't recognise the desktop (sway, i3, Hyprland, COSMIC and others),
    the app asks for `--password-store=gnome-libsecret` before it is ready:
    libsecret speaks the Secret Service API, which gnome-keyring, KeePassXC
    and KWallet all serve. A `--password-store` the person chose themselves
    is left alone, and in a Flatpak it is asked for on every desktop but KDE
    (where sign-ins are sealed with the Secret portal's key, below).
    The refusal's words are the only secret error shown verbatim; everything
    else of the keychain's gets the generic sentence.
  - **The Flatpak is experimental.** It carries the app and the toolchain for
    its own work with network, display, GPU, the keyring and the device's own
    tools through the broad `flatpak-spawn` permission (ADR-027); its worktrees live
    beside its profile, and `scripts/flatpak-smoke.sh` checks its own
    environment. It is called experimental until a whole task has been run
    under GNOME and KDE.
  - **A Flatpak on KDE keeps its key in KWallet itself.** When the Secret
    portal is available, libsecret inside a sandbox stores in a keyring file
    of the app's own (`$XDG_DATA_HOME/keyrings/default.keyring`), while
    Chromium's synchronous backend looks up the item on the host's Secret
    Service and does not see that file. So on KDE the app asks for
    `--password-store=kwallet6` (`kwallet5` when `KDE_SESSION_VERSION` is 5),
    and the manifest lets it talk to `org.kde.kwalletd6` and
    `org.kde.kwalletd5`, no more (ADR-027). Chromium keeps the key in the
    host's network wallet (`kdewallet` by default), folder `Chromium Keys`,
    entry `Chromium Safe Storage`; it only makes one where that entry is empty,
    and never overwrites one. KWallet asks for the wallet's password if the
    wallet is closed, and asks to let Althar in if its "prompt when an
    application accesses a wallet" setting is on. Refused, closed or away,
    `isEncryptionAvailable()` is false and the same refusal holds: no sign-in
    is sealed, and nothing falls back to plain text. Outside a Flatpak KDE
    keeps libsecret, which looks up where it stores.
  - **A Flatpak off KDE seals only with the Secret portal's per-app key.** The
    main process uses Electron safeStorage's async methods and enables
    Chromium's `SecretPortalKeyProviderUseForEncryption` feature. Chromium
    retrieves the stable, per-Flatpak-id master secret through
    `org.freedesktop.portal.Secret`, then derives its `v12` key with
    HKDF-SHA-256 for AES-256-GCM. The portal keeps the master secret in the
    host keyring and does not give Althar's secret to another Flatpak. GNOME's
    portal configuration selects the GNOME Keyring backend; the portal needs
    no D-Bus permission in the manifest. Chromium also has a shared Secret
    Service provider (`v11`) and a fixed-key fallback (`v10`), and reports its
    async encryptor available even when neither safe provider exists. Althar
    accepts and opens only `v12`; `v11`, `v10`, empty data and unknown future
    tags fail closed. This keeps the app-specific boundary and never stores a
    sign-in under a shared or fixed key. A desktop without the Secret portal
    cannot save Flatpak sign-ins, even if its Secret Service is reachable.
    This is an intentional availability trade-off. Existing non-KDE Flatpak
    seals may not use `v12`; they remain on disk and require signing in again,
    after which the normal whole-file replace writes a portal seal. No profile
    data is removed. `Secrets.ts` keeps its existing transport and file format:
    the runtime still sends opaque sealed data to main and never holds a key.
- **Alternatives considered:** keeping the menu's bar visible on Linux (it
  would sit above the strip's own chrome, and a framed window gives that up); publishing on every main push (tagged releases are what people
  install, and a rebuild could ship what verify never saw); accepting
  `basic_text` (a token in plain text); keeping a deny-list for backends
  (a later Electron's name would silently pass); for the Flatpak's key on KDE,
  `SECRET_BACKEND=service` (libsecret checks for a sandbox before it reads
  it), dropping `org.freedesktop.secrets` (the lookup then fails and nothing
  is sealed), and a libsecret built into the manifest without its file
  backend (the secret would cross the bus unencrypted); for the Flatpak's key
  off KDE, the async encryptor with the secret service alone (it works on any
  desktop with a secret service, but every app that talks to it can read the
  item, where the portal gives Althar's secret to Althar alone), Althar
  calling the portal itself and deriving its own key (the same as Chromium's
  provider, with a D-Bus client and a file descriptor to keep in the main
  process), a key from a passphrase of the person's (one more thing to type
  at each start), and the portal on KDE too (it works there, shown from the
  sandbox, but #201's KWallet path was already settled, and changing it
  would ask KDE's sign-ins to be made again).
- **Trade-off:** the buttons and the strip are more code than the system's
  chrome, and the Flatpak ships unfinished — its own README says so. KWallet's
  `Chromium Safe Storage` entry is Chromium's name, not Althar's: Chromium,
  Chromium-based browsers and other Electron apps on KWallet use the same one,
  so they share the key, and removing the entry for one of them makes Althar's
  sign-ins ask to be made again. GNOME needs a working GNOME Keyring Secret
  portal. A desktop with no app-specific Secret portal refuses to save
  sign-ins rather than use the shared Secret Service key or Chromium's `v10`
  fallback.
- **Evidence reviewed 2026-10-15:** libsecret 0.21.7's
  [backend selector](https://github.com/GNOME/libsecret/blob/0.21.7/libsecret/secret-backend.c)
  checks for Flatpak and a Secret portal before consulting `SECRET_BACKEND`,
  then chooses its
  [local file backend](https://github.com/GNOME/libsecret/blob/0.21.7/libsecret/secret-file-backend.c).
  GNOME's current
  [portal configuration](https://flatpak.github.io/xdg-desktop-portal/docs/configuration-file.html)
  selects the GNOME Keyring backend, explaining why setting
  `SECRET_BACKEND=service` cannot align the two stores.
  The [Secret portal interface](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Secret.html)
  specifies a stable master secret per application id. Electron 44.5.0
  (released 2026-09-29; Chromium 152) includes async safeStorage; Chromium's
  [Secret portal provider](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/components/os_crypt/async/browser/secret_portal_key_provider.cc)
  derives the `v12` AES-GCM key, while its
  [Secret Service provider](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc)
  is the shared `v11` fallback. The
  [Electron 44.5.0 safeStorage source](https://github.com/electron/electron/blob/v44.5.0/shell/browser/api/electron_api_safe_storage.cc)
  wires the async methods
  ([release and Chromium version](https://releases.electronjs.org/release/v44.5.0)).
  As a dated comparison, the Flathub manifests for
  [Mailspring](https://github.com/flathub/com.getmailspring.Mailspring/blob/master/com.getmailspring.Mailspring.yml),
  [Obsidian](https://github.com/flathub/md.obsidian.Obsidian/blob/master/md.obsidian.Obsidian.yml)
  and [Visual Studio Code](https://github.com/flathub/com.visualstudio.code/blob/master/com.visualstudio.code.yaml),
  viewed 2026-10-15, grant `org.freedesktop.secrets`; Obsidian and Visual
  Studio Code also grant KWallet bus names. These are common Electron
  Flatpak permissions, not a persistence fix: they neither make libsecret's
  sandbox file visible to Chromium nor scope a Secret Service key to one app.
- **Revisit when:** a whole task has run under GNOME and KDE (the Flatpak
  stops being experimental); Electron's safeStorage keeps a key of its own
  name in KWallet, or libsecret looks up where it stores in a sandbox (the
  Flatpak's KDE switch can go); Electron drops the sync safeStorage, or
  Chromium turns the portal's key on for encryption by default (every
  package could then seal one way, and the Flatpak on KDE could use the
  portal too); Electron recognises the remaining desktops
  itself; or the app gains a real updater and the packages stop being the
  install story.
