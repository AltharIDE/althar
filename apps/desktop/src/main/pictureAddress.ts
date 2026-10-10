/*
 * How the window asks for a picture an agent handed back: by its digest,
 * at an address of Althar's own that the main process answers from the
 * artifact store (pictures.ts). The window never names a path. Pure, so the
 * window and the main process share it.
 */

/** The scheme the window reads pictures by: `althar-picture://shot/<digest>`, with `?w=` for a smaller copy. */
export const PICTURE_SCHEME = 'althar-picture'

/** The width a smaller copy is made at: a shot alone at the thread's width, at twice its pixels. */
export const THUMB_WIDTH = 1120

/** A picture's address, for the window: the full picture, or its smaller copy. */
export const pictureUrl = (digest: string, smaller = false) => `${PICTURE_SCHEME}://shot/${digest}${smaller ? `?w=${THUMB_WIDTH}` : ''}`

/** What an address asks for: a digest, and the width of a smaller copy where it asks for one; null for anything else. */
export const pictureAsked = (url: string): { readonly digest: string; readonly width: number | null } | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PICTURE_SCHEME}:` || parsed.host !== 'shot') return null
  const digest = parsed.pathname.replace(/^\//, '')
  if (!/^[0-9a-f]{64}$/.test(digest)) return null
  const width = parsed.searchParams.get('w')
  if (width === null) return { digest, width: null }
  return width === String(THUMB_WIDTH) ? { digest, width: THUMB_WIDTH } : null
}
