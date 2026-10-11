import type { PageMeta } from '../content/pages'

/*
 * Writes a page's title, description, address and preview tags, and what it
 * is in structured data, into the built HTML. Pure string work, so the
 * prerender can run it on each page's copy.
 */

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** The tags this writes, marked so that writing again replaces them rather than adding a second set. */
const START = '<!-- page meta -->'
const END = '<!-- /page meta -->'

/** A page's address on the site: the root with its slash, every other page without one. */
export const urlOf = (origin: string, path: string) => `${origin.replace(/\/+$/, '')}${path}`

/** Schema.org data as a script; `<` is escaped so no string in it can close the script early. */
const jsonLd = (data: object) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`

/**
 * The page's HTML with its own meta. `origin` (such as https://example.com)
 * makes the image and the page's address absolute, as previewers and search
 * engines want them; empty, the image stays a path and the address is left out.
 * `structured` is the page's schema.org data (lib/structured.ts).
 */
export const withMeta = (html: string, page: PageMeta, origin: string, structured: readonly object[] = []): string => {
  const base = origin.replace(/\/+$/, '')
  const meta = (attr: 'name' | 'property', key: string, value: string) => `<meta ${attr}="${key}" content="${escape(value)}" />`
  const url = urlOf(base, page.path)
  const tags = [
    ...(base && page.index ? [`<link rel="canonical" href="${escape(url)}" />`] : []),
    meta('property', 'og:type', page.type ?? 'website'),
    meta('property', 'og:site_name', 'Althar'),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:image', `${base}${page.image}`),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    ...(base ? [meta('property', 'og:url', url)] : []),
    meta('name', 'twitter:card', 'summary_large_image'),
    ...(page.index ? [] : [meta('name', 'robots', 'noindex')]),
    ...structured.map(jsonLd),
  ]
  const block = `${START}\n  ${tags.join('\n  ')}\n  ${END}`
  const withoutOld = html.replace(new RegExp(`\\s*${START}[\\s\\S]*?${END}`), '')
  return withoutOld
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, meta('name', 'description', page.description))
    .replace('</head>', `  ${block}\n</head>`)
}
