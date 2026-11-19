import { type RefObject, useEffect, useState } from 'react'

/*
 * A long run of lines, as a file or a diff shows it, drawn in chunks that the
 * browser lays out and paints only once they come near the screen
 * (`content-visibility: auto`), each held until then at the size its lines
 * will take, which its view's style works out from what the chunk says of
 * them. Every line is still in the page, so it is found, selected, copied
 * and read as ever; only the drawing of what no one sees waits. A chunk takes
 * its lines' colours once it comes near too, so a long file's colours cost
 * the window what is seen, not the whole file.
 */

/** Lines to a chunk; a run no longer than this is drawn whole. */
export const CHUNK = 200

/** Which chunk a line is in, by its place in the run: chunks start at whole multiples, so lines shown later join their own. */
export const chunkOf = (at: number) => Math.floor(at / CHUNK)

/** How wide a line is, in characters as monospace draws them: a tab as two, the kit's tab size. */
export const widthOf = (line: string) => {
  let tabs = 0
  for (let at = line.indexOf('\t'); at >= 0; at = line.indexOf('\t', at + 1)) tabs += 1
  return line.length + tabs
}

/**
 * Whether a chunk is near the screen, within a screen's height of it, or has been: once near, it stays so. One that shows as
 * it is first drawn is near from the start (`initially`), so it is in its colours from the first frame. Where nothing can
 * tell, every chunk is.
 */
export function useNear(ref: RefObject<Element | null>, initially: boolean) {
  const [near, setNear] = useState(() => initially || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (near || el === null) return
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((one) => one.isIntersecting)) setNear(true)
      },
      { rootMargin: '100% 0px' },
    )
    seen.observe(el)
    return () => seen.disconnect()
  }, [ref, near])
  return near
}
