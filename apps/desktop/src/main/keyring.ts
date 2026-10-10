/*
 * Whether secrets may be sealed here. Electron's safeStorage uses the OS
 * keychain on macOS and Windows, and libsecret on Linux, where it can fall
 * back to plain text (basic_text) without saying so. Althar refuses that
 * fallback: without a keyring a sign-in fails loudly in the window, rather
 * than keeping a token unprotected.
 */

/** The Linux backends that hold a secret service: gnome-keyring, KeePassXC and KWallet (5.97+) all serve libsecret's Secret Service API. */
const isKeyring = (backend: string) => backend === 'gnome_libsecret' || backend.startsWith('kwallet')

/**
 * Whether this backend is a keyring. An allow-list, not a deny-list:
 * Electron's own `unknown` (before it is ready) and any backend a later
 * Electron adds fail closed, like plain text does.
 */
export const keyringIsSafe = (platform: NodeJS.Platform, backend: string): boolean => platform !== 'linux' || isKeyring(backend)

/**
 * Which password store to ask Electron for, off a Mac. Electron picks
 * gnome_libsecret only for the desktops it recognises (GNOME, XFCE, KDE and
 * a few more) and plain text for everything else — sway, i3, Hyprland, niri,
 * COSMIC, LXQt — even where a keyring runs. Asking for gnome_libsecret there
 * is safe: it is libsecret, which speaks the Secret Service API that
 * gnome-keyring, KeePassXC and KWallet all serve. In a Flatpak it is asked
 * for whatever the desktop is: the sandbox reaches the host's secret service,
 * not KWallet's own socket, so KDE there needs it too. A `--password-store`
 * the person chose themselves is left alone.
 */
export const passwordStore = (
  args: ReadonlyArray<string>,
  desktop: string | undefined,
  flatpak: boolean,
  platform: NodeJS.Platform = process.platform,
): 'gnome-libsecret' | null => {
  // A Linux switch: macOS and Windows keep their own keychain, which Electron knows without being told.
  if (platform !== 'linux') return null
  if (args.some((arg) => arg.startsWith('--password-store='))) return null
  const names = (desktop ?? '').toLowerCase().split(':')
  const recognised = ['x-cinnamon', 'deepin', 'gnome', 'pantheon', 'xfce', 'ukui', 'unity', 'kde']
  return flatpak || !names.some((name) => recognised.includes(name)) ? 'gnome-libsecret' : null
}

/** What the window says when secrets can't be sealed here: on Linux, what to install; elsewhere, that the keychain is missing. */
export const keyringUnavailable = (platform: NodeJS.Platform): string =>
  platform === 'linux'
    ? 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.'
    : 'The keychain Althar seals sign-ins with isn’t available.'
