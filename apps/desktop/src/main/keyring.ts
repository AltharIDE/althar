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
 * makes a new one at every start. Other desktops in a Flatpak keep libsecret
 * for Chromium's own use, and seal sign-ins with the Secret portal's
 * app-specific key instead (sealsWithPortal). Without that provider,
 * sign-ins fail closed rather than use a shared service key.
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

/**
 * Whether sign-ins use safeStorage's async encryptor, whose app-specific key
 * the Secret portal gives: in a Flatpak on any desktop but KDE, where
 * safeStorage's own libsecret key would be made anew at every start. The
 * portal (`org.freedesktop.portal.Secret`) hands each Flatpak a secret of its
 * own, kept in the host's keyring, the same at every start; Chromium derives
 * the key from it (HKDF-SHA-256, AES-256-GCM). Another Flatpak asking gets its
 * own, not Althar's. If the portal is unavailable, Chromium can fall back to a
 * shared Secret Service key or its fixed `v10` key; neither is accepted for
 * Althar sign-ins.
 */
export const sealsWithPortal = (desktop: string | undefined, flatpak: boolean, platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'linux' && flatpak && !(desktop ?? '').toLowerCase().split(':').includes('kde')

/** Chromium's switch that has its Secret portal key seal, not only open (it opens by default). */
export const PORTAL_FEATURE = 'SecretPortalKeyProviderUseForEncryption'

/** `--enable-features` with the portal's key among them, keeping any the person passed. */
export const withPortalFeature = (enabled: string): string => {
  const features = enabled.split(',').filter((feature) => feature !== '')
  return (features.includes(PORTAL_FEATURE) ? features : [...features, PORTAL_FEATURE]).join(',')
}

/** Only the Secret portal's per-app key (`v12`) meets Althar's isolation rule. */
export const sealedByPortal = (sealed: Uint8Array): boolean => {
  const tag = new TextDecoder().decode(sealed.subarray(0, 3))
  return tag === 'v12'
}

/** Shown when the Secret portal cannot provide Althar's per-app key. */
export const portalKeyUnavailable =
  'Althar has nowhere app-specific to keep sign-ins safely in this Flatpak: start a desktop Secret portal backed by a keyring, then try again.'

/** Shown when a saved sign-in was sealed by a legacy or shared provider. */
export const portalSealUnavailable =
  "Althar couldn't open this saved sign-in with its app-specific Secret portal key. Sign in again to replace it."

/** What the window says when secrets can't be sealed here: on Linux, what to install; elsewhere, that the keychain is missing. */
export const keyringUnavailable = (platform: NodeJS.Platform): string =>
  platform === 'linux'
    ? 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.'
    : 'The keychain Althar seals sign-ins with isn’t available.'
