/*
 * What the browser beside a conversation may load (ADR-100). Only web pages,
 * `http:` and `https:`: a typed address, a link, a redirect, a frame or a
 * pop-up that would go anywhere else is refused, and the page stays where it
 * was. Sign-in pages of the services Althar connects to (Claude, GitHub,
 * GitLab, Linear) open in the person's own browser instead: Althar never
 * collects or passes on those credentials (DEV-79, DEV-75). Pure, so the
 * window can share the words for what was refused.
 */

/** Why an address doesn't load beside the conversation: a file on this computer, another scheme, or not an address at all. */
export type Refusal = 'file' | 'scheme' | 'address'

/** The services whose sign-in stays in the person's browser. */
export type SignInService = 'Claude' | 'GitHub' | 'GitLab' | 'Linear'

/** Where a navigation starts: the page itself, or a frame inside it. */
export type FrameKind = 'top' | 'frame'

const WEB = new Set(['http:', 'https:'])

/*
 * Inside a page, frames of these load as the page's own content, never a place of their own: a blank frame a script
 * fills, a frame's inline document, its own pictures and blobs. At the top they are refused like any other scheme.
 */
const FRAME_ONLY = new Set(['about:', 'data:', 'blob:'])

const parse = (address: string): URL | null => {
  try {
    return new URL(address)
  } catch {
    return null
  }
}

/** Why an address can't load, or null where it can: only `http:` and `https:` at the top, and those or a page's own in a frame. */
export const refusalOf = (address: string, where: FrameKind = 'top'): Refusal | null => {
  const url = parse(address)
  if (url === null) return 'address'
  if (WEB.has(url.protocol)) return null
  if (where === 'frame' && FRAME_ONLY.has(url.protocol)) return null
  return url.protocol === 'file:' ? 'file' : 'scheme'
}

/**
 * What a page hands to the person's browser (its own address, a download
 * it was refused, a sign-in): any web page's address, plain `http:` off this
 * computer too, as the page was on it already; nothing else.
 */
export const outsideOf = (address: string): string | null => {
  const url = parse(address)
  return url !== null && WEB.has(url.protocol) ? url.toString() : null
}

/** A host on this computer: localhost and its names, and the loopback addresses. */
export const isLocalHost = (host: string): boolean =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '127.0.0.1' ||
  host === '0.0.0.0' ||
  host === '[::1]' ||
  host === '::1' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)

/* A scheme as a URL begins with one; `localhost:5173` begins with a host and its port instead. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const HOST_AND_PORT = /^[^\s/:?#]+:\d{1,5}(?:[/?#]|$)/

/**
 * What the person typed in the address field, as an address to load: as it
 * is where it says its scheme, else on `http:` for this computer and
 * `https:` for anywhere else. Null where it isn't an address (words with
 * spaces, nothing). It is checked like any other address after.
 */
export const typedAddress = (typed: string): string | null => {
  const text = typed.trim()
  if (text === '' || /\s/.test(text)) return null
  if (SCHEME.test(text) && !HOST_AND_PORT.test(text)) return parse(text)?.toString() ?? null
  const host = text.replace(/^\/\//, '').split(/[/?#]/)[0] ?? ''
  const name = host.replace(/:\d+$/, '').toLowerCase()
  if (name === '' || (!name.includes('.') && !isLocalHost(name) && !name.startsWith('['))) return null
  return parse(`${isLocalHost(name) ? 'http' : 'https'}://${text.replace(/^\/\//, '')}`)?.toString() ?? null
}

interface SignIn {
  readonly service: SignInService
  readonly hosts: ReadonlyArray<string>
  /** Paths where signing in, signing up or granting an app happens: each the whole first segments, or those and more. */
  readonly paths: ReadonlyArray<string>
}

const SIGN_INS: ReadonlyArray<SignIn> = [
  {
    service: 'Claude',
    hosts: ['claude.ai', 'claude.com', 'console.anthropic.com', 'platform.claude.com'],
    paths: ['/login', '/logout', '/signup', '/sign-up', '/oauth', '/magic-link', '/auth', '/sso'],
  },
  {
    service: 'GitHub',
    hosts: ['github.com'],
    paths: ['/login', '/logout', '/session', '/sessions', '/signup', '/join', '/password_reset'],
  },
  {
    service: 'GitLab',
    hosts: ['gitlab.com'],
    paths: ['/users/sign_in', '/users/sign_up', '/users/sign_out', '/users/auth', '/users/password', '/oauth'],
  },
  { service: 'Linear', hosts: ['linear.app'], paths: ['/login', '/logout', '/signup', '/oauth', '/auth'] },
]

const onHost = (host: string, hosts: ReadonlyArray<string>) => hosts.some((one) => host === one || host === `www.${one}`)
const onPath = (path: string, paths: ReadonlyArray<string>) =>
  paths.some((one) => path === one || path.startsWith(`${one}/`) || path.startsWith(`${one}?`))

/** The service an address signs in to, where it is one whose sign-in stays in the person's browser; null for any other. */
export const signInOf = (address: string): SignInService | null => {
  const url = parse(address)
  if (url === null || !WEB.has(url.protocol)) return null
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()
  return SIGN_INS.find((one) => onHost(host, one.hosts) && onPath(path, one.paths))?.service ?? null
}

/** An address as the bar shows it: the host and what follows, without `https://` or a lone `/`. */
export const shownAddress = (address: string): string => {
  const url = parse(address)
  if (url === null || !WEB.has(url.protocol)) return address
  const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`
  return `${url.protocol === 'http:' && !isLocalHost(url.hostname) ? 'http://' : ''}${url.host}${rest}`
}
