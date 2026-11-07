import type { Shot } from './Config'

/*
 * Screenshots may visit any HTTP(S) page (ADR-097). The desktop browser
 * remains isolated from the app and refuses local-file and other schemes.
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

/** Whether a page at `url` may be drawn: over http, at any host. */
export const mayDraw = (url: string, _origins: ReadonlyArray<string>) => {
  let at: URL
  try {
    at = new URL(url)
  } catch {
    return false
  }
  return at.protocol === 'http:' || at.protocol === 'https:'
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
  const origins = running.flatMap((one) => {
    try {
      return [new URL(one).origin]
    } catch {
      return []
    }
  })
  const selector = typeof asked.selector === 'string' && asked.selector.trim() !== '' ? asked.selector.trim() : null
  return {
    url: url.href,
    width: within(asked.width, NARROWEST, WIDEST, VIEWPORT.width),
    height: within(asked.height, SHORTEST, TALLEST, VIEWPORT.height),
    fullPage: asked.full_page === true,
    selector,
    origins,
  }
}

/** What a screenshot is of, in words for the agent beside it. */
export const shotWords = (shot: Shot, taken: { readonly width: number; readonly height: number; readonly title: string }) =>
  [
    `A screenshot of ${shot.url}${taken.title === '' ? '' : ` ("${taken.title}")`}`,
    shot.selector === null ? (shot.fullPage ? ', the whole page' : '') : `, the element ${shot.selector}`,
    `, at a ${shot.width}×${shot.height} viewport: ${taken.width}×${taken.height} pixels, at 1×.`,
  ].join('')
