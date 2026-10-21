import { render, screen, waitFor, within } from '@testing-library/react'
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
  it('says its commits in no pull request, one or more', () => {
    const merged = change({ state: 'merged' })
    expect(briefOf(task({ change: merged, unshipped: { commits: 1, add: 5, del: 1 } }))).toBe('1 commit in no pull request · +5 −1')
    expect(briefOf(task({ change: merged, unshipped: { commits: 3, add: 9, del: 2 } }))).toBe('3 commits in no pull request · +9 −2')
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
    expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toBe('The runtime is restarting.')
    expect(within(document.body).queryByRole('region', { name: /needs? you/ })).toBeNull()
  })
})
