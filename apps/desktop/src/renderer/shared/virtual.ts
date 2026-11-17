import { Delivery } from '@althar/ui'

/*
 * What a thread drawn in part (the kit's VirtualBlocks) asks of its blocks
 * when they aren't drawn: whether one holds an item, for a search or a link
 * that takes the person there, and where the person's own messages are, for
 * the navigator's stops.
 */

/** How deep into a block an item's id is looked for: a round's work, its steps and their parts. */
const DEPTH = 8

/**
 * Whether a block holds an item, by the item's id: the block's own, or any id within it, as a turn's messages, a round's
 * report or a review's settling round are. What the drawn block marks with `data-item` or `data-items` is among them.
 */
export const holdsItem = (value: unknown, itemId: string, depth = 0): boolean => {
  if (value === null || typeof value !== 'object' || depth > DEPTH) return false
  if (Array.isArray(value)) return value.some((one) => holdsItem(one, itemId, depth + 1))
  const record = value as Record<string, unknown>
  if (record.id === itemId) return true
  for (const key in record) {
    const one = record[key]
    if (one !== null && typeof one === 'object' && holdsItem(one, itemId, depth + 1)) return true
  }
  return false
}

/** A preview's length, as the navigator shows it. */
const PREVIEW = 280

const words = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW)

/** What answered a message: a turn's words, or a round's acknowledgement or result. */
const replyOf = (block: unknown): string => {
  if (block === null || typeof block !== 'object') return ''
  const one = block as {
    kind?: string
    said?: ReadonlyArray<{ kind: string; text?: string }>
    ack?: { text: string } | null
    result?: { text: string } | null
    writing?: { text: string } | null
  }
  if (one.kind === 'turn')
    return words((one.said ?? []).flatMap((part) => (part.kind === 'message' && part.text !== undefined ? [part.text] : [])).join(' '))
  if (one.kind === 'round') return words(one.result?.text ?? one.ack?.text ?? one.writing?.text ?? '')
  return ''
}

/** The navigator's stop at a block, where it is something the person said that was delivered, with the start of its answer. */
export const stopOf = (
  blocks: ReadonlyArray<{ readonly kind: string }>,
  index: number,
): { readonly prompt: string; readonly reply: string } | null => {
  const block = blocks[index] as { kind: string; text?: string; delivery?: Delivery } | undefined
  if (block?.kind !== 'you' || block.delivery === Delivery.Queued) return null
  return { prompt: words(block.text ?? ''), reply: replyOf(blocks[index + 1]) }
}
