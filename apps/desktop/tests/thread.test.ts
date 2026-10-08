import type { ThreadItem } from '@althar/contracts'
import { Delivery, PlanState, ToolKind, ToolState } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import {
  type Block,
  blocksOf,
  planStateOf,
  type Streamed,
  targetOf,
  toolKindOf,
  toolStateOf,
  verbFor,
  verbs,
} from '../src/renderer/shared/thread'
import { card, items } from './fixtures'

const at = () => 'just now'

/** A thread's items, with its agent idle, in the fixtures' worktree. */
const source = (thread: ReadonlyArray<ThreadItem>, turnRunning = false) => ({ items: thread, turnRunning, worktree: '/w/meridian' })

describe('a thread as blocks', () => {
  it('groups what one agent does in a row into one turn, and marks changes of scene', () => {
    const thread = [
      items.you('Add a retry'),
      items.thinks('Where is the call?'),
      items.tool({ locations: [{ path: '/w/meridian/src/checkout.ts' }] }),
      items.says('Found it.'),
      items.notice({ source: 'runtime', title: 'Codex takes over.' }, null),
      items.says('Carrying on.', 'codex'),
      items.plan(
        [
          { content: 'Write the test', status: 'completed' },
          { content: 'Add the retry', status: 'in_progress' },
          { content: 'Ship', status: 'pending' },
        ],
        'codex',
      ),
      items.notice({ severity: 'warning', title: 'Context is filling up', description: 'Half left.' }, 'codex'),
      items.notice({ severity: 'error', title: 'Rate limited' }, 'codex'),
      items.notice({ source: 'runtime', severity: 'warning', title: 'Althar restarted.', description: 'The lead stopped with it.' }, null),
    ]
    const blocks = blocksOf(source(thread), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'turn', 'divider', 'turn', 'divider'])
    const [you, first, divider, second, restarted] = blocks
    expect(you).toMatchObject({ text: 'Add a retry', delivery: Delivery.Delivered, at: 'just now' })
    if (first?.kind !== 'turn' || second?.kind !== 'turn') throw new Error('Expected turns')
    expect(first.parts.map((part) => part.kind)).toEqual(['thought', 'tool', 'message'])
    expect(first.parts[1]).toMatchObject({ toolKind: ToolKind.Read, verb: 'Read', target: 'src/checkout.ts', state: ToolState.Done })
    expect(divider).toMatchObject({ text: 'Codex takes over.' })
    expect(restarted).toMatchObject({ text: 'Althar restarted. The lead stopped with it.' })
    expect(second.parts.map((part) => (part.kind === 'notice' ? [part.tone, part.text] : part.kind))).toEqual([
      'message',
      'plan',
      ['warning', 'Context is filling up Half left.'],
      ['error', 'Rate limited'],
    ])
    expect(second.parts[1]).toMatchObject({
      steps: [
        { label: 'Write the test', state: PlanState.Done },
        { label: 'Add the retry', state: PlanState.Queued },
        { label: 'Ship', state: PlanState.Queued },
      ],
    })
  })

  it('shows text still streaming in place of what the store has, until the store catches up', () => {
    const message = items.says('Hel')
    const live = (text: string): Streamed => ({ kind: 'agent_message', agentId: 'claude-code', text, at: '2026-09-30T12:00:00.000Z' })
    const shown = (text: string) => {
      const [turn] = blocksOf(source([message]), new Map([[message.id, live(text)]]), at)
      return turn?.kind === 'turn' && turn.parts[0]?.kind === 'message' ? turn.parts[0].text : undefined
    }
    expect(shown('Hello')).toBe('Hello')
    expect(shown('H')).toBe('Hel')
  })

  it('shows a message from its first words, before the window has read it, under the agent writing it', () => {
    const thread = source([items.you('Go'), items.says('Looking.')], true)
    const streaming = new Map<string, Streamed>([
      ['unread', { kind: 'agent_message', agentId: 'claude-code', text: 'Found the call', at: '2026-09-30T12:00:00.000Z' }],
      ['thinking', { kind: 'agent_thought', agentId: 'codex', text: 'Hmm', at: '2026-09-30T12:00:01.000Z' }],
    ])
    const blocks = blocksOf(thread, streaming, at)
    expect(blocks.map((block) => (block.kind === 'turn' ? [block.agentId, block.parts.map((part) => part.kind)] : block.kind))).toEqual([
      'you',
      ['claude-code', ['message', 'message']],
      ['codex', ['thought']],
    ])
  })

  it('says where a message stands with the lead, and leaves what waits behind a running turn to the composer', () => {
    const thread = [
      items.you('next', { state: 'queued', interrupting: false }),
      items.you('now', { state: 'queued', interrupting: true }),
      items.you('dropped', { state: 'withdrawn', interrupting: false }),
      items.you('old', null),
    ]
    const shown = (turnRunning: boolean, queue?: boolean) =>
      blocksOf({ ...source(thread), turnRunning, ...(queue === undefined ? {} : { queue }) }, new Map(), at).map((block) =>
        block.kind === 'you' ? [block.text, block.delivery] : null,
      )
    expect(shown(false)).toEqual([
      ['next', Delivery.Queued],
      ['now', Delivery.Interrupting],
      ['old', Delivery.Delivered],
    ])
    expect(shown(true)).toEqual([
      ['now', Delivery.Interrupting],
      ['old', Delivery.Delivered],
    ])
    // With no agent to take it, what waits is in the queue too.
    expect(shown(false, true)).toEqual(shown(true))
  })

  it('runs a plan step and a tool call only while their turn does', () => {
    const running = [items.plan([{ content: 'Test', status: 'in_progress' }]), items.tool({ status: 'in_progress' })]
    const [turn] = blocksOf(source(running, true), new Map(), at)
    expect(
      turn?.kind === 'turn' &&
        turn.parts.map((part) =>
          part.kind === 'plan' ? part.steps[0]?.state : part.kind === 'tool' ? [part.verb, part.state] : undefined,
        ),
    ).toEqual([PlanState.Running, ['Reading', ToolState.Running]])
    const [stopped] = blocksOf(source(running), new Map(), at)
    expect(stopped?.kind === 'turn' && stopped.parts[1]).toMatchObject({ verb: 'Read', state: ToolState.Cancelled })
  })
})

