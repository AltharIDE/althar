import { describe, expect, it, vi } from 'vite-plus/test'

import { asPublished, CURRENT, isOut, RELEASES, releaseUrl } from '../src/content/changelog'
import { LINKS } from '../src/content/facts'
import { PAGE_META, type PagePath } from '../src/content/pages'
import { SHIFTS } from '../src/content/shifts'
import { changelogMd, indexed, llmsTxt, MARKDOWN, robotsTxt, shiftsMd, sitemapXml } from '../src/lib/crawl'
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
    expect(HIDDEN.map((page) => page.path)).toEqual(['/docs', '/pair', '/enterprise'])
  })

  it('links llms.txt only to the site’s own pages, their Markdown, the sitemap, the repository and ACP', () => {
    const allowed = new Set([
      ...indexed().map((page) => `${ORIGIN}${page.path}`),
      ...Object.values(MARKDOWN).map((path) => `${ORIGIN}${path}`),
      `${ORIGIN}/sitemap.xml`,
      LINKS.acp,
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

  it('writes every release into the Markdown with its day, its lines and its notes', () => {
    const md = changelogMd(ORIGIN)
    for (const release of RELEASES) {
      expect(md).toContain(`## ${release.version} · ${release.title}`)
      if (isOut(release)) expect(md).toContain(`Released ${release.date}. [Release notes](${releaseUrl(release.version)})`)
      else expect(md).not.toContain(releaseUrl(release.version))
      for (const change of release.changes) expect(md).toContain(`- ${change.text}`)
    }
  })

  it('dates, links and calls current only a release that is out', () => {
    const llms = llmsTxt(ORIGIN)
    const json = JSON.stringify(structuredData('/changelog', ORIGIN))
    expect(isOut(CURRENT)).toBe(true)
    expect(llms).toContain(`${CURRENT.version}, ${CURRENT.date}:`)
    for (const release of RELEASES.filter((release) => !isOut(release))) {
      expect(changelogMd(ORIGIN)).toContain(`## ${release.version} · ${release.title}\n\nNot released yet.`)
      expect(llms).not.toContain(releaseUrl(release.version))
      expect(json).not.toContain(releaseUrl(release.version))
      expect(llms).not.toContain(`${release.version}, ${release.date}`)
    }
  })

  it('dates a release by its publish time once it goes out, on every page that tells it, whatever day its notes were written for', async () => {
    // The newest release, before its publish time is recorded and after, whatever the real record says today.
    const newest = RELEASES[0]!
    const at = '2099-01-02T09:15:00Z'
    const real = (await import('../src/content/published')).PUBLISHED
    const before = Object.fromEntries(Object.entries(real).filter(([version]) => version !== newest.version))
    expect(asPublished(newest, before).date).not.toBe('2099-01-02')
    expect(asPublished(newest, { [newest.version]: at }).date).toBe('2099-01-02')
    // Every page reads the changelog afresh, with the record as given.
    const pages = async (published: Readonly<Record<string, string>>) => {
      vi.resetModules()
      vi.doMock('../src/content/published', () => ({ PUBLISHED: published }))
      try {
        return {
          changelog: await import('../src/content/changelog'),
          crawl: await import('../src/lib/crawl'),
          structured: await import('../src/lib/structured'),
        }
      } finally {
        vi.doUnmock('../src/content/published')
      }
    }
    try {
      const coming = await pages(before)
      const written = coming.changelog.RELEASES[0]!
      expect(coming.changelog.isOut(written)).toBe(false)
      expect(coming.changelog.CURRENT.version).not.toBe(newest.version)
      expect(coming.crawl.changelogMd(ORIGIN)).toContain(`## ${newest.version} · ${newest.title}\n\nNot released yet.`)
      expect(JSON.stringify(coming.structured.structuredData('/changelog', ORIGIN))).not.toContain(releaseUrl(newest.version))

      const out = await pages({ ...before, [newest.version]: at })
      expect(out.changelog.CURRENT.version).toBe(newest.version)
      expect(out.changelog.CURRENT.date).toBe('2099-01-02')
      expect(out.crawl.changelogMd(ORIGIN)).toContain(`Released 2099-01-02. [Release notes](${releaseUrl(newest.version)})`)
      expect(out.crawl.llmsTxt(ORIGIN)).toContain(`${newest.version}, 2099-01-02:`)
      const json = JSON.stringify(out.structured.structuredData('/changelog', ORIGIN))
      expect(json).toContain('"datePublished":"2099-01-02"')
      expect(json).toContain('"dateModified":"2099-01-02"')
      expect(json).not.toContain(`"datePublished":"${written.date}"`)
    } finally {
      vi.resetModules()
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
