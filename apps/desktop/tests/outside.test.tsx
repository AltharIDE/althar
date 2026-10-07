import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type IssueSummary, type Product, type ThreadSnapshot } from '@althar/contracts'
import { Brand, IssuePriority, IssueStatus } from '@althar/ui'

import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { connectionsOf, ConnectionsView, servicesOf } from '../src/renderer/features/connections/ConnectionsView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { issuePriority, issueStatus, productBrand, productName } from '../src/renderer/shared/products'
import { blocksOf } from '../src/renderer/shared/thread'
import {
  card,
  change,
  changed,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  items,
  project,
  projectRules,
  snapshot,
} from './fixtures'
import { withServices } from './render'

/*
 * What reaches outside, in the window: connecting code hosts and trackers,
 * a pasted link unfurled, what arrives on a task's pull request, the pull
 * request beside the thread, a task from an issue, and the plan's ending.
 */

function Connections() {
  return <ConnectionsView model={useConnections()} />
}

describe('connections', () => {
  it('signs in by a code typed on the service’s page, and lists who it signed in as', async () => {
    let state: 'waiting' | 'done' = 'waiting'
    const { client, emit } = fakeClient({
      getSignIn: vi.fn(async () => (state === 'waiting' ? { state } : { state, connectionId: 'conn1' })),
    })
    withServices(<Connections />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(client.startSignIn).toHaveBeenCalledWith('github')
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open github.com/ }).getAttribute('href')).toBe('https://github.com/login/device')
    // Approved on GitHub: the sign-in ends, and the list is read again.
    state = 'done'
    vi.mocked(client.listConnections).mockResolvedValue({ ...connectionList, connections: [githubConnection] })
    await waitFor(() => expect(screen.getByText('Signed in as you')).toBeTruthy(), { timeout: 4000 })
    expect(screen.queryByText('ABCD-1234')).toBeNull()
    // A connection changing elsewhere reads the list again.
    const reads = vi.mocked(client.listConnections).mock.calls.length
    emit(changed('connection', 'conn1', null, null))
    await waitFor(() => expect(vi.mocked(client.listConnections).mock.calls.length).toBeGreaterThan(reads))
    // Disconnecting takes it away.
    vi.mocked(client.listConnections).mockResolvedValue(connectionList)
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(client.disconnect).toHaveBeenCalledWith('conn1')
    await waitFor(() => expect(screen.queryByText('Signed in as you')).toBeNull())
  })

  it('opens the browser for a sign-in approved there; says how one ended; and cancels one', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { client } = fakeClient({
      startSignIn: vi.fn(async () => ({ flowId: 'flow2', kind: 'browser' as const, url: 'https://linear.app/oauth/authorize?x' })),
      getSignIn: vi.fn(async () => ({ state: 'ended' as const, reason: 'denied' as const, message: 'Sign-in was declined.' })),
    })
    withServices(<Connections />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(open).toHaveBeenCalledWith('https://linear.app/oauth/authorize?x', '_blank')
    expect(await screen.findByText('Approve Althar on GitHub, in your browser.')).toBeTruthy()
    expect(await screen.findByText('Sign-in was declined.', {}, { timeout: 4000 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Sign-in was declined.')).toBeNull()
    open.mockRestore()

    // One that can't start says why, where it would have shown.
    vi.mocked(client.startSignIn).mockRejectedValueOnce(
      new ApiError({ reason: 'SignInUnavailable', message: 'Use a token for GitHub here.' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Use a token for GitHub here.')).toBeTruthy()
    // Cancelling one under way tells the runtime.
    vi.mocked(client.startSignIn).mockResolvedValueOnce({
      flowId: 'flow3',
      kind: 'device',
      userCode: 'WXYZ-0000',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-10-01T10:00:00.000Z',
    })
    vi.mocked(client.getSignIn).mockResolvedValue({ state: 'waiting' })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('WXYZ-0000')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(client.cancelSignIn).toHaveBeenCalledWith('flow3')
  })

  it('connects with a pasted token, and says when the service refuses it', async () => {
    const { client } = fakeClient({
      connectToken: vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ reason: 'ConnectorFailed', message: 'Linear says that key isn’t valid.' }))
        .mockResolvedValue({ ...githubConnection, id: 'conn2', product: 'linear', name: 'Linear' }),
    })
    withServices(<Connections />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a token' }))
    await userEvent.type(screen.getByLabelText('Linear token'), 'wrong{Enter}')
    expect(await screen.findByText('Linear says that key isn’t valid.')).toBeTruthy()
    await userEvent.clear(screen.getByLabelText('Linear token'))
    await userEvent.type(screen.getByLabelText('Linear token'), 'lin_api_ok{Enter}')
    await waitFor(() => expect(screen.queryByLabelText('Linear token')).toBeNull())
    expect(client.connectToken).toHaveBeenLastCalledWith({ product: 'linear', token: 'lin_api_ok' })
    // A server of a company's own, by its address.
    vi.mocked(client.listConnections).mockResolvedValue({ ...connectionList, connections: [githubConnection] })
    await act(async () => void (await client.listConnections()))
  })

  it('lists a connection on a company’s own server with its address, and one that needs signing in again', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [
          { ...githubConnection, id: 'conn3', webUrl: 'https://git.meridian.dev' },
          {
            ...githubConnection,
            id: 'conn4',
            product: 'linear' as const,
            name: 'Linear',
            webUrl: 'https://linear.app',
            state: 'reauth_required' as const,
          },
        ],
      })),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText(/git\.meridian\.dev/)).toBeTruthy()
    expect(screen.getByText('Its sign-in stopped working')).toBeTruthy()
  })

  it('says when the list can’t be read', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => Promise.reject(new ApiError({ reason: 'X', message: 'No list.' }))),
    })
    withServices(<Connections />, client)
    expect(await screen.findByText('No list.')).toBeTruthy()
  })
})