describe('work, folded', () => {
  const later = (item: ThreadItem, seconds: number): ThreadItem => ({
    ...item,
    createdAt: new Date(Date.parse(item.createdAt) + seconds * 1000).toISOString(),
  })
  const counts = (block: Block | undefined) =>
    block?.kind === 'turn' ? { work: block.work.map((part) => part.kind), said: block.said.map((part) => part.kind) } : undefined

  it('folds a turn under how long it worked, all but its last message', () => {
    const thread = [
      items.you('Why is it slow?'),
      items.says('Looking.'),
      items.tool(),
      later(items.tool({ title: 'Run tests', toolKind: 'execute', command: 'npm test' }), 30),
      later(items.says('The index is missing.'), 125),
      later(items.notice({ severity: 'warning', title: 'Context is filling up' }), 125),
    ]
    const [, turn] = blocksOf(source(thread), new Map(), at)
    expect(turn).toMatchObject({ live: false, took: '2m 5s', doing: null })
    expect(counts(turn)).toEqual({ work: ['message', 'tool', 'tool', 'notice'], said: ['message'] })
    // A turn that only spoke has nothing to fold; one that said nothing folds whole.
    expect(counts(blocksOf(source([items.says('Hi.')]), new Map(), at)[0])).toEqual({ work: [], said: ['message'] })
    expect(counts(blocksOf(source([items.tool(), items.thinks('Hm')]), new Map(), at)[0])).toEqual({ work: ['tool', 'thought'], said: [] })
  })

  it('leaves out of the fold an error that ended a turn, and only one that ended it', () => {
    const failed = items.notice({ severity: 'error', title: "OpenCode couldn't answer.", description: 'Endpoint is unavailable.' })
    expect(counts(blocksOf(source([failed]), new Map(), at)[0])).toEqual({ work: [], said: ['notice'] })
    expect(counts(blocksOf(source([items.says('Looking.'), items.tool(), failed]), new Map(), at)[0])).toEqual({
      work: ['tool'],
      said: ['message', 'notice'],
    })
    // Said after the error, the agent carried on: the error folds with the work.
    expect(counts(blocksOf(source([items.tool(), failed, items.says('Done after all.')]), new Map(), at)[0])).toEqual({
      work: ['tool', 'notice'],
      said: ['message'],
    })
    // A warning that ends a turn folds as before.
    const warned = items.notice({ severity: 'warning', title: 'Context is filling up' })
    expect(counts(blocksOf(source([items.says('Hi.'), warned]), new Map(), at)[0])).toEqual({ work: ['notice'], said: ['message'] })
  })

  it('folds a running turn too, saying how long it has worked so far and what it is doing now', () => {
    const thread = [
      items.you('Go'),
      items.says('I’ll look at the call.'),
      items.tool({ status: 'in_progress', locations: [{ path: '/w/meridian/src/a.ts' }] }),
    ]
    const [, turn] = blocksOf(source(thread, true), new Map(), at, '2026-09-29T12:01:12.000Z')
    expect(turn).toMatchObject({ live: true, took: '1m 12s', doing: 'Reading src/a.ts' })
    expect(counts(turn)).toEqual({ work: ['tool'], said: ['message'] })
    const thinking = blocksOf(source([items.thinks('Hm')], true), new Map(), at)[0]
    expect(thinking).toMatchObject({ doing: 'Thinking' })
    const planning = blocksOf(source([items.plan([{ content: 'Test', status: 'pending' }])], true), new Map(), at)[0]
    expect(planning).toMatchObject({ doing: 'Planning' })
    const noted = blocksOf(source([items.notice({ title: 'Hm' })], true), new Map(), at)[0]
    expect(noted).toMatchObject({ doing: null })
  })

  it("folds all of a turn a step's result ends, and stands the result under it; a task's card is a block of its own", () => {
    const result = later(items.step({ step: 'implement', summary: 'Added the retry.' }), 90)
    const thread = [items.tool(), items.says('Done.'), result, items.card(card())]
    const blocks = blocksOf(source(thread), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['turn', 'step', 'card'])
    expect(blocks[0]).toMatchObject({ took: '1m 30s' })
    expect(counts(blocks[0])).toEqual({ work: ['tool', 'message'], said: [] })
    expect(blocks[1]).toMatchObject({ result: { step: 'implement', summary: 'Added the retry.' } })
    expect(blocks[2]).toMatchObject({ card: { slug: 'add-a-retry' } })
  })

  it('folds what the agent says after its step reported with the work that led to it, once it has said it', () => {
    const thread = [items.tool(), items.step({ summary: 'Added the retry.' }), later(items.says('A review starts now.'), 12)]
    const blocks = blocksOf(source(thread), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['turn', 'step'])
    expect(counts(blocks[0])).toEqual({ work: ['tool', 'message'], said: [] })
    expect(blocks[0]).toMatchObject({ took: '12s' })
    // While it is still saying it, it stays where it is.
    expect(blocksOf(source(thread, true), new Map(), at).map((block) => block.kind)).toEqual(['turn', 'step', 'turn'])
  })
})

