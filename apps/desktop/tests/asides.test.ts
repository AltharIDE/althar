import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask, type PlanStep } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { asidesOf, asideTitle, asideWords, useAsideMoves, useAsides } from '../src/renderer/features/project/Asides'
import { fakeClient } from './fixtures'

/*
 * Asides (docs/decisions/tasks.md, "Asides"): the pills' asides, those left a
 * week apart, and what a new one is titled and opens with.
 */

/** An aside on the board, as much of one as the pills read. */
const boardTask = (one: Partial<BoardTask>): BoardTask =>
  ({ threadId: `th-${one.taskId}`, phase: 'ready', scratch: true, createdAt: '2026-11-11T11:00:00.000Z', ...one }) as BoardTask

const NOW = Date.parse('2026-11-11T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

describe('asides', () => {
  it('keeps the latest apart from those left a week, by their latest exchange or else when they began', () => {
    const { recent, older } = asidesOf(
      [
        boardTask({
          taskId: 'a1',
          title: 'Why does the retry back off twice?',
          phase: 'running',
          latest: { at: ago(0), by: 'lead', said: 'In two places.' },
        }),
        boardTask({ taskId: 'a2', title: 'Name for the export', createdAt: ago(2) }),
        boardTask({ taskId: 'a3', title: 'Is the webhook checked twice?', latest: { at: ago(9), by: 'person', said: 'Thanks.' } }),
      ],
      NOW,
    )
    expect(recent).toEqual([
      { id: 'a1', title: 'Why does the retry back off twice?', said: 'In two places.', running: true },
      { id: 'a2', title: 'Name for the export' },
    ])
    expect(older).toEqual([{ id: 'a3', title: 'Is the webhook checked twice?', said: 'Thanks.' }])
  })

  it('titles a new one by its first line, cut at a word, and opens it with what it quotes above the person’s words', () => {
    expect(asideTitle('Which file holds the retry?\nAnd why twice?')).toBe('Which file holds the retry?')
    // As long as a task's title may be, so naming it from its first words is never refused.
    const long = asideTitle(`${'word '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('word…')).toBe(true)
    expect(asideWords('Which is safe to drop?', 'It backs off in two places.\nThe client waits.')).toBe(
      '> It backs off in two places.\n> The client waits.\n\nWhich is safe to drop?',
    )
    expect(asideWords('Just this', null)).toBe('Just this')
  })

  it('puts a new one first, by the id it keeps, before the board has it and after, and shows one left unsaid only while open', () => {
    const asides = [
      boardTask({ taskId: 'a1', title: 'Why does the retry back off twice?', latest: { at: ago(0), by: 'lead', said: 'Twice.' } }),
      // Opened with +, nothing said in it yet: its lead waits for the person's words, and isn't at work.
      boardTask({ taskId: 'a2', title: '', phase: 'running', unsaid: true }),
    ]
    // Not open, it takes no pill; + opens it again.
    expect(asidesOf(asides, NOW).recent.map((aside) => aside.id)).toEqual(['a1'])
    // Open, its one pill comes first, as it did before the board had it, untitled and not at work.
    expect(asidesOf(asides, NOW, { open: 'a2', first: 'a2' }).recent).toEqual([
      { id: 'a2', title: '' },
      { id: 'a1', title: 'Why does the retry back off twice?', said: 'Twice.' },
    ])
    expect(asidesOf([asides[0] as BoardTask], NOW, { open: 'a9', first: 'a9' }).recent.map((aside) => aside.id)).toEqual(['a9', 'a1'])
    // Its first words sent, a board read from before them still says it is unsaid: it keeps its pill, and its place.
    expect(asidesOf(asides, NOW, { open: 'a2', first: 'a2' }).recent.map((aside) => aside.id)).toEqual(['a2', 'a1'])
    expect(asidesOf(asides, NOW, { open: 'a1', first: 'a2' }).recent.map((aside) => aside.id)).toEqual(['a2', 'a1'])
  })
})

/** A board of these tasks, as much of one as the asides read. */
const boardOf = (tasks: ReadonlyArray<BoardTask>) => ({ tasks, calls: [], settledTotal: 0 }) as unknown as BoardSnapshot

const LEAD: PlanStep = { key: 'implement', agentId: 'claude-code', model: 'opus', effort: 'high', skipped: false }

/** The pane's asides as the project's screen has them: the person's moves over the board, and the asides drawn from that. */
const useScreen = (client: Client, props: { board: BoardSnapshot; lead: PlanStep }) => {
  const moves = useAsideMoves(client, props.board)
  const tasks = moves.over?.tasks ?? []
  const scratch = tasks.filter((task) => task.scratch === true && task.phase !== 'settled')
  const asides = useAsides({ client, projectId: 'p1', lead: props.lead, scratch, tasks, moves })
  return {
    moves,
    asides,
    scratch,
    pills: asidesOf(scratch, NOW, { open: asides.open.kind === 'coordinator' ? null : asides.open.taskId, first: asides.first }).recent,
  }
}

describe('moves on asides', () => {
  const said = boardTask({ taskId: 'a1', title: 'Hi', phase: 'ready', latest: { at: ago(0), by: 'lead', said: 'Hello.' } })

  it('clears one at once, keeps it gone until the board says so, and brings it back with why where the runtime refused', async () => {
    let refuse = false
    const { client } = fakeClient({
      markTaskDone: vi.fn(async () => {
        if (refuse) throw new ApiError({ reason: 'conflict', message: 'Althar is still starting it.' })
      }),
    })
    const { result, rerender } = renderHook((props: { board: BoardSnapshot }) => useScreen(client, { ...props, lead: LEAD }), {
      initialProps: { board: boardOf([said]) },
    })
    act(() => result.current.asides.pick('a1'))
    expect(result.current.asides.open.kind).toBe('aside')
    // Pressed: its pill goes, and the pane is the coordinator's, in the same frame.
    act(() => result.current.asides.clear(['a1']))
    expect(result.current.pills).toEqual([])
    expect(result.current.asides.open.kind).toBe('coordinator')
    expect(client.markTaskDone).toHaveBeenCalledWith('a1')
    // A read of the board from before the runtime took it still has it on Scratch: it stays gone.
    rerender({ board: boardOf([{ ...said }]) })
    expect(result.current.pills).toEqual([])
    // The board says it settled: the board's again.
    rerender({ board: boardOf([{ ...said, phase: 'settled' }]) })
    expect(result.current.moves.moving.size).toBe(0)
    expect(result.current.pills).toEqual([])

    // Refused, it comes back, and the line says why.
    const other = boardTask({ taskId: 'a2', title: 'Retry', latest: { at: ago(0), by: 'lead', said: 'Twice.' } })
    rerender({ board: boardOf([other]) })
    refuse = true
    act(() => result.current.asides.clear(['a2']))
    expect(result.current.pills).toEqual([])
    await waitFor(() => expect(result.current.pills.map((pill) => pill.id)).toEqual(['a2']))
    expect(result.current.moves.failed).toBe('Couldn’t clear “Retry”. Althar is still starting it.')
    act(() => result.current.moves.dismiss())
    expect(result.current.moves.failed).toBeNull()
  })

  it('makes one a task at once: it is on the board as work, off the pills, and the pane is the coordinator’s', () => {
    const { client } = fakeClient()
    const { result } = renderHook(() => useScreen(client, { board: boardOf([said]), lead: LEAD }))
    act(() => result.current.asides.pick('a1'))
    act(() => result.current.asides.makeTask('a1'))
    expect(client.shelveTask).toHaveBeenCalledWith('a1', null)
    expect(result.current.pills).toEqual([])
    expect(result.current.asides.open.kind).toBe('coordinator')
    expect(result.current.moves.over?.tasks.find((task) => task.taskId === 'a1')).not.toHaveProperty('scratch')
  })

  it('never brings back a blank pill for the one just sent, once it is cleared or made a task', async () => {
    const { client } = fakeClient({ startTask: vi.fn(async () => ({ id: 'n1', threadId: 'th-n1' }) as never) })
    const { result, rerender } = renderHook((props: { board: BoardSnapshot }) => useScreen(client, { ...props, lead: LEAD }), {
      initialProps: { board: boardOf([]) },
    })
    act(() => result.current.asides.begin(null))
    const id = result.current.asides.open.kind === 'new' ? result.current.asides.open.taskId : ''
    await act(async () => void (await result.current.asides.say('Hi')))
    // Sent, before the board has its first exchange: its one pill, first.
    rerender({ board: boardOf([boardTask({ taskId: id, title: 'Hi', phase: 'running' })]) })
    expect(result.current.pills.map((pill) => pill.id)).toEqual([id])
    act(() => result.current.asides.clear([id]))
    expect(result.current.pills).toEqual([])
    // Settled, and later gone from the board's read altogether: no pill comes back for it, titled or blank.
    rerender({ board: boardOf([boardTask({ taskId: id, title: 'Hi', phase: 'settled' })]) })
    rerender({ board: boardOf([]) })
    expect(result.current.pills).toEqual([])
    expect(result.current.asides.first).toBeNull()
  })
})

describe('an aside’s first words', () => {
  it('go on the lead picked as they are sent: another agent takes the thread, another model or effort is set first', async () => {
    const { client } = fakeClient({ startTask: vi.fn(async () => ({ id: 'n1', threadId: 'th-n1' }) as never) })
    const { result, rerender } = renderHook((props: { lead: PlanStep }) => useScreen(client, { board: boardOf([]), lead: props.lead }), {
      initialProps: { lead: LEAD },
    })
    // The same lead as at +: its words go to the lead that got ready.
    act(() => result.current.asides.begin(null))
    await act(async () => void (await result.current.asides.say('Hi')))
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th-n1', body: 'Hi', disposition: 'after_current' })
    expect(client.switchAgent).not.toHaveBeenCalled()

    // Another model and effort picked after +: set on its thread, then the words.
    act(() => result.current.asides.begin(null))
    rerender({ lead: { ...LEAD, model: 'sonnet', effort: 'low' } })
    await act(async () => void (await result.current.asides.say('And this?')))
    expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th-n1', model: 'sonnet' })
    expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'th-n1', effort: 'low' })
    expect(client.switchAgent).not.toHaveBeenCalled()

    // Another agent picked after +: it takes the thread, with the words.
    act(() => result.current.asides.begin(null))
    rerender({ lead: { ...LEAD, agentId: 'codex', model: 'gpt', effort: null } })
    await act(async () => void (await result.current.asides.say('Codex, then')))
    expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th-n1', agentId: 'codex', model: 'gpt', body: 'Codex, then' })
  })
})
