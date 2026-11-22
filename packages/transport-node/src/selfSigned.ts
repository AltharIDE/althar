import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

/*
 * A self-signed TLS certificate for a home that phones reach directly, such as
 * This Mac on the same Wi-Fi. Nothing public vouches for it: a phone trusts it
 * by the key pin and the certificate its pairing code carries, so the key is
 * what stays. It is made once, valid into 2049, and kept with its key, so the
 * pin a paired phone holds never changes. P-256 keeps the pairing code short.
 */

/** A DER length: short form under 0x80, else its bytes after a count. */
const lengthOf = (n: number) => {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const der = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), lengthOf(body.length), body])
const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts))
const set = (...parts: Buffer[]) => der(0x31, Buffer.concat(parts))
const explicit = (n: number, body: Buffer) => der(0xa0 + n, body)
/** Only ever given a positive number whose first byte is under 0x80, so no sign byte is needed. */
const integer = (bytes: Buffer) => der(0x02, bytes)
const oid = (first: number, second: number, ...rest: number[]) => {
  const bytes = [first * 40 + second]
  for (const value of rest) {
    const chunk = [value & 0x7f]
    for (let v = value >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80)
    bytes.push(...chunk)
  }
  return der(0x06, Buffer.from(bytes))
}
const utf8 = (text: string) => der(0x0c, Buffer.from(text, 'utf8'))
const octets = (body: Buffer) => der(0x04, body)
const bits = (body: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), body]))
const CRITICAL = der(0x01, Buffer.from([0xff]))
/** UTCTime, YYMMDDHHMMSSZ: good to 2049, as far as this certificate needs. */
const utcTime = (at: Date) => der(0x17, Buffer.from(`${at.toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`, 'ascii'))

const ECDSA_SHA256 = sequence(oid(1, 2, 840, 10045, 4, 3, 2))
const COMMON_NAME = oid(2, 5, 4, 3)
const SUBJECT_ALT_NAME = oid(2, 5, 29, 17)
const BASIC_CONSTRAINTS = oid(2, 5, 29, 19)
const KEY_USAGE = oid(2, 5, 29, 15)
const EXTENDED_KEY_USAGE = oid(2, 5, 29, 37)
const SERVER_AUTH = oid(1, 3, 6, 1, 5, 5, 7, 3, 1)
const UNTIL = new Date('2049-12-31T23:59:59Z')

export interface SelfSigned {
  /** PEM. */
  readonly certificate: string
  /** PKCS #8 PEM. */
  readonly key: string
}

/** A new P-256 key, or the one kept, and a certificate for it naming the home's host names. */
export const selfSignedCertificate = (name: string, hosts: ReadonlyArray<string>, now: number, keptKey?: string): SelfSigned => {
  const privateKey = keptKey === undefined ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey : createPrivateKey(keptKey)
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  const distinguished = sequence(set(sequence(COMMON_NAME, utf8(name.slice(0, 64) || 'Althar'))))
  const serial = randomBytes(16)
  // Positive, and its first byte never 0: DER keeps an integer's shortest form.
  serial.writeUInt8((serial.readUInt8(0) & 0x7f) | 0x40, 0)
  const names = sequence(...hosts.map((host) => der(0x82, Buffer.from(host, 'ascii'))))
  const extensions = explicit(
    3,
    sequence(
      sequence(SUBJECT_ALT_NAME, octets(names)),
      sequence(BASIC_CONSTRAINTS, CRITICAL, octets(sequence())),
      // digitalSignature only
      sequence(KEY_USAGE, CRITICAL, octets(der(0x03, Buffer.from([7, 0x80])))),
      sequence(EXTENDED_KEY_USAGE, octets(sequence(SERVER_AUTH))),
    ),
  )
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    ECDSA_SHA256,
    distinguished,
    sequence(utcTime(new Date(now - 24 * 60 * 60_000)), utcTime(UNTIL)),
    distinguished,
    spki,
    extensions,
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const body = sequence(tbs, ECDSA_SHA256, bits(signature)).toString('base64')
  return {
    certificate: `-----BEGIN CERTIFICATE-----\n${body.replace(/(.{64})(?=.)/g, '$1\n')}\n-----END CERTIFICATE-----\n`,
    key: keptKey ?? privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}