describe('tool calls', () => {
  it("maps ACP's kinds to the kit's, and anything else to Other", () => {
    expect(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode'].map(toolKindOf)).toEqual([
      ToolKind.Read,
      ToolKind.Edit,
      ToolKind.Delete,
      ToolKind.Move,
      ToolKind.Search,
      ToolKind.Run,
      ToolKind.Think,
      ToolKind.Fetch,
      ToolKind.Other,
    ])
    expect(Object.values(ToolKind).every((kind) => verbs[kind].plain !== '' && verbs[kind].running !== '' && verbs[kind].done !== '')).toBe(
      true,
    )
  })

  it('says what it does as it stands: running, done, or the plain verb when declined, failed or stopped', () => {
    expect(toolStateOf('completed', false)).toBe(ToolState.Done)
    expect(toolStateOf('failed', true)).toBe(ToolState.Failed)
    expect(toolStateOf('in_progress', true)).toBe(ToolState.Running)
    expect(toolStateOf('pending', false)).toBe(ToolState.Cancelled)
    expect(toolStateOf('failed', false, true)).toBe(ToolState.Declined)
    expect(planStateOf('pending', true)).toBe(PlanState.Queued)
    expect(
      [ToolState.Running, ToolState.Done, ToolState.Declined, ToolState.Failed, ToolState.Cancelled].map((state) =>
        verbFor(ToolKind.Run, state),
      ),
    ).toEqual(['Running', 'Ran', 'Run', 'Run', 'Run'])
  })

  it('says what it acted on: the file, the command, or its title', () => {
    const tool = (content: Parameters<typeof items.tool>[0]) => {
      const made = items.tool(content)
      if (made.kind !== 'tool_call') throw new Error('Expected a tool call')
      return made.content
    }
    expect(targetOf(tool({ locations: [{ path: '/w/a.ts' }] }), '/w')).toBe('a.ts')
    expect(targetOf(tool({ locations: [{ path: '/elsewhere/a.ts' }] }), '/w')).toBe('/elsewhere/a.ts')
    expect(targetOf(tool({ locations: [{ path: '/w/a.ts' }] }), null)).toBe('/w/a.ts')
    expect(targetOf(tool({ command: 'bun test' }), '/w')).toBe('bun test')
    expect(targetOf(tool({ title: 'Write hello.txt', toolKind: 'edit' }), '/w')).toBe('hello.txt')
    expect(targetOf(tool({ title: 'mcp__linear__search', toolKind: 'other' }), '/w')).toBe('mcp__linear__search')
    expect(targetOf(tool({ title: 'format sql', toolKind: 'other' }), '/w')).toBe('format sql')
    expect(targetOf(tool({ title: 'Use format_sql', toolKind: 'other' }), '/w')).toBe('format_sql')
    // A command's title is the command: none of it is a verb to take off.
    expect(targetOf(tool({ title: 'grep -n "touch" src/hall.css', toolKind: 'execute' }), '/w')).toBe('grep -n "touch" src/hall.css')
    // Codex's titles start with a verb of their own, which the row's verb says already.
    expect(targetOf(tool({ title: 'Run command', toolKind: 'execute' }), '/w')).toBe('command')
    expect(targetOf(tool({ title: 'Read file', toolKind: 'read' }), '/w')).toBe('file')
    expect(targetOf(tool({ title: 'List files', toolKind: 'search' }), '/w')).toBe('files')
  })
})
