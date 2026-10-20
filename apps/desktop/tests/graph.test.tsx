import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AttentionRequest, GraphRound, GraphStep, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { GraphNodeState, type ModelInfo } from '@althar/ui'

import { REQUEST, taskGraphOf } from '../src/renderer/features/task/graph'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's Graph face (ADR-054): its rounds of work from the runtime, each
 * step with what it came to from its report and the calls waiting on it; a
 * lane for each agent, the lead's first; a marker for each round, saying who
 * started it and taking the person to it in the conversation.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString()
const NOW = at(59)
const named = (agentId: string | null, model: string | null = null): ModelInfo => ({
  id: `${agentId}/${model ?? 'default'}`,
  name: `${agentId} ${model ?? 'default'}`,
  short: `${agentId}:${model ?? 'default'}`,
  runtime: agentId ?? '',
  efforts: [],
})

const step = (key: GraphStep['key'], iteration: number, state: GraphStep['state'], extra: Partial<GraphStep> = {}): GraphStep => ({
  id: `${key}${iteration}`,
  key,
  iteration,
  state,
  hold: null,
  agentId: key === 'review' ? 'codex' : key === 'publish' ? null : 'claude-code',
  model: key === 'review' ? 'gpt-5.2' : key === 'publish' ? null : 'opus',
  startedAt: state === 'next' ? null : at(1),
  endedAt: state === 'done' ? at(25) : null,
  added: false,
  ...extra,
})

const round = (steps: ReadonlyArray<GraphStep>, extra: Partial<GraphRound> = {}): GraphRound => ({
  id: 'run1',
  followUp: false,
  createdAt: at(0),
  endedAt: null,
  said: null,
  changedAt: null,
  steps,
  ...extra,
})

const report = (content: Partial<Extract<ThreadItem, { kind: 'step_result' }>['content']>, minute: number): ThreadItem => ({
  ...items.step(content),
  createdAt: at(minute),
})

const stuck = (why: NonNullable<AttentionRequest['stuck']>['why'], stepKey: 'implement' | 'review', round = 0): AttentionRequest => ({
  id: `st-${why}`,
  kind: 'stuck',
  title: 'Stuck',
  reason: '',
  command: null,
  createdAt: at(40),
  stuck: { step: stepKey, why, detail: null, agentId: 'codex', round, open: 1 },
})
const permission: AttentionRequest = {
  id: 'p1',
  kind: 'permission',
  title: 'Run npm test',
  reason: '',
  command: 'npm test',
  createdAt: at(30),
  stuck: null,
}

const LOOP = [
  step('implement', 0, 'done'),
  step('review', 0, 'done'),
  step('settle', 0, 'done'),
  step('review', 1, 'running'),
  step('publish', 0, 'next'),
]

const graphOf = (overrides: Partial<ThreadSnapshot> & { rounds?: ReadonlyArray<GraphRound> } = {}) => {
  const { rounds = [round(LOOP)], ...rest } = overrides
  const base = snapshot(rest)
  return taskGraphOf(
    { ...base, task: { ...base.task, lead: { agentId: 'claude-code', model: 'opus', account: null }, graph: rounds } },
    named,
    NOW,
  )
}