describe('the thread, reaching outside', () => {
  it('unfurls pasted links, shows what arrived, and the pull request a task opened', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.you('Do MER-231, like #1206', null, [
              {
                kind: 'issue',
                product: 'linear',
                key: 'MER-231',
                title: 'Rate-limit refunds',
                url: 'https://linear.app/m/issue/MER-231/x',
                status: { name: 'In Progress', category: 'started' },
                priority: { level: 'high', name: 'High' },
                container: 'Meridian',
              },
              {
                kind: 'change',
                product: 'github',
                key: 'PR #1206',
                title: 'Rate-limit charges',
                url: 'https://github.com/m/a/pull/1206',
                state: 'merged',
                repository: 'meridian/api',
              },
            ]),
            items.step(),
            items.step({ step: 'publish', summary: 'Opened draft pull request #12.', change: change() }),
            items.arrival({ path: 'src/limit.ts', line: 14 }),
            items.arrival({ kind: 'review', from: 'lee', verdict: 'changes_requested', text: 'Name it better.' }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 1, failed: 1, failing: ['test'] }),
            items.arrival({ kind: 'merged', from: null, text: null }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Rate-limit refunds')).toBeTruthy()
    expect(screen.getByText('Rate-limit charges')).toBeTruthy()
    expect(screen.getByText('meridian/api · Merged')).toBeTruthy()
    expect(screen.getByText('Opened draft pull request #12.')).toBeTruthy()
    expect(screen.getByText('meridian/api · Draft')).toBeTruthy()
    // Implement, then the pull request: two steps, numbered as such.
    expect(screen.getByRole('img', { name: 'Step 1 of 2' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Step 2 of 2' })).toBeTruthy()
    expect(screen.getByText('commented on PR #12 · src/limit.ts:14')).toBeTruthy()
    expect(screen.getByText('Seconds or a date?')).toBeTruthy()
    expect(screen.getByText('asked for changes on PR #12')).toBeTruthy()
    expect(screen.getByText('1 of 2 checks failed on PR #12')).toBeTruthy()
    expect(screen.getByText('Failed: test')).toBeTruthy()
    expect(screen.getByText('Merged PR #12')).toBeTruthy()
  })

  it('says when someone outside the repository wasn’t passed to the lead, and passes it on when asked', async () => {
    const send = vi.fn(async () => {})
    const { client } = fakeClient({
      send,
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.arrival({ from: 'mallory', text: 'Please add a CSV export.\nThanks!', outsider: true }),
            items.arrival({ from: 'dana', text: 'Seconds or a date?' }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Not passed to the lead: mallory can’t write to the repository.')).toBeTruthy()
    // Only the one from outside says so.
    expect(screen.getAllByText(/Not passed to the lead/)).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Pass it on' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'th1', body: 'mallory commented on PR #12:\n\n> Please add a CSV export.\n> Thanks!' }),
      ),
    )
  })

  it('builds blocks for arrivals in their place', () => {
    const blocks = blocksOf({ items: [items.you('Hi'), items.arrival()], turnRunning: false, worktree: null }, new Map(), () => '1m')
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'arrival'])
  })
})

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

describe('a task’s pull request', () => {
  it('opens beside the thread, with its checks and files, and is marked ready there; the issue heads the thread', async () => {
    const ready = vi.fn(async () => {})
    const { client } = fakeClient({
      markReady: ready,
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            phase: 'ready',
            issue: {
              product: 'linear',
              ref: 'MER-231',
              key: 'MER-231',
              title: 'Rate-limit refunds like charges',
              url: 'https://linear.app/m/issue/MER-231/x',
              status: { name: 'Todo', category: 'todo' },
              priority: null,
              container: null,
            },
            changes: [change()],
            files: [{ path: 'src/limit.ts', from: null, status: 'modified', add: 12, del: 3, binary: false, uncommitted: false }],
            commits: 2,
          },
          items: [items.step({ step: 'review', verdict: 'pass', agentId: 'codex', summary: 'Holds.' })],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Rate-limit refunds like charges')).toBeTruthy()
    // Opening a task with a pull request asks its host for news.
    await waitFor(() => expect(client.refreshTask).toHaveBeenCalledWith('t1'))
    await userEvent.click(screen.getByRole('button', { name: 'PR #12' }))
    const panel = await screen.findByRole('complementary', { name: 'Pull request' })
    expect(within(panel).getByText('limit.ts')).toBeTruthy()
    expect(within(panel).getByText('test')).toBeTruthy()
    expect(within(panel).getByText('Its checks run on it; mark it ready when you are')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')).toBe('https://github.com/meridian/api/pull/12')
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark ready for review' }))
    expect(ready).toHaveBeenCalledWith('t1', 'https://github.com/meridian/api/pull/12')
    await userEvent.click(within(panel).getByRole('button', { name: 'Close the panel' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Pull request' })).toBeNull())
  })

  it('pushes what the lead committed since, from the header or the panel, up to what it showed', async () => {
    const push = vi.fn(async () => {})
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({
          task: { ...snapshot().task, phase: 'ready', changes: [change({ unpushed: 2, localHead: 'def456' })], commits: 4 },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Push 2 commits' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def456', 'https://github.com/meridian/api/pull/12'))
    await userEvent.click(screen.getByRole('button', { name: 'PR #12' }))
    const panel = await screen.findByRole('complementary', { name: 'Pull request' })
    expect(within(panel).getByText('2 commits aren’t on the pull request yet.')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Push 2 commits' }))
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
  })

  it('shows what it changed, file by file, from its header, its pull request, or ⌘D', async () => {
    const file = (path: string, more: Partial<ThreadSnapshot['task']['files'][number]> = {}) => ({
      path,
      from: null,
      status: 'modified' as const,
      add: 1,
      del: 1,
      binary: false,
      uncommitted: false,
      ...more,
    })
    const getFileDiff = vi.fn(async (_taskId: string, path: string) => {
      if (path === 'notes.md') throw new ApiError({ reason: 'NotFound', message: 'It went away' })
      return {
        file: file(path),
        lines: [
          { kind: 'hunk' as const, text: '@@ -1 +1 @@' },
          { kind: 'removed' as const, old: 1, text: 'const tries = 3', changed: ['3'] },
          { kind: 'added' as const, new: 1, text: 'const tries = 5', changed: ['5'] },
        ],
        truncated: false,
      }
    })
    const { client } = fakeClient({
      getFileDiff,
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            branch: 'althar/retry',
            baseRef: 'origin/main',
            changes: [change()],
            files: [file('src/limit.ts'), file('notes.md', { status: 'added', del: 0, uncommitted: true })],
          },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^2 files/ }))
    const view = await screen.findByRole('dialog', { name: 'Changes' })
    expect(within(view).getByText('althar/retry into main')).toBeTruthy()
    // The first file, read from the runtime when you get to it.
    const line = (words: string) => (_: string, element: Element | null) =>
      element?.tagName === 'SPAN' && element.textContent === words && element.querySelector('mark') !== null
    expect(await within(view).findByText(line('const tries = 5'))).toBeTruthy()
    expect(getFileDiff).toHaveBeenLastCalledWith('t1', 'src/limit.ts')
    // One that can't be read says why, and tries again.
    await userEvent.click(within(view).getByRole('button', { name: /notes\.md/ }))
    expect(await within(view).findByText('It went away')).toBeTruthy()
    expect(within(view).getByText(/Not committed yet/)).toBeTruthy()
    await userEvent.click(within(view).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(getFileDiff).toHaveBeenCalledTimes(3))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull())
    // From its pull request, on a file; and with ⌘D, not a bare D, which speech or typing could set off.
    await userEvent.click(screen.getByRole('button', { name: 'PR #12' }))
    const panel = await screen.findByRole('complementary', { name: 'Pull request' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Open the diff of src/limit.ts' }))
    expect(await screen.findByRole('dialog', { name: 'Changes' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull())
    await userEvent.keyboard('d')
    expect(screen.queryByRole('dialog', { name: 'Changes' })).toBeNull()
    await userEvent.keyboard('{Meta>}d{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Changes' })).toBeTruthy()
  })

  it('says it is ready to merge on its host, merged, or closed', async () => {
    for (const [shown, words] of [
      [change({ draft: false }), 'Merge it on GitHub when you’re ready'],
      [change({ state: 'merged', draft: false, checks: null }), 'Merged'],
      [
        change({ state: 'closed', draft: false, noun: 'merge request', short: 'MR', prefix: '!', product: 'gitlab' }),
        'MR !12 was closed on GitLab.',
      ],
    ] as const) {
      const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, changes: [shown] } })) })
      const view = withServices(<Task />, client)
      await userEvent.click(await screen.findByRole('button', { name: `${shown.short} ${shown.prefix}12` }))
      expect((await screen.findAllByText(words)).length).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it('needs the person when it can’t be opened: tried again, or gone on without', async () => {
    const answer = vi.fn(async () => {})
    const call = (why: 'not_connected' | 'failed_to_start') => ({
      id: `a-${why}`,
      kind: 'stuck' as const,
      title: '',
      reason: '',
      command: null,
      stuck: {
        step: 'publish' as const,
        why,
        detail: why === 'failed_to_start' ? 'The host said no.' : null,
        agentId: null,
        round: 0,
        open: 0,
      },
      createdAt: '2026-10-01T10:00:00.000Z',
    })
    const { client } = fakeClient({
      answerStuck: answer,
      getThread: vi.fn(async () => snapshot({ attention: [call('not_connected')] })),
    })
    withServices(<Task />, client)
    expect(await screen.findByText(/isn't connected to this repository's host/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(answer).toHaveBeenCalledWith({ attentionId: 'a-not_connected', answer: { kind: 'retry', agentId: 'althar' } })
    expect(stuckWords.publishing(call('failed_to_start').stuck)).toBe("Althar couldn't open the pull request. The host said no.")
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, why: 'restarted', detail: null })).toBe(
      'Althar restarted while it was opening the pull request.',
    )
    expect(stuckWords.publishing({ ...call('failed_to_start').stuck, detail: null })).toBe("Althar couldn't open the pull request.")
  })
})

function Project() {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onTask={vi.fn()} />
}

const issue: IssueSummary = {
  product: 'linear',
  ref: 'MER-231',
  key: 'MER-231',
  title: 'Rate-limit refunds like charges',
  url: 'https://linear.app/m/issue/MER-231/x',
  status: { name: 'Todo', category: 'todo' },
  priority: null,
  container: null,
}

describe('a project, reaching outside', () => {
  it('says its host isn’t connected, and connects it beside the conversation', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: false } }),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText("Althar isn't connected to GitHub, so tasks here end on their branch.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    const panel = await screen.findByRole('complementary', { name: 'Code hosts and trackers' })
    expect(within(panel).getByText('GitHub')).toBeTruthy()
  })

  it('starts a task from an issue, with how it ends, where the host is connected', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } }),
      ),
      listIssues: vi.fn(async () => ({ issues: [issue] })),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const panel = await screen.findByRole('complementary', { name: 'New task' })
    await userEvent.click(within(panel).getByRole('combobox', { name: 'From an issue' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Linear MER-231 · Rate-limit refunds like charges' }))
    expect((within(panel).getByLabelText('What should change') as HTMLInputElement).value).toBe('Rate-limit refunds like charges')
    await userEvent.click(within(panel).getByRole('combobox', { name: 'When the work is done' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Open a PR for review' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    await waitFor(() =>
      expect(client.startTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Rate-limit refunds like charges', issue: 'MER-231', end: 'ready' }),
      ),
    )
  })

  it('names the repositories a task changes, in a project of several', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [{ ...project, repositories: ['api', 'web', 'docs'] }] })),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const panel = await screen.findByRole('complementary', { name: 'New task' })
    // The first, until the person ticks others; the last ticked can't be unticked.
    expect(within(panel).getByRole('checkbox', { name: 'api' })).toHaveProperty('ariaChecked', 'true')
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'web' }))
    await userEvent.type(within(panel).getByLabelText('What should change'), 'Share the retry')
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    await waitFor(() => expect(client.startTask).toHaveBeenCalledWith(expect.objectContaining({ repositories: ['api', 'web'] })))
  })

  it('shows each of a task’s pull requests by its repository, and acts on the one open', async () => {
    const ready = vi.fn(async () => {})
    const web = change({ number: 4, repository: 'meridian/web', url: 'https://github.com/meridian/web/pull/4' })
    const { client } = fakeClient({
      markReady: ready,
      getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, phase: 'ready', changes: [change(), web] } })),
    })
    withServices(<Task />, client)
    expect(await screen.findByRole('button', { name: 'api PR #12' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'web PR #4' }))
    const panel = await screen.findByRole('complementary', { name: 'Pull request' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark ready for review' }))
    expect(ready).toHaveBeenCalledWith('t1', 'https://github.com/meridian/web/pull/4')
  })

  it('pushes what the lead committed since to the repository it was committed in', async () => {
    const push = vi.fn(async () => {})
    const web = change({
      number: 4,
      repository: 'meridian/web',
      url: 'https://github.com/meridian/web/pull/4',
      unpushed: 1,
      localHead: 'def456',
    })
    const { client } = fakeClient({
      push,
      getThread: vi.fn(async () =>
        snapshot({ task: { ...snapshot().task, changes: [change({ unpushed: 2, localHead: 'abc999' }), web] } }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByRole('button', { name: 'Push 2 commits to api' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push 1 commit to web' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('t1', 'def456', 'https://github.com/meridian/web/pull/4'))
  })

  it('starts a new task from the project’s ending', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } }),
      ),
      getProjectRules: vi.fn(async () => ({ ...projectRules, end: 'none' as const })),
    })
    withServices(<Project />, client)
    await waitFor(() => expect(client.getProjectRules).toHaveBeenCalledWith('p1'))
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const panel = await screen.findByRole('complementary', { name: 'New task' })
    await userEvent.type(within(panel).getByLabelText('What should change'), 'Push it')
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    await waitFor(() => expect(client.startTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Push it', end: 'none' })))
  })

  it('shows a task’s issue and pull request on its card, and its ending on its plan, which can change', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            items.card(
              card({ plan: { ...card().plan!, end: 'draft' }, issue: { product: 'linear', key: 'MER-231', title: 't', url: 'u' } }),
              'c1',
            ),
            items.card(card({ taskId: 't2', slug: 'shipped', phase: 'ready', change: change(), plan: null }), 'c2'),
          ],
        }),
      ),
    })
    withServices(<Project />, client)
    expect((await screen.findAllByText('MER-231')).length).toBeGreaterThan(0)
    expect(screen.getByText('PR #12')).toBeTruthy()
    // No rule of the project's picked the draft pull request, so none is named.
    expect(screen.queryByText(/rule/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Open a draft PR/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Push the branch only/ }))
    await waitFor(() => expect(screen.getByText('this task only')).toBeTruthy())
    await waitFor(() => expect(client.changePlan).toHaveBeenLastCalledWith('pln1', expect.any(Array), 'none'))
  })
})

