import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type StuckStep, type ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { lookedOf, noOutputsOf, readsOf } from '../src/renderer/features/task/NoOutputsView'
import { conflictsOf } from '../src/renderer/features/task/Outputs'
import { elapsedOf, sinceOf, statusOf, TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, changed, fakeClient, items, models, snapshot, status, streamed } from './fixtures'
import type { ChangedFile } from '@althar/contracts'
import { clock } from '../src/renderer/shared/time'
import { reads } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { servicesFor, withServices } from './render'

function Task({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <TaskView model={useTask('th1')} onBack={onBack} />
}

const thread = (overrides: Partial<ThreadSnapshot> = {}) =>
  snapshot({
    items: [
      items.you('Add a retry'),
      items.thinks('Where is the call?'),
      items.tool({ locations: [{ path: '/w/meridian/src/checkout.ts' }] }),
      items.says('Found **it**.', 'claude-code', 'reply'),
      items.plan([{ content: 'Write the test', status: 'completed' }]),
      items.notice({ severity: 'warning', title: 'Context is filling up' }),
      items.notice({ source: 'runtime', title: 'Codex took over from Claude Code.' }, null),
      items.says('Carrying on.', 'codex'),
    ],
    ...overrides,
  })

const running = (overrides: Partial<ThreadSnapshot> = {}) => {
  const base = thread(overrides)
  return { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
}

describe('a task', () => {
  it('catches up on what changed between its route reading it and its first listening', async () => {
    const meanwhile = items.says('Said meanwhile', 'claude-code', 'i-meanwhile')
    const getThread = vi
      .fn()
      .mockResolvedValueOnce(thread())
      .mockResolvedValue(thread({ items: [...thread().items, meanwhile] }))
    const { client, emit } = fakeClient({ getThread })
    const services = servicesFor(client)
    // The route's loader reads the thread; an item arrives before the screen has mounted and listens.
    await services.cache.fetchQuery(reads(client).thread('th1'))
    act(() => emit(changed('thread_item', 'i-meanwhile')))
    render(
      <ServicesProvider value={services}>
        <Task />
      </ServicesProvider>,
    )
    expect(await screen.findByText('Said meanwhile')).toBeTruthy()
    // Read again whole as it showed, beside reading what it changed.
    expect(getThread.mock.calls.filter(([, page]) => page === undefined)).toHaveLength(2)
  })

  it('reads what it changed from git as it opens, and again as its outputs or its changes show', async () => {
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const ready = thread({ task: { ...thread().task, phase: 'ready', files: [file] } })
    const { client } = fakeClient({ getThread: vi.fn(async () => ready) })
    withServices(<Task />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    const fresh = () => vi.mocked(client.getThread).mock.calls.filter(([, page]) => page?.fresh === true).length
    // Ready, it opens on its outputs: one read.
    await waitFor(() => expect(fresh()).toBe(1))
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('c')
    expect(fresh()).toBe(1)
    await userEvent.keyboard('o')
    await waitFor(() => expect(fresh()).toBe(2))
    // And the changes, over the window.
    await userEvent.keyboard('{Meta>}d{/Meta}')
    await waitFor(() => expect(fresh()).toBe(3))
  })

  it('shows its header and its thread', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task onBack={onBack} />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    // The lead's model, by the name its agent gives it.
    expect((await screen.findAllByText('Claude Opus')).length).toBeGreaterThan(0)
    // Its branch, and who leads it, are said with where it stands, and shown on hover.
    expect(screen.getByRole('banner', { name: 'Add a retry' }).textContent).toMatch(/althar\/add-a-retry/)
    // Nothing made yet, the Outputs face is there all the same, and says so.
    await userEvent.click(screen.getByRole('radio', { name: /Outputs/ }))
    expect(screen.getByRole('heading', { name: 'Nothing changed yet' })).toBeTruthy()
    await userEvent.keyboard('c')
    // Work under way has no pull request to open yet.
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
    expect(screen.getByText('Idle')).toBeTruthy()
    expect(screen.getByText('it')).toBeTruthy()
    // The turn is over: what it did before its last message is folded.
    expect(screen.queryByText('src/checkout.ts')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Worked for 0s/ }))
    expect(screen.getByText('src/checkout.ts')).toBeTruthy()
    expect(screen.getByText('Write the test')).toBeTruthy()
    expect(screen.getByText('Context is filling up')).toBeTruthy()
    expect(screen.getByText('Codex took over from Claude Code.')).toBeTruthy()
    // Its turns are named by model, the agent said on hover.
    expect(screen.getAllByText('gpt-5.2-codex').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Thought' }))
    expect(screen.getByText('Where is the call?')).toBeTruthy()
    // Escape, with nothing else open, goes back to the project.
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalled()
  })

  it('opens its thread with what the person asked for, and names its last lead when none runs', async () => {
    const base = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [items.says('On it.', 'codex')],
          task: {
            ...base.task,
            request: 'Add a retry with backoff so a flaky provider doesn’t fail the order',
            lead: { agentId: 'codex', model: 'gpt-5.2-codex', account: null },
          },
          session: null,
        }),
      ),
    })
    withServices(<Task />, client)
    const asked = await screen.findByText('Add a retry with backoff so a flaky provider doesn’t fail the order')
    // Said before anything the lead did.
    expect(asked.compareDocumentPosition(screen.getByText('On it.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Stopped, the task is still led by who led it last, not by nobody.
    expect(screen.queryByText('No lead yet')).toBeNull()
    expect(screen.getAllByText('gpt-5.2-codex').length).toBeGreaterThan(0)
  })

  it('starts a stopped task on its last lead and model, and not on an agent signed out since', async () => {
    const base = snapshot()
    const stopped = thread({
      task: { ...base.task, lead: { agentId: 'claude-code', model: 'claude-opus-5', account: null } },
      session: null,
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => stopped) })
    const first = withServices(<Task />, client)
    await waitFor(() => expect(client.status).toHaveBeenCalled())
    await userEvent.type(await screen.findByRole('textbox', { name: /^Tell .* something$/ }), 'Carry on{Enter}')
    await waitFor(() =>
      expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude-code', model: 'claude-opus-5' })),
    )
    first.unmount()

    // Every agent signed out now: none is started that can't, the person is told why, and what they send waits.
    const out = { ...status, agents: status.agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) }
    const again = fakeClient({ getThread: vi.fn(async () => stopped), status: vi.fn(async () => out) }).client
    withServices(<Task />, again)
    expect(await screen.findByText(/No agent is signed in, so nothing can pick this up\./)).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell the lead something' }), 'Carry on{Enter}')
    await waitFor(() => expect(again.send).toHaveBeenCalled())
    expect(again.startSession).not.toHaveBeenCalled()
  })

  it('shows its steps as a track, the one it is on by what it does, and how long it has run', async () => {
    const steps = [
      { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
      { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
    ]
    const startedAt = new Date(Date.now() - 64 * 60_000).toISOString()
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, steps, step: 'review', startedAt } })),
    })
    withServices(<Task />, client)
    // Its lead waits while another agent reviews.
    expect(await screen.findByText('Reviewing')).toBeTruthy()
    const track = screen.getByRole('list', { name: 'Steps' })
    expect(
      within(track)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual(['Implement, done', 'Review, now'])
    expect(screen.getByText(/1h 4m/)).toBeTruthy()
  })

  it('pushes its branch with the person’s own git, then offers its host’s pull request page, and what connecting would add', async () => {
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const page = 'https://github.com/meridian/api/compare/main...althar/add-a-retry?expand=1'
    const at = (remote: { pushed: boolean; ahead: number }, phase: ThreadSnapshot['task']['phase'] = 'ready') => {
      const base = thread({ session: null })
      return {
        ...base,
        host: { product: 'github' as const, name: 'GitHub', webUrl: 'https://github.com', connected: false },
        task: {
          ...base.task,
          phase,
          files: [file],
          commits: 2,
          here: [
            {
              repository: 'meridian',
              name: 'meridian',
              branch: 'main',
              head: 'abc111',
              remote: { name: 'origin', branch: 'althar/add-a-retry', newPullRequest: page, ...remote },
            },
          ],
        },
      }
    }
    let stands = { pushed: false, ahead: 2 }
    // Under way, its branch so far can go up already.
    const early = withServices(<Task />, fakeClient({ getThread: vi.fn(async () => at(stands, 'running')) }).client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    const sofar = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(sofar.getByText('Its branch so far')).toBeTruthy()
    expect(sofar.getByRole('button', { name: 'Push the branch to origin' })).toBeTruthy()
    early.unmount()

    const { client } = fakeClient({ getThread: vi.fn(async () => at(stands)) })
    const view = withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('Not merged yet')).toBeTruthy()
    expect(outputs.getByText('Not on origin yet')).toBeTruthy()
    // Nothing to connect for, before anything is pushed.
    expect(screen.queryByText(/Connected to GitHub, Althar would/)).toBeNull()
    await userEvent.click(outputs.getByRole('button', { name: 'Push the branch to origin' }))
    await waitFor(() => expect(client.pushBranch).toHaveBeenCalledWith('t1', [{ repository: 'meridian', head: 'abc111' }]))
    view.unmount()

    // Pushed: its pull request is a press away on GitHub, and connecting would let Althar carry it from there.
    stands = { pushed: true, ahead: 0 }
    withServices(<Task />, client)
    const pushed = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(pushed.getByText('On origin')).toBeTruthy()
    expect(pushed.getByRole('link', { name: /Open a pull request on GitHub/ }).getAttribute('href')).toBe(page)
    expect(pushed.queryByRole('button', { name: 'Push the branch to origin' })).toBeNull()
    expect(
      screen.getByText(/Connected to GitHub, Althar would open the pull request itself, bring its checks and reviews back to the lead/),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    expect(await screen.findByRole('complementary', { name: 'Code hosts and trackers' })).toBeTruthy()
    await userEvent.click(
      within(screen.getByRole('complementary', { name: 'Code hosts and trackers' })).getByRole('button', { name: /Close/ }),
    )
    expect(screen.queryByRole('complementary', { name: 'Code hosts and trackers' })).toBeNull()
  })

  it('says why a push of its branch didn’t go, in the remote’s words', async () => {
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        task: {
          ...base.task,
          phase: 'ready' as const,
          commits: 1,
          here: [
            {
              repository: 'meridian',
              name: 'meridian',
              branch: 'main',
              head: 'abc111',
              remote: { name: 'origin', branch: 'althar/add-a-retry', newPullRequest: null, pushed: false, ahead: 1 },
            },
          ],
        },
      })),
      pushBranch: vi.fn(async () =>
        Promise.reject(new ApiError({ reason: 'PushRefused', message: 'origin/althar/add-a-retry refused the push: protected branch.' })),
      ),
    })
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    await userEvent.click(outputs.getByRole('button', { name: 'Push the branch to origin' }))
    expect(await outputs.findByText('origin/althar/add-a-retry refused the push: protected branch.')).toBeTruthy()
  })

  it('names each repository’s pull request page by its host, and says how far behind its remote is', async () => {
    const base = thread({ session: null })
    const repo = (name: string, page: string | null, pushed: boolean, ahead: number) => ({
      repository: name,
      name,
      branch: 'main',
      head: `${name}-head`,
      remote: { name: 'origin', branch: 'althar/add-a-retry', newPullRequest: page, pushed, ahead },
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        host: null,
        task: {
          ...base.task,
          phase: 'ready' as const,
          commits: 3,
          files: [{ path: 'api/a.ts', from: null, status: 'modified' as const, add: 1, del: 0, binary: false, uncommitted: false }],
          here: [
            repo('api', 'https://gitlab.acme.dev/web/api/-/merge_requests/new?x', true, 1),
            repo('web', 'https://codeberg.org/me/web/compare/main...x', true, 2),
            repo('docs', 'https://git.example.org/me/docs/x', true, 0),
            { ...repo('tools', null, false, 0), remote: null },
          ],
        },
      })),
    })
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    // Its remote is behind by what each repository has that it doesn't.
    expect(outputs.getByText('3 commits not on origin yet')).toBeTruthy()
    expect(outputs.getByRole('link', { name: 'Open a pull request on GitLab' })).toBeTruthy()
    expect(outputs.getByRole('link', { name: 'Open a pull request on Codeberg' })).toBeTruthy()
    expect(outputs.getByRole('link', { name: 'Open a pull request' })).toBeTruthy()
    // With no host Althar knows, nothing to connect.
    expect(screen.queryByText(/Althar would open the pull request itself/)).toBeNull()
    await userEvent.click(outputs.getByRole('button', { name: 'Push the branch to origin' }))
    await waitFor(() =>
      expect(client.pushBranch).toHaveBeenCalledWith('t1', [
        { repository: 'api', head: 'api-head' },
        { repository: 'web', head: 'web-head' },
        { repository: 'docs', head: 'docs-head' },
      ]),
    )
  })

  it('keeps the pull request page of a repository its remote has, while another still waits for a push', async () => {
    const base = thread({ session: null })
    const repo = (name: string, page: string, pushed: boolean) => ({
      repository: name,
      name,
      branch: 'main',
      head: `${name}-head`,
      remote: { name: 'origin', branch: 'althar/add-a-retry', newPullRequest: page, pushed, ahead: 1 },
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        host: null,
        task: {
          ...base.task,
          phase: 'ready' as const,
          commits: 2,
          here: [
            repo('api', 'https://gitlab.acme.dev/web/api/-/merge_requests/new?x', true),
            repo('web', 'https://codeberg.org/me/web/compare/main...x', false),
          ],
        },
      })),
    })
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('Not on origin yet')).toBeTruthy()
    expect(outputs.getByRole('link', { name: 'Open a pull request on GitLab' })).toBeTruthy()
    expect(outputs.queryByRole('link', { name: 'Open a pull request on Codeberg' })).toBeNull()
    expect(outputs.getByRole('button', { name: 'Push the branch to origin' })).toBeTruthy()
  })

  it('opens on its outputs once ready, switches faces by c and o, and goes back on Escape', async () => {
    const onBack = vi.fn()
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    withServices(<Task onBack={onBack} />, client)
    // What it made, on its branch: merged here, as the person says.
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('On its branch')).toBeTruthy()
    expect(outputs.getByText('checkout.ts')).toBeTruthy()
    expect(screen.getByText('Ready for you')).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Merge into main' }))
    await waitFor(() => expect(client.mergeHere).toHaveBeenCalledWith('t1', [{ repository: 'meridian', head: 'abc111' }]))
    // c for the conversation, o for the outputs; not while typing.
    await userEvent.keyboard('c')
    expect(await screen.findByRole('region', { name: 'Thread' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
    await userEvent.type(screen.getByRole('textbox'), 'o')
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('o')
    expect(await screen.findByRole('article', { name: 'Add a retry' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalled()
  })

  it('says what merged here and whether its remote has it, and pushes it when the person says', async () => {
    const merged = [{ repository: 'meridian', name: 'meridian', branch: 'main', remote: 'origin/main', ahead: 1 }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, merged } })),
    })
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('Into main on this Mac. origin doesn’t have it yet.')).toBeTruthy()
    expect(outputs.getByText('Repository')).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
    expect(outputs.queryByRole('button', { name: /^Merge into/ })).toBeNull()
  })

  it('offers the push of what merged here beside a pull request for the rest', async () => {
    const merged = [{ repository: 'web', name: 'web', branch: 'main', remote: 'origin/main', ahead: 2 }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, changes: [change()], merged } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
  })

  it('says a merge here was pushed, or that there is nowhere to push it', async () => {
    const base = thread({ session: null })
    const once = (merged: ReadonlyArray<{ remote: string | null; ahead: number }>) =>
      fakeClient({
        getThread: vi.fn(async () => ({
          ...base,
          task: {
            ...base.task,
            phase: 'settled' as const,
            merged: merged.map((one) => ({ repository: 'meridian', name: 'meridian', branch: 'main', ...one })),
          },
        })),
      }).client
    const view = withServices(<Task />, once([{ remote: 'origin/main', ahead: 0 }]))
    // Nothing left to do there, it opens on its conversation, and what it made is a press away, in a line.
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByText('Merged into main, and pushed to origin.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Push/ })).toBeNull()
    view.unmount()
    withServices(<Task />, once([{ remote: null, ahead: 0 }]))
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByText('Merged into main on this Mac.')).toBeTruthy()
  })

  it('offers to have the lead settle a merge that conflicts, in words it acts on', async () => {
    const file: ChangedFile = { path: 'README.md', from: null, status: 'modified', add: 1, del: 1, binary: false, uncommitted: false }
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    vi.mocked(client.mergeHere).mockRejectedValueOnce(
      new ApiError({
        reason: 'CantMerge',
        message: 'It conflicts with the default branch, in README.md.',
        why: 'conflicts',
        detail: 'README.md',
      }),
    )
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    await userEvent.click(outputs.getByRole('button', { name: 'Merge into main' }))
    expect(await outputs.findByText(/It conflicts with main as it is now, in README\.md\./)).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Ask the lead to resolve it' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(/^main has moved on, and merging this task's branch into it conflicts in README\.md\./),
        }),
      ),
    )
    expect(outputs.queryByRole('button', { name: 'Ask the lead to resolve it' })).toBeNull()
  })

  it('says what merged in each of several repositories, pushes them all, and names the branch a conflict is with', async () => {
    const merged = [
      { repository: 'api', name: 'api', branch: 'main', remote: 'origin/main', ahead: 1 },
      { repository: 'web', name: 'web', branch: 'develop', remote: 'upstream/develop', ahead: 0 },
    ]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, commits: 2, merged } })),
    })
    const view = withServices(<Task />, client)
    expect(await screen.findByText('Into main and develop on this Mac. origin and upstream don’t have it yet.')).toBeTruthy()
    expect(screen.getByText('Repositories')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
    view.unmount()
    // Ahead on both: one press pushes each.
    const both = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        task: { ...base.task, phase: 'settled' as const, commits: 2, merged: merged.map((one) => ({ ...one, ahead: 1 })) },
      })),
    })
    const again = withServices(<Task />, both.client)
    expect(await screen.findByRole('button', { name: 'Push to each remote' })).toBeTruthy()
    again.unmount()
    // A conflict in one of several says whose branch it is with.
    const here = [
      { repository: 'api', name: 'api', branch: 'main', head: 'abc111' },
      { repository: 'web', name: 'web', branch: 'develop', head: 'def222' },
    ]
    const file: ChangedFile = { path: 'web/README.md', from: null, status: 'modified', add: 1, del: 1, binary: false, uncommitted: false }
    const conflicted = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    vi.mocked(conflicted.client.mergeHere).mockRejectedValueOnce(
      new ApiError({ reason: 'CantMerge', message: 'It conflicts.', why: 'conflicts', detail: 'web: README.md' }),
    )
    withServices(<Task />, conflicted.client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into each default branch' }))
    expect(await screen.findByText(/It conflicts with web’s develop as it is now, in README\.md\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Ask the lead to resolve it' }))
    await waitFor(() =>
      expect(conflicted.client.send).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringMatching(/in web, develop conflicts in README\.md/) }),
      ),
    )
  })

  it('tells the lead of a task across repositories which default branch each conflicts with', () => {
    const here = [
      { name: 'api', branch: 'main' },
      { name: 'web', branch: 'develop' },
    ]
    expect(conflictsOf('web: README.md', here)).toEqual([{ name: 'web', branch: 'develop', files: 'README.md' }])
    expect(conflictsOf('api: a.ts; web: b.ts, c.ts', here).map((one) => [one.name, one.branch, one.files])).toEqual([
      ['api', 'main', 'a.ts'],
      ['web', 'develop', 'b.ts, c.ts'],
    ])
    expect(conflictsOf('README.md', [{ name: 'meridian', branch: 'trunk' }])).toEqual([{ name: null, branch: 'trunk', files: 'README.md' }])
  })

  it('stays on the conversation the person is reading when the task becomes ready', async () => {
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const base = thread()
    const getThread = vi.fn(async () => ({ ...base, task: { ...base.task, files: [file] } }))
    const { client, emit } = fakeClient({ getThread })
    withServices(<Task />, client)
    expect(await screen.findByRole('region', { name: 'Thread' })).toBeTruthy()
    getThread.mockResolvedValue({ ...base, task: { ...base.task, files: [file], phase: 'ready' as const } })
    emit(changed('task', 't1', 'th1'))
    expect(await screen.findByText('Ready for you')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Thread' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
  })

  it('accepts a ready pull request at the head it showed, or sends it back as a note to its lead', async () => {
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        task: { ...base.task, phase: 'ready' as const, changes: [change({ draft: false })], commits: 2 },
      })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12'))
    await userEvent.click(screen.getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(screen.getByRole('textbox', { name: /What should change/ }), 'Name the retry')
    await userEvent.click(screen.getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Name the retry' })))
  })

  it('talks to its lead: sends, queues while it works, sends now, and interrupts', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    const view = withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(box, 'Add a test{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Add a test', disposition: 'after_current' }))
    expect((box as HTMLTextAreaElement).value).toBe('')

    vi.mocked(client.getThread).mockImplementation(async () => running())
    view.rerender(<></>)
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    expect(screen.getByText('Working')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Interrupt the lead/ }))
    expect(client.interrupt).toHaveBeenCalledWith('th1')
    await userEvent.type(busy, 'Stop, use the helper{Meta>}{Enter}{/Meta}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Stop, use the helper', disposition: 'interrupt_and_continue' }),
    )
  })

  it('names its lead by model, with the agent and account it runs on said on hover, and switches a model off from every model', async () => {
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, session: base.session === null ? null : { ...base.session, account: 'work' } })),
      getModels: vi.fn(async () => models.map((offered) => (offered.agentId === 'codex' ? { ...offered, blocked: ['gpt-5.2'] } : offered))),
    })
    withServices(<Task />, client)
    expect((await screen.findAllByText(', via Claude Code · work')).length).toBeGreaterThan(0)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    // Switched off: there, and not to be chosen, until it is switched on again.
    expect(within(browser).getByRole('button', { name: 'Use gpt-5.2' })).toHaveProperty('disabled', true)
    await userEvent.click(within(browser).getByRole('button', { name: 'Don’t use gpt-5.2' }))
    expect(client.setModelBlocked).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', blocked: false })
    await userEvent.click(within(browser).getByRole('button', { name: 'Don’t use Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenLastCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: true })
  })

  it('shows what the person sends at once, before Althar has it, and takes it out again if the send fails', async () => {
    let answer: () => void = () => undefined
    let refuse: (failure: Error) => void = () => undefined
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)))
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(box, 'Add a test{Enter}')
    // In the thread while the send is still on its way.
    expect(screen.getByText('Add a test')).toBeTruthy()
    answer()
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((_, reject) => (refuse = reject)))
    await userEvent.type(box, 'Never mind{Enter}')
    expect(screen.getByText('Never mind')).toBeTruthy()
    refuse(new Error('Althar is restarting.'))
    await waitFor(() => expect(screen.queryByText('Never mind')).toBeNull())
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('takes back a queued message, or puts it back in the composer to change', async () => {
    const edited = items.you('Use the helper', { state: 'queued', interrupting: false })
    const dropped = items.you('Skip the docs', { state: 'queued', interrupting: false })
    const { client } = fakeClient({ getThread: vi.fn(async () => running({ items: [items.you('Add a retry'), edited, dropped] })) })
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    expect(screen.getByRole('region', { name: '2 queued; the lead reads them in order' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Take “Skip the docs” out of the queue' }))
    expect(client.takeBack).toHaveBeenCalledWith(dropped.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(client.takeBack).toHaveBeenCalledWith(edited.id)
    await waitFor(() => expect((busy as HTMLTextAreaElement).value).toBe('Use the helper'))
    expect(screen.queryByRole('region', { name: /queued/ })).toBeNull()
    expect(screen.queryByText('Skip the docs')).toBeNull()
  })

  it('leaves a queued message where it is, and the composer as it was, when the lead has it already', async () => {
    const queued = items.you('Use the helper', { state: 'queued', interrupting: false })
    const { client } = fakeClient({ getThread: vi.fn(async () => running({ items: [items.you('Add a retry'), queued] })) })
    vi.mocked(client.takeBack).mockRejectedValueOnce(new Error('The lead has read it already.'))
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((busy as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByRole('region', { name: 'Queued; the lead reads it next' })).toBeTruthy()
  })

  it('changes how hard its lead thinks and its model, hands it to another agent, and stops it', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    // The lead's model and effort, in the composer.
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await waitFor(() => expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'th1', effort: 'low' }))
    // Every model is one step away, whichever agent offers it.
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    expect(within(browser).getByRole('button', { name: 'Use gpt-5.2' })).toBeTruthy()
    // An agent that is signed out offers nothing.
    expect(within(browser).queryByText(/OpenCode/)).toBeNull()
    await userEvent.click(within(browser).getByRole('button', { name: 'Use Claude Sonnet' }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' }))
    expect(client.setEffort).toHaveBeenCalledTimes(1)
    // Another agent's model hands the task to that agent, on its own effort, with what the person says next: nothing happens until then.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Opus when you send\./)).toBeTruthy()
    expect(client.switchAgent).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: /^Tell .* something$/ }), 'Over to you{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2-codex', body: 'Over to you' }),
    )
    expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ body: 'Over to you' }))
    expect(screen.queryByText(/takes over from/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Stop the task/ }))
    expect(client.stopSession).toHaveBeenCalledWith('th1')
  })

  it('opens the pull request of work that ended on its branch', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2 } })),
    })
    const view = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Open a pull request' }))
    await waitFor(() => expect(client.openChange).toHaveBeenCalledWith('t1'))
    view.unmount()
    // With its host not connected, there is no pull request a press could open.
    const unconnected = fakeClient({
      getThread: vi.fn(async () => ({
        ...thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2 } }),
        host: { product: 'github' as const, name: 'GitHub', webUrl: 'https://github.com', connected: false },
      })),
    })
    withServices(<Task />, unconnected.client)
    expect(await screen.findByText('Ready for you')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
  })

  it('merges work that ended on its branch here, up to the heads it showed', async () => {
    const here = [
      { repository: 'api', name: 'api', branch: 'main', head: 'abc111' },
      { repository: 'web', name: 'web', branch: 'develop', head: 'def222' },
    ]
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2, here } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into each default branch' }))
    await waitFor(() =>
      expect(client.mergeHere).toHaveBeenCalledWith('t1', [
        { repository: 'api', head: 'abc111' },
        { repository: 'web', head: 'def222' },
      ]),
    )
  })

  it('merges a repository that ended on its branch here, beside the pull request of the rest', async () => {
    const here = [
      { repository: 'tools', name: 'tools', branch: 'main', head: 'abc111' },
      { repository: 'docs', name: 'docs', branch: 'main', head: 'def222' },
    ]
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2, here, changes: [change()] } }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge tools and docs into main' }))
    await waitFor(() =>
      expect(client.mergeHere).toHaveBeenCalledWith('t1', [
        { repository: 'tools', head: 'abc111' },
        { repository: 'docs', head: 'def222' },
      ]),
    )
    // Its pull request is open already.
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
  })

  it('keeps the person’s pinned models in this window, and their default efforts in Althar', async () => {
    // The runtime keeps defaults: what is set is what the models say when read again.
    const kept = new Map<string, Array<{ model: string; effort: string }>>()
    const getModels = vi.fn(async () => models.map((offered) => ({ ...offered, defaults: kept.get(offered.agentId) ?? [] })))
    const setDefaultEffort = vi.fn(async (input: { agentId: string; model: string; effort: string }) => {
      kept.set(input.agentId, [...(kept.get(input.agentId) ?? []), { model: input.model, effort: input.effort }])
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()), getModels, setDefaultEffort })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    // Until the person pins one, each agent's current model is pinned; the one in use shows first.
    const pinned = await screen.findByRole('radiogroup', { name: 'Pinned models' })
    expect(
      within(pinned)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual([
      'Claude Opus, via Claude Codenot pinned',
      'Claude Code default, via Claude Code',
      'gpt-5.2-codex, via Codexhands the task to Codex',
    ])
    // High is not what Claude Code is on; the person makes it Opus's.
    expect(screen.getByText(/default Medium/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Make this default' }))
    expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'opus', effort: 'high' })
    expect(await screen.findByText('Claude Opus default')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    await userEvent.click(within(browser).getByRole('button', { name: 'Pin Claude Opus' }))
    await userEvent.click(within(browser).getByRole('combobox', { name: 'Default effort for gpt-5.2' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Extra high' }))
    await waitFor(() => expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'extra-high' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem('althar.models') ?? '{}')).toEqual({
      pins: ['claude-code:default', 'codex:gpt-5.2-codex', 'claude-code:opus'],
    })

    // A model with the person's default effort starts on it.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Tell .* something$/ }), 'Go{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({
        threadId: 'th1',
        agentId: 'codex',
        model: 'gpt-5.2',
        effort: 'extra-high',
        body: 'Go',
      }),
    )
  })

  it('leaves a lead at work alone when another agent is picked, until the person says something, and keeps it if asked', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: { ...snapshot().session!, turnRunning: true } })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Opus when you send\./)).toBeTruthy()
    // The picker says who will lead; the lead at work goes on.
    expect(screen.getByRole('button', { name: /^Lead: gpt-5\.2-codex/ })).toBeTruthy()
    expect([client.switchAgent, client.interrupt, client.setModel].map((call) => vi.mocked(call).mock.calls.length)).toEqual([0, 0, 0])
    await userEvent.click(screen.getByRole('button', { name: 'Keep Claude Opus' }))
    expect(screen.queryByText(/takes over from/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Lead: Claude Opus High' })).toBeTruthy()
    // From every model too; what the person says then is the new lead's, not a message queued for the old one.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Add to the queue/ }), 'Take it from here{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2', body: 'Take it from here' }),
    )
    expect(client.send).not.toHaveBeenCalled()
    // Its own models change without waiting.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'default' }))
  })

  it('answers what the rules keep for the person, several as one stack', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
      title: 'Run git push',
      reason: 'Pushing leaves the worktree.',
      command: 'git push',
      createdAt: '2026-09-29T12:00:00.000Z',
    }
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ attention: [call, { ...call, id: 'a2', command: null, title: 'Fetch a page' }] })),
    })
    withServices(<Task />, client)
    await screen.findByText('Needs you')
    expect(screen.getByText(/1 of 2/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Allow(?! all)/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
    await screen.findByText(/2 of 2/)
    await userEvent.click(screen.getByRole('radio', { name: /No, and say what to do instead/ }))
    await userEvent.type(screen.getByPlaceholderText('Say what to do instead'), 'Open a PR instead')
    await userEvent.click(screen.getByRole('button', { name: /^Deny/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a2', decision: 'reject', reason: 'Open a PR instead' }))
  })

  it('keeps an answer as a rule by the scope the runtime offers, and offers no always it wouldn’t keep', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
      title: 'Run git status',
      reason: "This project asks you before anything an agent does beyond the task's own files.",
      command: 'git status --short',
      createdAt: '2026-09-29T12:00:00.000Z',
      always: {
        command: 'git status --short',
        prefix: 'git status',
        kind: null,
        allow: ['exact', 'prefix'] as const,
        deny: ['exact'] as const,
      },
    }
    const held = {
      ...call,
      id: 'a2',
      reason: 'Deploying or publishing always asks.',
      command: 'make deploy',
      always: { command: 'make deploy', prefix: 'make deploy', kind: 'deploy' as const, allow: [], deny: ['kind'] as const },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [call, held] })) })
    withServices(<Task />, client)
    await screen.findByText('Needs you')
    await userEvent.click(screen.getByRole('radio', { name: /Yes, and always allow/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'What to always allow' }))
    await userEvent.click(await screen.findByRole('option', { name: 'commands starting “git status”' }))
    await userEvent.click(screen.getByRole('button', { name: /^Allow(?! all)/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow', always: 'prefix' }))
    // Held for the person by the always-ask list: never, by its kind, but no always allow.
    await screen.findByText(/2 of 2/)
    expect(screen.queryByRole('radio', { name: /Yes, and always allow/ })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /No, and never allow/ }))
    expect(screen.getByText('deploying and publishing')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Deny/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a2', decision: 'reject', always: 'kind' }))
  })

  it('allows every call in the stack once with Allow all', async () => {
    const call = (id: string) => ({
      id,
      kind: 'permission' as const,
      stuck: null,
      title: `Run ${id}`,
      reason: 'It asks.',
      command: id,
      createdAt: '2026-09-29T12:00:00.000Z',
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [call('a1'), call('a2'), call('a3')] })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow all 3' }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledTimes(3))
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a3', decision: 'allow' })
  })

  it('says in a line under a turn what the project’s rules let through, and which rule', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.you('Check the tree'),
            items.tool({
              title: 'Run git status --short',
              toolKind: 'execute',
              command: 'git status --short',
              allowedBy: { pattern: 'git status', match: 'prefix' },
            }),
            items.says('Clean.'),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    const line = await screen.findByRole('button', { name: /Allowed 1 request/ })
    expect(line.textContent).toContain('by meridian’s rules')
    await userEvent.click(line)
    expect(await screen.findByText('commands starting “git status”')).toBeTruthy()
  })

  it('shows a step that needs the person, and takes their answer: tell the lead, hand it on, or abandon it', async () => {
    const stuck = (overrides: Partial<StuckStep> = {}) => ({
      id: 'st1',
      kind: 'stuck' as const,
      title: '',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'no_report' as const,
        detail: null,
        agentId: 'claude-code',
        round: 0,
        open: 0,
        ...overrides,
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [stuck()] })) })
    const view = withServices(<Task />, client)
    expect(await screen.findByText('Claude Code ended its turn twice without saying the step is done.')).toBeTruthy()
    expect(screen.getByText('Reminded it to report')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Tell the lead' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What should it do instead?' }), 'Report it now.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'tell', note: 'Report it now.' } }),
    )

    // A review that couldn't start: another reviewer, or none.
    view.unmount()
    vi.mocked(client.getThread).mockImplementation(async () =>
      thread({ attention: [stuck({ step: 'review', why: 'failed_to_start', detail: 'It isn’t signed in.', agentId: 'codex' })] }),
    )
    const again = withServices(<Task />, client)
    expect(await screen.findByText("Codex couldn't start. It isn’t signed in.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review again' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Claude Code/ }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'retry', agentId: 'claude-code' } }),
    )

    // Out of review rounds: accepted as it is.
    again.unmount()
    vi.mocked(client.getThread).mockImplementation(async () =>
      thread({ attention: [stuck({ step: 'review', why: 'round_limit', open: 2 })] }),
    )
    withServices(<Task />, client)
    expect(await screen.findByText(/Three rounds of review are done.*2 findings are still open\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Accept it as it is' }))
    await waitFor(() => expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'abandon' } }))
  })

  it('says why each step needed the person', () => {
    const at = (why: StuckStep['why'], detail: string | null = null, open = 0) =>
      stuckWords.what({ step: 'implement', why, detail, agentId: null, round: 0, open }, 'Codex')
    expect([at('session_ended'), at('restarted'), at('failed_to_start'), at('round_limit', null, 1), at('usage_limit')]).toEqual([
      'Codex stopped before the step was done.',
      'Althar restarted while this step was running.',
      "Codex couldn't start.",
      "Three rounds of review are done, and the lead's last changes haven't been reviewed. One finding is still open.",
      "Codex reached its usage limit and didn't say when it resets.",
    ])
    expect([at('stalled'), at('looping', 'npm test'), at('over_budget', '6 hours'), at('refused')]).toEqual([
      'Codex stopped showing any sign of work on this step.',
      'Codex kept running `npm test` to the same end.',
      "Codex has worked on this step for 6 hours since you last said anything, and isn't done.",
      'Codex declined to go on with this step.',
    ])
  })

  it('shows what Althar tried for a lead that went quiet, and starts it again', async () => {
    const quiet = {
      id: 'st7',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'stalled' as const,
        detail: null,
        agentId: 'codex',
        round: 0,
        open: 0,
        tried: ['carried_on' as const, 'restarted' as const],
      },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [quiet] })) })
    withServices(<Task />, client)
    await screen.findByText('Codex stopped showing any sign of work on this step.')
    expect(screen.getByText('Stopped its turn and told it to carry on')).toBeTruthy()
    expect(screen.getByText('Started Codex afresh')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tell the lead' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st7', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('hands a step whose agent is out of usage on, or tries it again, and never tells it anything', async () => {
    const out = {
      id: 'st9',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: { step: 'implement' as const, why: 'usage_limit' as const, detail: null, agentId: 'codex', round: 0, open: 0 },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [out] })) })
    withServices(<Task />, client)
    await screen.findByText("Codex reached its usage limit and didn't say when it resets.")
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    // Handing it on is offered only to the agents that aren't out.
    await userEvent.click(screen.getByRole('button', { name: 'Try another agent' }))
    expect(screen.queryByRole('menuitem', { name: /Codex/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Try Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st9', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('starts the lead picked when the person says something to a task none is working on, with that as its first turn', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: null })) })
    withServices(<Task />, client)
    expect(await screen.findByText('Stopped')).toBeTruthy()
    // No button to start one that has nothing to do: saying something starts it.
    expect(screen.queryByRole('button', { name: 'Start the lead' })).toBeNull()
    // Nothing to stop; its folder still opens, in the editor files open in.
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    expect(screen.queryByRole('menuitem', { name: /Stop the task/ })).toBeNull()
    await userEvent.click(await screen.findByRole('menuitem', { name: /Open in Zed/ }))
    expect(client.openInEditor).toHaveBeenCalledWith({ taskId: 't1', editor: 'zed' })
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: gpt-5.2-codex Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell Claude Code something' }), 'Carry on with the retry.{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'default' }))
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Carry on with the retry.', disposition: 'after_current' })
    // Queued before the lead starts, so it reads it in its first turn.
    expect(vi.mocked(client.send).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.startSession).mock.invocationCallOrder[0] ?? 0)
  })

  it('shows text as it streams; reads a changed item alone, and the head alone for anything else', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { client, emit, watching } = fakeClient({ getThread: vi.fn(async () => thread()) })
      withServices(<Task />, client)
      await screen.findByText('it')
      // The window watches once, for every screen.
      expect(watching).toHaveLength(1)
      act(() => emit(streamed('reply', 'Found it, and a second call.')))
      act(() => emit(streamed('reply', 'Not this thread', 'other')))
      await screen.findByText('Found it, and a second call.')
      // How full the lead's context is shows in the composer as it says, for this thread only.
      expect(screen.queryByRole('button', { name: /^Context/ })).toBeNull()
      act(() => emit({ _tag: 'Context', threadId: 'other', used: 190_000, size: 200_000 }))
      act(() => emit({ _tag: 'Context', threadId: 'th1', used: 50_000, size: 200_000 }))
      expect(await screen.findByRole('button', { name: 'Context 25% used' })).toBeTruthy()

      vi.mocked(client.getThreadItem).mockImplementation(async (_threadId, itemId) =>
        itemId === 'reply'
          ? items.says('Found it, and a second call. Done.', 'claude-code', 'reply')
          : items.says('A new line.', 'codex', itemId),
      )
      vi.mocked(client.getThread).mockImplementation(async () => ({ ...thread({ items: [] }), attention: [], session: null }))
      act(() => {
        emit(changed('thread_item', 'reply'))
        emit(changed('thread_item', 'reply'))
        emit(changed('thread_item', 'fresh'))
        emit(changed('thread_item', 'x', 'th9'))
        emit(changed('provider_session', 's1'))
      })
      await act(() => vi.advanceTimersByTimeAsync(100))
      await screen.findByText('Found it, and a second call. Done.')
      await screen.findByText('A new line.')
      expect(vi.mocked(client.getThreadItem).mock.calls.map(([, itemId]) => itemId)).toEqual(['reply', 'fresh'])
      // The head is read without items, and the items read so far stay.
      expect(client.getThread).toHaveBeenLastCalledWith('th1', { limit: 0 })
      await screen.findByText('Stopped')
      expect(screen.getByText('Carrying on.')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a command over several lines on one, and all of it when its row opens', async () => {
    const script = "python3 - <<'EOF'\nprint('hi')\nEOF"
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ items: [items.tool({ title: 'python3', toolKind: 'execute', command: script })] })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Worked for/ }))
    await userEvent.click(await screen.findByText("python3 - <<'EOF' …"))
    expect(await screen.findByText("print('hi')")).toBeTruthy()
  })

  it('opens a long one-line command too, since its row clips it', async () => {
    const pipeline = `python3 -c "import json,sys; print(json.load(sys.stdin)['name'])" < package.json | tr a-z A-Z | tee out.txt`
    const short = 'bun test'
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.tool({ title: 'python3', toolKind: 'execute', command: pipeline }),
            items.tool({ title: 'bun', toolKind: 'execute', command: short }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Worked for/ }))
    await userEvent.click(await screen.findByText(pipeline))
    expect(await screen.findByRole('figure')).toBeTruthy()
    // A short one has nothing more to show, so its row doesn't open.
    expect(screen.getByText(short).closest('button')).toBeNull()
  })

  it("folds the lead's work under what its step reported, and shows what the review found", async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.tool({ title: 'Edit checkout.ts', toolKind: 'edit' }),
            items.step({ summary: 'Added the retry, and a test.' }),
            items.step({
              step: 'review',
              verdict: 'changes_requested',
              summary: 'One thing to fix.',
              agentId: 'codex',
              findings: [
                { severity: 'major', file: 'src/checkout.ts', line: 12, claim: 'The retry never stops.' },
                { severity: 'nit', file: 'README.md', line: null, claim: 'A typo.' },
                { severity: 'minor', file: null, line: null, claim: 'Name it better.' },
              ],
            }),
            items.step({ step: 'settle', summary: 'Capped the retries at three.' }),
            items.step({ step: 'review', round: 1, verdict: 'pass', summary: '', agentId: 'mystery' }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Added the retry, and a test.')).toBeTruthy()
    expect(screen.queryByText('checkout.ts')).toBeNull()
    expect(screen.getByText('Capped the retries at three.')).toBeTruthy()
    expect(screen.getByText('One thing to fix.')).toBeTruthy()
    expect(screen.getByText(/round 2/)).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: /findings|Details/i })[0]!)
    expect(await screen.findByText('The retry never stops.')).toBeTruthy()
    expect(screen.getByText('src/checkout.ts:12')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows earlier items when asked', async () => {
    const newest = thread({ items: [items.says('The newest.', 'claude-code', 'newest')], earlier: true })
    const { client } = fakeClient({
      getThread: vi.fn(async (_threadId: string, page?: { before?: number }) =>
        page?.before === undefined
          ? newest
          : { ...newest, items: [items.says('An earlier one.', 'claude-code', 'earlier')], earlier: false },
      ),
    })
    withServices(<Task />, client)
    await screen.findByText('The newest.')
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    await screen.findByText('An earlier one.')
    expect(client.getThread).toHaveBeenLastCalledWith('th1', { before: newest.items[0]?.sequence, limit: 100 })
    expect(screen.queryByText('Earlier in this task')).toBeNull()
  })

  it('says what went wrong, and lets it go', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread()),
      setModel: vi.fn(async () =>
        Promise.reject(
          new ApiError({ reason: 'ModelUnchanged', message: "Claude Code is still on its old model. The agent doesn't offer sonnet." }),
        ),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use Claude Sonnet' }))
    await screen.findByText(/still on its old model/)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/still on its old model/)).toBeNull()
  })

  it('waits for its thread, and says when it cannot have it', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: "That task isn't there any more." }))),
      status: vi.fn(async () => Promise.reject(new Error('The port closed'))),
    })
    withServices(<Task />, client)
    expect((await screen.findAllByText(/That task isn't there any more.|didn't answer/)).length).toBeGreaterThan(0)
  })

  it('reads nothing earlier when it has nothing yet', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ items: [], earlier: true })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }))
    // Only the thread, and what it changed as it opened: no page before nothing.
    expect(vi.mocked(client.getThread).mock.calls.filter(([, page]) => page?.before !== undefined)).toEqual([])
  })

  it('says where it stands', () => {
    const base = snapshot()
    expect(statusOf(base)).toEqual({ status: TaskStatus.Running, state: 'Idle' })
    // A step held for a usage limit says whom it waits for, and until when.
    const until = '2026-10-03T15:40:00.000Z'
    expect(
      statusOf({ ...base, task: { ...base.task, waits: { agentId: 'codex', until } } }, (id) => (id === 'codex' ? 'Codex' : id)),
    ).toEqual({
      status: TaskStatus.Paused,
      state: `Waits for Codex, back at ${clock(until)}`,
    })
    expect(statusOf(running())).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(statusOf({ ...base, session: null })).toEqual({ status: TaskStatus.Stopped, state: 'Stopped' })
    // Ready, accepting it is the person's; settled, it is done.
    expect(statusOf({ ...base, task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Yours, state: 'Ready for you' })
    expect(statusOf({ ...base, task: { ...base.task, phase: 'settled' } })).toEqual({ status: TaskStatus.Done, state: 'Done' })
    expect(statusOf({ ...running(), task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(
      statusOf({
        ...base,
        attention: [{ id: 'a', kind: 'permission', title: 't', reason: 'r', command: null, stuck: null, createdAt: '' }],
      }).state,
    ).toBe('Needs you')
    // On a step, it says what it does there: while its lead works, and while another agent reviews.
    expect(statusOf({ ...running(), task: { ...base.task, step: 'implement' } }).state).toBe('Implementing')
    expect(statusOf({ ...base, task: { ...base.task, step: 'settle' } })).toEqual({
      status: TaskStatus.Running,
      state: 'Settling the review',
    })
  })

  it('says since when it has been where it stands', () => {
    const base = snapshot()
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 9, minutes)).toISOString()
    const on = (step: string) => ({ ...base, task: { ...base.task, step, stepAt: at(0) } })
    expect(sinceOf(on('implement'), at(6))).toBe('implement · 6m')
    // Settling the review's findings is part of the review.
    expect(sinceOf(on('settle'), at(6))).toBe('review · 6m')
    expect(sinceOf(base, at(6))).toBeNull()
    const call = { id: 'a', kind: 'permission' as const, title: 't', reason: 'r', command: null, stuck: null, createdAt: at(3) }
    expect(sinceOf({ ...on('implement'), attention: [call] }, at(6))).toBe('waiting · 3m')
    expect(sinceOf({ ...on('implement'), task: { ...on('implement').task, waits: { agentId: 'codex', until: at(60) } } }, at(6))).toBeNull()
    const reported = { ...items.step({ step: 'review' }), createdAt: new Date(Date.now() - 4 * 60_000).toISOString() }
    const now = new Date().toISOString()
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'ready' }, items: [reported] }, now)).toBe('ready · 4m ago')
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'stopped' }, items: [reported] }, now)).toBe('stopped · 4m ago')
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'settled', settledAt: reported.createdAt } }, now)).toBe('done · 4m ago')
  })

  it('says how long it has run, until it stopped', () => {
    const base = snapshot()
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 9, minutes)).toISOString()
    const task = { ...base.task, startedAt: at(0) }
    expect(elapsedOf(base, at(30))).toBeNull()
    // Under way, until now.
    expect(elapsedOf({ ...base, task }, at(6))).toBe('6m')
    // Ready, until its last step reported; stopped, until the last thing said; settled, until it settled.
    const said = { ...items.says('Done.'), createdAt: at(50) }
    const reported = { ...items.step({ step: 'review' }), createdAt: at(40) }
    expect(elapsedOf({ ...base, task: { ...task, phase: 'ready' }, items: [reported, said] }, at(59))).toBe('40m')
    expect(elapsedOf({ ...base, task: { ...task, phase: 'stopped' }, items: [reported, said] }, at(59))).toBe('50m')
    expect(elapsedOf({ ...base, task: { ...task, phase: 'settled', settledAt: at(20) } }, at(59))).toBe('20m')
  })
})

