import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask, type PlanStep } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { asidesOf, asideTitle, asideWords, useAsideMoves, useAsides } from '../src/renderer/features/project/Asides'
import { fakeClient } from './fixtures'
import { makeQueryClient } from '../src/renderer/data/reads'

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
  const [cache] = useState(makeQueryClient)
  const moves = useAsideMoves(client, props.board, 'p1')
  const tasks = moves.over?.tasks ?? []
  const scratch = tasks.filter((task) => task.scratch === true && task.phase !== 'settled')
  const asides = useAsides({ client, cache, projectId: 'p1', lead: props.lead, scratch, tasks, moves })
  return {
    moves,
    asides,
    scratch,
    pills: asidesOf(scratch, NOW, {
      open: asides.open.kind === 'coordinator' ? null : asides.open.taskId,
      first: asides.first,
      ...(asides.title === undefined ? {} : { title: asides.title }),
    }).recent,
    cache,
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
    // An aside that couldn't start says why the same way, its words back in the composer.
    act(() => result.current.moves.startFailed(new ApiError({ reason: 'conflict', message: 'Codex is signed out.' })))
    expect(result.current.moves.failed).toBe('Couldn’t start the aside. Codex is signed out.')
  })

  it('brings one back with why where the runtime answered without settling it, by a read of the board after its answer', async () => {
    const retry = boardTask({ taskId: 'a2', title: 'Retry', latest: { at: ago(0), by: 'lead', said: 'Twice.' } })
    const { client } = fakeClient({ getBoard: vi.fn(async () => boardOf([retry])) })
    const { result } = renderHook(() => useScreen(client, { board: boardOf([retry]), lead: LEAD }))
    act(() => result.current.asides.clear(['a2']))
    expect(result.current.pills).toEqual([])
    await waitFor(() => expect(result.current.moves.failed).toBe('Couldn’t clear “Retry”. Something of it is still open.'))
    expect(result.current.pills.map((pill) => pill.id)).toEqual(['a2'])
  })

  it('leaves two cleared whose reads of the board overlap: neither comes back, and no line says so', async () => {
    // Each clear's read of the board answers only when the test says, the second before the first.
    const reads: Array<(board: BoardSnapshot) => void> = []
    const { client } = fakeClient({ getBoard: vi.fn(() => new Promise<BoardSnapshot>((answer) => reads.push(answer))) })
    const two = [said, boardTask({ taskId: 'a2', title: 'Retry', latest: { at: ago(0), by: 'lead', said: 'Twice.' } })]
    const { result, rerender } = renderHook((props: { board: BoardSnapshot }) => useScreen(client, { ...props, lead: LEAD }), {
      initialProps: { board: boardOf(two) },
    })
    act(() => result.current.asides.clear(['a1']))
    act(() => result.current.asides.clear(['a2']))
    expect(result.current.pills).toEqual([])
    await waitFor(() => expect(reads).toHaveLength(2))
    const settled = boardOf(two.map((task) => ({ ...task, phase: 'settled' as const })))
    await act(async () => reads[1]?.(settled))
    // A read of the board from before either clear lands meanwhile.
    rerender({ board: boardOf(two) })
    expect(result.current.pills).toEqual([])
    await act(async () => reads[0]?.(settled))
    expect(result.current.pills).toEqual([])
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

  it('never brings back a pill for one sent and answered, cleared or made a task, whatever the board reads after', async () => {
    const { client } = fakeClient({ startTask: vi.fn(async () => ({ id: 'n1', threadId: 'th-n1' }) as never) })
    const { result, rerender } = renderHook((props: { board: BoardSnapshot }) => useScreen(client, { ...props, lead: LEAD }), {
      initialProps: { board: boardOf([]) },
    })
    const answered = async (move: (id: string) => void, after: BoardTask['phase']) => {
      act(() => result.current.asides.begin(null))
      const id = result.current.asides.open.kind === 'new' ? result.current.asides.open.taskId : ''
      await act(async () => void (await result.current.asides.say('Hi')))
      // Its lead answered: the board has its first exchange.
      const task = boardTask({ taskId: id, title: 'Hi', phase: 'ready', latest: { at: ago(0), by: 'lead', said: 'Hello.' } })
      rerender({ board: boardOf([task]) })
      expect(result.current.pills.map((pill) => pill.id)).toEqual([id])
      act(() => move(id))
      expect(result.current.pills).toEqual([])
      // The board catches up, then reads without it, as a board with only work does: no pill, titled or blank.
      rerender({ board: boardOf([{ ...task, phase: after, scratch: after === 'settled' }]) })
      rerender({ board: boardOf([]) })
      expect(result.current.pills).toEqual([])
      expect(result.current.asides.first).toBeNull()
    }
    await answered((id) => result.current.asides.clear([id]), 'settled')
    await answered((id) => result.current.asides.makeTask(id), 'ready')
  })
})