describe('a task’s graph, from its snapshot', () => {
  it('is nothing where the runtime keeps no rounds of work for the task', () => {
    expect(taskGraphOf(snapshot(), named, NOW)).toBeNull()
    const base = snapshot()
    expect(taskGraphOf({ ...base, task: { ...base.task, graph: [] } }, named, NOW)).toBeNull()
  })

  it('has a lane for each agent and model, the lead’s first and Althar’s last, and steps to come in their agent’s lane', () => {
    const graph = graphOf({
      rounds: [
        round([
          step('publish', 0, 'done'),
          step('review', 0, 'done'),
          step('implement', 0, 'done'),
          step('review', 1, 'next', { model: null }),
        ]),
      ],
    })
    expect(graph?.lanes.map((lane) => [lane.id, lane.lead === true])).toEqual([
      ['claude-code|opus', true],
      ['codex|gpt-5.2', false],
      ['althar', false],
    ])
    expect(graph?.lanes[2]?.who).toEqual({ kind: 'althar', name: 'Althar' })
    expect(graph?.steps.find((one) => one.id === 'review1')?.lane).toBe('codex|gpt-5.2')
  })

  it('names each step, says where it stands, how long it took, and what it came to', () => {
    const graph = graphOf({
      reports: [
        report({ step: 'review', round: 0, verdict: 'changes_requested', findings: [finding(), finding()] }, 10),
        report({ step: 'settle', round: 0 }, 20),
        report({ step: 'publish', round: 0, change: change({ number: 229, draft: true }) }, 30),
      ],
      rounds: [round([...LOOP.slice(0, 4), step('publish', 0, 'done')])],
    })
    expect(graph?.steps.map((one) => [one.label, one.state, one.corner, one.outcome, one.warn ?? false])).toEqual([
      ['Implement', GraphNodeState.Done, '24m', undefined, false],
      ['Review 1', GraphNodeState.Done, '24m', '2 findings', true],
      ['Settle', GraphNodeState.Done, '24m', '2 settled', false],
      ['Review 2', GraphNodeState.Now, '58m', undefined, false],
      ['Pull request', GraphNodeState.Done, '24m', 'Draft #229', false],
    ])
  })

  it('says a review passed, with its notes, and a pull request that merged since', () => {
    const graph = graphOf({
      reports: [
        report({ step: 'review', round: 0, verdict: 'pass', findings: [finding()] }, 10),
        report({ step: 'publish', round: 0, change: change({ number: 142 }) }, 30),
      ],
      task: { ...snapshot().task, changes: [change({ number: 142, state: 'merged', draft: false })] },
      rounds: [round([step('implement', 0, 'done'), step('review', 0, 'done'), step('publish', 0, 'done')])],
    })
    expect(graph?.steps.map((one) => one.outcome)).toEqual([undefined, 'Passed · 1 note', '#142 merged'])
  })

  it('puts what waits on the person on its step: a permission on the step at work, a stuck step’s on its own', () => {
    const asking = graphOf({ attention: [permission] })
    const review = asking?.steps.find((one) => one.id === 'review1')
    expect([review?.state, review?.corner, review?.outcome]).toEqual([GraphNodeState.Waiting, 'asks you', 'A command to allow'])
    expect(asking?.facts.get('review1')?.calls).toEqual([permission])
    const stopped = graphOf({
      attention: [stuck('no_report', 'review')],
      rounds: [round([...LOOP.slice(0, 3), step('review', 1, 'failed')])],
    })
    const failed = stopped?.steps.find((one) => one.id === 'review1')
    expect([failed?.state, failed?.corner, failed?.outcome]).toEqual([GraphNodeState.Waiting, 'stuck', 'Needs you'])
  })

  it('puts a fourth review the person’s say would add after the last settling, before what is still to come', () => {
    const graph = graphOf({
      attention: [stuck('round_limit', 'review', 3)],
      rounds: [round([...LOOP.slice(0, 3), step('review', 1, 'done'), step('settle', 1, 'done'), step('publish', 0, 'next')])],
    })
    expect(graph?.steps.map((one) => [one.label, one.state])).toEqual([
      ['Implement', GraphNodeState.Done],
      ['Review 1', GraphNodeState.Done],
      ['Settle', GraphNodeState.Done],
      ['Review 2', GraphNodeState.Done],
      ['Settle', GraphNodeState.Done],
      ['Review 4', GraphNodeState.Proposed],
      ['Pull request', GraphNodeState.Next],
    ])
    const proposed = graph?.steps.find((one) => one.state === GraphNodeState.Proposed)
    expect([proposed?.lane, proposed?.corner, proposed?.outcome]).toEqual(['codex|gpt-5.2', 'your say', 'Needs you'])
  })

  it('says what holds a step, and what a change to the steps put in', () => {
    const graph = graphOf({
      rounds: [
        round(
          [step('implement', 0, 'done'), step('review', 0, 'held', { hold: 'usage_limit' }), step('publish', 0, 'next', { added: true })],
          {
            changedAt: at(5),
          },
        ),
      ],
    })
    expect(graph?.steps.map((one) => [one.state, one.corner])).toEqual([
      [GraphNodeState.Done, '24m'],
      [GraphNodeState.Held, 'at its limit'],
      [GraphNodeState.Added, 'added'],
    ])
    expect(graph?.rounds[0]?.changed).toBe('Pull request added')
    const free = graphOf({
      rounds: [round([step('review', 0, 'held', { hold: 'machine_busy' }), step('implement', 0, 'cancelled', { endedAt: at(3) })])],
    })
    expect(free?.steps.map((one) => [one.state, one.corner])).toEqual([
      [GraphNodeState.Held, 'waits for an agent'],
      [GraphNodeState.Stopped, '2m'],
    ])
  })

  it('marks each round with who started it, how long after the one before, and where it goes in the conversation', () => {
    const said = { itemId: 'item_said', text: 'Also log each retry', relayed: false }
    const reported = report({ step: 'implement', round: 0 }, 200)
    const graph = graphOf({
      task: { ...snapshot().task, request: 'Add a retry' },
      reports: [reported],
      rounds: [
        round([step('implement', 0, 'done')], { endedAt: at(10) }),
        round([step('implement', 0, 'done', { id: 'f1' })], { id: 'run2', followUp: true, createdAt: at(12), endedAt: at(30), said }),
        round([step('implement', 0, 'running', { id: 'f2' })], {
          id: 'run3',
          followUp: true,
          createdAt: new Date(Date.UTC(2026, 9, 21, 3)).toISOString(),
          said: { ...said, itemId: 'item_relayed', relayed: true },
        }),
        round([step('implement', 0, 'done', { id: 'f3' })], { id: 'run4', followUp: true, createdAt: at(13), said: null }),
      ],
    })
    expect(graph?.rounds.map((one) => [one.by, one.after, one.said])).toEqual([
      ['You asked', undefined, 'Add a retry'],
      ['You followed up', undefined, 'Also log each retry'],
      ['From the coordinator', '17h later', 'Also log each retry'],
      ['Follow-up', undefined, ''],
    ])
    expect([...(graph?.saidAt ?? new Map()).entries()]).toEqual([
      ['run1', REQUEST],
      ['run2', 'item_said'],
      ['run3', 'item_relayed'],
      // A follow-up the thread kept no words for goes where it first reported.
      ['run4', reported.id],
    ])
  })
})

