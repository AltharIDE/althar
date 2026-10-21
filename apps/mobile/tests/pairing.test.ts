import { describe, expect, it } from 'vitest'

import {
  fromBase64Url,
  makePairingCode,
  parsePairingCode,
  safetyWords,
  toBase64Url,
  WORDS,
  type PairingCode,
} from '../src/client/relay/pairing'

const NOW = Date.parse('2026-10-21T15:00:00.000Z')

const bytes = (fill: number, length = 32) => new Uint8Array(length).fill(fill)

const code: PairingCode = {
  relay: 'wss://relay.althar.dev',
  mac: 'mac_01',
  name: 'Balazs’s MacBook Pro',
  key: bytes(7),
  nonce: bytes(9, 16),
  expires: '2026-10-21T15:05:00.000Z',
}

describe('the pairing code', () => {
  it('reads back what the Mac wrote', () => {
    const parsed = parsePairingCode(makePairingCode(code), NOW)
    expect(parsed).toEqual({ ok: true, code })
  })

  it('refuses one that has expired, in words', () => {
    expect(parsePairingCode(makePairingCode(code), Date.parse('2026-10-21T15:06:00.000Z'))).toEqual({
      ok: false,
      why: 'The code has expired: show a new one on your Mac.',
    })
  })

  it('refuses what isn’t a code, a code of another version, and one that names no secure relay', () => {
    expect(parsePairingCode('https://example.com', NOW)).toMatchObject({ ok: false, why: 'That isn’t an Althar pairing code.' })
    expect(parsePairingCode('althar-pair:2:abc', NOW)).toMatchObject({ ok: false, why: expect.stringContaining('another version') })
    expect(parsePairingCode(makePairingCode({ ...code, relay: 'ws://relay.althar.dev' }), NOW)).toMatchObject({
      ok: false,
      why: 'The code names no secure relay.',
    })
    expect(parsePairingCode(makePairingCode({ ...code, key: bytes(7, 31) }), NOW)).toMatchObject({
      ok: false,
      why: 'The code’s key isn’t whole.',
    })
    expect(parsePairingCode('althar-pair:1:%%%', NOW)).toMatchObject({ ok: false, why: 'The code didn’t read whole: scan it again.' })
  })

  it('round-trips base64url of every length', () => {
    for (let length = 0; length < 40; length++) {
      const input = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256)
      expect(fromBase64Url(toBase64Url(input))).toEqual(input)
    }
    expect(fromBase64Url('a')).toBeNull()
    expect(fromBase64Url('a+b/')).toBeNull()
  })
})

describe('the safety words', () => {
  it('has a word for each value of a byte, all different', () => {
    expect(WORDS).toHaveLength(256)
    expect(new Set(WORDS).size).toBe(256)
  })

  it('draws the same four words on both sides, and others for a swapped key', () => {
    const phone = bytes(3)
    const words = safetyWords(code.key, phone, code.nonce)
    expect(words).toHaveLength(4)
    expect(safetyWords(code.key, phone, code.nonce)).toEqual(words)
    expect(safetyWords(code.key, bytes(4), code.nonce)).not.toEqual(words)
    expect(safetyWords(phone, code.key, code.nonce)).not.toEqual(words)
  })
})