describe('an aside’s first words', () => {
  it('shows the words and title while startup is held, and opens a cached thread without a loading gap', async () => {
    let started!: (value: never) => void
    const { client } = fakeClient({
      startTask: vi.fn(
        () =>
          new Promise<never>((resolve) => {
            started = resolve
          }),
      ),
    })
    const { result, rerender } = renderHook((props: { board: BoardSnapshot }) => useScreen(client, { ...props, lead: LEAD }), {
      initialProps: { board: boardOf([]) },
    })
    act(() => result.current.asides.begin(null))
    const id = result.current.asides.open.kind === 'new' ? result.current.asides.open.taskId : ''
    let sent!: Promise<boolean>
    act(() => {
      sent = result.current.asides.say('Hi')
    })
    expect(result.current.pills).toEqual([{ id, title: 'Hi' }])
    expect(result.current.asides.items).toMatchObject([{ kind: 'user_message', content: { text: 'Hi' } }])
    // A board read made before the first words never blanks its title.
    rerender({ board: boardOf([boardTask({ taskId: id, title: '', unsaid: true })]) })
    expect(result.current.pills).toEqual([{ id, title: 'Hi' }])
    await act(async () => {
      started({ id, threadId: 'th-new' } as never)
      await sent
    })
    expect(result.current.asides.open).toEqual({ kind: 'aside', taskId: id, threadId: 'th-new' })
    expect(result.current.cache.getQueryData(['thread', 'th-new'])).toBeDefined()
  })

  it('returns failed first words to the composer, removes their optimistic copy, and can send again', async () => {
    const { client } = fakeClient({
      startTask: vi.fn(async () => ({ id: 'n1', threadId: 'th-new' }) as never),
      send: vi.fn(async () => {
        throw new Error('Claude Code is signed out.')
      }),
    })
    const { result } = renderHook(() => useScreen(client, { board: boardOf([]), lead: LEAD }))
    act(() => result.current.asides.begin(null))
    await act(async () => {
      await expect(result.current.asides.say('Hi')).rejects.toThrow('Claude Code is signed out.')
    })
    expect(result.current.asides.open.kind).toBe('new')
    expect(result.current.asides.items).toEqual([])
    expect(
      result.current.cache
        .getQueryData<import('@althar/contracts').ThreadSnapshot>(['thread', 'th-new'])
        ?.items.some((item) => item.id.startsWith('sending:')),
    ).toBe(false)
    vi.mocked(client.send).mockResolvedValueOnce(undefined)
    await act(async () => {
      expect(await result.current.asides.say('Hi')).toBe(true)
    })
  })

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

  it('go on what its own picker shows, picked after +, while the coordinator’s pick is left as it was', async () => {
    const { client } = fakeClient({ startTask: vi.fn(async () => ({ id: 'n1', threadId: 'th-n1' }) as never) })
    const { result } = renderHook(() => useScreen(client, { board: boardOf([]), lead: LEAD }))
    // Nothing new open: no lead of its own, so the composer's picker is the coordinator's.
    expect(result.current.asides.lead).toBeNull()
    act(() => result.current.asides.begin(null))
    expect(client.startTask).toHaveBeenCalledWith(expect.objectContaining({ steps: [LEAD] }))
    expect(result.current.asides.lead).toEqual(LEAD)
    // Another effort, then another agent, in its picker: it shows the last, and its words go on it.
    act(() => result.current.asides.choose({ ...LEAD, effort: 'low' }))
    expect(result.current.asides.lead).toEqual({ ...LEAD, effort: 'low' })
    const codex: PlanStep = { key: 'implement', agentId: 'codex', model: 'gpt', effort: null, skipped: false }
    act(() => result.current.asides.choose(codex))
    expect(result.current.asides.lead).toEqual(codex)
    await act(async () => void (await result.current.asides.say('Hi')))
    expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th-n1', agentId: 'codex', model: 'gpt', body: 'Hi' })
    expect(client.send).not.toHaveBeenCalled()
    // Said, it is an aside, with a composer of its own: the picker is the coordinator's again, on its own lead.
    expect(result.current.asides.lead).toBeNull()
    // The next + starts on the coordinator's pick, not the last aside's.
    act(() => result.current.asides.begin(null))
    expect(result.current.asides.lead).toEqual(LEAD)
  })
})
