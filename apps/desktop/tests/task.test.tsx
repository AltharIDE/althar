import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { type AgentStatus, ApiError, type LimitCall, type StuckStep, type ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { lookedOf, noOutputsOf, readsOf } from '../src/renderer/features/task/NoOutputsView'
import { conflictsOf } from '../src/renderer/features/task/Outputs'
import { elapsedOf, openingFace, sinceOf, statusOf, TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { numberOf, reachOf, reviewedUnfurl } from '../src/renderer/features/task/ReviewCard'
import { agents, change, changed, fakeClient, fakeHost, items, models, snapshot, status, streamed, usual } from './fixtures'
import type { ChangedFile } from '@althar/contracts'
import { clock } from '../src/renderer/shared/time'
import { reads } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { servicesFor, withServices } from './render'

function Task({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <TaskView model={useTask('th1')} onBack={onBack} />
}

/** A PNG's signature and header, 1 by 1: enough for the window to read it as one. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
])

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

/** A task standing as given, with its menu open: the client, the view, and each item the menu offers, by its name. */
const taskMenu = async (task: Partial<ThreadSnapshot['task']>, session?: ThreadSnapshot['session']) => {
  const { client } = fakeClient({
    getThread: vi.fn(async () => thread({ task: { ...thread().task, ...task }, ...(session === undefined ? {} : { session }) })),
  })
  const view = withServices(<Task />, client)
  await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
  // An item's name is its label, without what it says it does.
  // Renaming is in every task's menu, and has its own test.
  const offered = (await screen.findAllByRole('menuitem'))
    .map((item) => document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent)
    .filter((name) => name !== 'Rename')
  return { client, view, offered }
}

describe('a task', () => {
  it('is seen once as its screen opens, however often it reads its thread again', async () => {
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    expect(await screen.findByText('Carrying on.')).toBeTruthy()
    await waitFor(() => expect(client.seeTask).toHaveBeenCalledWith(snapshot().task.id))
    act(() => emit(changed('task', snapshot().task.id)))
    await waitFor(() => expect(client.getThread).toHaveBeenCalledTimes(2))
    expect(client.seeTask).toHaveBeenCalledTimes(1)
  })

  it('is seen again as it becomes ready in front of the person, however quickly it finished', async () => {
    let now = thread()
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => now) })
    withServices(<Task />, client)
    expect(await screen.findByText('Carrying on.')).toBeTruthy()
    await waitFor(() => expect(client.seeTask).toHaveBeenCalledTimes(1))
    // Started and finished between two reads: never seen running here, it is ready now.
    now = thread({ task: { ...thread().task, phase: 'ready' } })
    act(() => emit(changed('task', snapshot().task.id)))
    await waitFor(() => expect(client.seeTask).toHaveBeenCalledTimes(2))
  })

  it('opens whether or not seeing it goes through', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread()),
      seeTask: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: 'No such task.' }))),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Carrying on.')).toBeTruthy()
    await waitFor(() => expect(client.seeTask).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('No such task.')).toBeNull()
  })

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
    // The round is over: its work is one line, under what it said; Althar's news between rounds stands alone.
    expect(screen.queryByText('src/checkout.ts')).toBeNull()
    expect(screen.getByText('Codex took over from Claude Code.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Worked 0s/ }))
    expect(screen.getByText('src/checkout.ts')).toBeTruthy()
    expect(screen.getByText('Write the test')).toBeTruthy()
    expect(screen.getByText('Context is filling up')).toBeTruthy()
    // Its rounds are named by model, the agent said on hover.
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

  it('reviews someone else’s pull request: opens with it, says what its lead can reach, and posts its draft only as the person says', async () => {
    const base = snapshot()
    const review = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 1212,
      url: 'https://github.com/meridian/api/pull/1212',
      title: 'Honour Retry-After on refund webhooks',
      author: 'ninemate',
      outside: true,
      additions: 58,
      deletions: 20,
      findings: 2,
      blocking: 1,
      verdict: null,
      posted: null,
    }
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [items.says('It needs a test.'), items.review()],
          task: {
            ...base.task,
            title: 'Review #1212: Honour Retry-After on refund webhooks',
            request: 'Review this one',
            review,
            phase: 'ready',
          },
        }),
      ),
    })
    withServices(<Task />, client)
    // Its thread opens with what the person asked, and the pull request under it.
    await screen.findByText('Review this one')
    // Drafted, its header says so: the review is the person's to post.
    expect(screen.getByText('Review drafted')).toBeTruthy()
    expect(screen.getAllByText('Honour Retry-After on refund webhooks').length).toBeGreaterThan(1)
    // Under its header, what its lead can reach: from outside, no network.
    const reach = screen.getByLabelText('What this review’s lead can reach')
    expect(
      within(reach)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual(['Reads ninemate’s branch', 'runs nothing of it', 'no network', 'posts nothing until you do'])
    await userEvent.click(within(reach).getByRole('button', { name: 'no network' }))
    expect(await screen.findByText(/The pull request is from outside the team, so the agent has no network/)).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    // Its draft: from outside, the lead would approve, and no verdict is chosen for the person.
    const card = screen.getByRole('article', { name: /Review draft · GitHub · meridian\/api #1212/ })
    expect(within(card).getByText('ninemate, from a fork · drafted by Claude Code')).toBeTruthy()
    for (const radio of within(card).getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(within(card).getByRole('button', { name: 'Post review' }))
    expect(client.postReviewDraft).not.toHaveBeenCalled()
    await userEvent.click(within(card).getByRole('radio', { name: 'Request changes' }))
    expect(client.changeReviewDraft).toHaveBeenCalledWith('rdr_1', { verdict: 'changes' })
    await userEvent.click(within(card).getByRole('switch', { name: 'Keep the comment on src/retry.ts:57' }))
    expect(client.changeReviewDraft).toHaveBeenCalledWith('rdr_1', { comments: [{ id: 'c2', kept: false }] })
    await userEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' Soon.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(client.changeReviewDraft).toHaveBeenLastCalledWith('rdr_1', {
      summary: 'The fix is **right**, but it needs a test. Soon.',
      comments: [
        { id: 'c1', body: 'Nothing covers the cap.' },
        { id: 'c2', body: 'Nit: seconds.' },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(client.discardReviewDraft).toHaveBeenCalledWith('rdr_1')
  })

  it('says a team’s review reads with the network, and posts once drafted where the person’s setting says so', () => {
    const team = {
      product: 'github' as const,
      repository: 'meridian/api',
      number: 7,
      url: 'https://github.com/meridian/api/pull/7',
      title: 'Tidy',
      author: 'ana',
      outside: false,
      additions: null,
      deletions: null,
      findings: 0,
      blocking: 0,
      verdict: null,
      posted: null,
    }
    expect(reachOf(team, false).map((one) => one.words)).toEqual(['Reads ana’s branch', 'runs nothing of it', 'posts nothing until you do'])
    expect(reachOf(team, true).at(-1)).toMatchObject({
      words: 'posts once drafted',
      means: expect.stringMatching(/Turn it off in Settings\.$/),
    })
    // From outside, the setting changes nothing: it waits for the person.
    expect(reachOf({ ...team, outside: true }, true).map((one) => one.words)).toContain('posts nothing until you do')
    expect(numberOf('gitlab', 4)).toBe('!4')
    expect(reviewedUnfurl(team)).toMatchObject({ kind: 'change', key: 'PR #7', state: 'open', repository: 'meridian/api' })
  })

  it('posts a review draft whose verdict stands chosen, and folds a posted one to its link', async () => {
    const base = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.review({ outside: false, fork: false, suggested: 'comment', verdict: 'comment', drafter: null, account: null }),
            items.review({
              draftId: 'rdr_2',
              state: 'posted',
              verdict: 'changes',
              review: { url: 'https://github.com/meridian/api/pull/1212#pullrequestreview-9', at: '2026-09-29T11:00:00.000Z' },
            }),
          ],
          task: { ...base.task, request: null },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Post review' }))
    expect(client.postReviewDraft).toHaveBeenCalledWith('rdr_1')
    expect(screen.getByText('The lead suggests Comment')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open on GitHub/ }).getAttribute('href')).toBe(
      'https://github.com/meridian/api/pull/1212#pullrequestreview-9',
    )
    // Not a review task: no reach under its header.
    expect(screen.queryByLabelText('What this review’s lead can reach')).toBeNull()
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
    // Connecting it opens GitHub's own walk in, beside the outputs.
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))
    const panel = await screen.findByRole('complementary', { name: 'Connect GitHub' })
    expect(await within(panel).findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: /Close/ }))
    expect(screen.queryByRole('complementary', { name: 'Connect GitHub' })).toBeNull()
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

  it('counts what is left to push as soon as a push ends, its button busy until the card read since is shown', async () => {
    const base = thread()
    const url = 'https://github.com/meridian/api/pull/12'
    const ready = (unpushed: number): ThreadSnapshot => ({
      ...base,
      task: { ...base.task, phase: 'ready' as const, changes: [change({ draft: false, localHead: 'def456', unpushed })], commits: 10 },
    })
    // Each read of the card after the push, answered when the test says.
    const rereads: Array<(snapshot: ThreadSnapshot) => void> = []
    const getThread = vi.fn(async () => ready(10))
    const { client, emit } = fakeClient({
      getThread,
      push: vi.fn(async () => {
        getThread.mockImplementation(() => new Promise<ThreadSnapshot>((resolve) => rereads.push(resolve)))
      }),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('10 commits aren’t on the pull request yet.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push 10 commits' }))
    await waitFor(() => expect(client.push).toHaveBeenCalledWith('t1', 'def456', url))
    const busy = () => screen.getByRole('button', { name: 'Push 10 commits' }).getAttribute('aria-busy')
    // The push's own read of the card, then another as the runtime's word of the push arrives, before the first answers.
    await waitFor(() => expect(rereads).toHaveLength(1))
    act(() => emit(changed('external_link', 'l1')))
    await waitFor(() => expect(rereads).toHaveLength(2))
    // The first answers, and the later read replaces it: Push stays under way, the ten never offered again as if nothing went.
    act(() => rereads[0]?.(ready(0)))
    await act(async () => {})
    expect(busy()).toBe('true')
    act(() => rereads[1]?.(ready(0)))
    // Read again, nothing is left: no second press.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Push \d+ commits?$/ })).toBeNull())
    expect(screen.queryByText('10 commits aren’t on the pull request yet.')).toBeNull()
    expect(client.push).toHaveBeenCalledTimes(1)
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

  it('sends images dropped on its composer with what the person says, and shows them in the thread at once', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.type(box, 'Look at this{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({
        threadId: 'th1',
        body: 'Look at this',
        disposition: 'after_current',
        images: [{ data: Buffer.from(PNG).toString('base64'), name: 'shot.png' }],
      }),
    )
    // Out of the composer, and on the message in the thread, drawn from its own bytes.
    expect(screen.queryByRole('list', { name: /to send/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'View shot.png' })).toBeTruthy()
    // Words sent on their own go as before.
    await userEvent.type(box, 'And this{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenLastCalledWith({ threadId: 'th1', body: 'And this', disposition: 'after_current' }))
  })

  it('puts a message Althar didn’t take back in the composer, its words and its images, to send again', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    vi.mocked(client.send).mockRejectedValueOnce(
      new ApiError({ reason: 'ImageRefused', message: 'Althar has nowhere to keep images here.' }),
    )
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.type(box, 'Look at this{Enter}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('Look at this'))
    expect(screen.getByRole('list', { name: '1 image to send' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View shot.png' })).toBeNull()
    // Sent again, it goes as it was.
    await userEvent.type(box, '{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenLastCalledWith({
        threadId: 'th1',
        body: 'Look at this',
        disposition: 'after_current',
        images: [{ data: Buffer.from(PNG).toString('base64'), name: 'shot.png' }],
      }),
    )
  })

  it('keeps a message Althar queued where it is when the lead it starts or resumes doesn’t, so it is never sent twice', async () => {
    const base = snapshot()
    const stopped = (actions: ThreadSnapshot['task']['actions']) =>
      thread({ task: { ...base.task, lead: { agentId: 'claude-code', model: 'claude-opus-5', account: null }, actions }, session: null })
    for (const [actions, starting] of [
      [[], 'startSession'],
      [['resume'], 'resumeTask'],
    ] as const) {
      const { client } = fakeClient({ getThread: vi.fn(async () => stopped([...actions])) })
      vi.mocked(client[starting]).mockRejectedValueOnce(new ApiError({ reason: 'SessionFailed', message: "Claude Code couldn't start." }))
      const view = withServices(<Task />, client)
      await waitFor(() => expect(client.status).toHaveBeenCalled())
      const box = await screen.findByRole('textbox', { name: /^Tell .* something$/ })
      fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
      expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
      await userEvent.type(box, 'Carry on{Enter}')
      expect(await screen.findByText("Claude Code couldn't start.")).toBeTruthy()
      expect(client[starting]).toHaveBeenCalled()
      // Queued, it stays in the thread, and the composer stays empty: nothing to send again.
      expect(screen.getByText('Carry on', { selector: 'p' })).toBeTruthy()
      expect((box as HTMLTextAreaElement).value).toBe('')
      expect(screen.queryByRole('list', { name: /to send/ })).toBeNull()
      await userEvent.type(box, '{Enter}')
      expect(client.send).toHaveBeenCalledTimes(1)
      view.unmount()
    }
  })

  it('keeps the agent picked to take over, and what was said, when the handover doesn’t go', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    vi.mocked(client.switchAgent).mockRejectedValueOnce(new Error('Althar is restarting.'))
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(box, 'Over to you{Enter}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('Over to you'))
    expect(screen.getByText(/gpt-5\.2-codex takes over from Claude Opus when you send\./)).toBeTruthy()
  })

  it('leaves a queued message in the queue when its images wouldn’t fit beside those waiting', async () => {
    const picture = (n: number) => ({
      digest: n.toString(16).padStart(64, '0'),
      mediaType: 'image/png',
      bytes: 68,
      width: 1,
      height: 1,
      name: `${n}.png`,
      unkept: null,
    })
    const queued = items.you(
      'All of these',
      { state: 'queued', interrupting: false },
      [],
      Array.from({ length: 10 }, (_, n) => picture(n)),
    )
    const { client } = fakeClient({ getThread: vi.fn(async () => running({ items: [items.you('Add a retry'), queued] })) })
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    fireEvent.drop(busy, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(
      await screen.findByText('Its images don’t fit beside these: a message can carry at most 10 images. Remove some first.'),
    ).toBeTruthy()
    expect(client.takeBack).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Queued; the lead reads it next' })).toBeTruthy()
    expect(screen.getByRole('list', { name: '1 image to send' })).toBeTruthy()
  })

  it('takes no images for a lead that doesn’t take them, and holds back those added before another was picked', async () => {
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        session: base.session === null ? null : { ...base.session, agentId: 'codex', agentName: 'Codex' },
      })),
    })
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Codex something' })
    await waitFor(() => expect(client.getModels).toHaveBeenCalled())
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Codex doesn’t take images, so they can’t be sent to it.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull()
  })

  it('holds a message back, saying why, when the agent picked to take over doesn’t take images', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText('Codex doesn’t take images. Remove them to send this, or pick an agent that does.')).toBeTruthy()
    await userEvent.type(box, 'Over to you{Enter}')
    expect(client.switchAgent).not.toHaveBeenCalled()
    expect((box as HTMLTextAreaElement).value).toBe('Over to you')
    // Taken off, the message goes.
    await userEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    await userEvent.type(box, '{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2-codex', body: 'Over to you' }),
    )
  })

  it('puts a queued message back in the composer with its images, which go again by their digests', async () => {
    const picture = { digest: 'f'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'shot.png', unkept: null }
    const queued = items.you('Like this', { state: 'queued', interrupting: false }, [], [picture])
    const { client } = fakeClient({ getThread: vi.fn(async () => running({ items: [items.you('Add a retry'), queued] })) })
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    // The queue says what went with it.
    expect(screen.getByText('1 image')).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('img', { name: 'shot.png' })).toHaveProperty('src', `althar-picture://shot/${'f'.repeat(64)}?w=1120`)
    await userEvent.type(busy, ' too{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({
        threadId: 'th1',
        body: 'Like this too',
        disposition: 'after_current',
        images: [{ digest: 'f'.repeat(64), name: 'shot.png' }],
      }),
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

  it('shows what the person sends at once, before Althar has it, and takes it out of the thread again if the send fails', async () => {
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
    await waitFor(() => expect(screen.queryByText('Never mind', { selector: 'p' })).toBeNull())
    expect(await screen.findByRole('alert')).toBeTruthy()
    // Back in the composer, to send again.
    expect((box as HTMLTextAreaElement).value).toBe('Never mind')
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
    expect(client.stopTask).toHaveBeenCalledWith('t1')
  })

  it('offers stopping and abandoning in its menu while it works, as the runtime says', async () => {
    const { client, offered } = await taskMenu({})
    expect(offered).toEqual(['Open in Zed', 'Stop the task', 'Abandon'])
    await userEvent.click(screen.getByRole('menuitem', { name: /Stop the task/ }))
    await waitFor(() => expect(client.stopTask).toHaveBeenCalledWith('t1'))
  })

  it('offers resuming a task stopped in the middle of its step', async () => {
    const { client, offered } = await taskMenu({ phase: 'stopped', actions: ['resume', 'abandon'] }, null)
    expect(offered).toEqual(['Open in Zed', 'Resume', 'Abandon'])
    expect(screen.getByText('Stopped')).toBeTruthy()
    await userEvent.click(screen.getByRole('menuitem', { name: /Resume/ }))
    await waitFor(() => expect(client.resumeTask).toHaveBeenCalledWith({ taskId: 't1' }))
  })

  it('offers how its conflicts go, as its project says or otherwise, and nothing beside the menu while it goes by the project', async () => {
    const { client } = await taskMenu({ resolveConflicts: { task: null, project: true } })
    expect(screen.getByRole('menuitemradio', { name: /Use the project setting/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('It’s on for this project.')).toBeTruthy()
    expect(screen.queryByText('Auto-resolve conflicts: on')).toBeNull()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Off for this task/ }))
    await waitFor(() => expect(client.setTaskResolveConflicts).toHaveBeenCalledWith({ taskId: 't1', resolveConflicts: false }))
  })

  it('says beside its menu where its lead resolves conflicts otherwise than its project, and not where it is the same', async () => {
    const shownFor = async (own: boolean, project: boolean) => {
      const { client } = fakeClient({
        getThread: vi.fn(async () => thread({ task: { ...thread().task, resolveConflicts: { task: own, project } } })),
      })
      const view = withServices(<Task />, client)
      await screen.findByRole('button', { name: 'More for this task' })
      const said = [screen.queryByText('Auto-resolve conflicts: on'), screen.queryByText('Auto-resolve conflicts: off')].map(
        (one) => one !== null,
      )
      view.unmount()
      return said
    }
    expect(await shownFor(true, false)).toEqual([true, false])
    expect(await shownFor(false, true)).toEqual([false, true])
    expect(await shownFor(true, true)).toEqual([false, false])
  })

  it('allows everything on it from its menu', async () => {
    const { client } = await taskMenu({})
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: /Allow everything on this task/ }))
    await waitFor(() => expect(client.setTaskAllowEverything).toHaveBeenCalledWith({ taskId: 't1', allowEverything: true }))
  })

  it('says why a call the project always asks about has no always allow, and allows everything on the task from it', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
      title: 'Run make deploy',
      reason: 'Deploying or publishing always asks.',
      command: 'make deploy',
      held: true,
      createdAt: '2026-09-29T12:00:00.000Z',
    }
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ attention: [call, { ...call, id: 'a2', held: false, command: 'git push' }] })),
    })
    withServices(<Task />, client)
    await screen.findByText(/always asks you about this, so there’s no “always allow”/)
    await userEvent.click(screen.getByRole('button', { name: 'Allow everything on this task' }))
    await waitFor(() => expect(client.setTaskAllowEverything).toHaveBeenCalledWith({ taskId: 't1', allowEverything: true }))
  })

  it('offers its folder for a plain task with no branch, and none where it has no worktree', async () => {
    const plain = await taskMenu({ phase: 'ready', branch: null, actions: ['abandon'] }, null)
    expect(plain.offered).toEqual(['Open in Zed', 'Abandon'])
    plain.view.unmount()
    expect((await taskMenu({ phase: 'held', branch: null, worktree: null, actions: ['abandon'] }, null)).offered).toEqual(['Abandon'])
  })

  it('offers no say on its conflicts once it settles', async () => {
    const { offered } = await taskMenu({ phase: 'settled', state: 'done', actions: [] }, null)
    expect(offered).toEqual(['Open in Zed'])
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })

  it('offers starting its plan now while it waits to start', async () => {
    const { client, offered } = await taskMenu({ phase: 'held', actions: ['start', 'abandon'], planId: 'pln1' }, null)
    expect(offered).toEqual(['Open in Zed', 'Start now', 'Abandon'])
    await userEvent.click(screen.getByRole('menuitem', { name: /Start now/ }))
    await waitFor(() => expect(client.startPlan).toHaveBeenCalledWith('pln1'))
  })

  it('marks each of its draft pull requests ready from its menu, in turn', async () => {
    const drafts = [change({ draft: true }), change({ draft: true, number: 1207, url: 'https://github.com/meridian/web/pull/1207' })]
    const { client, offered } = await taskMenu(
      { phase: 'ready', actions: ['abandon'], changes: [...drafts, change({ state: 'merged' })] },
      null,
    )
    expect(offered).toEqual(['Open in Zed', 'Mark ready for review', 'Abandon'])
    await userEvent.click(screen.getByRole('menuitem', { name: /Mark ready for review/ }))
    await waitFor(() => expect(client.markReady).toHaveBeenCalledTimes(2))
    expect(vi.mocked(client.markReady).mock.calls).toEqual(drafts.map((one) => ['t1', one.url]))
  })

  it('says an abandoned task was abandoned, and offers reopening it, and only its folder once merged', async () => {
    const drafts = [change({ draft: true })]
    const abandoned = await taskMenu({ phase: 'settled', state: 'abandoned', actions: ['reopen'], changes: drafts }, null)
    expect(abandoned.offered).toEqual(['Open in Zed', 'Reopen'])
    expect(screen.getByText('Abandoned')).toBeTruthy()
    await userEvent.click(screen.getByRole('menuitem', { name: /Reopen/ }))
    await waitFor(() => expect(abandoned.client.reopenTask).toHaveBeenCalledWith('t1'))
    abandoned.view.unmount()
    // Merged, it is done for good.
    expect((await taskMenu({ phase: 'settled', state: 'done', actions: [] }, null)).offered).toEqual(['Open in Zed'])
  })

  it('offers abandoning a merged task with commits after its pull request, which keep it in Needs you: it stays merged', async () => {
    const after = await taskMenu(
      {
        phase: 'ready',
        state: 'done',
        actions: ['leaveOut'],
        changes: [change({ state: 'merged' })],
        unshipped: { commits: 1, add: 300, del: 304 },
      },
      null,
    )
    expect(after.offered).toEqual(['Open in Zed', 'Abandon'])
    expect(screen.getByRole('menuitem', { name: /Abandon/ }).textContent).toContain('Its pull request stays merged.')
    await userEvent.click(screen.getByRole('menuitem', { name: /Abandon/ }))
    // Asked first, it says what stays merged and what is left out, and offers no reopening.
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('stays merged.')
    expect(dialog.textContent).toContain('The commit after it goes in no pull request.')
    expect(dialog.textContent).not.toContain('reopen')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await waitFor(() => expect(after.client.leaveOutCommits).toHaveBeenCalledWith('t1'))
    expect(after.client.abandonTask).not.toHaveBeenCalled()
  })

  it('renames a task in its header: pressing the title edits it where it is, Enter keeps it and Escape puts it back', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    const title = thread().task.title
    // Escape puts it back, and nothing is sent.
    await userEvent.click(await screen.findByRole('button', { name: `Rename: ${title}` }))
    const field = screen.getByRole('textbox', { name: 'Rename' })
    expect((field as HTMLInputElement).value).toBe(title)
    expect(field.getAttribute('maxlength')).toBe('60')
    await userEvent.type(field, ' and more{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull()
    expect(client.renameTask).not.toHaveBeenCalled()
    // An emptied title isn't kept: Enter says so and stays, and leaving puts it back.
    await userEvent.click(screen.getByRole('button', { name: `Rename: ${title}` }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Rename' }))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('alert').textContent).toBe('Give the task a title.')
    await userEvent.tab()
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull()
    expect(client.renameTask).not.toHaveBeenCalled()
    // Enter keeps what was typed, trimmed, once.
    await userEvent.click(screen.getByRole('button', { name: `Rename: ${title}` }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Rename' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Rename' }), '  Retry the checkout {Enter}')
    await waitFor(() => expect(client.renameTask).toHaveBeenCalledTimes(1))
    expect(client.renameTask).toHaveBeenCalledWith('t1', 'Retry the checkout')
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull()
    // From the menu too.
    await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    const again = await screen.findByRole('textbox', { name: 'Rename' })
    await waitFor(() => expect(document.activeElement).toBe(again))
  })

  it('asks before abandoning, saying what stays, and abandons on the person’s say-so', async () => {
    const pr = change({ state: 'open' })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ task: { ...thread().task, changes: [pr] } })) })
    vi.mocked(client.abandonTask).mockRejectedValueOnce(
      new ApiError({ reason: 'TaskRefused', message: 'The task is merged, so it stays done.' }),
    )
    withServices(<Task />, client)
    const abandon = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: /Abandon/ }))
      return screen.findByRole('dialog', { name: 'Abandon this task?' })
    }
    const asked = await abandon()
    expect(asked.textContent).toContain('The agents on it stop.')
    expect(asked.textContent).toContain('Its worktree stays in /w/meridian, as it is.')
    expect(asked.textContent).toContain('Its branch althar/add-a-retry stays. Nothing is pushed or deleted.')
    // Its pull request is offered to close on GitHub, on; its branch there to delete, off.
    expect(within(asked).getByRole('checkbox', { name: `Close pull request ${pr.prefix}${pr.number} on GitHub` })).toHaveProperty(
      'ariaChecked',
      'true',
    )
    expect(within(asked).getByRole('checkbox', { name: 'Delete its branch on GitHub' })).toHaveProperty('ariaChecked', 'false')
    // Cancelled, nothing happens.
    await userEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(client.abandonTask).not.toHaveBeenCalled()
    // Refused, it says why and stays open; then it goes.
    await userEvent.click(within(await abandon()).getByRole('button', { name: 'Abandon task' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeTruthy()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abandon task' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(client.abandonTask).toHaveBeenCalledTimes(2)
    expect(client.abandonTask).toHaveBeenLastCalledWith('t1')
    // Abandoned, its pull request is closed on its host, as the person left it on: only then.
    expect(client.closePullRequest).toHaveBeenCalledTimes(1)
    expect(client.closePullRequest).toHaveBeenCalledWith({ taskId: 't1', url: pr.url, deleteBranch: false })
  })

  /** A task with its pull request open, its abandon dialog open: the client, the pull request and the dialog. */
  const abandoning = async () => {
    const pr = change({ state: 'open' })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ task: { ...thread().task, changes: [pr] } })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abandon/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Abandon this task?' })
    return { client, pr, dialog, close: `Close pull request ${pr.prefix}${pr.number} on GitHub` }
  }

  it('abandons with its pull request left open on its host where the person turns closing off', async () => {
    const { client, dialog, close } = await abandoning()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: close }))
    // Left open, its branch there can't be deleted alone.
    expect(within(dialog).queryByRole('checkbox', { name: 'Delete its branch on GitHub' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(client.abandonTask).toHaveBeenCalledWith('t1')
    expect(client.closePullRequest).not.toHaveBeenCalled()
  })

  it('deletes its pull request’s branch on its host too where the person says', async () => {
    const { client, pr, dialog } = await abandoning()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' }))
    expect(dialog.textContent).toContain('Its branch althar/add-a-retry stays on this Mac.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(client.closePullRequest).toHaveBeenCalledWith({ taskId: 't1', url: pr.url, deleteBranch: true })
  })

  it('says a pull request its host wouldn’t close is still open, and offers to close it again', async () => {
    const { client, pr, dialog } = await abandoning()
    vi.mocked(client.closePullRequest).mockRejectedValueOnce(
      new ApiError({
        reason: 'ConnectorFailed',
        message: 'GitHub won’t let this account do that: Resource not accessible by integration.',
      }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    // Abandoned all the same: the dialog says so, and why the pull request is still open.
    const after = await screen.findByRole('dialog', { name: 'Task abandoned' })
    expect(within(after).getByRole('alert').textContent).toBe(
      `PR ${pr.prefix}${pr.number} is still open. GitHub won’t let this account do that: Resource not accessible by integration.`,
    )
    expect(client.abandonTask).toHaveBeenCalledTimes(1)
    await userEvent.click(within(after).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(client.closePullRequest).toHaveBeenCalledTimes(2)
  })

  it('says when abandoning that a planned task’s plan doesn’t start, and nothing stops for one at rest', async () => {
    const ask = async (task: Partial<ThreadSnapshot['task']>) => {
      const { view } = await taskMenu(task, null)
      await userEvent.click(screen.getByRole('menuitem', { name: /Abandon/ }))
      const asked = await screen.findByRole('dialog', { name: 'Abandon this task?' })
      return { view, said: asked.textContent ?? '' }
    }
    const planned = await ask({ phase: 'held', actions: ['start', 'abandon'], planId: 'pln1' })
    expect(planned.said).toContain('Its plan doesn’t start.')
    expect(planned.said).not.toContain('stays open on')
    planned.view.unmount()
    const still = await ask({ phase: 'stopped', actions: ['abandon'], worktree: null, branch: null })
    expect(still.said).not.toContain('stop')
    expect(still.said).toContain('It has no worktree to leave behind.')
  })

  it('reopens an abandoned task when the person writes to it, then gives the lead their words first', async () => {
    const base = snapshot()
    const lead = { agentId: 'claude-code', model: 'opus', account: null }
    const abandoned = thread({ task: { ...base.task, phase: 'settled', state: 'abandoned', actions: ['reopen'], lead }, session: null })
    // Reopened, it stands where it was: stopped in the middle of its step, or with nothing to carry on.
    const reopened = (actions: ThreadSnapshot['task']['actions']) =>
      thread({ task: { ...base.task, phase: 'stopped', state: 'open', actions, lead }, session: null })
    const writes = async (after: ThreadSnapshot) => {
      let open = false
      const { client } = fakeClient({
        getThread: vi.fn(async () => (open ? after : abandoned)),
        reopenTask: vi.fn(async () => {
          open = true
        }),
      })
      const view = withServices(<Task />, client)
      await waitFor(() => expect(client.status).toHaveBeenCalled())
      await userEvent.type(await screen.findByRole('textbox', { name: /^Tell .* something$/ }), 'Carry on{Enter}')
      await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Carry on', disposition: 'after_current' }))
      // Reopened first, as its menu would: the message goes to an open task.
      expect(client.reopenTask).toHaveBeenCalledWith('t1')
      expect(vi.mocked(client.reopenTask).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.send).mock.invocationCallOrder[0] ?? 0)
      return { client, view }
    }
    const resumed = await writes(reopened(['resume', 'abandon']))
    await waitFor(() =>
      expect(resumed.client.resumeTask).toHaveBeenCalledWith({ taskId: 't1', agentId: 'claude-code', model: 'opus', effort: null }),
    )
    expect(resumed.client.startSession).not.toHaveBeenCalled()
    resumed.view.unmount()
    const started = await writes(reopened(['abandon']))
    await waitFor(() =>
      expect(started.client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'opus' }),
    )
    expect(started.client.resumeTask).not.toHaveBeenCalled()
  })

  it('says why an abandoned task can’t be reopened when the person writes to it, and sends nothing', async () => {
    const base = snapshot()
    const abandoned = thread({
      task: {
        ...base.task,
        phase: 'settled',
        state: 'abandoned',
        actions: ['reopen'],
        lead: { agentId: 'claude-code', model: 'opus', account: null },
      },
      session: null,
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => abandoned),
      reopenTask: vi.fn(async () =>
        Promise.reject(
          new ApiError({
            reason: 'TaskRefused',
            message: 'The task’s worktree and its branch are both gone, so it can’t be reopened on them.',
          }),
        ),
      ),
    })
    withServices(<Task />, client)
    await waitFor(() => expect(client.status).toHaveBeenCalled())
    await userEvent.type(await screen.findByRole('textbox', { name: /^Tell .* something$/ }), 'Carry on{Enter}')
    expect(await screen.findByText(/can’t be reopened on them/)).toBeTruthy()
    expect(client.send).not.toHaveBeenCalled()
    expect(client.startSession).not.toHaveBeenCalled()
  })

  it('resumes a task stopped in the middle of its step with what the person says, on the lead picked', async () => {
    const base = snapshot()
    const stopped = thread({
      task: {
        ...base.task,
        phase: 'stopped',
        actions: ['resume', 'abandon'],
        lead: { agentId: 'claude-code', model: 'opus', account: null },
      },
      session: null,
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => stopped) })
    withServices(<Task />, client)
    await waitFor(() => expect(client.status).toHaveBeenCalled())
    await userEvent.type(await screen.findByRole('textbox', { name: /^Tell .* something$/ }), 'Use the new client{Enter}')
    await waitFor(() =>
      expect(client.resumeTask).toHaveBeenCalledWith({ taskId: 't1', agentId: 'claude-code', model: 'opus', effort: null }),
    )
    // Queued first, so it is the lead's first word; and no lead is started beside the run.
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Use the new client', disposition: 'after_current' })
    expect(vi.mocked(client.send).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.resumeTask).mock.invocationCallOrder[0] ?? 0)
    expect(client.startSession).not.toHaveBeenCalled()
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

  it('opens with focus on a permission waiting, so Enter answers it and then the next', async () => {
    const call = (id: string) => ({
      id,
      kind: 'permission' as const,
      stuck: null,
      title: `Run ${id}`,
      reason: 'It asks.',
      command: id,
      createdAt: '2026-09-29T12:00:00.000Z',
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [call('a1'), call('a2')] })) })
    withServices(<Task />, client)
    await screen.findByText(/1 of 2/)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBe(document.activeElement))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
    await screen.findByText(/2 of 2/)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBe(document.activeElement))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a2', decision: 'allow' }))
  })

  it('doesn’t take focus from the composer for a permission that comes while it is typed in', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
      title: 'Run git push',
      reason: 'It asks.',
      command: 'git push',
      createdAt: '2026-09-29T12:00:00.000Z',
    }
    const getThread = vi.fn(async () => thread())
    const { client, emit } = fakeClient({ getThread })
    withServices(<Task />, client)
    const box = await screen.findByPlaceholderText(/^Tell .+ something$/)
    box.focus()
    getThread.mockImplementation(async () => thread({ attention: [call] }))
    act(() => emit(changed('attention_request', 'a1', 'th1')))
    await screen.findByText('Needs your permission')
    await act(async () => {})
    expect(box).toBe(document.activeElement)
  })

  it('doesn’t take focus back from the composer when a card remounts after a failed answer', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
      title: 'Run git push',
      reason: 'It asks.',
      command: 'git push',
      createdAt: '2026-09-29T12:00:00.000Z',
    }
    let fail: (error: Error) => void = () => {}
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ attention: [call] })),
      answer: vi.fn(() => new Promise<never>((_, reject) => (fail = reject))),
    })
    withServices(<Task />, client)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBe(document.activeElement))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.answer).toHaveBeenCalledTimes(1))
    // The person moves on to the composer while the answer is out; then it fails and the card starts afresh.
    const box = await screen.findByPlaceholderText(/^Tell .+ something$/)
    box.focus()
    await act(async () => fail(new Error('offline')))
    await act(async () => {})
    await screen.findByText('Needs your permission')
    expect(box).toBe(document.activeElement)
    expect(client.answer).toHaveBeenCalledTimes(1)
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

  it('makes calls answerable again when an answer of Allow all doesn’t go through', async () => {
    const call = (id: string) => ({
      id,
      kind: 'permission' as const,
      stuck: null,
      title: `Run ${id}`,
      reason: 'It asks.',
      command: id,
      createdAt: '2026-09-29T12:00:00.000Z',
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [call('a1'), call('a2')] })) })
    vi.mocked(client.answer).mockImplementation(async ({ attentionId }) => {
      if (attentionId === 'a2') throw new ApiError({ reason: 'SqlError', message: 'Althar couldn’t record that.' })
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Allow all 2' }))
    expect(await screen.findByText('Althar couldn’t record that.')).toBeTruthy()
    // The stack starts afresh with what still waits.
    expect(await screen.findByRole('button', { name: 'Allow all 2' })).toBeTruthy()
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
    expect(
      await screen.findByText(
        'Claude Code stopped twice without saying whether the step is done, even after Althar reminded it. Tell it what to do next, or hand the step to another agent.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Reminded it to say when the step is done')).toBeTruthy()
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
    expect(
      await screen.findByText(
        "Codex couldn't start. It isn’t signed in. Check that it's installed and signed in, or review with another agent.",
      ),
    ).toBeTruthy()
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
    expect(await screen.findByText(/reviewed three times.*2 findings are still open\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Accept it as it is' }))
    await waitFor(() => expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'abandon' } }))
  })

  it('reports a stuck step with its task, from Report this, where the app can report', async () => {
    const stuckThread = thread({
      attention: [
        {
          id: 'st1',
          kind: 'stuck' as const,
          title: '',
          reason: '',
          command: null,
          createdAt: '2026-09-29T12:00:00.000Z',
          stuck: { step: 'implement' as const, why: 'session_ended' as const, detail: null, agentId: 'claude-code', round: 0, open: 0 },
        },
      ],
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => stuckThread) })
    const reportProblem = vi.fn()
    withServices(<Task />, client, fakeHost({ reportProblem }))
    await userEvent.click(await screen.findByRole('button', { name: 'Report this' }))
    expect(reportProblem).toHaveBeenCalledWith({
      kind: 'failed',
      taskId: stuckThread.task.id,
      projectId: stuckThread.project.id,
      threadId: stuckThread.threadId,
      what: 'the stuck Implement step',
    })
    // It answers nothing: the step still waits on the person.
    expect(client.answerStuck).not.toHaveBeenCalled()
  })

  it('offers no Report this where the app can’t report', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          attention: [
            {
              id: 'st1',
              kind: 'stuck' as const,
              title: '',
              reason: '',
              command: null,
              createdAt: '2026-09-29T12:00:00.000Z',
              stuck: { step: 'implement' as const, why: 'session_ended' as const, detail: null, agentId: 'claude-code', round: 0, open: 0 },
            },
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText(/^Claude Code closed before finishing the step\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull()
  })

  it('says why each step needed the person', () => {
    const at = (why: StuckStep['why'], detail: string | null = null, open = 0) =>
      stuckWords.what({ step: 'implement', why, detail, agentId: null, round: 0, open }, 'Codex')
    expect([at('session_ended'), at('restarted'), at('failed_to_start'), at('round_limit', null, 1), at('usage_limit')]).toEqual([
      'Codex closed before finishing the step. This is usually harmless: tell it to carry on, or hand the step to another agent.',
      'Althar restarted twice while this step was running, so it paused the step in case the step caused it. If you restarted Althar yourself, start Codex again.',
      "Codex couldn't start. Check that it's installed and signed in, or hand the step to another agent.",
      "The work has been reviewed three times, and the lead's last changes haven't been reviewed yet. One finding is still open. Review it again, or accept it as it is.",
      "Codex reached its usage limit and didn't say when it resets.",
    ])
    // A review has no lead to tell: it advises the buttons it has.
    const inReview = (why: StuckStep['why']) =>
      stuckWords.what({ step: 'review', why, detail: null, agentId: null, round: 0, open: 0 }, 'Codex')
    expect([inReview('session_ended'), inReview('restarted'), inReview('refused')]).toEqual([
      'Codex closed before finishing the step. This is usually harmless: review again, or skip the review.',
      'Althar restarted twice while this step was running, so it paused the step in case the step caused it. If you restarted Althar yourself, review again.',
      'Codex refused to go on with this step. Review again with another agent, or skip the review.',
    ])
    const back = '2026-09-29T14:00:00.000Z'
    expect(
      stuckWords.what(
        {
          step: 'implement',
          why: 'usage_limit',
          detail: null,
          agentId: null,
          round: 0,
          open: 0,
          limit: { accountId: null, resetsAt: back, choices: [] },
        },
        'Codex',
      ),
    ).toBe(`Codex reached its usage limit, until ${clock(back)}.`)
    expect([at('stalled'), at('looping', 'npm test'), at('over_budget', '6 hours'), at('refused')]).toEqual([
      'Codex has gone quiet: there has been no sign of work on this step for a while. Start it again, or hand the step to another agent.',
      'Codex kept running `npm test` and got the same result each time. Tell it to try something else, or hand the step to another agent.',
      "Codex has worked on this step for 6 hours since you last said anything, and isn't done. Let it carry on if it seems to be getting somewhere, or hand the step to another agent.",
      'Codex refused to go on with this step. Tell it what to do differently, or hand the step to another agent.',
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
    await screen.findByText(
      'Codex has gone quiet: there has been no sign of work on this step for a while. Start it again, or hand the step to another agent.',
    )
    expect(screen.getByText('Told it to carry on')).toBeTruthy()
    expect(screen.getByText('Started Codex again from the start')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tell the lead' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st7', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('starts a step restarts kept stopping again, on its agent, as the person says', async () => {
    const restarted = {
      id: 'st8',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: { step: 'implement' as const, why: 'restarted' as const, detail: null, agentId: 'codex', round: 0, open: 0 },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [restarted] })) })
    withServices(<Task />, client)
    await screen.findByText(/Althar restarted twice while this step was running/)
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st8', answer: { kind: 'retry', agentId: 'codex' } }),
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
    await userEvent.click(screen.getByRole('button', { name: 'Hand to another agent' }))
    expect(screen.queryByRole('menuitem', { name: /Codex/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Try Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st9', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('asks with the models that could take over a step a usage limit stopped, and moves it, waits for the reset, or tries again', async () => {
    const back = '2026-09-29T14:00:00.000Z'
    const limited = (resetsAt: string | null) => ({
      id: 'st10',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'usage_limit' as const,
        detail: null,
        agentId: 'claude-code',
        round: 0,
        open: 0,
        limit: {
          accountId: 'acc_claude',
          resetsAt,
          choices: [
            { agentId: 'claude-code', accountId: 'acc_work', model: 'opus' },
            { agentId: 'codex', accountId: 'acc_codex', model: 'gpt-5.2' },
            { agentId: 'opencode', accountId: 'acc_opencode', model: null },
          ],
        } satisfies LimitCall,
      },
    })
    // As the accounts stand now: Claude Code's work account ran out since, Codex is paid per use, and OpenCode isn't signed in.
    const now: ReadonlyArray<AgentStatus> = agents.map((agent) =>
      agent.id === 'claude-code'
        ? {
            ...agent,
            accounts: [
              usual('acc_claude', 'signed_in'),
              { ...usual('acc_work', 'signed_in'), name: 'work', outUntil: '2099-01-01T10:00:00.000Z' },
            ],
          }
        : agent.id === 'codex'
          ? { ...agent, accounts: [{ ...usual('acc_codex', 'signed_in'), paidBy: 'key' as const }] }
          : agent,
    )
    // What the window first read of them is from before the work account ran out: the call reads them again.
    const before = now.map((agent) =>
      agent.id === 'claude-code' ? { ...agent, accounts: agent.accounts.map((account) => ({ ...account, outUntil: null })) } : agent,
    )
    const { client } = fakeClient({
      status: vi
        .fn()
        .mockResolvedValueOnce({ ...status, agents: before })
        .mockResolvedValue({ ...status, agents: now }),
      getThread: vi.fn(async () => thread({ attention: [limited(back)] })),
    })
    const view = withServices(<Task />, client)
    expect(await screen.findByText(`Claude Code (main) reached its usage limit, until ${clock(back)}.`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    // The first free one is offered; the one out since is there but can't be picked, and one signed out isn't there at all.
    await userEvent.click(await screen.findByRole('button', { name: 'Choose another model' }))
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('via Claude Code · work · out until')
    expect(items[0]?.getAttribute('aria-disabled')).toBe('true')
    expect(items[1]?.textContent).toContain('via Codex · paid per use')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /^Continue with/ }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({
        attentionId: 'st10',
        answer: { kind: 'retry', agentId: 'codex', accountId: 'acc_codex', model: 'gpt-5.2' },
      }),
    )

    // Waiting for the reset, where it is known.
    view.unmount()
    const waiting = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: `Wait until ${clock(back)}` }))
    await waitFor(() => expect(client.answerStuck).toHaveBeenLastCalledWith({ attentionId: 'st10', answer: { kind: 'wait' } }))

    // With no reset known there is nothing to wait for: the agent can be tried again.
    waiting.unmount()
    vi.mocked(client.getThread).mockImplementation(async () => thread({ attention: [limited(null)] }))
    withServices(<Task />, client)
    expect(await screen.findByText("Claude Code (main) reached its usage limit and didn't say when it resets.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Wait until/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try Claude Code (main) again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenLastCalledWith({ attentionId: 'st10', answer: { kind: 'retry', agentId: 'claude-code' } }),
    )
  })

  it('reads the accounts again at the reset of one out of usage, so it can be picked then', async () => {
    const until = new Date(Date.now() + 300).toISOString()
    // Codex is out until a moment from now, as the runtime says each time it is asked.
    const at = () =>
      agents.map((agent) =>
        agent.id === 'codex'
          ? { ...agent, accounts: [{ ...usual('acc_codex', 'signed_in'), outUntil: Date.now() < Date.parse(until) ? until : null }] }
          : agent,
      )
    const call = {
      id: 'st11',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'usage_limit' as const,
        detail: null,
        agentId: 'claude-code',
        round: 0,
        open: 0,
        limit: { accountId: 'acc_claude', resetsAt: null, choices: [{ agentId: 'codex', accountId: 'acc_codex', model: null }] },
      },
    }
    const { client } = fakeClient({
      status: vi.fn(async () => ({ ...status, agents: at() })),
      getThread: vi.fn(async () => thread({ attention: [call] })),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('No other model is free now.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /^Continue with/ }, { timeout: 4000 })).toBeTruthy()
  })

  it('starts the lead picked when the person says something to a task none is working on, with that as its first turn', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...thread().task, phase: 'stopped', actions: ['abandon'] } })),
    })
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

  it('uses the picked agent for a stale session summary and queues the note before starting it', async () => {
    const base = thread()
    const stale = thread({
      session: base.session === null ? null : { ...base.session, held: false },
      task: { ...base.task, phase: 'stopped', actions: ['abandon'], lead: { agentId: 'codex', model: 'gpt-5.2-codex', account: null } },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => stale) })
    withServices(<Task />, client)
    await waitFor(() => expect(client.status).toHaveBeenCalled())
    expect(await screen.findByText('Stopped')).toBeTruthy()
    const box = await screen.findByRole('textbox', { name: 'Tell Codex something' })
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Codex doesn’t take images, so they can’t be sent to it.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull()
    await userEvent.type(box, 'Carry on{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2-codex' }))
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Carry on', disposition: 'after_current' })
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
    // A round that said nothing is its line alone, with who worked.
    await userEvent.click(await screen.findByRole('button', { name: /worked 0s/ }))
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
    await userEvent.click(await screen.findByRole('button', { name: /worked 0s/ }))
    await userEvent.click(await screen.findByText(pipeline))
    expect(await screen.findByRole('figure')).toBeTruthy()
    // A short one has nothing more to show, so its row doesn't open.
    expect(screen.getByText(short).closest('button')).toBeNull()
  })

  it("folds the lead's work under what its report says, and the reviewer says what it found in its own voice", async () => {
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
    expect(screen.getByRole('button', { name: /^Worked/ })).toBeTruthy()
    expect(screen.getByText('Capped the retries at three.')).toBeTruthy()
    // The reviewer: its verdict in a sentence, each finding how much it matters, where, and what; then what it said.
    expect(screen.getByText('Needs changes: 3 findings.')).toBeTruthy()
    expect(screen.getByText('The retry never stops.')).toBeTruthy()
    expect(screen.getByText('src/checkout.ts:12')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.getByText('One thing to fix.')).toBeTruthy()
    expect(screen.getByText('Looks good to me.')).toBeTruthy()
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
    // One waiting for a free agent says how many are busy, of how many this Mac runs at once; past that, both.
    expect(statusOf({ ...base, task: { ...base.task, queued: { busy: 4, atOnce: 4 } } })).toEqual({
      status: TaskStatus.Queued,
      state: 'Waiting: 4 of 4 agents busy on this Mac',
    })
    expect(statusOf({ ...base, task: { ...base.task, queued: { busy: 6, atOnce: 2 } } }).state).toBe(
      'Waiting: 6 agents busy on this Mac, which runs 2 at once',
    )
    expect(statusOf(running())).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(statusOf({ ...base, session: null })).toEqual({ status: TaskStatus.Stopped, state: 'Stopped' })
    // Ready, accepting it is the person's; settled, it is done.
    expect(statusOf({ ...base, task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Yours, state: 'Ready for you' })
    expect(statusOf({ ...base, task: { ...base.task, phase: 'settled' } })).toEqual({ status: TaskStatus.Done, state: 'Done' })
    // Abandoned, it says so.
    expect(statusOf({ ...base, task: { ...base.task, phase: 'settled', state: 'abandoned' } })).toEqual({
      status: TaskStatus.Done,
      state: 'Abandoned',
    })
    expect(statusOf({ ...running(), task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(
      statusOf({
        ...base,
        attention: [{ id: 'a', kind: 'permission', title: 't', reason: 'r', command: null, stuck: null, createdAt: '' }],
      }).state,
    ).toBe('Needs you')
    // Resolving a conflict is work under way, though its lead's turn is over; once it hands the conflict back, it needs the person.
    expect(statusOf({ ...base, task: { ...base.task, phase: 'running', step: 'conflict' } })).toEqual({
      status: TaskStatus.Running,
      state: 'Resolving a conflict',
    })
    expect(statusOf({ ...base, task: { ...base.task, phase: 'running', step: 'checks' } }).state).toBe('Fixing the checks')
    expect(statusOf({ ...base, task: { ...base.task, phase: 'ready', handedBack: 'The lead couldn’t resolve the conflict.' } })).toEqual({
      status: TaskStatus.Yours,
      state: 'Needs you',
    })
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
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'settled', state: 'abandoned', settledAt: reported.createdAt } }, now)).toBe(
      'abandoned · 4m ago',
    )
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

describe('the face a task opens on', () => {
  const file: ChangedFile = { path: 'src/a.ts', from: null, status: 'modified', add: 1, del: 0, binary: false, uncommitted: false }
  const base = snapshot()
  const of = (task: Partial<ThreadSnapshot['task']>, attention: ThreadSnapshot['attention'] = []) =>
    openingFace({ ...base, attention, task: { ...base.task, ...task } })
  const asks: ThreadSnapshot['attention'] = [
    {
      id: 'q1',
      kind: 'question',
      stuck: null,
      title: 'Which?',
      reason: '',
      command: null,
      question: { message: 'Which?', fields: [] },
      createdAt: '2026-10-10T12:00:00.000Z',
    },
  ]

  it('opens a change that is ready on its outputs', () => {
    expect(of({ kind: 'change', phase: 'ready', files: [file], commits: 1 })).toBe('out')
    expect(of({ phase: 'ready', files: [file] })).toBe('out')
  })

  it('opens a quick task with no branch on its conversation', () => {
    expect(of({ kind: 'plain', phase: 'ready', branch: null, files: [file] })).toBe('talk')
  })

  it('opens a prototype, a quick task that wrote files, on its conversation', () => {
    expect(of({ kind: 'plain', phase: 'ready', branch: 'althar/proto', commits: 2, files: [file] })).toBe('talk')
  })

  it('opens a review of someone else’s pull request on its conversation, where its draft is', () => {
    expect(of({ kind: 'review', phase: 'ready' })).toBe('talk')
  })

  it('opens a task with a question waiting on its conversation, whatever its kind', () => {
    expect(of({ kind: 'change', phase: 'ready', files: [file] }, asks)).toBe('talk')
    expect(of({ kind: 'plain', phase: 'waiting' }, asks)).toBe('talk')
  })

  it('opens a quick task that became a change on its outputs from then on', () => {
    expect(of({ kind: 'plain', phase: 'ready', files: [file], commits: 1 })).toBe('talk')
    expect(of({ kind: 'change', phase: 'ready', files: [file], commits: 1 })).toBe('out')
  })

  it('shows the conversation, not the outputs, for a prototype that is ready', async () => {
    const ready = snapshot({ task: { ...base.task, kind: 'plain', phase: 'ready', files: [file] } })
    const { client } = fakeClient({ getThread: vi.fn(async () => ready) })
    withServices(<Task />, client)
    expect((await screen.findByRole('radio', { name: /Conversation/ })).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the view the person picked when they open the task again', async () => {
    const ready = snapshot({ task: { ...base.task, kind: 'plain', phase: 'ready', files: [file] } })
    const { client } = fakeClient({ getThread: vi.fn(async () => ready) })
    const first = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(screen.getByRole('radio', { name: /Outputs/ }).getAttribute('aria-checked')).toBe('true')
    first.unmount()
    withServices(<Task />, client)
    expect((await screen.findByRole('radio', { name: /Outputs/ })).getAttribute('aria-checked')).toBe('true')
  })

  it('opens on the conversation when a call waits, though Outputs was picked before', async () => {
    const ready = snapshot({ task: { ...base.task, kind: 'plain', phase: 'ready', files: [file] } })
    const asking = snapshot({ task: { ...ready.task, phase: 'waiting' }, attention: asks })
    let current = ready
    const { client } = fakeClient({ getThread: vi.fn(async () => current) })
    const first = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    first.unmount()
    current = asking
    withServices(<Task />, client)
    expect((await screen.findByRole('radio', { name: /Conversation/ })).getAttribute('aria-checked')).toBe('true')
  })
})
