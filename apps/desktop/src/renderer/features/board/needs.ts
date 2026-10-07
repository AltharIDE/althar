import type { WorkNeed } from '@althar/ui'

import { callCardOf } from './BoardView'
import type { Lanes } from './lanes'

/*
 * What waits on the person in a project, as the bar's count previews it:
 * every call, then work ready to accept, in the board's order. Each opens
 * its task, where it is answered or accepted; the count itself opens the
 * first.
 */

export const text = {
  ready: 'Ready to accept',
}

export const needsOf = (lanes: Lanes, name: (id: string | null) => string, onTask: (threadId: string) => void): WorkNeed[] => [
  ...lanes.calls.map((call) => {
    const card = callCardOf(call, name)
    return { id: call.id, kind: card.kind, title: card.title, meta: call.taskTitle, at: card.at, onOpen: () => onTask(call.threadId) }
  }),
  ...lanes.ready.map((work) => {
    const change = work.change
    const meta = change === null ? (work.branch ?? undefined) : `${change.short} ${change.prefix}${change.number}`
    return {
      id: work.taskId,
      kind: text.ready,
      title: work.title,
      ...(meta === undefined ? {} : { meta }),
      onOpen: () => onTask(work.threadId),
    }
  }),
]

/** The thread of the first thing that waits on the person, as the count opens it. */
export const firstNeedOf = (lanes: Lanes): string | null => lanes.calls[0]?.threadId ?? lanes.ready[0]?.threadId ?? null
