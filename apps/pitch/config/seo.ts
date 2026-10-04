/* Page metadata that depends on where the site is deployed. Pure, so the
   prerender and the tests share it.

   SITE_URL (e.g. https://althar.dev) adds canonical links, absolute
   social-card URLs and a sitemap. SITE_NOINDEX=1 keeps a deployment out of search. */

import type { PageMeta } from '../src/meta'

export interface SeoOptions {
  /** Public origin, without a trailing slash. */
  origin?: string | undefined
  /** Base path the site is served from, with slashes at both ends. */
  base: string
  /** Ask search engines not to index this deployment. */
  noindex: boolean
}

/** Checks SITE_URL is an origin, and drops a trailing slash. */
export function parseOrigin(siteUrl: string | undefined): string | undefined {
  if (!siteUrl) return undefined
  const origin = siteUrl.replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error(`SITE_URL must be an origin like https://example.com, got "${siteUrl}"`)
  return origin
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const attr = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c] ?? c)

/** Joins the base path and a page path: ('/brief/', '/research/') -> '/brief/research/'. */
export const joinBase = (base: string, path: string): string => `${base.replace(/\/$/, '')}${path}`

/** The <title> and <meta>/<link> tags for one page. */
export function headTags(page: PageMeta, { origin, base, noindex }: SeoOptions): { title: string; tags: string } {
  const url = origin ? `${origin}${joinBase(base, page.path)}` : undefined
  const image = `${origin ?? ''}${joinBase(base, '/og.png')}`
  const meta = (k: 'name' | 'property', key: string, content: string): string => `<meta ${k}="${key}" content="${attr(content)}" />`
  const tags = [
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Althar'),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', 'Althar: agents come and go, the project stays.'),
    meta('name', 'twitter:card', 'summary_large_image'),
  ]
  if (url && !page.noindex) tags.push(meta('property', 'og:url', url), `<link rel="canonical" href="${attr(url)}" />`)
  if (noindex || page.noindex) tags.push(meta('name', 'robots', 'noindex'))
  return { title: page.title, tags: tags.join('\n  ') }
}

/** Fills the built index.html shell with one page's head and prerendered body. */
export function fillShell(shell: string, page: PageMeta, body: string, opts: SeoOptions): string {
  const { title, tags } = headTags(page, opts)
  const out = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${attr(page.description)}" />`)
    .replace(/<meta name="theme-color" content="[^"]*" \/>/, `<meta name="theme-color" content="${attr(page.theme)}" />`)
    .replace('<!--head-->', tags)
    .replace('<!--app-->', body)
  if (out.includes('<!--app-->') || out.includes('<!--head-->') || !out.includes(`<title>${attr(title)}</title>`)) {
    throw new Error('The HTML shell is missing a slot: expected <title>, <!--head--> and <!--app-->')
  }
  return out
}

export const robotsTxt = (origin: string | undefined, noindex: boolean, base: string): string =>
  noindex
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${origin}${joinBase(base, '/sitemap.xml')}\n` : ''}`

export function sitemapXml(origin: string, pages: readonly PageMeta[], base: string): string {
  const urls = pages.filter((p) => !p.noindex).map((p) => `  <url><loc>${attr(`${origin}${joinBase(base, p.path)}`)}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
