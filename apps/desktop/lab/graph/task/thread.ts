import type { ThreadItem } from '@althar/contracts'

import type { Writer } from '../data'
import { scenario } from '../state'
import type { NodeView } from '../view'

/*
 * A task's own thread, as the runtime would give it: the brief it was
 * started with, and its lead's first word once it starts.
 */
export const taskItems = (node: NodeView, write: Writer): ReadonlyArray<ThreadItem> => {
  const s = scenario()
  return [
    write.you(`${node.spec.title}. ${node.spec.what} Part of: ${s.asked}`, `${node.threadId}_you`, 0),
    ...(node.now.startedAt === null
      ? []
      : [
          write.says(
            `I’ll ${node.spec.title.charAt(0).toLowerCase()}${node.spec.title.slice(1)}, then open its pull request.`,
            `${node.threadId}_says`,
            node.now.startedAt,
            node.spec.lead,
          ),
        ]),
  ]
}
