import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'

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

const CLIENT_AUTH = oid(1, 3, 6, 1, 5, 5, 7, 3, 2)
const SUBJECT_KEY_ID = oid(2, 5, 29, 14)
const AUTHORITY_KEY_ID = oid(2, 5, 29, 35)

const pem = (body: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${body.toString('base64').replace(/(.{64})(?=.)/g, '$1\n')}\n-----END CERTIFICATE-----\n`
const nameOf = (name: string) => sequence(set(sequence(COMMON_NAME, utf8(name.slice(0, 64) || 'Althar'))))
/** A key's identifier, as RFC 5280 has it: SHA-1 of its public key's bits. */
const keyId = (spki: Buffer) => {
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'der' })
  // The last BIT STRING of a SubjectPublicKeyInfo is the key itself; for P-256 it is the final 65 bytes.
  return createHash('sha1')
    .update(key.subarray(key.length - 65))
    .digest()
}

/** One DER element at `at`: where its body starts and where it ends. */
const element = (bytes: Buffer, at: number) => {
  const first = bytes.readUInt8(at + 1)
  const count = first < 0x80 ? 0 : first & 0x7f
  let length = first < 0x80 ? first : 0
  for (let i = 0; i < count; i++) length = length * 256 + bytes.readUInt8(at + 2 + i)
  const body = at + 2 + count
  return { body, end: body + length }
}
/** A certificate's subject, as the DER it was signed with: an issuer's name in what it signs is that, byte for byte. */
const subjectOf = (raw: Buffer) => {
  const tbs = element(raw, element(raw, 0).body)
  let at = tbs.body
  // version [0], serialNumber, signature, issuer, validity: then the subject.
  for (let i = 0; i < 5; i++) at = element(raw, at).end
  return raw.subarray(at, element(raw, at).end)
}

/** What a certificate is for: a server's name, a client, or an authority that signs the others. */
export type CertificateUse =
  | { readonly kind: 'server'; readonly hosts: ReadonlyArray<string> }
  | { readonly kind: 'client' }
  | { readonly kind: 'authority' }

export interface IssueOptions {
  /** Its common name. */
  readonly name: string
  /** The public key it certifies, as SPKI DER. */
  readonly publicKey: Buffer
  readonly use: CertificateUse
  /** Who signs it: an authority's certificate and key (PEM); none signs it with its own `selfKey`. */
  readonly issuer?: { readonly certificate: string; readonly key: string }
  /** For a self-signed one, its own private key (PEM). */
  readonly selfKey?: string
  readonly now: number
  /** Valid until, into 2049 at most. */
  readonly until?: Date
}

/** A P-256 certificate: self-signed, or signed by an authority Althar made, for a server, a client or an authority. */
export const issueCertificate = (options: IssueOptions): string => {
  const signer = options.issuer === undefined ? options.selfKey : options.issuer.key
  if (signer === undefined) throw new Error('A certificate needs a key to sign it')
  const issuerCertificate = options.issuer === undefined ? undefined : new X509Certificate(options.issuer.certificate)
  const subject = nameOf(options.name)
  const issuerName = issuerCertificate === undefined ? subject : subjectOf(issuerCertificate.raw)
  const issuerSpki =
    issuerCertificate === undefined ? options.publicKey : issuerCertificate.publicKey.export({ type: 'spki', format: 'der' })
  const serial = randomBytes(16)
  // Positive, and its first byte never 0: DER keeps an integer's shortest form.
  serial.writeUInt8((serial.readUInt8(0) & 0x7f) | 0x40, 0)
  const use = options.use
  const extensions = [
    ...(use.kind === 'server'
      ? [sequence(SUBJECT_ALT_NAME, octets(sequence(...use.hosts.map((host) => der(0x82, Buffer.from(host, 'ascii'))))))]
      : []),
    use.kind === 'authority'
      ? sequence(BASIC_CONSTRAINTS, CRITICAL, octets(sequence(der(0x01, Buffer.from([0xff])), integer(Buffer.from([0])))))
      : sequence(BASIC_CONSTRAINTS, CRITICAL, octets(sequence())),
    // An authority signs certificates (keyCertSign); the rest sign their TLS handshakes (digitalSignature).
    use.kind === 'authority'
      ? sequence(KEY_USAGE, CRITICAL, octets(der(0x03, Buffer.from([1, 0x06]))))
      : sequence(KEY_USAGE, CRITICAL, octets(der(0x03, Buffer.from([7, 0x80])))),
    ...(use.kind === 'authority'
      ? []
      : [sequence(EXTENDED_KEY_USAGE, octets(sequence(use.kind === 'server' ? SERVER_AUTH : CLIENT_AUTH)))]),
    sequence(SUBJECT_KEY_ID, octets(octets(keyId(options.publicKey)))),
    ...(issuerCertificate === undefined ? [] : [sequence(AUTHORITY_KEY_ID, octets(sequence(der(0x80, keyId(issuerSpki)))))]),
  ]
  const until = options.until === undefined || options.until > UNTIL ? UNTIL : options.until
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    ECDSA_SHA256,
    issuerName,
    sequence(utcTime(new Date(options.now - 24 * 60 * 60_000)), utcTime(until)),
    subject,
    options.publicKey,
    explicit(3, sequence(...extensions)),
  )
  const signature = sign('sha256', tbs, { key: createPrivateKey(signer), dsaEncoding: 'der' })
  return pem(sequence(tbs, ECDSA_SHA256, bits(signature)))
}

/** A new P-256 private key, as PKCS #8 PEM, and its public key as SPKI DER. */
export const newKey = (): { readonly key: string; readonly publicKey: Buffer } => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
  }
}

/** A new P-256 key, or the one kept, and a certificate for it naming the home's host names. */
export const selfSignedCertificate = (name: string, hosts: ReadonlyArray<string>, now: number, keptKey?: string): SelfSigned => {
  const privateKey = keptKey === undefined ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey : createPrivateKey(keptKey)
  const key = keptKey ?? privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  return { certificate: issueCertificate({ name, publicKey, use: { kind: 'server', hosts }, selfKey: key, now }), key }
}
