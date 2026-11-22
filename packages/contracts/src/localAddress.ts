/*
 * What counts as a local address: a page that Althar or its agents build and
 * run on this computer, rather than one on the web (ADR-100).
 */

/**
 * Whether `address` is an http or https page on this computer: localhost
 * (or a name under `.localhost`), 127.0.0.1 or [::1], on any port. Anything
 * else, a file, another scheme, an address that carries a sign-in, or what
 * isn't an address, is not.
 */
export const isLocalAddress = (address: string): boolean => {
  try {
    const url = new URL(address)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username !== '' || url.password !== '') return false
    const host = url.hostname.toLowerCase().replace(/\.$/u, '')
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}
