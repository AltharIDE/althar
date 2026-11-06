// Scrappy: what an address is to Althar's browser: a run's page, the public site, a sign-in sent out, a scheme refused.

/** The runs this page knows: main's copy of the site, and the task's worktree with its change. */
export const RUNS = {
  main: { port: 5320, address: 'http://localhost:5320/' },
  task: { port: 5321, address: 'http://localhost:5321/' },
} as const

export type Run = keyof typeof RUNS

/** Hosts whose pages are sign-ins: sent to the person's browser, where their accounts are (DEV-79, DEV-75). */
const SIGN_INS = ['linear.app', 'claude.ai', 'accounts.google.com', 'login.microsoftonline.com', 'gitlab.com']
const signInPath = (url: URL) => /^\/(login|signin|sign-in|session|oauth|authorize)/.test(url.pathname) || SIGN_INS.includes(url.hostname)

/** What loading an address comes to. */
export type Verdict =
  /** A page this browser shows: the frame's own address for it, and which copy of the site it is. */
  | { readonly kind: 'page'; readonly address: string; readonly src: string; readonly run: Run | 'public'; readonly path: string }
  /** A page that asks the person to sign in: it opens in their browser. */
  | { readonly kind: 'signin'; readonly address: string; readonly host: string }
  /** A file on this computer: never opened here. */
  | { readonly kind: 'file'; readonly address: string; readonly path: string }
  /** javascript:, data: and any other scheme: never opened here. */
  | { readonly kind: 'scheme'; readonly address: string; readonly scheme: string }
  /** A page of the web this prototype doesn't have: in the app it would load like any other. */
  | { readonly kind: 'absent'; readonly address: string; readonly host: string }
  | { readonly kind: 'blank'; readonly address: '' }

/** What the person typed, as an address: a scheme added where there is none, http for this computer. */
export const normalized = (typed: string): string => {
  const raw = typed.trim()
  if (raw === '') return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(raw)) return raw
  return /^(localhost|127\.0\.0\.1|\[::1\])/i.test(raw) ? `http://${raw}` : `https://${raw}`
}

/** Which go of the task's branch its run serves: the lead's first, or its second after the person's comments. */
let revision = 1
export const serve = (next: number) => {
  revision = next
}

/** The site's page for a path, held still (t=40) so two copies line up. */
const srcOf = (run: Run, path: string) =>
  `/site.html?run=${run}&path=${encodeURIComponent(path)}&t=40${run === 'task' && revision > 1 ? `&rev=${revision}` : ''}`

export const verdictOf = (address: string): Verdict => {
  if (address === '' || address === 'about:blank') return { kind: 'blank', address: '' }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return { kind: 'scheme', address, scheme: address.split(':')[0] ?? '' }
  }
  if (url.protocol === 'file:') return { kind: 'file', address, path: decodeURIComponent(url.pathname) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'scheme', address, scheme: url.protocol.replace(/:$/, '') }
  const path = url.pathname || '/'
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    const run = (Object.keys(RUNS) as Run[]).find((one) => String(RUNS[one].port) === url.port)
    if (run !== undefined) return { kind: 'page', address: url.toString(), src: srcOf(run, path), run, path }
    return { kind: 'absent', address: url.toString(), host: url.host }
  }
  if (signInPath(url)) return { kind: 'signin', address: url.toString(), host: url.hostname }
  if (url.hostname === 'althar.ai') return { kind: 'page', address: url.toString(), src: srcOf('main', path), run: 'public', path }
  return { kind: 'absent', address: url.toString(), host: url.hostname }
}

/** An address as the bar shows it at rest: no scheme for the web, the host in full. */
export const shown = (address: string) => address.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** The address a link in a page of the site goes to: its path on the same run, or wherever it says. */
export const followed = (from: string, href: string): string => {
  try {
    return new URL(href, from).toString()
  } catch {
    return href
  }
}

/** The run of an address on this computer, where it is one. */
export const runOf = (address: string): Run | null => {
  const verdict = verdictOf(address)
  return verdict.kind === 'page' && verdict.run !== 'public' ? verdict.run : null
}

/** The same path on the other run: main's page for the task's, and back. */
export const onRun = (address: string, run: Run): string => {
  try {
    const url = new URL(address)
    return `${RUNS[run].address.replace(/\/$/, '')}${url.pathname}${url.search}`
  } catch {
    return RUNS[run].address
  }
}
