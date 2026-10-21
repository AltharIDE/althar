import type { Shot } from './Config'

/*
 * A screenshot an agent asks Althar for (Launches.ts, `screenshot`): what of
 * it Althar reads, and where it may be of. Only a page served on this
 * computer, such as a run's or a dev server's on localhost, never one out on
 * the internet: Althar draws it outside the agent's sandbox, so a page
 * elsewhere would be a way out of it.
 */

/** The viewport an agent gets without saying, and the least and most it may ask for. */
export const VIEWPORT = { width: 1280, height: 800 }
const WIDEST = 3840
const TALLEST = 2160
const NARROWEST = 240
const SHORTEST = 160

/** Whether a host is this computer: localhost, a name under it, or a loopback or unspecified address. */
export const isLocal = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:1'
  )
}

const within = (value: unknown, least: number, most: number, otherwise: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(most, Math.max(least, Math.round(value))) : otherwise

/**
 * What a screenshot asked for is, or why it can't be: a page on this
 * computer, or one of the runs Althar started (`running`, where they
 * answer), over http; at the viewport asked, kept within what a screen is.
 */
export const shotOf = (input: unknown, running: ReadonlyArray<string>): Shot | string => {
  const asked = (typeof input === 'object' && input !== null ? input : {}) as Readonly<Record<string, unknown>>
  const raw = typeof asked.url === 'string' ? asked.url.trim() : ''
  if (raw === '') return 'Give the url of the page, such as http://localhost:5173/.'
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`)
  } catch {
    return `${raw} isn't an address Althar can open.`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return `Althar takes screenshots of web pages only, over http: not ${url.protocol} addresses.`
  const ours = running.some((one) => {
    try {
      return new URL(one).origin === url.origin
    } catch {
      return false
    }
  })
  if (!isLocal(url.hostname) && !ours)
    return `Althar takes screenshots only of what is served on this computer, such as a run's or a dev server's on localhost: not ${url.host}.`
  const selector = typeof asked.selector === 'string' && asked.selector.trim() !== '' ? asked.selector.trim() : null
  return {
    url: url.href,
    width: within(asked.width, NARROWEST, WIDEST, VIEWPORT.width),
    height: within(asked.height, SHORTEST, TALLEST, VIEWPORT.height),
    fullPage: asked.full_page === true,
    selector,
  }
}

/** What a screenshot is of, in words for the agent beside it. */
export const shotWords = (shot: Shot, taken: { readonly width: number; readonly height: number; readonly title: string }) =>
  [
    `A screenshot of ${shot.url}${taken.title === '' ? '' : ` ("${taken.title}")`}`,
    shot.selector === null ? (shot.fullPage ? ', the whole page' : '') : `, the element ${shot.selector}`,
    `, at a ${shot.width}×${shot.height} viewport: ${taken.width}×${taken.height} pixels, at 1×.`,
  ].join('')
