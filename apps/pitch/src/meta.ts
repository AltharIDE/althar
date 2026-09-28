/* What each page is called, shared by the prerender (static <head>) and the client (navigation). */

export interface PageMeta {
  /** Public path, relative to the site's base. */
  path: string
  /** File the prerender writes, relative to dist/. */
  file: string
  title: string
  description: string
  /** Browser UI colour: the page's background. */
  theme: string
  /** Kept out of search and the sitemap. */
  noindex?: boolean
}

export const BRIEF: PageMeta = {
  path: '/',
  file: 'index.html',
  title: 'Charrette · Brief',
  description:
    'Charrette is the open project layer for software engineering with AI agents: a memory the project owns, and a coordinator that moves work between any agents.',
  theme: '#f4f2ec',
}

export const RESEARCH: PageMeta = {
  path: '/research/',
  file: 'research/index.html',
  title: 'Charrette · Research note',
  description:
    'The missing project layer: why software engineering with AI agents needs open, provider-independent project memory and coordination.',
  theme: '#fcfbf8',
}

export const NOT_FOUND: PageMeta = {
  path: '/404/',
  file: '404.html',
  title: 'Not found · Charrette',
  description: 'This page isn’t part of the Charrette brief.',
  theme: '#2b3bff',
  noindex: true,
}

export const PAGES: readonly PageMeta[] = [BRIEF, RESEARCH, NOT_FOUND]
