import type { ThreadItem } from '@althar/contracts'

import { duration, plural } from './words'

/*
 * A task's thread, as a phone reads it: what people and agents said, with
 * the lead's work between folded into one line a round (ADR-042: "Worked
 * 12m · edited 3 files, ran 6 commands"), and what steps reported standing
 * out. The tools themselves open from the line.
 */

type Tool = Extract<ThreadItem, { readonly kind: 'tool_call' }>

export type Block =
  | { readonly kind: 'item'; readonly item: ThreadItem }
  | {
      readonly kind: 'work'
      readonly id: string
      readonly tools: ReadonlyArray<Tool>
      /** Still going: its last tool hasn't ended. */
      readonly working: boolean
      readonly words: string
    }

const shown = (item: ThreadItem): boolean => item.kind !== 'agent_thought' && item.kind !== 'plan'

/** What a round of work did, counted: edited 3 files, ran 6 commands, read 2. */
export const workWords = (tools: ReadonlyArray<Tool>, ms: number, working: boolean): string => {
  const edited = new Set(
    tools.filter((tool) => tool.content.toolKind === 'edit').flatMap((tool) => tool.content.locations.map((place) => place.path)),
  )
  const ran = tools.filter((tool) => tool.content.toolKind === 'execute').length
  const read = tools.filter((tool) => tool.content.toolKind === 'read' || tool.content.toolKind === 'search').length
  const did = [
    edited.size > 0 ? `edited ${plural(edited.size, 'file')}` : null,
    ran > 0 ? `ran ${plural(ran, 'command')}` : null,
    read > 0 && edited.size === 0 && ran === 0 ? `read ${plural(read, 'file')}` : null,
  ].filter((part) => part !== null)
  return `${working ? 'Working' : 'Worked'} ${duration(ms)}${did.length > 0 ? ` · ${did.join(', ')}` : ''}`
}

export const blocksOf = (items: ReadonlyArray<ThreadItem>, now: number): ReadonlyArray<Block> => {
  const blocks: Array<Block> = []
  let run: Array<Tool> = []
  const close = (until: string | null) => {
    const first = run[0]
    const last = run.at(-1)
    if (first === undefined || last === undefined) return
    const working = last.content.status === 'in_progress' || last.content.status === 'pending'
    const end = until === null ? (working ? now : Date.parse(last.createdAt)) : Date.parse(until)
    blocks.push({
      kind: 'work',
      id: `work_${first.id}`,
      tools: run,
      working,
      words: workWords(run, Math.max(end - Date.parse(first.createdAt), 60_000), working),
    })
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool_call') run.push(item)
    else if (shown(item)) {
      close(item.createdAt)
      blocks.push({ kind: 'item', item })
    }
  }
  close(null)
  return blocks
}
