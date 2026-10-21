import { sha256 } from '@noble/hashes/sha2.js'

/*
 * Pairing, as the phone reads it (ADR-048, docs/design.md). The Mac shows a
 * code: where its relay is, who it is, its public key, and a one-time
 * nonce. The phone sends its own public key to the Mac through the relay.
 * Both then draw four words from both keys and the nonce; the person checks
 * they match. A key swapped in transit draws other words on one side, so a
 * relay, or anyone on the way, can't sit between them unseen.
 *
 * A draft for review: the keys are X25519, the session itself is to be a
 * vetted handshake (Noise KK, both static keys known after pairing), not
 * something made here.
 */

export const PAIRING_PREFIX = 'althar-pair:1:'

export type PairingCode = {
  /** The relay, which must be wss://. */
  readonly relay: string
  /** The Mac's id at the relay. */
  readonly mac: string
  /** The Mac's name, as the person called it. */
  readonly name: string
  /** The Mac's X25519 public key. */
  readonly key: Uint8Array
  /** One-time, so a code photographed later is no use. */
  readonly nonce: Uint8Array
  readonly expires: string
}

export type Parsed = { readonly ok: true; readonly code: PairingCode } | { readonly ok: false; readonly why: string }

const BASE64URL = /^[A-Za-z0-9_-]*$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export const toBase64Url = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!
  }
  return out
}

export const fromBase64Url = (text: string): Uint8Array | null => {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  const bytes: Array<number> = []
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4)
    const n = chunk.split('').reduce((sum, char, index) => sum | (ALPHABET.indexOf(char) << (18 - 6 * index)), 0)
    bytes.push((n >> 16) & 255)
    if (chunk.length > 2) bytes.push((n >> 8) & 255)
    if (chunk.length > 3) bytes.push(n & 255)
  }
  return Uint8Array.from(bytes)
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Reads a scanned code; refuses, in words, what isn't one, or one gone stale. */
export const parsePairingCode = (scanned: string, now: number = Date.now()): Parsed => {
  if (!scanned.startsWith(PAIRING_PREFIX)) {
    return {
      ok: false,
      why: scanned.startsWith('althar-pair:')
        ? 'This code is for another version of Althar: update both.'
        : 'That isn’t an Althar pairing code.',
    }
  }
  const bytes = fromBase64Url(scanned.slice(PAIRING_PREFIX.length))
  let fields: Record<string, unknown>
  try {
    fields = JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())) as Record<string, unknown>
  } catch {
    return { ok: false, why: 'The code didn’t read whole: scan it again.' }
  }
  const relay = text(fields.relay)
  const mac = text(fields.mac)
  const name = text(fields.name)
  const key = fromBase64Url(text(fields.key) ?? '!')
  const nonce = fromBase64Url(text(fields.nonce) ?? '!')
  const expires = text(fields.expires)
  if (relay === null || !relay.startsWith('wss://')) return { ok: false, why: 'The code names no secure relay.' }
  if (mac === null || mac === '' || name === null || name.trim() === '' || name.length > 64)
    return { ok: false, why: 'The code doesn’t say which Mac.' }
  if (key === null || key.length !== 32) return { ok: false, why: 'The code’s key isn’t whole.' }
  if (nonce === null || nonce.length < 16) return { ok: false, why: 'The code’s nonce is too short.' }
  if (expires === null || Number.isNaN(Date.parse(expires))) return { ok: false, why: 'The code doesn’t say when it expires.' }
  if (Date.parse(expires) <= now) return { ok: false, why: 'The code has expired: show a new one on your Mac.' }
  return { ok: true, code: { relay, mac, name: name.trim(), key, nonce, expires } }
}

/** Makes a code, as the Mac will: for tests, and for the desktop to share. */
export const makePairingCode = (code: PairingCode): string =>
  PAIRING_PREFIX +
  toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        relay: code.relay,
        mac: code.mac,
        name: code.name,
        key: toBase64Url(code.key),
        nonce: toBase64Url(code.nonce),
        expires: code.expires,
      }),
    ),
  )

