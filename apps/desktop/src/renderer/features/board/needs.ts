import type { WorkNeed } from '@althar/ui'

import { callKindOf, readyKindOf, whereOf } from '../../shared/calls'
import { callCardOf, text } from './BoardView'
import type { Lanes } from './lanes'

/*
 * What waits on the person in a project, as the bar's count previews it:
 * every call, a task's once, then work ready to accept, in the board's
 * order.
 * Each opens its task, where it is answered or accepted; the count itself
 * opens the first. On a task's screen (`here`, its thread), that task is
 * listed but opens nothing, and the count opens the first of the others.
 */

export const needsOf = (
  lanes: Lanes,
  name: (id: string | null) => string,
  onTask: (threadId: string) => void,
  here: string | null = null,
): WorkNeed[] => [
  ...lanes.waiting.map(({ task, call }) => {
    const card = call === null ? null : callCardOf(call, name)
    return {
      id: call?.id ?? task.taskId,
      kind: call === null ? text.status.you : callKindOf(call),
      title: card?.title ?? task.title,
      meta: task.title,
      ...(card === null ? {} : { at: card.at }),
      ...(task.threadId === here ? { here: true } : {}),
      onOpen: () => onTask(task.threadId),
    }
  }),
  ...lanes.calls.map((call) => {
    const card = callCardOf(call, name)
    return {
      id: call.id,
      kind: card.kind,
      title: card.title,
      meta: whereOf(call),
      at: card.at,
      ...(call.threadId === here ? { here: true } : {}),
      onOpen: () => onTask(call.threadId),
    }
  }),
  ...lanes.ready.map((work) => {
    const change = work.change
    // A review drafted: their pull request; else its own, or its branch.
    const meta =
      work.reviewing != null
        ? `PR #${work.reviewing.number} by ${work.reviewing.author}`
        : change === null
          ? (work.branch ?? undefined)
          : `${change.short} ${change.prefix}${change.number}`
    return {
      id: work.taskId,
      kind: readyKindOf(work),
      title: work.title,
      ...(work.checksBack != null
        ? { meta: work.checksBack }
        : work.handedBack != null
          ? { meta: work.handedBack }
          : meta === undefined
            ? {}
            : { meta }),
      ...(work.threadId === here ? { here: true } : {}),
      onOpen: () => onTask(work.threadId),
    }
  }),
]

/** The thread of the first thing that waits on the person, as the count opens it: never `here`, the one already on screen. */
export const firstNeedOf = (lanes: Lanes, here: string | null = null): string | null =>
  [
    ...lanes.waiting.map(({ task }) => task.threadId),
    ...lanes.calls.map((call) => call.threadId),
    ...lanes.ready.map((work) => work.threadId),
  ].find((threadId) => threadId !== here) ?? null
