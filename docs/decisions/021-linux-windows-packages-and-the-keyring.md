# ADR-021: Linux windows, packages and the keyring

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** Althar was a Mac app. Off a Mac it has no system title bar and
  no system menu bar, several ways to install exist, Linux sign-ins need a
  keyring Electron does not always find, and a Flatpak's sandbox is narrower
  than anything the app had run in (ADR-020). The window's chrome, the
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
    runs from a version tag: the tag must be `v<apps/desktop's version>`, and
    the released files are the package job's own build — the one verify
    passed on — not a rebuild.
  - **The keyring, refused loudly, and asked for where it is hidden.**
    `basic_text` — Electron's plain-text fallback — is refused with an
    allow-list of real backends (`gnome_libsecret`, `kwallet*`), so anything
    unknown fails closed too. Where Electron would pick plain text because it
    doesn't recognise the desktop (sway, i3, Hyprland, COSMIC and others),
    the app asks for `--password-store=gnome-libsecret` before it is ready:
    libsecret speaks the Secret Service API, which gnome-keyring, KeePassXC
    and KWallet all serve. A `--password-store` the person chose themselves
    is left alone, and in a Flatpak it is asked for whatever the desktop is.
    The refusal's words are the only secret error shown verbatim; everything
    else of the keychain's gets the generic sentence.
  - **The Flatpak is experimental.** It carries the app and the toolchain for
    its own work in a narrow sandbox (network, display, GPU, the keyring, the
    device's own tools through `flatpak-spawn` — ADR-020), its worktrees live
    beside its profile, and `scripts/flatpak-smoke.sh` checks its own
    environment. It is called experimental until a whole task has been run
    under GNOME and KDE.
- **Alternatives considered:** keeping the menu's bar visible on Linux (it
  would sit above the strip's own chrome, and a framed window gives that up); publishing on every main push (tagged releases are what people
  install, and a rebuild could ship what verify never saw); accepting
  `basic_text` (a token in plain text); keeping a deny-list for backends
  (a later Electron's name would silently pass).
- **Trade-off:** the buttons and the strip are more code than the system's
  chrome, and the Flatpak ships unfinished — its own README says so.
- **Revisit when:** a whole task has run under GNOME and KDE (the Flatpak
  stops being experimental); Electron recognises the remaining desktops
  itself; or the app gains a real updater and the packages stop being the
  install story.
