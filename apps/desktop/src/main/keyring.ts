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
 * KWallet all serve. In a Flatpak it is asked for every desktop because the
 * sandbox's libsecret file key is not where Chromium's host-service lookup
 * expects it. A `--password-store` the person chose themselves is left alone.
 */
export const passwordStore = (
  args: ReadonlyArray<string>,
  desktop: string | undefined,
  flatpak: boolean,
  platform: NodeJS.Platform = process.platform,
): 'gnome-libsecret' | null => {
  // A Linux switch: macOS and Windows keep their own keychain, which Electron knows without being told.
  if (platform !== 'linux') return null
  if (args.some((arg) => arg === '--password-store' || arg.startsWith('--password-store='))) return null
  const names = (desktop ?? '').toLowerCase().split(':')
  const recognised = ['x-cinnamon', 'deepin', 'gnome', 'pantheon', 'xfce', 'ukui', 'unity']
  return flatpak || names.includes('kde') || !names.some((name) => recognised.includes(name)) ? 'gnome-libsecret' : null
}

/** Whether Flatpak sign-ins use Chromium's app-scoped Secret portal key. */
export const sealsWithPortal = (flatpak: boolean, platform: NodeJS.Platform = process.platform): boolean => platform === 'linux' && flatpak

/** Chromium's switch that makes the Secret portal key seal as well as open. */
export const PORTAL_FEATURE = 'SecretPortalKeyProviderUseForEncryption'

/** `--enable-features` with the portal key enabled, keeping switches the person passed. */
export const withPortalFeature = (enabled: string): string => {
  const features = enabled.split(',').filter(Boolean)
  return (features.includes(PORTAL_FEATURE) ? features : [...features, PORTAL_FEATURE]).join(',')
}

/** Prefix for Chromium's per-application Secret portal key. */
export const sealedByPortal = (sealed: Uint8Array): boolean => new TextDecoder().decode(sealed.subarray(0, 3)) === 'v12'

/** Prefix used by sync safeStorage; accepted only when Electron reports a real keyring. */
const sealedBySyncKeyring = (sealed: Uint8Array): boolean => new TextDecoder().decode(sealed.subarray(0, 3)) === 'v10'

/** Shown when Chromium cannot obtain its per-app Secret portal key and no safe session fallback can seal. */
export const portalKeyUnavailable =
  'Althar has nowhere app-specific to keep sign-ins safely in this Flatpak: start a desktop Secret portal backed by a keyring, then try again.'

/** Shown when a saved value cannot be opened by the available keyring. */
export const portalSealUnavailable = "Althar couldn't open this saved sign-in safely. Sign in again to replace it."

export interface SafeStorageLike {
  getSelectedStorageBackend: () => string
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
  encryptStringAsync: (value: string) => Promise<Buffer>
  decryptStringAsync: (value: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type SealReply = { value: string } | { error: string; keyring: true }

const safeSyncKeyring = (storage: SafeStorageLike, platform: NodeJS.Platform): boolean => {
  try {
    const backend = platform === 'linux' ? storage.getSelectedStorageBackend() : 'keychain'
    return (
      storage.isEncryptionAvailable() &&
      keyringIsSafe(platform, backend) &&
      // The only Flatpak sync fallback that does not share its Chromium key
      // with other applications is libsecret's sandbox-local file backend.
      (platform !== 'linux' || backend === 'gnome_libsecret')
    )
  } catch {
    return false
  }
}

/**
 * Seal Flatpak secrets with Chromium's app-scoped Secret portal key when it
 * answers. If it does not, keep the old safeStorage session behavior only
 * when Electron reports a real keyring; never accept its shared-service or
 * fixed-key async formats, or `basic_text`. A sync seal may stop opening after
 * restart in a Flatpak, in which case the person signs in again.
 */
export const sealWithPortal = async (
  sealing: boolean,
  value: string,
  storage: SafeStorageLike,
  platform: NodeJS.Platform = process.platform,
): Promise<SealReply> => {
  if (sealing) {
    try {
      const sealed = await storage.encryptStringAsync(value)
      if (sealedByPortal(sealed)) return { value: sealed.toString('base64') }
    } catch {
      // The portal provider is optional; try the session-scoped keyring path below.
    }
    if (!safeSyncKeyring(storage, platform)) return { error: portalKeyUnavailable, keyring: true }
    try {
      const sealed = storage.encryptString(value)
      if (sealedBySyncKeyring(sealed)) return { value: sealed.toString('base64') }
    } catch {
      // The keyring became unavailable between the availability check and use.
    }
    return { error: keyringUnavailable(platform), keyring: true }
  }

  const sealed = Buffer.from(value, 'base64')
  if (sealedByPortal(sealed)) {
    try {
      // Chromium may rotate its key during decryption. Electron says to call
      // again so the same ciphertext is opened with the newly available key.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { result, shouldReEncrypt } = await storage.decryptStringAsync(sealed)
        if (!shouldReEncrypt) return { value: result }
      }
    } catch {
      // A portal-sealed value cannot be opened by the session fallback.
    }
    return { error: portalSealUnavailable, keyring: true }
  }
  if (!sealedBySyncKeyring(sealed)) return { error: portalSealUnavailable, keyring: true }
  if (!safeSyncKeyring(storage, platform)) return { error: keyringUnavailable(platform), keyring: true }
  try {
    return { value: storage.decryptString(sealed) }
  } catch {
    return { error: portalSealUnavailable, keyring: true }
  }
}

/** What the window says when secrets can't be sealed here: on Linux, what to install; elsewhere, that the keychain is missing. */
export const keyringUnavailable = (platform: NodeJS.Platform): string =>
  platform === 'linux'
    ? 'Althar has nowhere safe to keep sign-ins: install and start a keyring (gnome-keyring or KWallet), then try again.'
    : 'The keychain Althar seals sign-ins with isn’t available.'
