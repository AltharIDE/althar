import { sealOf, sealSvg } from '@althar/ui/seal'

/*
 * The site's one piece of server: the review seal a pull request Althar
 * opens shows in its corner (packages/ui's seal). A code host shows an
 * image only by its address, so the seal is drawn from its address here,
 * every fact in the address, and kept by caches for good: the same address
 * always draws the same seal. Everything else is the static site, which
 * wrangler.jsonc serves before this is asked.
 */

interface Env {
  readonly ASSETS: { fetch: (request: Request) => Promise<Response> }
}

/** For a year, never asked again: an address names one seal, and code hosts' image proxies keep it. */
const KEPT = 'public, max-age=31536000, immutable'

export function seal(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  const asked = sealOf(new URL(request.url))
  if (asked === null) return new Response('No such seal.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new Response(request.method === 'HEAD' ? null : sealSvg(asked.style, asked.facts, asked.ink), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': KEPT,
      // An image, never a page: nothing in it runs or loads, opened on its own too.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
}

export default {
  fetch: (request: Request, env: Env) => (new URL(request.url).pathname.startsWith('/seal/') ? seal(request) : env.ASSETS.fetch(request)),
}
