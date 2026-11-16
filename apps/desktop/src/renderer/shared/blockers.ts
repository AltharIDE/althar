import type { TaskBlocker } from '@althar/contracts'
import { BlockerStands } from '@althar/ui'

/*
 * A task that waits for other tasks (tasks wait for their blockers): its
 * plan starts by itself once they've all merged, and waits on the person
 * once one of them is abandoned. Its row in Up next, its header and its
 * plan card say so in the same words: "Starts when Pairing merges";
 * "Pairing was abandoned".
 */

/** What of a card says what it waits for. */
export interface Waiting {
  readonly phase: string | null
  readonly waitsFor?: ReadonlyArray<TaskBlocker> | undefined
}

/** The tasks it still waits for: not merged. Empty once it has started, or where it waits for none. */
export const openBlockers = (task: Waiting): ReadonlyArray<TaskBlocker> =>
  task.phase === 'planned' || task.phase === 'held' ? (task.waitsFor ?? []).filter((one) => one.stands !== 'merged') : []

/** The first it waits for that was abandoned: it then waits on the person. */
export const abandonedBlocker = (task: Waiting): TaskBlocker | undefined => openBlockers(task).find((one) => one.stands === 'abandoned')

/** The kit's standing, from the runtime's. */
export const standsOf = (stands: TaskBlocker['stands']): BlockerStands => {
  switch (stands) {
    case 'planned':
      return BlockerStands.Planned
    case 'working':
      return BlockerStands.Working
    case 'stuck':
      return BlockerStands.Stuck
    case 'review':
      return BlockerStands.Review
    case 'merged':
      return BlockerStands.Merged
    case 'abandoned':
      return BlockerStands.Abandoned
  }
}

const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

export const blockerText = {
  startsWhen: (names: ReadonlyArray<string>) => `Starts when ${listed(names)} ${names.length === 1 ? 'merges' : 'merge'}`,
  held: (when: string) => `Held. ${when}, and you say`,
  abandoned: (name: string) => `${name} was abandoned`,
  /** On a task that waits for this one: what else it waits for, or when it starts. */
  alsoWaits: (names: ReadonlyArray<string>) => `Also waits for ${listed(names)}`,
  startsOnce: 'Starts once this merges',
  heldToo: 'Held; waits for your word too',
}

/** What it waits for, in a line: its row's reason in Up next and its header's words; null where it waits for no task. */
export const blockerWords = (task: Waiting): string | null => {
  const open = openBlockers(task)
  if (open.length === 0) return null
  const gone = open.find((one) => one.stands === 'abandoned')
  if (gone !== undefined) return blockerText.abandoned(gone.title)
  const when = blockerText.startsWhen(open.map((one) => one.title))
  return task.phase === 'held' ? blockerText.held(when) : when
}
