import type { ThreadItem } from '@althar/contracts'
import type { MergingRow } from '@althar/ui'

/*
 * What is on its way into a branch, as the thread's foot shows it: every
 * merge card not yet all in, and every merge kept for later whose pull
 * request isn't on one, as one line under whatever was said since. The lines
 * an errand that merges says as it moves on fold into it; a card all in
 * stands folded where it was asked.
 */

type MergeLine = Extract<ThreadItem, { kind: 'merge_line' }>
type Notice = Extract<ThreadItem, { kind: 'notice' }>
export type ErrandMerges = NonNullable<Notice['content']['errand']>

export interface MergingGroup {
  readonly key: string
  /** The branch they go into, where it isn't the repository's default. */
  readonly branch: string | null
  readonly rows: ReadonlyArray<MergingRow>
}

/** The thread's foot while anything is on its way in. */
export interface MergingBlock {
  readonly kind: 'merging'
  readonly id: 'merging'
  readonly groups: ReadonlyArray<MergingGroup>
}

/** A card with every pull request in: what happened, which stands where it was asked. */
export const allIn = (line: MergeLine['content']): boolean => line.rows.every((row) => row.state === 'merged')

/** Each repository and branch's newest card, by its item: the one Althar keeps current, which goes to the foot while it moves. */
export const newestCards = (items: ReadonlyArray<ThreadItem>): ReadonlySet<string> => {
  const newest = new Map<string, string>()
  for (const item of items) if (item.kind === 'merge_line') newest.set(item.content.key, item.id)
  return new Set(newest.values())
}

/**
 * The foot: each card still moving, its rows as they stand, and what merges kept for later still wait for, by the newest
 * line each errand said, under the default branch's card (or one of their own); null where nothing is on its way.
 */
export const mergingOf = (
  cards: ReadonlyArray<MergeLine['content']>,
  errands: ReadonlyMap<string, ErrandMerges>,
  seen: ReadonlySet<string>,
): MergingBlock | null => {
  const groups: Array<MergingGroup> = cards.map((card) => ({
    key: card.key,
    branch: card.branch,
    rows: card.rows.map((row) => ({
      key: `#${row.number}`,
      label: `#${row.number}`,
      title: row.title,
      url: row.url,
      state: row.state,
      ...(row.reason === undefined ? {} : { reason: row.reason }),
    })),
  }))
  // A pull request on a card is there already, moving or in; a kept merge stands for it only until it is.
  const kept: Array<MergingRow> = []
  for (const [id, errand] of errands)
    for (const merge of errand.merges)
      if (!seen.has(merge.label) && !kept.some((one) => one.label === merge.label))
        kept.push({
          key: `${id} ${merge.label}`,
          label: merge.label,
          title: '',
          url: merge.url,
          state: 'waiting',
          ...(merge.once === '' ? {} : { once: merge.once }),
        })
  if (kept.length > 0) {
    const home = groups.findIndex((group) => group.branch === null)
    if (home === -1) groups.push({ key: 'kept', branch: null, rows: kept })
    else groups[home] = { ...groups[home]!, rows: [...groups[home]!.rows, ...kept] }
  }
  return groups.length === 0 ? null : { kind: 'merging', id: 'merging', groups }
}
