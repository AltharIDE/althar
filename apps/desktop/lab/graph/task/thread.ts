import type { ThreadItem } from '@althar/contracts'

import { items } from '../../../tests/fixtures'
import { at, type Writer } from '../data'
import { option, scenario, worldNow } from '../state'
import { graphOf, listed, type NodeView } from '../view'

/*
 * A task's own thread, as the runtime would give it: the brief it was
 * started with, and its lead's first word once it starts. Where the thread
 * is where the mission shows (B), the plan's word heads the thread in place
 * of the brief (InThread.tsx), Althar says what started it, and the lead's
 * first word takes in what it builds on and the person's notes.
 */

/** Althar's own line in the thread, at a minute: a notice from the runtime. */
const althar = (text: string, id: string, minute: number): ThreadItem =>
  ({ ...items.notice({ title: text, source: 'runtime', severity: 'info' }, null), id, createdAt: at(minute) }) as ThreadItem

/** What the lead says as it starts, taking in what it builds on and the person's notes. */
const opening = (node: NodeView, before: ReadonlyArray<NodeView>): string => {
  const on = before.length === 0 ? 'On it.' : `On it, building on ${listed(before.map((one) => one.spec.short))}.`
  const notes = node.spec.notes ?? []
  const kept = notes.length === 0 ? '' : ` I’ll keep to your note${notes.length > 1 ? 's' : ''}.`
  return `${on}${kept} I’ll open the pull request once it’s reviewed.`
}

export const taskItems = (node: NodeView, write: Writer): ReadonlyArray<ThreadItem> => {
  const s = scenario()
  if (option.task.get() !== 'b')
    return [
      write.you(`${node.spec.title}. ${node.spec.what} Part of: ${s.asked}`, `${node.threadId}_you`, 0),
      ...(node.now.startedAt === null
        ? []
        : [
            write.says(
              'On it. I’ll open the pull request once it’s reviewed.',
              `${node.threadId}_says`,
              node.now.startedAt,
              node.spec.lead,
            ),
          ]),
    ]
  if (node.now.startedAt === null) return []
  const graph = graphOf(s, worldNow())
  const before = node.now.deps.map((dep) => graph.byKey.get(dep)).filter((one): one is NodeView => one !== undefined)
  const merged = before.filter((one) => one.stand === 'done')
  // What started it: what it waited for merging, or the mission launching; started by the person, nothing.
  const why =
    before.length === 0
      ? `Started as ${s.name} launched.`
      : merged.length === before.length
        ? `${listed(merged.map((one) => `${one.spec.short} merged as #${one.spec.pr}`))}, so this started.`
        : null
  return [
    ...(why === null ? [] : [althar(why, `${node.threadId}_started`, node.now.startedAt - 0.01)]),
    write.says(opening(node, before), `${node.threadId}_says`, node.now.startedAt, node.spec.lead),
  ].map((item, i) => ({ ...item, sequence: i + 1 }) as ThreadItem)
}
