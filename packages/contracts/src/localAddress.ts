/*
 * What counts as a local address: a page that Althar or its agents build and
 * run on this computer, rather than one on the web (ADR-100).
 */

/**
 * The window feature a thread's link passes to `window.open`, so the main
 * process can tell it from other callers and apply the thread-link rule.
 */
export const THREAD_LINK_FEATURE = 'althar-thread-link'

/**
 * Whether `address` is an http or https page on this computer: localhost
 * (or a name under `.localhost`), 127.0.0.1 or [::1], on any port. Anything
 * else, a file, another scheme, or what isn't an address, is not. A sign-in
 * in the address changes nothing here: the host is what is judged.
 */
export const isLocalAddress = (address: string): boolean => {
  try {
    const url = new URL(address)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase().replace(/\.$/u, '')
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}
