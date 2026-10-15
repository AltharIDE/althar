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
 * KWallet all serve. A Flatpak on KDE is the exception, and asks for KWallet
 * itself (`kwallet6`, or `kwallet5` on Plasma 5): inside a sandbox libsecret
 * keeps its keyring in a file of the app's own, stores the sealing key
 * there, and Chromium looks it up in the host's service, where it isn't, so it
 * makes a new key at every start and what an earlier run sealed can't be
 * opened (ADR-028). KWallet's own wallet is the host's and has one key, kept;
 * the manifest lets the sandbox talk to it. A `--password-store` the person
 * chose themselves is left alone.
 */
export const passwordStore = (
  args: ReadonlyArray<string>,
  desktop: string | undefined,
  flatpak: boolean,
  platform: NodeJS.Platform = process.platform,
  kdeSession?: string,
): 'gnome-libsecret' | 'kwallet5' | 'kwallet6' | null => {
  // A Linux switch: macOS and Windows keep their own keychain, which Electron knows without being told.
  if (platform !== 'linux') return null
  if (args.some((arg) => arg === '--password-store' || arg.startsWith('--password-store='))) return null
  const names = (desktop ?? '').toLowerCase().split(':')
  if (flatpak && names.includes('kde')) return kdeSession === '5' ? 'kwallet5' : 'kwallet6'
  const recognised = ['x-cinnamon', 'deepin', 'gnome', 'pantheon', 'xfce', 'ukui', 'unity']
  return flatpak || names.includes('kde') || !names.some((name) => recognised.includes(name)) ? 'gnome-libsecret' : null
}

/** What the window says when secrets can't be sealed here: on Linux, what to install; elsewhere, that the keychain is missing. */
export const keyringUnavailable = (platform: NodeJS.Platform): string =>
  platform === 'linux'
    ? 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.'
    : 'The keychain Althar seals sign-ins with isn’t available.'

/**
 * What main answers the runtime when safeStorage throws. A failed open is not the keychain being away (that is answered before,
 * as `keyring`): the keychain answered, and the key it holds doesn't open what Althar sealed. In a Flatpak whose libsecret keeps
 * its keyring in a file of the sandbox's own, Chromium finds no key there and makes a new one at every start, so what an earlier
 * run sealed can't be opened by the next. The runtime has the sign-in made again, rather than ask again.
 */
export const sealFailure = (type: 'seal' | 'open', error: unknown): { readonly error: string; readonly unreadable?: true } => ({
  error: error instanceof Error ? error.message : String(error),
  ...(type === 'open' ? { unreadable: true } : {}),
})
