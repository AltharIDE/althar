import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type HomeCall, type HomeTask } from '@althar/contracts'

import { refOf } from '../src/renderer/features/home/glance'
import { HomeView } from '../src/renderer/features/home/HomeView'
import { briefOf, needLineOf, needsOf } from '../src/renderer/features/home/needs'
import { useHome } from '../src/renderer/features/home/useHome'
import { useStart } from '../src/renderer/features/start/useStart'
import { card, change, fakeClient, home, project } from './fixtures'
import { withServices } from './render'

/*
 * What the home says waits on the person where its other tests don't go: a
 * ready task's line by its commits, its branch or a review's findings, a
 * pull request merged or closed, calls answered here put back in their
 * place, a never kept, and the home's own lines for what it can't place or
 * open, and its read failing.
 */

const task = (overrides: Partial<HomeTask> = {}): HomeTask => ({
  ...card(),
  state: 'open',
  phase: 'ready',
  createdAt: '2026-10-07T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const call = (id: string, createdAt: string, overrides: Partial<HomeCall> = {}): HomeCall => ({
  id,
  kind: 'permission',
  title: `Run ${id}`,
  reason: 'Deploying or publishing always asks.',
  command: `make ${id}`,
  stuck: null,
  createdAt,
  projectId: 'p1',
  taskId: `t-${id}`,
  threadId: `th-${id}`,
  taskTitle: 'Ship it',
  taskSlug: 'ship-it',
  ...overrides,
})

const refs = new Map([['p1', refOf(project)]])
const agentName = () => ''

describe('a ready task’s line', () => {
  it('offers queue bypass only as the explicit secondary action', async () => {
    const work = task({
      kind: 'change',
      change: change({
        draft: false,
        canBypassQueue: true,
        checks: { outcome: 'passed', passed: 1, failed: 0, running: 0, total: 1, failing: [], list: [] },
      }),
    })
    const [need] = needsOf({ calls: [], ready: [work], refs, agentName })
    const next = vi.fn()
    render(<>{needLineOf(need!, { onOpen: vi.fn(), onAnswer: vi.fn(), onNext: next })}</>)
    await userEvent.click(screen.getByRole('button', { name: 'Other ways to merge' }))
    expect(next).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Merge without queue' }))
    expect(next).toHaveBeenCalledWith(work, { kind: 'merge' }, true)
  })

  it('says its commits in no pull request, one or more', () => {
    const merged = change({ state: 'merged' })
    expect(briefOf(task({ change: merged, unshipped: { commits: 1, add: 5, del: 1 } }))).toBe('1 commit in no pull request · +5 −1')
    expect(briefOf(task({ change: merged, unshipped: { commits: 3, add: 9, del: 2 } }))).toBe('3 commits in no pull request · +9 −2')
  })

  it('says what waits for Ship, by the pull request it goes to, and offers Ship', () => {
    const held = task({ change: change({ draft: false }), held: { since: '2026-10-01T10:00:00.000Z', commits: 2 } })
    expect(briefOf(held)).toBe('api #12 · 2 commits not shipped')
    expect(briefOf(task({ change: change({ state: 'merged' }), held: { since: '2026-10-01T10:00:00.000Z', commits: 1 } }))).toBe(
      '1 commit not shipped',
    )
  })

  it('says nothing changed on a branch with no files, and only which pull request one merged or closed was', () => {
    expect(briefOf(task({ changed: { files: 0, add: 0, del: 0 } }))).toBe('Nothing changed on its branch')
    expect(briefOf(task({ change: change({ state: 'closed' }) }))).toBe('api #12')
  })

  it('says how many findings a review drafted, none or one', () => {
    const reviewing = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 1199,
      url: 'https://github.com/meridian/api/pull/1199',
      title: 'Retry webhooks',
      author: 'ninemate',
      outside: true,
      additions: 1,
      deletions: 0,
      findings: 0,
      blocking: 0,
      verdict: null,
      posted: null,
    }
    expect(briefOf(task({ kind: 'review', reviewing }))).toBe('api #1199 · by ninemate · no findings')
    expect(briefOf(task({ kind: 'review', reviewing: { ...reviewing, findings: 1 } }))).toBe('api #1199 · by ninemate · 1 finding')
  })

  it('says why a conflict wasn’t asked of its lead, beside its button', () => {
    const why = '“Resolve conflicts automatically” is off for this task.'
    const [need] = needsOf({
      calls: [],
      ready: [task({ kind: 'change', change: change({ conflicts: true }), conflictUnsent: why })],
      refs,
      agentName,
    })
    expect(need?.brief).toBe(`api #12 · ${why}`)
    expect(need?.ready).toBeDefined()
  })
})

