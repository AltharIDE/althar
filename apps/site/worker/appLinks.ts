import { PHONE_APP } from '../src/content/phone'

/*
 * The files that let a pairing link (althar.ai/pair#…) open Althar on a phone
 * that has it, rather than this site: Apple's apple-app-site-association and
 * Android's assetlinks.json. Each names the app by who signs it, so it is
 * served only once that is known (src/content/phone.ts); until then it's
 * missing, and the link opens the page, which works without it. JSON, at
 * its exact address with no redirect, as both platforms fetch it.
 */

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
  })
const missing = () => new Response('Not set up yet.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export const APP_LINK_PATHS = ['/.well-known/apple-app-site-association', '/apple-app-site-association', '/.well-known/assetlinks.json']

export function appLinks(pathname: string, app: typeof PHONE_APP = PHONE_APP): Response {
  if (pathname.endsWith('apple-app-site-association'))
    return app.appleTeamId === null
      ? missing()
      : json({
          applinks: {
            details: [
              {
                appIDs: [`${app.appleTeamId}.${app.bundleId}`],
                components: [{ '/': '/pair', comment: 'A pairing link: the code is after the #.' }],
              },
            ],
          },
        })
  return app.androidCertificates.length === 0
    ? missing()
    : json([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: app.bundleId, sha256_cert_fingerprints: app.androidCertificates },
        },
      ])
}
