import { Delivery, PlanState, ToolKind, ToolState } from '@charrette/ui'
import { describe, expect, it } from 'vitest'

import {
  blocksOf,
  planStateOf,
  type Streamed,
  targetOf,
  toolKindOf,
  toolStateOf,
  verbFor,
  verbs,
} from '../src/renderer/features/task/thread'
import { items, snapshot } from './fixtures'

const at = () => 'just now'

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
      items.notice(
        { source: 'runtime', severity: 'warning', title: 'Charrette restarted.', description: 'The lead stopped with it.' },
        null,
      ),
    ]
    const blocks = blocksOf(snapshot({ items: thread }), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'turn', 'divider', 'turn', 'divider'])
    const [you, first, divider, second, restarted] = blocks
    expect(you).toMatchObject({ text: 'Add a retry', delivery: Delivery.Delivered, at: 'just now' })
    if (first?.kind !== 'turn' || second?.kind !== 'turn') throw new Error('Expected turns')
    expect(first.parts.map((part) => part.kind)).toEqual(['thought', 'tool', 'message'])
    expect(first.parts[1]).toMatchObject({ toolKind: ToolKind.Read, verb: 'Read', target: 'src/checkout.ts', state: ToolState.Done })
    expect(divider).toMatchObject({ text: 'Codex takes over.' })
    expect(restarted).toMatchObject({ text: 'Charrette restarted. The lead stopped with it.' })
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
      const [turn] = blocksOf(snapshot({ items: [message] }), new Map([[message.id, live(text)]]), at)
      return turn?.kind === 'turn' && turn.parts[0]?.kind === 'message' ? turn.parts[0].text : undefined
    }
    expect(shown('Hello')).toBe('Hello')
    expect(shown('H')).toBe('Hel')
  })

  it('shows a message from its first words, before the window has read it, under the agent writing it', () => {
    const thread = snapshot({ items: [items.you('Go'), items.says('Looking.')] })
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

  it('says where a message stands with the lead', () => {
    const thread = [
      items.you('next', { state: 'queued', interrupting: false }),
      items.you('now', { state: 'queued', interrupting: true }),
      items.you('old', null),
    ]
    expect(
      blocksOf(snapshot({ items: thread }), new Map(), at).map((block) => (block.kind === 'you' ? [block.text, block.delivery] : null)),
    ).toEqual([
      ['next', Delivery.Queued],
      ['now', Delivery.Interrupting],
      ['old', Delivery.Delivered],
    ])
  })

  it('runs a plan step and a tool call only while their turn does', () => {
    const running = snapshot({ items: [items.plan([{ content: 'Test', status: 'in_progress' }]), items.tool({ status: 'in_progress' })] })
    const [turn] = blocksOf(
      { ...running, session: running.session === null ? null : { ...running.session, turnRunning: true } },
      new Map(),
      at,
    )
    expect(
      turn?.kind === 'turn' &&
        turn.parts.map((part) =>
          part.kind === 'plan' ? part.steps[0]?.state : part.kind === 'tool' ? [part.verb, part.state] : undefined,
        ),
    ).toEqual([PlanState.Running, ['Reading', ToolState.Running]])
    const [stopped] = blocksOf(snapshot({ ...running, session: null }), new Map(), at)
    expect(stopped?.kind === 'turn' && stopped.parts[1]).toMatchObject({ verb: 'Read', state: ToolState.Cancelled })
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
