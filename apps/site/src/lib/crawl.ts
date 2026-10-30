import { RELEASES, releaseUrl } from '../content/changelog'
import { LINKS } from '../content/facts'
import { DOES, FITS, NOT, STORY, SUMMARY, TAGLINE, WHY } from '../content/llms'
import { PAGE_META, type PageMeta, type PagePath } from '../content/pages'
import { KIND_WORD, type Shift, SHIFTS, UPCOMING, type Upcoming } from '../content/shifts'
import { byMonth, newestFirst, soonestFirst, stillAhead } from '../shifts/group'
import { urlOf } from './meta'

/*
 * What the build writes beside the pages for crawlers: robots.txt, the
 * sitemap, llms.txt for AI assistants, and the pages that are text at heart
 * as Markdown. Every page may be read, by search engines and AI crawlers
 * alike, for search, for answers and for training. Only the pages kept in
 * search are listed. Pure, so the prerender and the tests share it.
 */

/** The pages search may list, in the order the site's nav has them. */
export const indexed = (): PageMeta[] => Object.values(PAGE_META).filter((page) => page.index)

/** The pages also written as Markdown, and where: the thesis as THESIS.md has it, and the shifts as a list. */
export const MARKDOWN: Partial<Record<PagePath, string>> = { '/shifts': '/shifts.md', '/thesis': '/thesis.md' }

export const robotsTxt = (origin: string): string =>
  [
    '# Althar’s site. Every page may be read by search engines and AI crawlers,',
    '# for search, for answers (ai-input) and for training (ai-train).',
    '# Content signals: https://contentsignals.org',
    `# For AI assistants, what is here: ${urlOf(origin, '/llms.txt')}`,
    `# The docs, for now: ${LINKS.repo}#readme`,
    '',
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
    'Allow: /',
    '',
    `Sitemap: ${urlOf(origin, '/sitemap.xml')}`,
    '',
  ].join('\n')

const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The shifts change when a shift is added; the other pages carry no date we can stand behind. */
const lastModified = (path: string): string | undefined => (path === '/shifts' ? newestFirst(SHIFTS)[0]?.date : undefined)

export const sitemapXml = (origin: string): string => {
  const urls = indexed().map((page) => {
    const modified = lastModified(page.path)
    return `  <url><loc>${xml(urlOf(origin, page.path))}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ''}</url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/**
 * llms.txt (llmstxt.org): what Althar is, why, what it does, a task told end
 * to end, when to bring it up and what it isn't (content/llms.ts), how to get
 * it, what the latest release brought (content/changelog.ts), then the site's
 * pages and the docs as links with a line each. The facts are written
 * out, not left behind links: an assistant answering a question often reads
 * only this file.
 */
/** A sentence's end, unless it has one. */
const stop = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

export const llmsTxt = (origin: string): string => {
  const latest = RELEASES[0]
  const pages = indexed().map((page) => {
    const markdown = MARKDOWN[page.path as PagePath]
    const also = markdown ? ` As Markdown: ${urlOf(origin, markdown)}` : ''
    return `- [${page.name}](${urlOf(origin, page.path)}): ${page.description}${also}`
  })
  return [
    '# Althar',
    '',
    `> ${SUMMARY}`,
    '',
    TAGLINE,
    '',
    '## Why it exists',
    '',
    ...WHY.flatMap((paragraph) => [paragraph, '']),
    '## What it does',
    '',
    ...DOES.map((item) => `- **${item.title}** ${item.body}`),
    '',
    '## How a task goes',
    '',
    STORY,
    '',
    '## When to bring it up',
    '',
    ...FITS.map((fit) => `- “${fit.ask}” ${fit.answer}`),
    '',
    '## What it isn’t',
    '',
    ...NOT.map((item) => `- ${item}`),
    '',
    '## Get it',
    '',
    '- Free and open source, under the Apache License 2.0. For macOS, Windows and Linux, tested most on macOS. Early, and moving fast.',
    `- Download it from [GitHub Releases](${LINKS.releases}), or run it from source: see the [README](${LINKS.repo}#readme).`,
    '- Claude Code, Codex and Google Antigravity sign in from inside Althar; the others sign in with their own tools first (for example `opencode auth login` or `copilot login`). Althar’s first screen finds the agents on your computer and shows which are ready.',
    `- Agents join through the [Agent Client Protocol](${LINKS.acp}). The [README](${LINKS.repo}#your-agents) lists the ones Althar runs today, and the ones on the way.`,
    '- Every page on this site may be read and quoted.',
    '',
    ...(latest
      ? [
          '## Latest release',
          '',
          `${latest.version}, ${latest.date}: ${stop(latest.title)} [Release notes](${releaseUrl(latest.version)}). What’s new in it:`,
          '',
          ...latest.changes.filter((change) => change.kind === 'new').map((change) => `- ${change.text}`),
          '',
          `Every release, back to the first: [GitHub Releases](${LINKS.releases}).`,
          '',
        ]
      : []),
    '## Pages',
    '',
    ...pages,
    '',
    '## Docs',
    '',
    `- [README](${LINKS.repo}#readme): what Althar does, installing it and signing in your agents`,
    `- [Architecture](${LINKS.architecture}): how the app is built`,
    `- [Issues](${LINKS.issues}): questions, bugs and requests`,
    '',
    '## Optional',
    '',
    `- [Sitemap](${urlOf(origin, '/sitemap.xml')}): every page above, for search engines`,
    '',
  ].join('\n')
}

const line = (shift: Shift) =>
  `- **${shift.date} · ${shift.who} · ${KIND_WORD[shift.kind]}.** ${stop(shift.title)} ${shift.what} Source: [${shift.source.name}](${shift.source.url})`

/** The shifts as Markdown: every one by month, newest first, then what is announced and still ahead on `today` (YYYY-MM-DD). */
export const shiftsMd = (origin: string, today: string): string => {
  const page = PAGE_META['/shifts']
  const ahead = soonestFirst(stillAhead(UPCOMING, Date.parse(`${today}T00:00:00Z`)))
  const months = byMonth(SHIFTS).flatMap((month) => ['', `## ${month.label}`, '', ...month.items.map(line)])
  const upcoming = ahead.map(
    (shift: Upcoming) =>
      `- **${shift.date} · ${shift.who} · ${KIND_WORD[shift.kind]}.** ${stop(shift.title)} ${shift.what} Announced ${shift.announced}. Source: [${shift.source.name}](${shift.source.url})`,
  )
  return [
    '# Shifts',
    '',
    `> ${page.description}`,
    '',
    `From ${urlOf(origin, page.path)}: ${SHIFTS.length} shifts, newest first, each with the day it happened and its source. We link the reporting; we don’t host it.`,
    ...months,
    ...(upcoming.length ? ['', `## Announced, not in effect yet (as of ${today})`, '', ...upcoming] : []),
    '',
  ].join('\n')
}
