import { StrictMode } from 'react'
import { prerender } from 'react-dom/static'

import { App } from './App'

/*
 * What the build renders to static HTML (scripts/prerender.ts): each page,
 * so it reads before any JavaScript runs, and crawlers that run none (most
 * AI ones) see its words. Then the browser hydrates it (main.tsx).
 */

/*
 * The kit counts a place with no IntersectionObserver as all on screen (its
 * useOnScreen), so the coordinator's plan would say "Starts in 30s" here and
 * "Starts 30s after you've seen it" in the browser, which can't hydrate. The
 * prerender sees nothing on screen, as the browser does before it looks.
 */
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
} as unknown as typeof IntersectionObserver

export { PAGE_META, NOT_FOUND } from './content/pages'
export { llmsTxt, MARKDOWN, robotsTxt, shiftsMd, sitemapXml } from './lib/crawl'
export { withMeta } from './lib/meta'
export { structuredData } from './lib/structured'

/** The page at a path as HTML, with its lazy parts loaded first. A part that fails to render fails the build rather than leaving a gap. */
export async function render(pathname: string): Promise<string> {
  const errors: unknown[] = []
  const { prelude } = await prerender(
    <StrictMode>
      <App pathname={pathname} />
    </StrictMode>,
    { onError: (error) => void errors.push(error) },
  )
  if (errors.length) throw new AggregateError(errors, `${pathname} failed to render`)
  return new Response(prelude).text()
}