describe('what reaching outside says, in every case', () => {
  it('draws each product with its own name and mark, and an issue’s status and priority as the kit’s', () => {
    const all: ReadonlyArray<Product> = ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello']
    expect(all.map(productName)).toEqual(['GitHub', 'GitLab', 'Bitbucket', 'Bitbucket', 'Linear', 'Jira', 'Jira', 'Trello'])
    expect(productBrand('jira_dc')).toBe(Brand.Jira)
    expect((['triage', 'backlog', 'todo', 'started', 'done', 'cancelled'] as const).map(issueStatus)).toEqual([
      IssueStatus.Backlog,
      IssueStatus.Backlog,
      IssueStatus.Todo,
      IssueStatus.InProgress,
      IssueStatus.Done,
      IssueStatus.Cancelled,
    ])
    expect(['urgent', 'high', 'medium', 'low', 'none', 'odd'].map(issuePriority)).toEqual([
      IssuePriority.Urgent,
      IssuePriority.High,
      IssuePriority.Medium,
      IssuePriority.Low,
      IssuePriority.None,
      IssuePriority.None,
    ])
  })

  it('offers each product as what it is for, with an address example where it needs one', () => {
    const list = {
      ...connectionList,
      products: [
        ...connectionList.products,
        { ...connectionList.products[1]!, product: 'jira_cloud' as const, name: 'Jira', hostedUrl: null, tokenNeedsUser: true },
        {
          ...connectionList.products[0]!,
          product: 'bitbucket_dc' as const,
          name: 'Bitbucket Data Center',
          tracker: false,
          hostedUrl: null,
        },
      ],
      connections: [{ ...githubConnection, webUrl: 'https://git.meridian.dev' }],
    }
    expect(servicesOf(list).map((service) => [service.id, service.what, service.instanceExample])).toEqual([
      ['github', 'Pull requests and issues', undefined],
      ['linear', 'Issues', undefined],
      ['jira_cloud', 'Issues', 'https://your-site.atlassian.net'],
      ['bitbucket_dc', 'Pull requests', undefined],
    ])
    expect(connectionsOf(list)).toEqual([{ id: 'conn1', service: 'github', account: 'you', instance: 'https://git.meridian.dev' }])
  })

  it('says each thing that arrives in its own words', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async (): Promise<ThreadSnapshot> =>
        snapshot({
          items: [
            items.arrival({ kind: 'review', from: 'lee', verdict: 'approved', text: '' }),
            items.arrival({ kind: 'review', from: 'kim', verdict: null, text: 'Fine.' }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 3, failed: 0, failing: [] }),
            items.arrival({ kind: 'checks', from: null, text: null, passed: 0, failed: 2, failing: ['test', 'lint'] }),
            items.arrival({ kind: 'closed', from: null, text: null, source: 'gitlab', where: 'MR !4' }),
            items.arrival({ kind: 'ready', from: null, text: null }),
            items.step({ step: 'publish', summary: 'Pushed althar/x.', change: null }),
            items.step({ step: 'publish', summary: 'Opened pull request #12 for review.', change: change({ draft: false }) }),
            items.you('See', null, [
              {
                kind: 'issue',
                product: 'github',
                key: '#12',
                title: 'Refunds ignore the limit',
                url: 'https://github.com/m/a/issues/12',
                status: { name: 'Open', category: 'todo' },
                priority: null,
                container: null,
              },
            ]),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('approved PR #12')).toBeTruthy()
    expect(screen.getByText('reviewed PR #12')).toBeTruthy()
    expect(screen.getByText('Checks passed on PR #12')).toBeTruthy()
    expect(screen.getByText('Checks failed on PR #12')).toBeTruthy()
    expect(screen.getByText('Failed: test, lint')).toBeTruthy()
    expect(screen.getByText('Closed MR !4')).toBeTruthy()
    expect(screen.getByText('Ready for review: PR #12')).toBeTruthy()
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.getByText('meridian/api · Open')).toBeTruthy()
    expect(screen.getByText('Refunds ignore the limit')).toBeTruthy()
  })
})