const finding = () => ({ severity: 'major' as const, file: 'src/checkout.ts', line: 12, claim: 'The retry never backs off.' })

describe('a task’s Graph face', () => {
  const graphSnapshot = (overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot => {
    const base = snapshot({
      items: [
        items.you('Add a retry'),
        { ...report({ step: 'review', round: 0, verdict: 'changes_requested', findings: [finding()] }, 10), id: 'item_review' },
      ],
      reports: [{ ...report({ step: 'review', round: 0, verdict: 'changes_requested', findings: [finding()] }, 10), id: 'item_review' }],
      ...overrides,
    })
    return {
      ...base,
      task: { ...base.task, request: 'Add a retry', lead: { agentId: 'claude-code', model: 'opus', account: null }, graph: [round(LOOP)] },
    }
  }
  function Task() {
    return <TaskView model={useTask('th1')} onBack={vi.fn()} />
  }

  it('is offered beside the conversation and outputs only where the task has rounds of work', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    withServices(<Task />, client)
    await screen.findByRole('radio', { name: /Conversation/ })
    expect(screen.queryByRole('radio', { name: /Graph/ })).toBeNull()
  })

  it('opens from its switch or g, and a card opens its report, which goes to it in the conversation', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => graphSnapshot()) })
    withServices(<Task />, client)
    await screen.findByRole('radio', { name: /Graph/ })
    fireEvent.keyDown(document.body, { key: 'g' })
    const graph = await screen.findByRole('region', { name: 'The task’s steps' })
    await user.click(within(graph).getByRole('button', { name: /Review 1/ }))
    const report = await screen.findByRole('dialog', { name: 'Review 1' })
    expect(report.textContent).toContain('The retry never backs off.')
    await user.click(within(report).getByRole('button', { name: 'Show in the conversation' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Conversation/ }).getAttribute('aria-checked')).toBe('true'))
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-item="item_review"]')))
  })

  it('takes the person from a round’s marker to what started it', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => graphSnapshot()) })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('radio', { name: /Graph/ }))
    await user.click(await screen.findByRole('button', { name: /You asked/ }))
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(`[data-item="${REQUEST}"]`)))
  })

  it('answers a stuck step where its card opens', async () => {
    const user = userEvent.setup()
    const call = stuck('no_report', 'review')
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...graphSnapshot({ attention: [call] }) })),
    })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('radio', { name: /Graph/ }))
    await user.click(await screen.findByRole('button', { name: /Review 2/ }))
    const opened = await screen.findByRole('dialog', { name: 'Review 2' })
    expect(within(opened).getAllByRole('button').length).toBeGreaterThan(1)
  })
})

describe('taking the person to a place in the conversation', () => {
  it('reads earlier pages until the item shows, and gives up where there are none', async () => {
    const { reveal } = await import('../src/renderer/features/task/reveal')
    const root = document.createElement('div')
    document.body.append(root)
    const earlier = vi.fn(async () => {
      const block = document.createElement('section')
      block.dataset.item = 'item_old'
      root.append(block)
      return true
    })
    expect(await reveal('item_old', earlier, root)).toBe(true)
    expect(earlier).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(root.querySelector('[data-item="item_old"]'))
    expect(root.querySelector('[data-item="item_old"]')?.getAttribute('tabindex')).toBe('-1')
    const none = vi.fn(async () => false)
    expect(await reveal('item_gone', none, root)).toBe(false)
    expect(none).toHaveBeenCalledTimes(1)
    // Past ten pages it stops reading.
    const endless = vi.fn(async () => true)
    expect(await reveal('item_never', endless, root)).toBe(false)
    expect(endless).toHaveBeenCalledTimes(10)
    root.remove()
  })
})
