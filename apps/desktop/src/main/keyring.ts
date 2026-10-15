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
 * gnome_libsecret only for desktops it recognises and plain text for others.
 * Asking for gnome_libsecret on an unrecognised desktop or KDE is safe:
 * libsecret speaks the Secret Service API that gnome-keyring, KeePassXC and
 * KWallet all serve. A `--password-store` the person chose themselves is left
 * alone.
 *
 * A Flatpak on KDE asks for KWallet itself (kwallet6, kwallet5 on Plasma 5),
 * through the talk permission the manifest gives it. Through libsecret the key
 * would not survive a restart: inside a sandbox libsecret stores in a keyring
 * file of the app's own (`$XDG_DATA_HOME/keyrings/default.keyring`), while
 * Chromium looks the key up on the host's secret service, finds none, and
 * makes a new one at every start. Other desktops in a Flatpak still get
 * libsecret, and the same new key at each start (open questions, "The
 * Flatpak's keyring").
 */
export const passwordStore = (
  args: ReadonlyArray<string>,
  desktop: string | undefined,
  flatpak: boolean,
  platform: NodeJS.Platform = process.platform,
  kdeVersion?: string,
): 'gnome-libsecret' | 'kwallet5' | 'kwallet6' | null => {
  // A Linux switch: macOS and Windows keep their own keychain, which Electron knows without being told.
  if (platform !== 'linux') return null
  if (args.some((arg) => arg === '--password-store' || arg.startsWith('--password-store='))) return null
  const names = (desktop ?? '').toLowerCase().split(':')
  const kde = names.includes('kde')
  if (flatpak && kde) return kdeVersion === '5' ? 'kwallet5' : 'kwallet6'
  const recognised = ['x-cinnamon', 'deepin', 'gnome', 'pantheon', 'xfce', 'ukui', 'unity']
  return flatpak || kde || !names.some((name) => recognised.includes(name)) ? 'gnome-libsecret' : null
}

/** What the window says when secrets can't be sealed here: on Linux, what to install; elsewhere, that the keychain is missing. */
export const keyringUnavailable = (platform: NodeJS.Platform): string =>
  platform === 'linux'
    ? 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.'
    : 'The keychain Althar seals sign-ins with isn’t available.'