/** 256 short words, easy to say and tell apart, one for each value of a byte. */
export const WORDS: ReadonlyArray<string> = [
  'acorn',
  'adobe',
  'agate',
  'alarm',
  'album',
  'alley',
  'amber',
  'anchor',
  'angle',
  'anvil',
  'apple',
  'apron',
  'arbor',
  'arrow',
  'aspen',
  'atlas',
  'attic',
  'autumn',
  'badge',
  'bagel',
  'banjo',
  'barge',
  'basin',
  'baton',
  'beach',
  'beacon',
  'bison',
  'blade',
  'blossom',
  'bonnet',
  'border',
  'bottle',
  'bramble',
  'breeze',
  'brick',
  'bridge',
  'brook',
  'bucket',
  'bugle',
  'butter',
  'cabin',
  'cactus',
  'camel',
  'candle',
  'canoe',
  'canyon',
  'carbon',
  'cargo',
  'carpet',
  'castle',
  'cedar',
  'cellar',
  'chalk',
  'cherry',
  'chimney',
  'cider',
  'cinder',
  'circus',
  'citrus',
  'clover',
  'cobalt',
  'coconut',
  'comet',
  'copper',
  'coral',
  'cotton',
  'cradle',
  'crater',
  'crayon',
  'cricket',
  'crystal',
  'cupboard',
  'daisy',
  'delta',
  'desert',
  'dinner',
  'dolphin',
  'domino',
  'donkey',
  'dragon',
  'drum',
  'dune',
  'eagle',
  'easel',
  'echo',
  'ember',
  'engine',
  'falcon',
  'feather',
  'fennel',
  'ferry',
  'fiddle',
  'fig',
  'flame',
  'flannel',
  'flute',
  'forest',
  'fossil',
  'fountain',
  'fox',
  'galaxy',
  'garden',
  'garnet',
  'geyser',
  'ginger',
  'glacier',
  'goblet',
  'gondola',
  'granite',
  'grape',
  'gravel',
  'guitar',
  'hammock',
  'harbor',
  'harvest',
  'hazel',
  'helmet',
  'heron',
  'hickory',
  'honey',
  'horizon',
  'iceberg',
  'igloo',
  'indigo',
  'island',
  'ivory',
  'jacket',
  'jaguar',
  'jasmine',
  'jelly',
  'jigsaw',
  'juniper',
  'kayak',
  'kernel',
  'kettle',
  'kiwi',
  'koala',
  'ladder',
  'lagoon',
  'lantern',
  'lava',
  'lemon',
  'lilac',
  'linen',
  'lizard',
  'lobster',
  'locket',
  'lotus',
  'lumber',
  'magnet',
  'mango',
  'maple',
  'marble',
  'meadow',
  'melon',
  'mesa',
  'meteor',
  'mint',
  'mitten',
  'monsoon',
  'mosaic',
  'mustard',
  'nectar',
  'needle',
  'nickel',
  'nutmeg',
  'oasis',
  'ocean',
  'olive',
  'onion',
  'opal',
  'orbit',
  'orchid',
  'otter',
  'oyster',
  'paddle',
  'pagoda',
  'panda',
  'paprika',
  'parrot',
  'pebble',
  'pelican',
  'pepper',
  'piano',
  'pickle',
  'pigeon',
  'pillow',
  'pine',
  'planet',
  'plum',
  'pocket',
  'pollen',
  'pony',
  'poppy',
  'prairie',
  'prism',
  'pumpkin',
  'puzzle',
  'quarry',
  'quartz',
  'quill',
  'quilt',
  'rabbit',
  'radish',
  'raven',
  'reef',
  'ribbon',
  'river',
  'robin',
  'rocket',
  'saddle',
  'saffron',
  'salmon',
  'sandal',
  'satin',
  'scarf',
  'shadow',
  'shell',
  'signal',
  'silver',
  'sketch',
  'sleigh',
  'spruce',
  'squid',
  'stable',
  'summit',
  'sunset',
  'swan',
  'tablet',
  'tango',
  'teapot',
  'temple',
  'thistle',
  'thunder',
  'tiger',
  'timber',
  'toast',
  'topaz',
  'tulip',
  'tundra',
  'turnip',
  'umbrella',
  'valley',
  'vanilla',
  'velvet',
  'violin',
  'volcano',
  'wagon',
  'walnut',
  'whistle',
  'willow',
  'window',
  'yarrow',
  'yogurt',
  'zebra',
  'zephyr',
]

const LABEL = new TextEncoder().encode('althar pairing words v1')

/** The four words both screens show: drawn from the Mac's key, then the phone's, then the code's nonce. */
export const safetyWords = (macKey: Uint8Array, phoneKey: Uint8Array, nonce: Uint8Array): ReadonlyArray<string> => {
  const input = new Uint8Array(LABEL.length + macKey.length + phoneKey.length + nonce.length)
  input.set(LABEL, 0)
  input.set(macKey, LABEL.length)
  input.set(phoneKey, LABEL.length + macKey.length)
  input.set(nonce, LABEL.length + macKey.length + phoneKey.length)
  const digest = sha256(input)
  return [0, 1, 2, 3].map((index) => WORDS[digest[index] ?? 0] ?? WORDS[0]!)
}
