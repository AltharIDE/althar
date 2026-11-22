/**
 * What the window hands to the person's browser: web pages only, http or
 * https, never a file or another app's scheme. A thread link to the web
 * arrives here (Settings › Browser keeps local addresses beside), and so
 * does a local one the person keeps outside. A remote home's links are
 * narrowed first (homes/policy.ts).
 */
export const outsideAddress = (address: string): string | null => {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}
