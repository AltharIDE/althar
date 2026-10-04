import { describe, expect, it } from 'vitest'

import { fillShell, headTags, joinBase, parseOrigin, robotsTxt, sitemapXml } from '../config/seo'
import { BRIEF, NOT_FOUND, PAGES, RESEARCH } from '../src/meta'

const SHELL =
  '<html><head><title>Althar</title><meta name="description" content="" /><meta name="theme-color" content="#f4f2ec" /><!--head--></head><body><div id="app"><!--app--></div></body></html>'

describe('parseOrigin', () => {
  it('accepts an origin, with or without a trailing slash', () => {
    expect(parseOrigin('https://althar.dev/')).toBe('https://althar.dev')
    expect(parseOrigin(undefined)).toBeUndefined()
  })
  it('refuses anything else', () => {
    expect(() => parseOrigin('althar.dev')).toThrow(/must be an origin/)
    expect(() => parseOrigin('https://althar.dev/brief')).toThrow(/must be an origin/)
  })
})

describe('joinBase', () => {
  it('serves pages under the base path', () => {
    expect(joinBase('/', '/research/')).toBe('/research/')
    expect(joinBase('/brief/', '/research/')).toBe('/brief/research/')
  })
})

describe('headTags', () => {
  it('adds canonical links only with an origin', () => {
    expect(headTags(BRIEF, { base: '/', noindex: false }).tags).not.toContain('canonical')
    const { tags } = headTags(RESEARCH, { origin: 'https://althar.dev', base: '/', noindex: false })
    expect(tags).toContain('<link rel="canonical" href="https://althar.dev/research/" />')
    expect(tags).toContain('content="https://althar.dev/og.png"')
  })
  it('keeps the 404 out of search, and has no canonical', () => {
    const { tags } = headTags(NOT_FOUND, { origin: 'https://althar.dev', base: '/', noindex: false })
    expect(tags).toContain('name="robots" content="noindex"')
    expect(tags).not.toContain('canonical')
  })
  it('escapes what it writes', () => {
    expect(headTags({ ...BRIEF, title: 'A "quoted" & <tagged> title' }, { base: '/', noindex: false }).tags).toContain(
      'A &quot;quoted&quot; &amp; &lt;tagged&gt; title',
    )
  })
})

describe('fillShell', () => {
  it('writes the head and the body', () => {
    const out = fillShell(SHELL, RESEARCH, '<p>hi</p>', { base: '/', noindex: false })
    expect(out).toContain('<title>Althar · Research note</title>')
    expect(out).toContain(`<meta name="theme-color" content="${RESEARCH.theme}" />`)
    expect(out).toContain('<div id="app"><p>hi</p></div>')
    expect(out).not.toContain('<!--')
  })
  it('refuses a shell without its slots', () => {
    expect(() => fillShell('<html></html>', BRIEF, '', { base: '/', noindex: false })).toThrow(/missing a slot/)
  })
})

describe('robots and sitemap', () => {
  it('points robots at the sitemap, or disallows everything', () => {
    expect(robotsTxt('https://althar.dev', false, '/')).toContain('Sitemap: https://althar.dev/sitemap.xml')
    expect(robotsTxt(undefined, true, '/')).toBe('User-agent: *\nDisallow: /\n')
  })
  it('lists the indexable pages only', () => {
    const xml = sitemapXml('https://althar.dev', PAGES, '/')
    expect(xml).toContain('<loc>https://althar.dev/</loc>')
    expect(xml).toContain('<loc>https://althar.dev/research/</loc>')
    expect(xml).not.toContain('404')
  })
})
