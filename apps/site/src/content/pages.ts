/*
 * Each page's title, description and preview image. The build writes them
 * into the page's own index.html (vite.config.ts), and the page sets its title
 * as it opens, so the tab is right in development too.
 */

export interface PageMeta {
  path: string
  title: string
  /** At most 160 characters: what search results and link previews show. */
  description: string
  /** The link-preview image, 1200×630, from public/og/. */
  image: string
  /** False keeps the page out of search. */
  index: boolean
}

export const PAGE_META = {
  '/': {
    path: '/',
    title: 'Althar · every coding agent you pay for, in one app',
    description:
      'An open-source desktop app that runs Claude Code, Codex and OpenCode side by side, on the plans you already pay for. Other models review every task.',
    image: '/og/home.png',
    index: true,
  },
  '/shifts': {
    path: '/shifts',
    title: 'Shifts · Althar',
    description:
      'New models, limits, owners and terms for people who code with agents, since August 2026. Each one dated, with its source.',
    image: '/og/shifts.png',
    index: true,
  },
  '/thesis': {
    path: '/thesis',
    title: 'The Fourth Age of Software Engineering · Althar',
    description: 'The hypothesis Althar comes out of: how software engineering changes once coding agents are abundant.',
    image: '/og/home.png',
    index: true,
  },
  '/wallpaper': {
    path: '/wallpaper',
    title: 'Wallpaper · Althar',
    description: 'Aurora, the light Althar opens in, as a wallpaper: light and dark, for a Mac, a larger display and a phone.',
    image: '/og/wallpaper.png',
    index: true,
  },
  '/docs': {
    path: '/docs',
    title: 'Docs · Althar',
    description: 'Althar’s documentation is being written. Until it’s published: the README, the thesis and the issues on GitHub.',
    image: '/og/home.png',
    index: false,
  },
  /** The earlier page, kept for the company version: linked from nowhere, and kept out of search until then. */
  '/enterprise': {
    path: '/enterprise',
    title: 'Althar · agents come and go, the project stays',
    description: 'The earlier Althar page: a project that keeps its rules, notes, decisions and history while agents come and go.',
    image: '/og/home.png',
    index: false,
  },
} as const satisfies Record<string, PageMeta>

export type PagePath = keyof typeof PAGE_META

const isPagePath = (path: string): path is PagePath => Object.hasOwn(PAGE_META, path)

/** The page at a path, ignoring a trailing slash; any other path is the root's. */
export const pageMeta = (pathname: string): PageMeta => {
  const path = pathname.replace(/\/+$/, '') || '/'
  return isPagePath(path) ? PAGE_META[path] : PAGE_META['/']
}
