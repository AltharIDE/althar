import type { PageMeta } from '../content/pages'

/*
 * Writes a page's title, description and preview tags into the built
 * index.html. Pure string work, so the build can run it on each route's copy.
 */

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** The tags this writes, marked so that writing again replaces them rather than adding a second set. */
const START = '<!-- page meta -->'
const END = '<!-- /page meta -->'

/**
 * The page's HTML with its own meta. `origin` (such as https://example.com)
 * makes the image and og:url absolute, as most previewers want; empty, the
 * image stays a path and og:url is left out.
 */
export const withMeta = (html: string, page: PageMeta, origin: string): string => {
  const base = origin.replace(/\/+$/, '')
  const meta = (attr: 'name' | 'property', key: string, value: string) => `<meta ${attr}="${key}" content="${escape(value)}" />`
  const tags = [
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:image', `${base}${page.image}`),
    ...(base ? [meta('property', 'og:url', `${base}${page.path}`)] : []),
    meta('name', 'twitter:card', 'summary_large_image'),
    ...(page.index ? [] : [meta('name', 'robots', 'noindex')]),
  ]
  const block = `${START}\n  ${tags.join('\n  ')}\n  ${END}`
  const withoutOld = html.replace(new RegExp(`\\s*${START}[\\s\\S]*?${END}`), '')
  return withoutOld
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, meta('name', 'description', page.description))
    .replace('</head>', `  ${block}\n</head>`)
}
