import type { WindowHome } from '../../homes'

export const homePartition = (home: WindowHome): string | undefined => {
  if (home.kind === 'local') return undefined
  if (!/^home_[0-9a-f]{32}$/.test(home.home.homeId)) throw new Error('This home identity is invalid.')
  return `persist:althar-home-${home.home.homeId}`
}
/**
 * What a home's window may ask its session for: only to write the clipboard, as this computer's own window may, so
 * copying its terminal's selection or a message works there too. Never to read it, a microphone or anything else.
 */
export const homeWindowAllows = (permission: string): boolean => permission === 'clipboard-sanitized-write'
export const localServicesUnavailable =
  'This connection cannot use files, previews or credentials on this computer. Use a local window for them.'

/** A remote localhost URL names the host, never the desktop. Preview forwarding is a separate capability. */
export const remoteExternalUrl = (text: string): string | null => {
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '::' ||
      host === '::1' ||
      (!host.includes('.') && !host.includes(':')) ||
      (host.startsWith('fc') && host.includes(':')) ||
      (host.startsWith('fd') && host.includes(':')) ||
      host.startsWith('fe80:') ||
      host.startsWith('::ffff:')
    )
      return null
    const ipv4 = host.split('.').map(Number)
    if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = ipv4
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168))
        return null
    }
    return url.toString()
  } catch {
    return null
  }
}
