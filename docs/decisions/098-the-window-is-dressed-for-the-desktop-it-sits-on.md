# ADR-098: The window is dressed for the desktop it sits on, decided by Althar, not chosen

- **Status:** Accepted; refines [ADR-028](028-linux-windows-packages-and-the-keyring.md)'s frameless window off a Mac
- **Date:** 2026-11-06
- **Owner:** Desktop app maintainers
- **Context:** Off a Mac the window was frameless everywhere, and its bar
  drew a Mac's grey dots for close, minimize and maximize, at the left, on
  GNOME, KDE and Windows alike ([ADR-028](028-linux-windows-packages-and-the-keyring.md);
  `windowOptions.ts`). On Linux that reads as foreign: GNOME
  puts round buttons on the right, often close alone; KDE's window manager
  draws its own frame in the person's theme; a tiling compositor wants no
  buttons at all. Light and dark already followed the desktop through the
  Settings portal (`colorScheme.ts`). The person asked that the window look
  like it belongs to the desktop, automatically, without a setting to pick.
  An Electron window's frame (`frame: true` or not) is fixed when the window
  is created, so that part has to be known at launch.
- **Decision:**
  - **Main reads the desktop** (`main/desktop.ts`, `main/desktopChrome.ts`):
    the session (`XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, `DISPLAY`); the
    desktop's family from `XDG_CURRENT_DESKTOP` (a colon list, `ubuntu:GNOME`,
    read in order), `XDG_SESSION_DESKTOP`, `DESKTOP_SESSION`,
    `KDE_FULL_SESSION` and `KDE_SESSION_VERSION`, and a tiling compositor's
    socket (`SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `NIRI_SOCKET`,
    `I3SOCK`), which wins over the desktop's name; on X11 the window manager's
    own `_NET_WM_NAME` through `xprop`, which wins over both; GNOME Shell's
    version from its `ShellVersion` D-Bus property; the GTK theme, GNOME's
    `button-layout` and the accent through the Settings portal, with
    `gsettings get org.gnome.desktop.wm.preferences button-layout` once
    where the portal doesn't give the layout (then a change shows on the
    next launch); KWin's
    buttons and decoration and KDE's colour scheme from `kwinrc` and
    `kdeglobals`, read as text through the XDG cascade (`XDG_CONFIG_HOME`,
    then `XDG_CONFIG_DIRS`, else `~/.config` and `/etc/xdg`).
  - **Only `gdbus`, `xprop` and `gsettings` are ever run**, with a
    timeout, with no shell: command-line tools that need no display
    (`gsettings` reads dconf's database). A desktop program never is. Probing once ran `plasmashell
    --version` and `kreadconfig6`: both are Qt GUI programs, which abort
    without a usable display (coredumps on the person's Plasma 6), and
    `kreadconfig6` opens a `kdialog` where it can't write its own config.
    `systemSources` refuses any other command, and a test asserts what every
    known session's reads spawn.
  - **Off the startup path, and cached.** The first window waits, as it
    already did for the scheme, only for the portal's first word (at most
    1.5 s, in parallel). The slower reads (the X11 window manager's name,
    the shell's version, KDE's files) don't hold it: what they found last
    time is in the profile's `window-chrome.json`, for the same desktop
    only, and what they find now follows, live.
  - **The decision** (`decideChrome`):

    | Desktop, window manager, session | Frame | Althar's buttons |
    | --- | --- | --- |
    | macOS | inset title bar | none: the system's traffic lights over Althar's bar |
    | Windows | frameless | Windows' manner: caption buttons the bar's full height, red under close |
    | Tiling: sway, Hyprland, i3, river, niri, bspwm, dwm, awesome, qtile, xmonad… (by name, socket or X11 name) | frameless | none, the bar stays as it is |
    | GNOME (Mutter) and its remixes (Ubuntu, Pop, Zorin), Budgie, Pantheon (Gala), on Wayland and X11, or GNOME's window manager under another desktop's name | frameless | GNOME's manner, in `button-layout`'s order and side; tuned: libadwaita's discs (GNOME 40+ or unknown), GTK 3's plain ones (before 40), Yaru's orange close |
    | KDE Plasma (KWin) on Wayland or X11 | the window manager's | none |
    | Xfce (xfwm4), MATE (Marco), LXDE and LXQt (Openbox), Cinnamon (Muffin), Unity (Compiz) on X11; labwc, Wayfire, COSMIC (cosmic-comp) on Wayland | the window manager's | none |
    | A desktop that would frame windows, on a Wayland compositor that can't (Cinnamon on Wayland, Muffin speaks no xdg-decoration) | frameless | its family's manner: GNOME's for GTK desktops, KDE's for Qt ones |
    | Anything else | frameless | neutral: GNOME's, untuned, all three on the right |

    A window manager's frame is used where it draws a good one that
    matches its own theme: on X11 every stacking window manager does; on
    Wayland only one that speaks xdg-decoration. Mutter doesn't, and a
    `frame: true` window there gets a plain bar Electron draws above
    Althar's own. GNOME's family draws its own bar on X11 too, where Mutter
    would add a second title bar above Althar's: its apps' convention is
    client-side, and theirs is what Althar matches.
  - **The frame is decided as the first window opens**, from what is known
    then, and every window of that run keeps it. A later read that says
    otherwise (the X11 name arriving after the window opened) changes only
    what can change: an unframed window draws its desktop's buttons, a
    framed one draws none. The buttons' manner, order and side, and the
    accent, follow live where the portal signals a change; KDE's files and
    the version are read again at the next launch.
  - **The buttons are Althar's own drawing** (`WindowButtons`, looks
    `gnome`, `kde`, `windows`, and Althar's `dots`): each desktop's
    conventions of shape, size, placement and hover, never its artwork.
    Each is a real button with its name, reached by the keyboard, its glyph
    always shown, so colour is never what says what it does.
  - **The accent is a setting** (Settings › Appearance › Accent colour,
    Althar's by default): the system's accent (the portal's `accent-color`,
    Electron's `getAccentColor()` on Windows and a Mac) takes the place of
    Althar's violet, in the nearest shade of it that keeps WCAG contrast for
    each use in each scheme, moved no further than 0.22 in OKLab lightness.
    Where any use can't be kept legible, Althar keeps its own, and the
    setting says why.
- **Alternatives considered:**
  - **A setting for the window's controls** (as the system, Althar's dots,
    the system's title bar). The first plan; dropped on the person's word:
    Althar can tell, and a setting that needs a restart is a poor one.
  - **Running the desktop's tools** (`plasmashell --version`,
    `gnome-shell --version`, `kreadconfig6`) for versions and settings:
    they are GUI programs, crash without a display and may open dialogs.
    Their files and D-Bus say the same. `gsettings` is not one of them and
    is kept, as the layout's fallback only: the portal is followed live
    and also reaches a Flatpak, where `gsettings` would read the sandbox's
    own settings.
  - **Electron's `titleBarOverlay` on Windows**, which draws Windows' own
    caption buttons with Snap Layouts: its colours and height are set from
    main and must be kept in step with the page's scheme and zoom, and it
    can't be checked from the Linux machines this was built on. Left for
    later; Windows draws Althar's caption buttons for now.
  - **The system's frame on GNOME too**: two bars, Electron's plain one on
    Wayland or Mutter's on X11, above Althar's.
- **Trade-off:**
  - **The first launch on X11 goes by the environment alone** where the
    window manager differs from the desktop's name (Xfce with i3): until the
    cache has its name, the frame may be the desktop's. From the second
    launch on, it is right.
  - **KDE's buttons are drawn only where KWin can't frame the window**, a
    rare case; KDE's look is there for Qt desktops on other compositors.
  - **Themes are mapped only where known**: Yaru, and GNOME's two eras.
    Other GTK themes, KWin's Aurorae and Oxygen, and KDE's colour schemes
    are read but leave the family's default: KWin draws its own frame in
    them anyway.
  - **The edge's pages** (the island, the menu bar's sheet, the tray) draw
    no window buttons and still follow the scheme; they keep Althar's
    accent.
- **Revisit when:**
  - Mutter, Muffin or Gala gain xdg-decoration, or GNOME's apps move to
    server-side bars.
  - Electron lets a window's frame change after it opens.
  - Windows is checked on a real machine: then `titleBarOverlay`.
  - More themes are worth mapping (elementary, Pop's, KDE's Aurorae).
