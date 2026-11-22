import { createPrivateKey, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { connect, createServer } from 'node:tls'

import { describe, expect, it } from 'vitest'

import { tlsPublicKeyPin } from '../src/https'
import { selfSignedCertificate } from '../src/selfSigned'

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
