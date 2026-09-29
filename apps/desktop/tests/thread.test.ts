import { Delivery, PlanState, ToolKind, ToolState } from '@charrette/ui'
import { describe, expect, it } from 'vitest'

import { blocksOf, describeTool, planStateOf, toolKindOf, toolStateOf, verbText } from '../src/renderer/features/task/thread'
import { item, snapshot } from './fixtures'

const at = () => 'just now'

describe('a thread as blocks', () => {
  it('groups what one agent does in a row into one turn, and marks changes of scene', () => {
    const items = [
      item('user_message', { text: 'Add a retry' }),
      item('agent_thought', { text: 'Where is the call?' }),
      item('tool_call', {
        title: 'Read checkout.ts',
        kind: 'read',
        status: 'completed',
        locations: [{ path: '/w/meridian/src/checkout.ts' }],
      }),
      item('agent_message', { text: 'Found it.' }),
      item('notice', { source: 'runtime', severity: 'info', title: 'Codex took over from Claude Code.' }),
      item('agent_message', { text: 'Carrying on.' }, { agentId: 'codex' }),
      item(
        'plan',
        {
          entries: [
            { content: 'Write the test', status: 'completed' },
            { content: 'Add the retry', status: 'in_progress' },
            { content: 'Ship', status: 'pending' },
          ],
        },
        { agentId: 'codex' },
      ),
      item(
        'notice',
        { source: 'agent', severity: 'warning', title: 'Context is filling up', description: 'Half left.' },
        { agentId: 'codex' },
      ),
      item('notice', { source: 'agent', severity: 'error', title: 'Rate limited' }, { agentId: 'codex' }),
      item('notice', { source: 'agent', title: 'Plain' }, { agentId: 'codex' }),
      item('step_result', {}, { agentId: 'codex' }),
    ]
    const blocks = blocksOf(snapshot({ items }), new Map(), at)
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'turn', 'divider', 'turn'])
    const [you, first, divider, second] = blocks
    expect(you).toMatchObject({ text: 'Add a retry', delivery: Delivery.Delivered, at: 'just now' })
    expect(first).toMatchObject({ agentId: 'claude-code' })
    if (first?.kind !== 'turn' || second?.kind !== 'turn') throw new Error('Expected turns')
    expect(first.parts.map((part) => part.kind)).toEqual(['thought', 'tool', 'message'])
    expect(first.parts[1]).toMatchObject({ toolKind: ToolKind.Read, verb: 'Read', target: 'src/checkout.ts', state: ToolState.Done })
    expect(divider).toMatchObject({ text: 'Codex took over from Claude Code.' })
    expect(second.parts.map((part) => (part.kind === 'notice' ? [part.tone, part.text] : part.kind))).toEqual([
      'message',
      'plan',
      ['warning', 'Context is filling up Half left.'],
      ['error', 'Rate limited'],
      ['info', 'Plain'],
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
    const message = item('agent_message', { text: 'Hel' })
    const shown = (live: string) => {
      const [turn] = blocksOf(snapshot({ items: [message] }), new Map([[message.id, live]]), at)
      return turn?.kind === 'turn' && turn.parts[0]?.kind === 'message' ? turn.parts[0].text : undefined
    }
    expect(shown('Hello')).toBe('Hello')
    expect(shown('H')).toBe('Hel')
  })

  it('says where a message stands with the lead', () => {
    const items = [
      item('user_message', { text: 'next' }, { input: { state: 'queued', interrupting: false } }),
      item('user_message', { text: 'now' }, { input: { state: 'queued', interrupting: true } }),
      item('user_message', { text: 'old' }, { input: null }),
      item('user_message', {}, {}),
    ]
    expect(
      blocksOf(snapshot({ items }), new Map(), at).map((block) => (block.kind === 'you' ? [block.text, block.delivery] : null)),
    ).toEqual([
      ['next', Delivery.Queued],
      ['now', Delivery.Interrupting],
      ['old', Delivery.Delivered],
      ['', Delivery.Delivered],
    ])
  })

  it('keeps a plan with no entries, and a thread with no session', () => {
    const [turn] = blocksOf(snapshot({ session: null, items: [item('plan', { entries: 'none' })] }), new Map(), at)
    expect(turn?.kind === 'turn' && turn.parts[0]).toMatchObject({ kind: 'plan', steps: [] })
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
    expect(Object.values(ToolKind).every((kind) => verbText[kind] !== '')).toBe(true)
  })

  it('is running only while its turn is', () => {
    expect(toolStateOf('completed', false)).toBe(ToolState.Done)
    expect(toolStateOf('failed', true)).toBe(ToolState.Failed)
    expect(toolStateOf('in_progress', true)).toBe(ToolState.Running)
    expect(toolStateOf('pending', false)).toBe(ToolState.Cancelled)
    expect(planStateOf('in_progress', true)).toBe(PlanState.Running)
  })

  it('says what it acted on: the file, the command, or its title', () => {
    expect(describeTool({ locations: [{ path: '/w/a.ts' }] }, ToolKind.Edit, '/w')).toEqual({ verb: 'Edited', target: 'a.ts' })
    expect(describeTool({ locations: [{ path: '/elsewhere/a.ts' }] }, ToolKind.Edit, '/w')).toEqual({
      verb: 'Edited',
      target: '/elsewhere/a.ts',
    })
    expect(describeTool({ locations: [{ path: '/w/a.ts' }] }, ToolKind.Read, null)).toEqual({ verb: 'Read', target: '/w/a.ts' })
    expect(describeTool({ rawInput: { command: 'bun test' } }, ToolKind.Run, '/w')).toEqual({ verb: 'Ran', target: 'bun test' })
    expect(describeTool({ rawInput: { command: ['git', 'status'] } }, ToolKind.Run, '/w')).toEqual({ verb: 'Ran', target: 'git status' })
    expect(describeTool({ title: 'Write hello.txt', rawInput: { command: [] } }, ToolKind.Edit, '/w')).toEqual({
      verb: 'Write',
      target: 'hello.txt',
    })
    expect(describeTool({ title: 'mcp__linear__search' }, ToolKind.Mcp, '/w')).toEqual({ verb: 'Used', target: 'mcp__linear__search' })
    expect(describeTool(null, ToolKind.Other, '/w')).toEqual({ verb: 'Did', target: '' })
  })
})
