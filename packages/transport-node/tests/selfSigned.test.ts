import { createPrivateKey, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { connect, createServer } from 'node:tls'

import { describe, expect, it } from 'vitest'

import { tlsPublicKeyPin } from '../src/https'
import { issueCertificate, newKey, selfSignedCertificate } from '../src/selfSigned'

describe('a home’s self-signed certificate', () => {
  it('is a P-256 certificate signed by its own key, for the names given, into 2049', () => {
    const made = selfSignedCertificate('Althar on Studio Mac', ['studio-mac.local', 'localhost'], Date.now())
    const certificate = new X509Certificate(made.certificate)
    expect(certificate.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(certificate.verify(certificate.publicKey)).toBe(true)
    expect(certificate.checkPrivateKey(createPrivateKey(made.key))).toBe(true)
    expect(certificate.subjectAltName).toBe('DNS:studio-mac.local, DNS:localhost')
    expect(certificate.subject).toBe('CN=Althar on Studio Mac')
    expect(new Date(certificate.validTo).getUTCFullYear()).toBe(2049)
    expect(new Date(certificate.validFrom).getTime()).toBeLessThan(Date.now())
    expect(certificate.raw.length).toBeLessThan(600)
  })

  it('names an unnamed home Althar, and cuts a long name to what a common name holds', () => {
    expect(new X509Certificate(selfSignedCertificate('', ['mac.local'], Date.now()).certificate).subject).toBe('CN=Althar')
    const long = new X509Certificate(selfSignedCertificate('A'.repeat(90), ['mac.local'], Date.now()).certificate)
    expect(long.subject).toBe(`CN=${'A'.repeat(64)}`)
  })

  it('keeps its key, and so the pin a paired phone holds, when made again', () => {
    const first = selfSignedCertificate('Althar', ['mac.local'], Date.now())
    const again = selfSignedCertificate('Althar', ['renamed-mac.local'], Date.now(), first.key)
    expect(again.key).toBe(first.key)
    expect(tlsPublicKeyPin(again.certificate)).toBe(tlsPublicKeyPin(first.certificate))
  })

  it('serves TLS that a client trusting only it accepts, for its name', async () => {
    const made = selfSignedCertificate('Althar', ['localhost'], Date.now())
    const server = createServer({ cert: made.certificate, key: made.key }, (socket) => socket.end('ok'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      const socket = connect({ host: '127.0.0.1', port, servername: 'localhost', ca: made.certificate })
      const [data] = (await once(socket, 'data')) as [Buffer]
      expect(socket.authorized).toBe(true)
      expect(data.toString()).toBe('ok')
      socket.destroy()
    } finally {
      server.close()
    }
  })
})

describe('a home’s own certificate authority', () => {
  const now = Date.now()
  const authority = newKey()
  const ca = issueCertificate({
    name: 'Althar home workers',
    publicKey: authority.publicKey,
    use: { kind: 'authority' },
    selfKey: authority.key,
    now,
  })
  const issuer = { certificate: ca, key: authority.key }

  it('is an authority that signs, and signs a server and a client it names', () => {
    const made = new X509Certificate(ca)
    expect(made.ca).toBe(true)
    expect(made.verify(made.publicKey)).toBe(true)
    expect(made.keyUsage).toBeUndefined()
    const worker = newKey()
    const client = new X509Certificate(
      issueCertificate({ name: 'wrk_0123', publicKey: worker.publicKey, use: { kind: 'client' }, issuer, now }),
    )
    expect(client.ca).toBe(false)
    expect(client.subject).toBe('CN=wrk_0123')
    expect(client.issuer).toBe('CN=Althar home workers')
    expect(client.checkIssued(made)).toBe(true)
    expect(client.verify(made.publicKey)).toBe(true)
    expect(client.keyUsage).toEqual(['1.3.6.1.5.5.7.3.2'])
  })

  it('makes a mutual TLS handshake that trusts only it, for the name the server carries', async () => {
    const server = newKey()
    const serving = issueCertificate({
      name: 'home',
      publicKey: server.publicKey,
      use: { kind: 'server', hosts: ['home.althar.invalid'] },
      issuer,
      now,
    })
    const worker = newKey()
    const client = issueCertificate({ name: 'wrk', publicKey: worker.publicKey, use: { kind: 'client' }, issuer, now })
    const tls = createServer({ cert: serving, key: server.key, ca, requestCert: true, rejectUnauthorized: true }, (socket) =>
      socket.end(socket.authorized ? 'ok' : 'no'),
    )
    tls.listen(0, '127.0.0.1')
    await once(tls, 'listening')
    try {
      const { port } = tls.address() as AddressInfo
      const socket = connect({ host: '127.0.0.1', port, servername: 'home.althar.invalid', ca, cert: client, key: worker.key })
      const [data] = (await once(socket, 'data')) as [Buffer]
      expect(socket.authorized).toBe(true)
      expect(data.toString()).toBe('ok')
      socket.destroy()
    } finally {
      tls.close()
    }
  })

  it('needs a key to sign with', () => {
    expect(() => issueCertificate({ name: 'x', publicKey: newKey().publicKey, use: { kind: 'client' }, now })).toThrow()
  })
})