describe('a task’s outputs before it has made anything', () => {
  const at = (task: Partial<ThreadSnapshot['task']>, more: Partial<ThreadSnapshot> = {}) => {
    const base = snapshot()
    return snapshot({ ...more, task: { ...base.task, worktree: '/w/meridian', ...task } })
  }

  it('says what is true by how the task stands', () => {
    const working = noOutputsOf(at({ phase: 'running' }, { session: { ...snapshot().session!, turnRunning: true } }), 'Claude Opus 5')
    expect([working.title, working.note, working.working]).toEqual([
      'Nothing changed yet',
      'What Claude Opus 5 changes shows here as it goes.',
      true,
    ])
    expect(noOutputsOf(at({ phase: 'planned' }), 'Claude Opus 5').note).toBe(
      'It starts when its plan does. What its lead changes shows here.',
    )
    expect(noOutputsOf(at({ phase: 'stopped' }, { session: null }), 'Claude Opus 5').note).toBe(
      'Claude Opus 5 stopped before changing anything. Tell it to carry on in the conversation.',
    )
    const ended = noOutputsOf(at({ phase: 'settled' }, { session: null }), 'Claude Opus 5')
    expect([ended.title, ended.note, ended.working]).toEqual([
      'Nothing changed',
      'It ended without changing a file. What it found is in the conversation.',
      false,
    ])
  })

  it('lists the files its lead has looked at, the latest first, each once, and only the task’s', () => {
    const looked = lookedOf(
      at(
        {},
        {
          items: [
            items.tool({ locations: [{ path: '/w/meridian/README.md' }] }),
            items.tool({ locations: [{ path: '/w/meridian/src/checkout.ts' }, { path: '/Users/me/.codex/memories/MEMORY.md' }] }),
            items.says('Looking.'),
            items.tool({ toolKind: 'execute', command: "nl -ba src/retry.ts | sed -n '1,40p'; cat ../elsewhere.md" }),
            items.tool({ locations: [{ path: '/w/meridian/README.md' }] }),
            // Out of the folder by way of it: not the task's.
            items.tool({ locations: [{ path: '/w/meridian/../private.txt' }] }),
            items.tool({ toolKind: 'execute', command: 'cat src/../../outside.md ./src/./a.ts' }),
          ],
        },
      ),
    )
    expect(looked).toEqual(['src/a.ts', 'README.md', 'src/retry.ts', 'src/checkout.ts'])
    // Before its folder is made, a path can't be said to be the task's.
    const homeless = at({ worktree: null }, { items: [items.tool({ locations: [{ path: '/w/meridian/README.md' }] })] })
    expect(lookedOf(homeless)).toEqual([])
  })

  it('reads the files a shell command looks at, as agents run them, and nothing from anything else', () => {
    // As Codex and Claude Code ran them in a real profile.
    expect(readsOf(`/bin/zsh -lc "nl -ba src/scenes/menu.ts | sed -n '1,110p'; nl -ba src/scenes/hall.ts | sed -n '140,205p'"`)).toEqual([
      'src/scenes/menu.ts',
      'src/scenes/hall.ts',
    ])
    expect(readsOf('cat src/content/identities.ts src/ui/together.ts; wc -l index.html hall.html; ls; cat package.json')).toEqual([
      'src/content/identities.ts',
      'src/ui/together.ts',
      'index.html',
      'hall.html',
      'package.json',
    ])
    expect(readsOf("sed -n '1,5p;24,36p' /Users/me/.codex/memories/MEMORY.md")).toEqual(['/Users/me/.codex/memories/MEMORY.md'])
    expect(readsOf('head -n 20 src/a.ts && tail -n 5 src/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(readsOf("sed -e 's/a/b/' src/c.ts")).toEqual(['src/c.ts'])
    // An option's value isn't a file; a file under the folder is the task's.
    expect(readsOf('bat -r 1:40 src/x.ts && nl -w 3 ./src/y.ts || tail -n 5 ../outside.ts')).toEqual([
      'src/x.ts',
      './src/y.ts',
      '../outside.ts',
    ])
    expect(readsOf("sed --in-place 's/a/b/' src/c.ts")).toEqual([])
    // A redirect's file isn't read; after a cd, a relative path is from somewhere else.
    expect(readsOf('cat a.ts > copied.ts; head -n 3 b.ts 2> err.log')).toEqual(['a.ts', 'b.ts'])
    expect(readsOf('cat x.ts; cd /outside && cat private.txt /w/meridian/c.ts')).toEqual(['x.ts', '/w/meridian/c.ts'])
    // A name with a space, quoted; a line ended with a separator.
    expect(readsOf('cat "docs/read me.md";')).toEqual(['docs/read me.md'])
    // Edited in place, it is written, not read.
    expect(readsOf("sed -i '' 's#http://localhost#http://127.0.0.1#' check.mjs")).toEqual([])
    expect(readsOf('git status --short; npm run build; grep -rn "x" src | head -40; cat src/*.ts; cat $f')).toEqual([])
  })
})
