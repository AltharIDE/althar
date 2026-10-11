import { describe, expect, it } from 'vite-plus/test'

import { LINKS } from '../src/content/facts'
import { PAGE_META, type PagePath } from '../src/content/pages'
import { SHIFTS } from '../src/content/shifts'
import { indexed, llmsTxt, MARKDOWN, robotsTxt, shiftsMd, sitemapXml } from '../src/lib/crawl'
import { structuredData } from '../src/lib/structured'

const ORIGIN = 'https://example.test'
const HIDDEN = Object.values(PAGE_META).filter((page) => !page.index)

/** Every address in a piece of text. */
const urls = (text: string) => text.match(/https?:\/\/[^\s)<"]+/g) ?? []

describe('what crawlers are given', () => {
  it('lets every crawler read everything, and points at the sitemap and llms.txt', () => {
    const robots = robotsTxt(ORIGIN)
    expect(robots).toMatch(/^User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: \/$/m)
    expect(robots).not.toMatch(/^Disallow/m)
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
    expect(robots).toContain(`${ORIGIN}/llms.txt`)
  })

  it('lists each page kept in search, at its own address, and none kept out', () => {
    const sitemap = sitemapXml(ORIGIN)
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(listed).toEqual(indexed().map((page) => (page.path === '/' ? `${ORIGIN}/` : `${ORIGIN}${page.path}`)))
    for (const page of HIDDEN) expect(llmsTxt(ORIGIN)).not.toContain(`${ORIGIN}${page.path})`)
    expect(HIDDEN.map((page) => page.path)).toEqual(['/docs', '/enterprise'])
  })

  it('links llms.txt only to the site’s own pages, their Markdown, the sitemap and the repository', () => {
    const allowed = new Set([
      ...indexed().map((page) => `${ORIGIN}${page.path}`),
      ...Object.values(MARKDOWN).map((path) => `${ORIGIN}${path}`),
      `${ORIGIN}/sitemap.xml`,
    ])
    for (const url of urls(llmsTxt(ORIGIN))) expect(allowed.has(url) || url.startsWith(LINKS.repo)).toBe(true)
  })

  it('writes every shift into the Markdown with its day and its source', () => {
    const md = shiftsMd(ORIGIN, '2026-10-11')
    for (const shift of SHIFTS) {
      expect(md).toContain(`**${shift.date} · ${shift.who}`)
      expect(md).toContain(`(${shift.source.url})`)
    }
  })

  it('gives each page kept in search structured data with absolute addresses on the site, and none to the others', () => {
    for (const page of Object.values(PAGE_META)) {
      const data = structuredData(page.path as PagePath, ORIGIN)
      if (!page.index) {
        expect(data).toEqual([])
        continue
      }
      expect(data.length).toBeGreaterThan(0)
      const json = JSON.stringify(data)
      expect(json).toContain(`"${page.path === '/' ? `${ORIGIN}/` : `${ORIGIN}${page.path}`}"`)
      for (const url of urls(json)) expect(url.startsWith('https://')).toBe(true)
    }
  })

  it('lists every shift in the shifts page’s structured data, with its own anchor and its source', () => {
    const json = JSON.stringify(structuredData('/shifts', ORIGIN))
    for (const shift of SHIFTS) {
      expect(json).toContain(`"${ORIGIN}/shifts#${shift.id}"`)
      expect(json).toContain(`"${shift.source.url}"`)
    }
  })
})
