import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChecksSummary, ThreadSnapshot } from '@althar/contracts'

import { kindsOf, partsOf, partsText, type PartsActions } from '../src/renderer/features/task/parts'
import { change, snapshot } from './fixtures'

const actions = (): PartsActions => ({
  seeChanges: vi.fn(),
  merge: vi.fn(),
  postReview: vi.fn(),
  stopLaunch: vi.fn(),
  openUrl: vi.fn(),
  toOutputs: vi.fn(),
  askLead: vi.fn(),
})
const thread = (over: Partial<ThreadSnapshot['task']>) => {
  const base = snapshot()
  return { ...base, task: { ...base.task, ...over } }
}
const checks = (over: Partial<ChecksSummary> = {}): ChecksSummary => ({
  outcome: 'passed',
  passed: 2,
  failed: 0,
  running: 0,
  total: 2,
  failing: [],
  list: [],
  ...over,
})

describe('a task’s parts where it has little or several kinds of work', () => {
  it('shows the first changed files, keeps binary files uncounted, and asks before removing uncommitted work', async () => {
    const files: ThreadSnapshot['task']['files'] = Array.from({ length: 6 }, (_, at) => ({
      path: `file-${at}.ts`,
      from: null,
      status: 'modified',
      add: 2,
      del: 1,
      binary: at === 0,
      uncommitted: at < 2,
    }))
    const workToward = vi.fn(),
      removeFolder = vi.fn(),
      open = vi.fn(),
      seeChanges = vi.fn()
    const part = partsOf(thread({ files }), {
      ...actions(),
      seeChanges,
      workToward,
      removeFolder,
      changesKey: 'Ctrl+D',
      openInEditor: { name: 'Zed', open },
    }).find((one) => one.id === 'worktree')
    render(<>{part?.body}</>)
    expect(screen.getByText('file-0.ts')).toBeTruthy()
    expect(screen.queryByText('file-5.ts')).toBeNull()
    expect(screen.getByText('1 more')).toBeTruthy()
    const remove = part?.actions?.find((one) => one.label === 'Remove')
    expect(remove?.confirm?.says).toBe('2 files aren’t committed. They’d be lost.')
    part?.actions?.find((one) => one.label === 'Open in Zed')?.onClick?.()
    expect(open).toHaveBeenCalledOnce()
    part?.actions?.find((one) => one.label === 'See the changes')?.onClick?.()
    expect(seeChanges).toHaveBeenCalledOnce()
    await userEvent.type(screen.getByRole('textbox', { name: 'Another branch to work toward' }), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Work toward it' }))
    expect(workToward).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox'), ' release/next ')
    await userEvent.click(screen.getByRole('button', { name: 'Work toward it' }))
    expect(workToward).toHaveBeenCalledWith('release/next')
  })

  it.each([
    { url: null, label: undefined, name: undefined, expected: 'bun test' },
    { url: null, label: 'Tests', name: undefined, expected: 'Tests' },
    { url: 'https://localhost:5320/', label: undefined, name: undefined, expected: 'localhost:5320' },
    { url: 'https://localhost:5320/', label: undefined, name: 'Preview', expected: 'Preview' },
  ])('names a running command as $expected and stops that run alone', ({ url, label, name, expected }) => {
    const act = actions()
    const launch = {
      id: 'r1',
      runnableId: null,
      taskId: 't1',
      where: 'This task',
      command: 'bun test',
      url,
      startedAt: '2026-11-12T10:00:00Z',
      ended: null,
      ...(label === undefined ? {} : { label }),
      ...(name === undefined ? {} : { name }),
    }
    const parts = partsOf(
      thread({ worktree: null, launches: [launch, { ...launch, id: 'done', ended: { at: launch.startedAt, code: 0 } }] }),
      act,
    )
    expect(parts).toHaveLength(1)
    expect(parts[0]?.name).toBe(expected)
    parts[0]?.actions?.find((one) => one.label === 'Stop')?.onClick?.()
    expect(act.stopLaunch).toHaveBeenCalledExactlyOnceWith('r1')
    if (url !== null) {
      parts[0]?.actions?.find((one) => one.label === 'Open')?.onClick?.()
      expect(act.openUrl).toHaveBeenCalledWith(url)
    }
  })
  it.each([
    { state: 'merged', draft: false, checks: null, word: 'Merged' },
    { state: 'closed', draft: false, checks: null, word: 'Closed' },
    { state: 'open', draft: true, checks: null, word: 'Draft' },
    { state: 'open', draft: false, checks: checks({ outcome: 'none', total: 0, passed: 0 }), word: 'Open' },
    { state: 'open', draft: false, checks: checks({ outcome: 'running', running: 1 }), word: 'Open · checks running' },
    { state: 'open', draft: false, checks: checks({ outcome: 'failed', failed: 2 }), word: 'Open · 2 checks fail' },
    { state: 'open', draft: false, checks: checks(), word: 'Open · checks pass' },
  ] as const)('says a $state pull request with its own checks: $word', ({ state, draft, checks, word }) => {
    const act = actions()
    const pr = change({ state, draft, checks })
    const part = partsOf(thread({ worktree: null, changes: [pr] }), act).find((one) => one.id.startsWith('pr:'))
    expect(part?.detail).toBe(word)
    part?.actions?.find((one) => one.label === 'On GitHub')?.onClick?.()
    expect(act.openUrl).toHaveBeenCalledWith(pr.url)
    if (checks?.outcome === 'running') expect(part?.facts).toContainEqual(['Checks', '1 running'])
    if (checks?.outcome === 'none') expect(part?.facts).toContainEqual(['Checks', 'None'])
  })

  it('offers a Local checkout’s move back, and lets a waiting move be called off', () => {
    const move = vi.fn(),
      dropMove = vi.fn(),
      act = { ...actions(), move, dropMove }
    const local = partsOf(thread({ local: true, files: [], branch: null }), act).find((one) => one.id === 'worktree')
    expect(local?.name).toBe('Local')
    local?.actions?.find((one) => one.label === 'Move to a worktree')?.onClick?.()
    expect(move).toHaveBeenCalledWith('worktree')
    const waiting = partsOf(thread({ moving: { to: 'checkout', why: 'Another task has the checkout.' } }), act).find(
      (one) => one.id === 'worktree',
    )
    expect(waiting?.detail).toBe('Another task has the checkout.')
    waiting?.actions?.find((one) => one.label === 'Call it off')?.onClick?.()
    expect(dropMove).toHaveBeenCalledOnce()
    expect(partsText.uncommitted(1)).toBe('1 file isn’t committed. They’d be lost.')
    expect(partsText.uncommitted(2)).toBe('2 files aren’t committed. They’d be lost.')
  })

  it('keeps a change’s row with its pull request and its own Ship, rather than showing it twice', () => {
    const shipChange = vi.fn()
    const pr = change({ draft: false, checks: checks(), change: { id: 'w1', name: 'Retry', waitsFor: 'the schema' } })
    const line = {
      id: 'w1',
      name: 'Retry',
      branch: 'althar/retry',
      stackedOn: 'Schema',
      waitsFor: 'the schema',
      url: pr.url,
      waiting: true,
      helper: null,
    }
    const parts = partsOf(thread({ worktree: null, changes: [pr], lines: [line] }), { ...actions(), shipChange })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ name: 'Retry', detail: 'PR · Waits for the schema to merge · Commits waiting for Ship' })
    parts[0]?.actions?.find((one) => one.label === 'Ship')?.onClick?.()
    expect(shipChange).toHaveBeenCalledWith('Retry')
    const noPr = partsOf(thread({ worktree: null, changes: [], lines: [{ ...line, url: null }] }), actions())
    expect(noPr[0]?.detail).toBe('Waits for the schema to merge · Commits waiting for Ship')
    expect(noPr[0]?.actions).toEqual([])
  })

  it('lists a helper on the task’s own change without a Stop where none is available', () => {
    const part = partsOf(thread({ worktree: null, helpers: [{ id: 'h1', name: 'Check it', change: null, model: 'Haiku' }] }), actions())[0]
    expect(part).toMatchObject({ detail: 'On the task’s change, Haiku', actions: [] })
  })

  it('offers no new parts after settling and offers a worktree to a chat that has none', () => {
    expect(kindsOf(thread({ phase: 'settled' }), actions()).every((one) => one.form === undefined)).toBe(true)
    const act = actions(),
      done = vi.fn()
    const worktree = kindsOf(thread({ worktree: null }), act).find((one) => one.kind === 'worktree')
    render(<>{worktree?.form?.(done)}</>)
    screen.getByRole('button', { name: 'Ask the lead' }).click()
    expect(act.askLead).toHaveBeenCalledWith('Make this a change: a worktree and a branch of its own, reviewed, ending in a pull request.')
    expect(done).toHaveBeenCalledOnce()
  })

  it('opens a new pull request from the task’s branch when attaching is unavailable', async () => {
    const openChange = vi.fn(),
      done = vi.fn()
    const kind = kindsOf(thread({ branch: null }), { ...actions(), openChange }).find((one) => one.kind === 'pr')
    render(<>{kind?.form?.(done)}</>)
    expect(screen.getByText(/From its branch, as a draft/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }))
    expect(openChange).toHaveBeenCalledOnce()
    expect(done).toHaveBeenCalledOnce()
  })

  it('attaches an existing pull request from either the only form or the open-or-attach switch', async () => {
    const attach = vi.fn(),
      openChange = vi.fn(),
      done = vi.fn()
    const base = thread({ branch: 'althar/retry' })
    const justAttach = kindsOf(base, { ...actions(), attach }).find((one) => one.kind === 'pr')
    const view = render(<>{justAttach?.form?.(done)}</>)
    await userEvent.type(screen.getByRole('textbox', { name: 'Its link, or its number' }), ' #12 ')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(attach).toHaveBeenLastCalledWith('#12')
    view.unmount()
    const both = kindsOf(base, { ...actions(), attach, openChange }).find((one) => one.kind === 'pr')
    render(<>{both?.form?.(done)}</>)
    await userEvent.click(screen.getByRole('radio', { name: 'One that exists' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Its link, or its number' }), '#13')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(attach).toHaveBeenLastCalledWith('#13')
    expect(openChange).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(2)
  })
})
