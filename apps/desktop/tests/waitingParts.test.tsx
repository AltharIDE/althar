import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Holder, SessionSummary } from '@althar/contracts'

import { queuedOfWords, queuedWords } from '../src/renderer/shared/agents'
import { titleOf } from '../src/renderer/shared/callCommand'
import { contextMeter } from '../src/renderer/shared/ContextMeter'
import { Holders } from '../src/renderer/shared/Holders'
import { headsOf } from '../src/renderer/shared/mergeHere'
import { runCardOf, runningOf } from '../src/renderer/shared/running'
import { fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * The parts of a conversation that say what it waits on and what runs
 * behind it, on their own: who holds the places a task waits for, how full
 * its lead's context is, and what runs.
 */

const NOW = '2026-10-10T09:05:00.000Z'
const serving = { id: 'bg-1', command: 'bun dev', url: 'http://localhost:5173/', startedAt: '2026-10-10T09:00:00.000Z', ended: null }

describe('who holds the places a task waits for', () => {
  it('offers the front of the line, naming none of the tasks at work', async () => {
    const onFront = vi.fn()
    const holders: ReadonlyArray<Holder> = [{ taskId: 't2', title: 'Fix the login', threadId: 'th2', kept: false, running: [] }]
    withServices(<Holders holders={holders} onStop={vi.fn()} onFront={onFront} />, fakeClient().client)
    expect(screen.queryByText(/Fix the login/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Move to the front of the line' }))
    expect(onFront).toHaveBeenCalled()
  })

  it('draws nothing where nothing can be stopped and it is first in line', () => {
    const holders: ReadonlyArray<Holder> = [
      { taskId: 't2', title: 'Fix the login', threadId: null, kept: false, running: [serving] },
      { taskId: 't3', title: 'Tidy the docs', threadId: 'th3', kept: false, running: [] },
    ]
    const { container } = withServices(<Holders holders={holders} onStop={vi.fn()} />, fakeClient().client)
    expect(container.textContent).toBe('')
  })

  it('opens where a server that keeps a place answers', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      const holders: ReadonlyArray<Holder> = [
        { taskId: 't2', title: 'Prototype the board', threadId: 'th2', kept: true, running: [serving] },
      ]
      withServices(<Holders holders={holders} onStop={vi.fn()} />, fakeClient().client)
      await userEvent.click(screen.getByRole('button', { name: /^Keeping a place/ }))
      const list = within(await screen.findByRole('dialog', { name: 'Keeping a place' }))
      await userEvent.click(list.getByRole('button', { name: 'Open localhost:5173' }))
      expect(open).toHaveBeenCalledWith('http://localhost:5173/', '_blank')
    } finally {
      open.mockRestore()
    }
  })
})

describe('how full the lead’s context is', () => {
  it('shows the ring without Compact where the conversation can’t compact', async () => {
    const session: SessionSummary = { ...snapshot().session!, context: { used: 42_000, size: 200_000 } }
    const named = () => ({ id: 'claude-code:opus', name: 'Claude Opus', short: 'Opus', runtime: 'claude-code', efforts: [] })
    withServices(<>{contextMeter(session, named)}</>, fakeClient().client)
    // Its detail, as the person points at it, has the numbers and nothing to press.
    await userEvent.click(screen.getByRole('button', { name: 'Context 21% used' }))
    expect(await screen.findByText(/42/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Compact/ })).toBeNull()
    // Where the agent hasn't said, nothing shows.
    expect(contextMeter({ ...session, context: null }, named)).toBeUndefined()
  })
})

describe('what runs, and what waits', () => {
  it('names a command by its label only where that says it shorter', () => {
    const [same, shorter] = runningOf(
      [
        { ...serving, label: 'bun dev' },
        { ...serving, id: 'bg-2', command: 'cd web && bun run dev --port 5174', label: 'bun run dev' },
      ],
      NOW,
    )
    expect(same).not.toHaveProperty('label')
    expect(shorter).toMatchObject({ command: 'cd web && bun run dev --port 5174', label: 'bun run dev' })
  })

  it('draws a run that answers nowhere without an address', () => {
    const card = runCardOf(
      {
        launchId: 'proc_1',
        taskId: 't1',
        where: 'main',
        command: 'bun test',
        url: null,
        startedAt: '2026-10-10T09:00:00.000Z',
        ended: null,
      },
      NOW,
    )
    expect(card).toEqual({ where: 'main', command: 'bun test', since: '5m' })
  })

  it('says how many of a project’s tasks wait, and for how many agents', () => {
    expect(queuedOfWords(1, { busy: 4, atOnce: 4 })).toBe('Waiting: 4 of 4 agents busy')
    expect(queuedOfWords(3, { busy: 6, atOnce: 2 })).toBe('3 waiting: 2 of 2 agents busy, and 4 more')
  })

  it('says why a task waits in plain words, over the number too', () => {
    expect(queuedWords({ busy: 6, atOnce: 6 }, 'this Mac')).toBe('Waiting: 6 of 6 agents busy on this Mac')
    expect(queuedWords({ busy: 7, atOnce: 6 }, 'this Mac')).toBe('Waiting: 6 of 6 agents busy on this Mac, and 1 more')
  })

  it('merges here only the repositories whose branch could be read', () => {
    expect(
      headsOf([
        { repository: 'api', name: 'api', branch: 'main', head: 'abc111' },
        { repository: 'web', name: 'web', branch: 'main', head: null },
      ]),
    ).toEqual([{ repository: 'api', head: 'abc111' }])
  })

  it('heads a permission whose command is its title by what it is, where the agent gave no command apart', () => {
    expect(titleOf({ title: 'cd web\nbun install\nbun run build', command: null })).toBe('Run a script')
  })
})
