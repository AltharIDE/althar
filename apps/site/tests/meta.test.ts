import { describe, expect, it } from 'vite-plus/test'

import { PAGE_META, pageMeta } from '../src/content/pages'
import { withMeta } from '../src/lib/meta'

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Old title</title>
  <meta name="description" content="Old description." />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</head>
<body><div id="app"></div></body>
</html>`

describe('page meta', () => {
  const pages = Object.values(PAGE_META)

  it('has a page for the root and each route, keyed by its own path', () => {
    expect(Object.keys(PAGE_META).sort()).toEqual(['/', '/enterprise', '/shifts', '/thesis'])
    for (const [path, meta] of Object.entries(PAGE_META)) expect(meta.path).toBe(path)
  })

  it('gives every page its own title and description, short enough for search results', () => {
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length)
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length)
    for (const p of pages) {
      expect(p.title.length).toBeLessThanOrEqual(60)
      expect(p.description.length).toBeLessThanOrEqual(160)
      expect(p.description.endsWith('.')).toBe(true)
      expect(p.image).toMatch(/^\/og\/[a-z]+\.png$/)
    }
  })

  it('keeps only the enterprise page out of search', () => {
    expect(pages.filter((p) => !p.index).map((p) => p.path)).toEqual(['/enterprise'])
  })

  it('finds a page by path, ignoring a trailing slash, and falls back to the root', () => {
    expect(pageMeta('/shifts/').path).toBe('/shifts')
    expect(pageMeta('/thesis').path).toBe('/thesis')
    expect(pageMeta('/nowhere').path).toBe('/')
    expect(pageMeta('/').path).toBe('/')
  })
})

describe('withMeta', () => {
  const page = { path: '/shifts', title: 'Shifts · Althar', description: 'What changed, and when.', image: '/og/shifts.png', index: true }

  it('replaces the title and the description', () => {
    const out = withMeta(HTML, page, '')
    expect(out).toContain('<title>Shifts · Althar</title>')
    expect(out).toContain('<meta name="description" content="What changed, and when." />')
    expect(out).not.toContain('Old title')
    expect(out).not.toContain('Old description.')
  })

  it('adds the preview tags inside the head, once', () => {
    const out = withMeta(withMeta(HTML, page, ''), page, '')
    const head = out.slice(0, out.indexOf('</head>'))
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:type', 'twitter:card']) {
      expect(head.split(tag).length - 1).toBe(1)
    }
    expect(head).toContain('<meta property="og:image" content="/og/shifts.png" />')
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('makes the image and the page address absolute when the origin is known', () => {
    const out = withMeta(HTML, page, 'https://example.test/')
    expect(out).toContain('<meta property="og:image" content="https://example.test/og/shifts.png" />')
    expect(out).toContain('<meta property="og:url" content="https://example.test/shifts" />')
    expect(withMeta(HTML, page, '')).not.toContain('og:url')
  })

  it('marks a page that stays out of search, and only that one', () => {
    expect(withMeta(HTML, { ...page, index: false }, '')).toContain('<meta name="robots" content="noindex" />')
    expect(withMeta(HTML, page, '')).not.toContain('robots')
  })

  it('escapes what goes into attributes and the title', () => {
    const out = withMeta(HTML, { ...page, title: 'A <b> & "c"', description: 'Say "hi" & go.' }, '')
    expect(out).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>')
    expect(out).toContain('content="Say &quot;hi&quot; &amp; go."')
  })
})
