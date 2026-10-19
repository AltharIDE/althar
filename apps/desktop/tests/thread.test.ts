import type { ThreadItem } from '@althar/contracts'
import { Delivery, PlanState, ToolKind, ToolState } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import {
  type Block,
  blocksOf,
  type ThreadSource,
  planStateOf,
  type Streamed,
  targetOf,
  toolKindOf,
  toolStateOf,
  verbFor,
  verbs,
} from '../src/renderer/shared/thread'
import { sending } from '../src/renderer/shared/items'
import { card, items, NOW } from './fixtures'

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
    // The restart an earlier version noted isn't shown.
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'turn', 'divider', 'turn'])
    const [you, first, divider, second] = blocks
    expect(you).toMatchObject({ text: 'Add a retry', delivery: Delivery.Delivered, at: 'just now' })
    if (first?.kind !== 'turn' || second?.kind !== 'turn') throw new Error('Expected turns')
    expect(first.parts.map((part) => part.kind)).toEqual(['thought', 'tool', 'message'])
    expect(first.parts[1]).toMatchObject({ toolKind: ToolKind.Read, verb: 'Read', target: 'src/checkout.ts', state: ToolState.Done })
    expect(divider).toMatchObject({ text: 'Codex takes over.' })
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
      blocksOf({ ...source(thread), turnRunning, ...(queue === undefined ? {} : { queue }) }, new Map(), at).flatMap((block) =>
        block.kind === 'you' ? [[block.text, block.delivery]] : [],
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

  it('takes no turn before Althar carried the step on after a restart, or what the agent read since, for the one running', () => {
    const earlier = [items.says('Reading.'), items.tool({ status: 'completed' })]
    const live = (thread: ReadonlyArray<ThreadItem>) =>
      blocksOf(source(thread, true), new Map(), at).flatMap((block) => (block.kind === 'turn' && block.live ? [block.id] : []))
    expect(live(earlier)).toHaveLength(1)
    // Started again after a restart, the turn running has said nothing yet.
    expect(
      live([...earlier, items.notice({ source: 'runtime', title: 'Althar restarted; the step carried on from here.' }, null)]),
    ).toEqual([])
    expect(live([...earlier, items.you('And the docs.')])).toEqual([])
    // What waits to interrupt it leaves it running.
    expect(live([...earlier, items.you('Stop.', { state: 'queued', interrupting: true })])).toHaveLength(1)
  })
})

