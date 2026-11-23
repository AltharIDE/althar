import { describe, expect, it } from 'vitest'
import { Api } from '../src/Api'

import { pairingCodeIn, pairingLinkOf } from '../src/pairing'

const code = 'althar-pairing1.eyJwcm90b2NvbCI6MX0'

describe('pairing links', () => {
  it('puts the code after the page address’s #, where the page’s server never sees it', () => {
    expect(pairingLinkOf(code)).toBe('https://althar.ai/pair#1.eyJwcm90b2NvbCI6MX0')
    expect(pairingLinkOf(code, 'althar://pair')).toBe('althar://pair#1.eyJwcm90b2NvbCI6MX0')
  })

  it('reads the code back from the page’s link, the app’s link, or the code itself', () => {
    expect(pairingCodeIn(pairingLinkOf(code))).toBe(code)
    expect(pairingCodeIn(pairingLinkOf(code, 'althar://pair'))).toBe(code)
    expect(pairingCodeIn('https://althar.ai/pair/#1.eyJwcm90b2NvbCI6MX0')).toBe(code)
    expect(pairingCodeIn(`  ${code}\n`)).toBe(code)
  })

  it('leaves anything else as it was given, for the decoder to refuse', () => {
    expect(pairingCodeIn('https://evil.example/pair#1.abc')).toBe('https://evil.example/pair#1.abc')
    expect(pairingCodeIn('https://althar.ai/pair#hello')).toBe('https://althar.ai/pair#hello')
    expect(pairingCodeIn('https://althar.ai/pair')).toBe('https://althar.ai/pair')
  })
})

describe('making a pairing code', () => {
  it('is a call with no command id, so no receipt keeps the code', () => {
    const rpc = Api.requests.get('CreatePairingCode')
    expect(rpc).toBeDefined()
    expect(Object.keys((rpc!.payloadSchema as unknown as { fields: object }).fields)).not.toContain('commandId')
  })
})
