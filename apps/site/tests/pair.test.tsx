import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { pairingLinkOf } from '../../../packages/contracts/src/pairing'
import { PHONE_APP } from '../src/content/phone'
import { Pair, PairPage, readCode } from '../src/pair/Pair'
import { appLinks } from '../worker/appLinks'
import worker from '../worker/index'

/*
 * althar.ai/pair, as a phone without Althar opens it from the computer's
 * pairing QR: the code after the #, read only on the phone; and the files that
 * let the same link open Althar where the phone has it.
 */

const code = `althar-pairing1.${Buffer.from(
  JSON.stringify({
    protocol: 1,
    homeId: 'home_5c1e0a7d93b24f6e8a01c2d3e4f5a6b7',
    apiVersion: 1,
    origin: 'https://studio-mac.local:6769',
    tlsKeyPin: 'a'.repeat(64),
    token: 'A'.repeat(43),
    expiresAt: 1_800_000_000_000,
  }),
).toString('base64url')}`
const hash = new URL(pairingLinkOf(code)).hash
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'")

describe('the pairing page', () => {
  it('is built without the code: the server never has it', () => {
    const html = text(renderToString(<Pair />))
    expect(html).toContain('Pair a phone with your computer')
    expect(html).not.toContain('studio-mac')
  })

  it('reads the home and the code’s time from after the #, and nothing from elsewhere', () => {
    expect(readCode(hash)).toMatchObject({ host: 'studio-mac', expiresAt: 1_800_000_000_000 })
    for (const other of ['', '#hello', '#1.', '#1.not*base64', `#x${hash.slice(1)}`]) expect(readCode(other)).toBeNull()
  })

  it('names the home, shows its print and words, and hands the app the code as it came', () => {
    const html = renderToString(<PairPage hash={hash} platform="ios" left={119_500} />)
    expect(text(html)).toContain('Pair this phone with studio-mac')
    expect(text(html)).toContain('Your computer shows this print')
    expect(text(html)).toContain('2:00 more')
    expect(html).toContain(`href="althar://pair${hash}"`)
  })

  it('says the code ran out, once it has', () => {
    expect(text(renderToString(<PairPage hash={hash} platform="android" left={0} />))).toContain('This code ran out')
  })

  it('offers a store only once its link is known', () => {
    const html = text(renderToString(<PairPage hash={hash} platform="ios" left={60_000} />))
    if (PHONE_APP.appStore === null) expect(html).toContain('isn’t in the App Store or Google Play yet')
    else expect(html).toContain('Get Althar on the App Store')
  })
})

describe('the app-link files', () => {
  const env = { ASSETS: { fetch: async () => new Response('page') } }
  it('are missing until the apps’ signers are known, so a link opens the page', async () => {
    const apple = await worker.fetch(new Request('https://althar.ai/.well-known/apple-app-site-association'), env)
    expect(apple.status).toBe(PHONE_APP.appleTeamId === null ? 404 : 200)
    const android = await worker.fetch(new Request('https://althar.ai/.well-known/assetlinks.json'), env)
    expect(android.status).toBe(PHONE_APP.androidCertificates.length === 0 ? 404 : 200)
  })

  it('name the apps by who signs them, for /pair, once known', async () => {
    const app = { ...PHONE_APP, appleTeamId: 'ABCDE12345', androidCertificates: ['AA:BB'] }
    const apple = appLinks('/.well-known/apple-app-site-association', app)
    expect(apple.headers.get('content-type')).toBe('application/json')
    expect(await apple.json()).toEqual({
      applinks: {
        details: [
          { appIDs: ['ABCDE12345.dev.althar.mobile'], components: [{ '/': '/pair', comment: 'A pairing link: the code is after the #.' }] },
        ],
      },
    })
    expect(await appLinks('/.well-known/assetlinks.json', app).json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'dev.althar.mobile', sha256_cert_fingerprints: ['AA:BB'] },
      },
    ])
  })

  it('leave every other address to the site', async () => {
    expect(await (await worker.fetch(new Request('https://althar.ai/pair'), env)).text()).toBe('page')
  })
})
