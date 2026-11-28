import type { ThreadItem } from '@althar/contracts'
import type { MergingRow } from '@althar/ui'

/*
 * What is on its way into a branch, as the pill on the composer's edge shows
 * it (MergingPill): each branch's newest merge card, and every merge kept for
 * later whose pull request isn't on one, kept current while the thread scrolls
 * on. The lines an errand that merges says as it moves on fold into it; a card
 * all in stands folded where it was asked, in the thread.
 */

type MergeLine = Extract<ThreadItem, { kind: 'merge_line' }>
type Notice = Extract<ThreadItem, { kind: 'notice' }>
export type ErrandMerges = NonNullable<Notice['content']['errand']>

export interface MergingGroup {
  /** Its card, by its item: a fresh card on the same branch is another pill, with its own life on the edge. */
  readonly id: string
  readonly key: string
  /** Every one in: the pill shows it so for a moment, where it saw them move, then goes. */
  readonly done: boolean
  /** The branch they go into, where it isn't the repository's default. */
  readonly branch: string | null
  readonly rows: ReadonlyArray<MergingRow>
}

/** A card with every pull request in: what happened, which stands where it was asked. */
export const allIn = (line: MergeLine['content']): boolean => line.rows.every((row) => row.state === 'merged')

/** Each repository and branch's newest card, by its item: the one Althar keeps current, which the pill holds while it moves. */
export const newestCards = (items: ReadonlyArray<ThreadItem>): ReadonlySet<string> => {
  const newest = new Map<string, string>()
  for (const item of items) if (item.kind === 'merge_line') newest.set(item.content.key, item.id)
  return new Set(newest.values())
}

/**
 * Each card's rows as they stand, all in or not, and what merges kept for later still wait for, by the newest line each
 * errand said, under the default branch's card while it moves (or one of their own). A card left with nothing on it, as
 * once its last one was called off, is none. `seen` is every pull request on a card of the thread, by its address.
 */
export const mergingOf = (
  cards: ReadonlyArray<{ readonly id: string; readonly card: MergeLine['content'] }>,
  errands: ReadonlyMap<string, ErrandMerges>,
  seen: ReadonlySet<string>,
): ReadonlyArray<MergingGroup> => {
  const groups: Array<MergingGroup> = cards.flatMap(({ id, card }) =>
    card.rows.length === 0
      ? []
      : [
          {
            id,
            key: card.key,
            branch: card.branch,
            done: allIn(card),
            rows: card.rows.map((row) => ({
              key: row.url,
              label: `#${row.number}`,
              title: row.title,
              url: row.url,
              state: row.state,
              ...(row.reason === undefined ? {} : { reason: row.reason }),
            })),
          },
        ],
  )
  // A pull request on a card is there already, moving or in, by its address, which tells #42 of one repository from another's;
  // a kept merge stands for it only until it is. Kept merges are told apart the same way, or by their task while they have no
  // pull request, never by the name they show.
  const kept: Array<MergingRow> = []
  const keys = new Set<string>()
  for (const [id, errand] of errands)
    errand.merges.forEach((merge, index) => {
      const key = merge.url ?? (merge.task === null ? `${id} ${index}` : `task ${merge.task}`)
      if ((merge.url !== null && seen.has(merge.url)) || keys.has(key)) return
      keys.add(key)
      kept.push({
        key,
        label: merge.label,
        title: '',
        url: merge.url,
        state: 'waiting',
        ...(merge.once === '' ? {} : { once: merge.once }),
      })
    })
  if (kept.length > 0) {
    // A card all in is what happened, not where what waits goes: those wait in a line of their own then.
    const home = groups.findIndex((group) => group.branch === null && !group.done)
    if (home === -1) groups.push({ id: 'kept', key: 'kept', branch: null, done: false, rows: kept })
    else groups[home] = { ...groups[home]!, rows: [...groups[home]!.rows, ...kept] }
  }
  return groups
}

/** What is on its way in by a thread's items: each branch's newest card, all in or not, and the merges kept for later. */
export const mergingIn = (items: ReadonlyArray<ThreadItem>): ReadonlyArray<MergingGroup> => {
  const newest = newestCards(items)
  const cards: Array<{ id: string; card: MergeLine['content'] }> = []
  const seen = new Set<string>()
  const errands = new Map<string, ErrandMerges>()
  for (const item of items) {
    if (item.kind === 'merge_line') {
      for (const row of item.content.rows) seen.add(row.url)
      if (newest.has(item.id)) cards.push({ id: item.id, card: item.content })
    } else if (item.kind === 'notice' && item.content.errand !== undefined) errands.set(item.content.errand.id, item.content.errand)
  }
  return mergingOf(cards, errands, seen)
}
