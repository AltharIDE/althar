// Scrappy: a case's beats as the runtime would hand its thread on: what the person said, the lead's turns with their tools, and
// Althar's lines. A line carries a key the thread's seam draws as the direction's block; a turn's took, the time it took.
import type { ReactNode } from 'react'

import type { Beat, Case, Timing } from './cases'
import type { ThreadItem } from './deps'
import { VIEWS } from './directions'
import { tookOf, totalOf } from './need'
import type { Direction } from './state'

/** The blocks Althar's lines stand for, by their key: what the thread's seam draws. */
export const BLOCKS = new Map<string, () => ReactNode>()
/** Each turn's timing, by the took its line says, with its beat. */
export const TIMES = new Map<string, { t: Timing; beat: Extract<Beat, { kind: 'lead' }> }>()
/** The case the thread is drawn for. */
export let drawing: Case | null = null

// Its first words an hour ago, so the times read as today's.
const START = Math.floor(Date.now() / 60_000) * 60_000 - 60 * 60_000
let sequence = 0
const made = new Map<string, ThreadItem[]>()

export const itemsOf = (c: Case, direction: Direction): ThreadItem[] => {
  drawing = c
  const key = `${c.key}/${direction}/${c.thread.length}`
  const view = VIEWS[direction]
  // The lead's part changes on its way, as a beat of their own after its turn.
  const beats: Beat[] = c.thread.flatMap((beat): Beat[] =>
    beat.kind === 'lead' && beat.part !== undefined
      ? [beat, { kind: 'part', who: 'lead', text: beat.part.text, ...(beat.part.change === undefined ? {} : { change: beat.part.change }) }]
      : [beat],
  )
  // The blocks are made again each read, so they draw on what the page holds now; the items keep their ids.
  BLOCKS.clear()
  TIMES.clear()
  const known = made.get(key)
  let clock = START
  let at = 0
  const out: ThreadItem[] = []
  const base = (agentId: string | null) => {
    sequence += 1
    clock += 4000
    return { id: `p${key}-${(at += 1)}`, sequence, agentId, createdAt: new Date(clock).toISOString() }
  }
  const block = (beat: Exclude<Beat, { kind: 'you' | 'lead' }>) => {
    const id = `b${at + 1}`
    BLOCKS.set(id, () => view.beat(c, beat))
    out.push({ ...base(null), kind: 'notice', content: { source: 'runtime', severity: 'info', title: `⟦${id}⟧`, description: null } })
  }
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index]!
    switch (beat.kind) {
      case 'you':
        out.push({
          ...base(null),
          kind: 'user_message',
          content: { text: beat.text, links: [], pictures: [], files: [] },
          input: { state: 'delivered', interrupting: false },
        })
        break
      case 'lead': {
        const tools = beat.tools ?? ['Read packages/ui/src/board/Board/Board.tsx']
        const total = totalOf(beat.took)
        const from = clock + 4000
        tools.forEach((title, n) => {
          out.push({
            ...base('claude-code'),
            model: 'opus',
            ...(n === 0 ? { createdAt: new Date(from).toISOString() } : {}),
            kind: 'tool_call',
            content: {
              title,
              toolKind: title.startsWith('Ran') ? 'execute' : title.startsWith('Edit') ? 'edit' : 'read',
              status: 'completed',
              command: null,
              locations: [],
              declined: false,
              pictures: [],
              files: [],
              output: null,
              exit: null,
            },
          })
        })
        // A part it changed on its way: inside its work, where the direction folds it.
        const after = beats[index + 1]
        if (after?.kind === 'part' && view.folds(after)) {
          out.push({
            ...base(null),
            kind: 'notice',
            content: { source: 'runtime', severity: 'info', title: after.text, description: null, role: 'aside' },
          })
          index += 1
        }
        // Its answer exactly its time after its first step, so its line's took finds its timing.
        const end = from + total * 1000
        clock = end - 4000
        out.push({
          ...base('claude-code'),
          model: 'opus',
          createdAt: new Date(end).toISOString(),
          kind: 'agent_message',
          content: { text: beat.text, pictures: [], files: [] },
        })
        TIMES.set(tookOf(beat.took), { t: beat.took, beat })
        break
      }
      default:
        block(beat)
    }
  }
  if (known !== undefined && known.length === out.length)
    return known.map((item, n) => ({ ...item, content: out[n]!.content }) as ThreadItem)
  made.set(key, out)
  return out
}