describe('calls answered here', () => {
  it('stay where they came among those still listed, before one at the same time by id, or last after all of them', () => {
    const listed = [call('b', '2026-10-07T09:10:00.000Z'), call('d', '2026-10-07T09:20:00.000Z')]
    const answered = [
      { call: call('a', '2026-10-07T09:10:00.000Z'), reply: { decision: 'allow' as const } },
      { call: call('c', '2026-10-07T09:15:00.000Z'), reply: { decision: 'allow' as const } },
      { call: call('e', '2026-10-07T09:30:00.000Z'), reply: { decision: 'allow' as const } },
    ]
    expect(needsOf({ calls: listed, answered, ready: [], refs, agentName }).map((need) => need.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('say a never was kept in the project’s rules, with what it asks said once where it is its command', () => {
    const asked = call('x', '2026-10-07T09:10:00.000Z', { title: 'make clean', command: 'make clean' })
    const answered = [{ call: asked, reply: { decision: 'reject' as const, always: 'exact' as const } }]
    const [need] = needsOf({ calls: [], answered, ready: [], refs, agentName })
    expect(need?.answer).toEqual({ kind: 'Denied', said: 'Never', note: 'kept in meridian’s rules', denied: true })
    render(<>{needLineOf(need!, { onOpen: vi.fn(), onAnswer: vi.fn() })}</>)
    const line = screen.getByRole('article', { name: 'make clean' })
    expect(line.getAttribute('aria-describedby')).not.toBeNull()
    expect(within(line).getAllByText('make clean')).toHaveLength(1)
    expect(within(line).getByText(/Never/)).toBeTruthy()
  })
})

describe('a stuck step’s line', () => {
  const stuck = (why: 'signed_out' | 'stalled') =>
    call('s', '2026-10-07T09:10:00.000Z', {
      kind: 'stuck',
      stuck: { step: 'implement', why, detail: null, agentId: 'claude-code', round: 0, open: 0 },
    })

  it('signs its agent in again where it is signed out, as its task’s card does first', async () => {
    const [need] = needsOf({ calls: [stuck('signed_out')], answered: [], ready: [], refs, agentName })
    const onSignIn = vi.fn()
    const onOpen = vi.fn()
    render(<>{needLineOf(need!, { onOpen, onAnswer: vi.fn(), onSignIn })}</>)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(onSignIn).toHaveBeenCalledWith('claude-code')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens its task for any other reason, or where the place can’t sign in', () => {
    const [stalled] = needsOf({ calls: [stuck('stalled')], answered: [], ready: [], refs, agentName })
    render(<>{needLineOf(stalled!, { onOpen: vi.fn(), onAnswer: vi.fn(), onSignIn: vi.fn() })}</>)
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
    const [signedOut] = needsOf({ calls: [stuck('signed_out')], answered: [], ready: [], refs, agentName })
    render(<>{needLineOf(signedOut!, { onOpen: vi.fn(), onAnswer: vi.fn() })}</>)
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)
  })
})

function Home({ onTask = vi.fn() }: { onTask?: (threadId: string) => void }) {
  return <HomeView model={useHome()} start={useStart()} onProject={vi.fn()} onTalk={vi.fn()} onTask={onTask} />
}

describe('the home', () => {
  it('merges a change from its line at the head it showed, where its host said none', async () => {
    const ready = task({
      taskId: 't5',
      threadId: 'th5',
      title: 'Name it better',
      change: change({ draft: false, head: null, checks: null }),
    })
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [ready] })) })
    withServices(<Home />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge #12' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t5', '', 'https://github.com/meridian/api/pull/12'))
  })

  it('ships what waits on a task’s branch from its line', async () => {
    const held = task({
      taskId: 't6',
      threadId: 'th6',
      title: 'Retry twice',
      change: change({ draft: false, localHead: 'def456', unpushed: 2 }),
      held: { since: '2026-10-01T10:00:00.000Z', commits: 2 },
    })
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [held] })) })
    withServices(<Home />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Ship 2 commits' }))
    await waitFor(() => expect(client.ship).toHaveBeenCalledWith('t6'))
    expect(client.push).not.toHaveBeenCalled()
  })

  it('says what a review after a merge found, and hands it to the lead with Fix it from its line', async () => {
    const found = task({
      taskId: 't7',
      threadId: 'th7',
      title: 'Rename the setting',
      state: 'done',
      change: change({ state: 'merged', draft: false }),
      afterMerge: { url: 'https://github.com/meridian/api/pull/12', words: '#12', state: 'found', findings: 2 },
    })
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [found] })) })
    withServices(<Home />, client)
    expect(await screen.findByText('After #12 merged')).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /new pull request after #12/ }))
    await waitFor(() => expect(client.fixAfterMerge).toHaveBeenCalledWith('t7'))
  })

  it('takes a change out of what waits on the person while it merges, and puts it back with why where it didn’t', async () => {
    const ready = task({ taskId: 't5', threadId: 'th5', title: 'Name it better', change: change({ draft: false, checks: null }) })
    let refuse = (_: unknown) => undefined as void
    const merge = vi.fn(() => new Promise<void>((_, reject) => (refuse = reject)))
    const { client } = fakeClient({ merge, getHome: vi.fn(async () => home({ tasks: [ready] })) })
    withServices(<Home />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge #12' }))
    // Merging, it waits on nobody, until it settles.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Accept and merge/ })).toBeNull())
    expect(screen.queryByRole('article', { name: 'Name it better' })).toBeNull()
    await act(async () => refuse(new ApiError({ reason: 'ConnectorFailed', message: 'GitHub says: Pull Request is not mergeable' })))
    // On its line, with a way to merge it again.
    const line = await screen.findByRole('article', { name: 'Name it better' })
    expect(within(line).getByText(/Pull Request is not mergeable/)).toBeTruthy()
    expect(within(line).getByRole('button', { name: /again/i })).toBeTruthy()
  })

  it('lists nothing the loop did in a project it doesn’t know, and opens nothing for permissions answered', async () => {
    const at = '2026-10-07T09:20:00.000Z'
    const about = { id: 't5', threadId: 'th5', slug: 'name-it', title: 'Name it better' }
    const onTask = vi.fn()
    const { client } = fakeClient({
      getHome: vi.fn(async () =>
        home({
          events: [
            { kind: 'answered', id: 'e1', at, count: 2 },
            { kind: 'dealt', id: 'e2', at, projectId: 'gone', task: about, about: 'limit', title: 'Moved to Codex.', description: null },
          ],
        }),
      ),
    })
    withServices(<Home onTask={onTask} />, client)
    await userEvent.click(await screen.findByRole('button', { name: /since you looked/ }))
    expect(screen.queryByText('Moved to Codex.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Answered 2 permission asks/ }))
    expect(onTask).not.toHaveBeenCalled()
  })

  it('says why it couldn’t be read', async () => {
    const { client } = fakeClient({
      getHome: vi.fn(async () => {
        throw new ApiError({ reason: 'Unavailable', message: 'The runtime is restarting.' })
      }),
    })
    withServices(<Home />, client)
    expect((await screen.findByRole('alert')).textContent).toBe('The runtime is restarting.')
    expect(within(document.body).queryByRole('region', { name: /needs? you/ })).toBeNull()
  })
})
