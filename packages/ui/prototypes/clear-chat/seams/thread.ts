// Scrappy: the thread's blocks as the app makes them, made for each side of the direction's line apart, so it falls between turns.
import { blocksOf as realBlocksOf } from '../../../../../apps/desktop/src/renderer/shared/thread'
import { proto, shownOf } from '../state'

export * from '../../../../../apps/desktop/src/renderer/shared/thread'

/** Where the current part begins in the blocks made, for the divider. */
export const splits = new WeakMap<object, number>()

export const blocksOf: typeof realBlocksOf = (source, streaming, ago, now) => {
  const p = proto.get()
  const shown = shownOf(p.direction, p.talks[p.direction])
  if (!shown.divided) return realBlocksOf(source, streaming, ago, now)
  const earlier = new Set(shown.earlier.map((item) => item.id))
  const before = source.items.filter((item) => earlier.has(item.id))
  const after = source.items.filter((item) => !earlier.has(item.id))
  const above = before.length === 0 ? [] : realBlocksOf({ ...source, items: before, turnRunning: false, queue: false }, streaming, ago, now)
  const blocks = [...above, ...realBlocksOf({ ...source, items: after }, streaming, ago, now)]
  splits.set(blocks, above.length)
  return blocks
}