describe('the wait for a reply', () => {
  const after = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString()
  const kinds = (blocks: ReadonlyArray<Block>) =>
    blocks.map((block) => (block.kind === 'turn' ? `turn${block.live ? ', live' : ''}` : block.kind))

  it('holds where the reply starts while the agent has said nothing since it was asked, and leaves the reply before it over', () => {
    const thread = [items.you('Why is it slow?'), items.says('The index is missing.'), items.you('Add it, then.')]
    const waited = (seconds: number) => blocksOf({ ...source(thread, true), turnStarted: NOW }, new Map(), at, after(seconds))
    expect(kinds(waited(1))).toEqual(['you', 'turn', 'you', 'waiting'])
    // Its time and what it said are the reply's own still, with nothing of it at work.
    expect(waited(1)[1]).toMatchObject({ live: false, took: '0s', doing: null, said: [{ kind: 'message', text: 'The index is missing.' }] })
    // Seconds once they are worth saying, then that it's longer than usual.
    expect(waited(1).at(-1)).toEqual({ kind: 'waiting', id: 'waiting', took: null, slow: false })
    expect(waited(12).at(-1)).toMatchObject({ took: '12s', slow: false })
    expect(waited(34).at(-1)).toMatchObject({ took: '34s', slow: true })
    // Between turns, nothing is waited for.
    expect(kinds(blocksOf(source(thread), new Map(), at))).toEqual(['you', 'turn', 'you'])
  })

  it('gives its place to the first words, a thought or a call, whichever comes first', () => {
    const thread = [items.you('Add it.')]
    const first = (streamed: Streamed) => kinds(blocksOf(source(thread, true), new Map([['unread', streamed]]), at))
    expect(first({ kind: 'agent_message', agentId: 'claude-code', text: 'On it', at: NOW })).toEqual(['you', 'turn, live'])
    expect(first({ kind: 'agent_thought', agentId: 'claude-code', text: 'Hm', at: NOW })).toEqual(['you', 'turn, live'])
    expect(kinds(blocksOf(source([...thread, items.tool({ status: 'in_progress' })], true), new Map(), at))).toEqual(['you', 'turn, live'])
  })

  it('counts from when it was sent, through the agent’s start, and from when its turn started where it waited behind one', () => {
    const waiting = (thread: ReadonlyArray<ThreadItem>, extra: Partial<ThreadSource>) =>
      blocksOf({ ...source(thread, true), ...extra }, new Map(), at, after(65)).at(-1)
    // Sent with nothing to wait behind, it counts from then: while the agent starts, and once its turn has.
    const next = items.you('Next')
    expect(waiting([next], { turnRunning: false, reading: true })).toMatchObject({ kind: 'waiting', took: '1m 5s', slow: true })
    expect(waiting([next], { turnStarted: after(60) })).toMatchObject({ took: '1m 5s' })
    // Sent while a turn was at work, and read after it, it counts from when the turn on it started.
    const behind = [items.you('First'), { ...items.says('Still on the first'), createdAt: after(30) }, next]
    expect(waiting(behind, { turnStarted: after(60) })).toMatchObject({ kind: 'waiting', took: '5s', slow: false })
    // Where the turn heard of is the one before, from the message; where none is heard of yet, uncounted.
    expect(waiting(behind, { turnStarted: after(-600) })).toMatchObject({ took: '1m 5s', slow: true })
    expect(waiting(behind, { turnStarted: null })).toMatchObject({ took: null, slow: false })
  })

  it('lets go of the wait once a turn ended on what was asked with nothing said, but not of what is still on its way', () => {
    const thread = [items.you('Go'), items.says('Done.'), items.you('And the docs?')]
    const between = (turnEnded: string | null) => kinds(blocksOf({ ...source(thread), reading: true, turnEnded }, new Map(), at))
    // A turn ended on it since it was sent, interrupted before its first word or done without one: nothing is waited for.
    expect(between(after(5))).toEqual(['you', 'turn', 'you'])
    // The last turn ended before it, or none is heard of yet: it is still to be read.
    expect(between(after(-5))).toEqual(['you', 'turn', 'you', 'waiting'])
    expect(between(null)).toEqual(['you', 'turn', 'you', 'waiting'])
    // While a turn runs on it, it is waited on whatever ended before.
    expect(kinds(blocksOf({ ...source(thread, true), turnEnded: after(5) }, new Map(), at))).toEqual(['you', 'turn', 'you', 'waiting'])
    // Still on its way, queued in the store or the window's copy as it is sent, it is waited on however long ago it was sent.
    const queued = [
      items.you('Go'),
      items.says('Done.'),
      { ...items.you('And the docs?', { state: 'queued', interrupting: false }), createdAt: after(-60) },
    ]
    expect(kinds(blocksOf({ ...source(queued), reading: true, turnEnded: after(5) }, new Map(), at))).toEqual([
      'you',
      'turn',
      'you',
      'waiting',
    ])
    const sent = sending([items.you('Go'), items.says('Done.')], { text: 'And the docs?', queued: false, interrupting: false }).items
    const later = new Date(Date.now() + 60_000).toISOString()
    expect(kinds(blocksOf({ ...source(sent), reading: true, turnEnded: later }, new Map(), at))).toEqual(['you', 'turn', 'you', 'waiting'])
  })

  it('has what waits after the last reply asked as the agent starts to read it, and queued where nothing will', () => {
    const thread = [items.you('Go'), items.says('Done.'), items.you('And the docs?', { state: 'queued', interrupting: false })]
    const shown = (reading: boolean) => blocksOf({ ...source(thread), reading }, new Map(), at)
    expect(kinds(shown(true))).toEqual(['you', 'turn', 'you', 'waiting'])
    expect(shown(true)[2]).toMatchObject({ delivery: Delivery.Delivered })
    expect(kinds(shown(false))).toEqual(['you', 'turn', 'you'])
    expect(shown(false)[2]).toMatchObject({ delivery: Delivery.Queued })
    // Interrupting, it says so, read or not.
    const now = [items.you('Go'), items.says('Done.'), items.you('Stop', { state: 'queued', interrupting: true })]
    expect(blocksOf({ ...source(now), reading: true }, new Map(), at)[2]).toMatchObject({ delivery: Delivery.Interrupting })
  })

  it('waits on what the coordinator passed on, and on what opens the thread from outside it, but not on what waits behind a turn', () => {
    const passed = items.notice({ source: 'runtime', title: 'From the coordinator:', description: 'Ship it.', role: 'relayed' }, null)
    expect(kinds(blocksOf(source([items.says('Done.'), passed], true), new Map(), at))).toEqual(['turn', 'divider', 'waiting'])
    // Any other line of Althar's is no ask: the turn before it runs on.
    const news = items.notice({ source: 'runtime', title: 'Codex takes over.' }, null)
    expect(kinds(blocksOf(source([items.you('Go'), items.says('On it.'), news], true), new Map(), at))).toEqual([
      'you',
      'turn, live',
      'divider',
    ])
    // A task's request opens its thread above its items: the lead's first turn answers it.
    expect(kinds(blocksOf({ ...source([], true), openedAt: NOW }, new Map(), at))).toEqual(['waiting'])
    expect(kinds(blocksOf({ ...source([items.says('On it.')], true), openedAt: NOW }, new Map(), at))).toEqual(['turn, live'])
    // What waits behind the turn, or interrupts it, isn't read yet: the turn runs on.
    const running = [items.you('Go'), items.tool({ status: 'in_progress' })]
    expect(
      kinds(blocksOf(source([...running, items.you('Then this', { state: 'queued', interrupting: false })], true), new Map(), at)),
    ).toEqual(['you', 'turn, live'])
    expect(kinds(blocksOf(source([...running, items.you('Stop', { state: 'queued', interrupting: true })], true), new Map(), at))).toEqual([
      'you',
      'turn, live',
      'you',
    ])
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

  it("keeps a run the lead starts on its own after its step's result as a turn of its own, with its last message in the open", () => {
    const thread = [
      items.tool(),
      items.step({ summary: 'Published.' }),
      later(items.tool(), 60),
      later(items.says('The log was under the build output.'), 70),
      later(items.says('Branch coverage clears 90%.'), 80),
    ]
    const blocks = blocksOf(source(thread), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['turn', 'step', 'turn'])
    expect(counts(blocks[2])).toEqual({ work: ['tool', 'message'], said: ['message'] })
    expect(blocks[2]).toMatchObject({ said: [{ text: 'Branch coverage clears 90%.' }] })
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

  it('carries the rule that let a call through without asking, and nothing where none did', () => {
    const [turn] = blocksOf(
      source([
        items.tool({ command: 'git status --short', toolKind: 'execute', allowedBy: { pattern: 'git status', match: 'prefix' } }),
        items.tool({ command: 'ls', toolKind: 'execute' }),
      ]),
      new Map(),
      at,
    )
    const tools = turn?.kind === 'turn' ? turn.parts.flatMap((part) => (part.kind === 'tool' ? [part.allowedBy ?? null] : [])) : []
    expect(tools).toEqual([{ pattern: 'git status', match: 'prefix' }, null])
  })
})
