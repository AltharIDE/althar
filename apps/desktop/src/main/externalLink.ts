import { isLocalAddress } from '@althar/contracts'

const parsed = (address: string): URL | null => {
  try {
    return new URL(address)
  } catch {
    return null
  }
}

/**
 * What the window's navigations hand to the person's browser: https, or a
 * local address over http. Never a file or another app's scheme.
 */
export const outsideAddress = (address: string): string | null => {
  const url = parsed(address)
  return url !== null && (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalAddress(address))) ? url.toString() : null
}

/**
 * What a link from a thread hands there (Settings › Browser keeps local
 * addresses beside and sends the web out): any http or https page, as it
 * opens in the person's own browser. Only a local home's window.open takes
 * this; a remote home's links are narrowed first (homes/policy.ts).
 */
export const threadLinkAddress = (address: string): string | null => {
  const url = parsed(address)
  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:') ? url.toString() : null
}
