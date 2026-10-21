/*
 * A diff's line, cut for drawing: what changed in it marked stronger.
 */

/** A line's text, cut into what changed and what didn't, by the stretches the diff names. */
export const pieces = (text: string, changed: ReadonlyArray<string> | undefined): ReadonlyArray<{ readonly text: string; readonly changed: boolean }> => {
  if (changed === undefined || changed.length === 0) return [{ text, changed: false }]
  const out: Array<{ text: string; changed: boolean }> = []
  let rest = text
  for (const stretch of changed) {
    const at = rest.indexOf(stretch)
    if (stretch === '' || at === -1) continue
    if (at > 0) out.push({ text: rest.slice(0, at), changed: false })
    out.push({ text: stretch, changed: true })
    rest = rest.slice(at + stretch.length)
  }
  if (rest !== '') out.push({ text: rest, changed: false })
  return out
}
