import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'
import type { HomeCall, HomeEvent, HomeTask, ProjectSummary } from '@althar/contracts'
import { ProjectInk } from '@althar/ui'

import { HomeView, lineOf, refOf } from '../src/renderer/features/home/HomeView'
import { clock } from '../src/renderer/shared/time'
import { useHome } from '../src/renderer/features/home/useHome'
import { useStart } from '../src/renderer/features/start/useStart'
import { NewTabContext } from '../src/renderer/features/tabs/TabsFrame'
import { card, change, changed, fakeClient, home, project } from './fixtures'
import { withServices } from './render'

/*
 * The home: across projects, what waits on the person, answered where it is
 * or opened as its task; what is in progress; what the loop did since they
 * last left; and the projects beside it. Althar's settings are the window's,
 * on every screen (settings.test.tsx, tabs.test.tsx).
 */

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'halyard', slug: 'halyard', ink: 'rose', lastWorkAt: null }
const ferrous: ProjectSummary = { ...project, id: 'p3', name: 'ferrous', slug: 'ferrous', ink: 'moss', lastWorkAt: null }

const task = (overrides: Partial<HomeTask> = {}): HomeTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-07T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const permission: HomeCall = {
  id: 'a1',
  kind: 'permission',
  title: 'Run npm publish',
  reason: 'Deploying or publishing always asks.',
  command: 'npm publish',
  stuck: null,
  createdAt: '2026-10-07T09:10:00.000Z',
  projectId: 'p2',
  taskId: 't3',
  threadId: 'th3',
  taskTitle: 'Ship it',
  taskSlug: 'ship-it',
}

const stuck: HomeCall = {
  ...permission,
  id: 'a2',
  kind: 'stuck',
  title: '',
  reason: '',
  command: null,
  stuck: { step: 'implement', why: 'session_ended', detail: null, agentId: 'claude-code', round: 0, open: 0 },
  projectId: 'p1',
  taskId: 't4',
  threadId: 'th4',
  taskTitle: 'Spike the cache',
  taskSlug: 'spike-the-cache',
}

const at = '2026-10-07T09:20:00.000Z'
const about = { id: 't5', threadId: 'th5', slug: 'name-it', title: 'Name it better' }
type StepResult = Extract<HomeEvent, { kind: 'step' }>['result']
const result: StepResult = {
  step: 'implement',
  round: 0,
  summary: 'Did the task.\nAnd more.',
  change: null,
  verdict: null,
  findings: [],
  built: null,
  evidence: [],
  unverified: null,
  agentId: null,
}

/** A busy day: two calls, two tasks ready, three running, and what the loop did. */
const busy = () =>
  home({
    looked: null,
    tasks: [
      task({
        taskId: 't1',
        threadId: 'th1',
        title: 'Retry the call',
        slug: 'retry-the-call',
        phase: 'running',
        step: 'implement',
        startedAt: '2026-10-07T08:00:00.000Z',
      }),
      task({
        taskId: 't2',
        threadId: 'th2',
        title: 'Held at a limit',
        slug: 'held',
        phase: 'running',
        startedAt: '2026-10-07T08:00:00.000Z',
        waits: { agentId: 'claude-code', until: '2026-10-07T14:20:00.000Z' },
        projectId: 'p2',
      }),
      task({ taskId: 't6', threadId: 'th6', title: 'Stopped work', slug: 'stopped', phase: 'stopped' }),
      task({ taskId: 't7', threadId: 'th7', title: 'Waits on a call', slug: 'waits', phase: 'waiting' }),
      task({ taskId: 't5', threadId: 'th5', title: 'Name it better', slug: 'name-it', phase: 'ready', change: change() }),
      task({
        taskId: 't8',
        threadId: 'th8',
        title: 'Ended on its branch',
        slug: 'branch',
        phase: 'ready',
        branch: 'althar/branch',
        changed: { files: 3, add: 40, del: 12 },
        projectId: 'p2',
      }),
      task({ taskId: 't9', threadId: 'th9', title: 'Nowhere', slug: 'nowhere', phase: 'ready', branch: null, projectId: 'p2' }),
      // Without a review, with a change whose size and checks aren't known yet, led by no one yet.
      task({
        taskId: 't10',
        threadId: 'th10',
        title: 'Unreviewed',
        slug: 'unreviewed',
        phase: 'ready',
        plan: null,
        lead: null,
        change: change({ checks: null, additions: null, deletions: null, number: 13 }),
      }),
      // A project that has gone since: none of its shows.
      task({ taskId: 'x1', title: 'Gone running', phase: 'running', projectId: 'gone' }),
      task({ taskId: 'x2', title: 'Gone ready', phase: 'ready', projectId: 'gone' }),
    ],
    calls: [
      permission,
      stuck,
      { ...permission, id: 'a3', title: 'Write outside the worktree', command: null, projectId: 'p1' },
      { ...stuck, id: 'a4', stuck: { ...stuck.stuck!, agentId: null }, taskTitle: 'Nobody on it' },
      {
        ...stuck,
        id: 'a5',
        stuck: {
          ...stuck.stuck!,
          why: 'usage_limit',
          agentId: 'codex',
          limit: { accountId: 'acc_codex', resetsAt: '2026-09-29T14:00:00.000Z', choices: [] },
        },
        taskTitle: 'Out of it',
      },
      { ...permission, id: 'x3', title: 'Gone call', projectId: 'gone' },
    ],
    events: [
      { kind: 'step', id: 'e1', at, projectId: 'p1', task: about, result },
      { kind: 'dealt', id: 'e2', at, projectId: 'p2', task: about, about: 'limit', title: 'Moved to Codex.', description: null },
      { kind: 'answered', id: 'e3', at, count: 3 },
      {
        kind: 'step',
        id: 'e4',
        at,
        projectId: 'p1',
        task: { ...about, id: 'gone', threadId: 'thg' },
        result: { ...result, step: 'settle' },
      },
    ],
    projects: [project, halyard, ferrous],
  })

function Home({
  onProject = vi.fn(),
  onTalk = vi.fn(),
  onTask = vi.fn(),
}: Partial<Record<'onProject' | 'onTalk' | 'onTask', (id: string) => void>>) {
  return <HomeView model={useHome()} start={useStart()} onProject={onProject} onTalk={onTalk} onTask={onTask} />
}

describe('the home', () => {
  it('shows what waits on you across projects, answers a permission where it is, and opens the rest as their tasks', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home onTask={onTask} />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    expect(within(needs).getByText('npm publish')).toBeTruthy()
    expect(
      within(needs).getByText(
        'Claude Code closed before finishing the step. This is usually harmless: tell it to carry on, or hand the step to another agent.',
      ),
    ).toBeTruthy()
    // A change on its branch says its size; tasks are named by their titles alone, never their slugs.
    expect(within(needs).getByText('On its branch: 3 files, +40 −12')).toBeTruthy()
    expect(within(needs).getByText('On its branch')).toBeTruthy()
    expect(screen.queryByText(/althar\/branch|retry-the-call|name-it/)).toBeNull()
    // A change with what stands between it and merging, or how its checks went, then how big, in its one line.
    expect(within(needs).getByText('api #12 · test failed · +12 −3')).toBeTruthy()
    expect(within(needs).getByText('api #13 · No checks ran')).toBeTruthy()
    expect(
      within(needs).getByText(
        'The agent closed before finishing the step. This is usually harmless: tell it to carry on, or hand the step to another agent.',
      ),
    ).toBeTruthy()
    expect(within(needs).getAllByText('Write outside the worktree')).toHaveLength(2)
    expect(screen.queryByText(/^Gone/)).toBeNull()
    // A step a usage limit stopped is out of usage, here as in its task, with when the agent is back.
    const out = within(needs).getByRole('article', { name: 'Out of it' })
    expect(within(out).getByText('Out of usage')).toBeTruthy()
    expect(within(out).getByText(`Codex reached its usage limit, until ${clock('2026-09-29T14:00:00.000Z')}.`)).toBeTruthy()

    // Allowed where it is: the line stays, quiet, with what was said where its buttons were, and has focus.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Allow once' })[0]!)
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' })
    const settled = await within(needs).findByRole('article', { name: 'Run npm publish', description: 'Allowed Once · in halyard' })
    await waitFor(() => expect(settled).toBe(document.activeElement))
    expect(within(settled).queryByRole('button', { name: /Allow once|Deny/ })).toBeNull()

    // Review opens a task with nothing to do from its line, and the projects stay where they are; the answered line kept its project's place.
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['halyard', 'meridian'])
    await userEvent.click(
      within(within(needs).getByRole('article', { name: 'Ended on its branch' })).getByRole('button', { name: 'Review' }),
    )
    expect(onTask).toHaveBeenLastCalledWith('th8')
    expect(screen.queryByRole('complementary', { name: 'Beside the home' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Projects' })).toBeTruthy()

    // A stuck step opens its task to be answered there; so does a line's title.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Open' })[0]!)
    expect(onTask).toHaveBeenLastCalledWith('th4')
    await userEvent.click(within(needs).getByRole('button', { name: 'Name it better' }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
  })

  it('says what stands between a ready change and merging, and does the next thing from its line', async () => {
    const passed = { outcome: 'passed' as const, passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] }
    const ready = (n: number, title: string, overrides: Parameters<typeof change>[0]) =>
      task({
        taskId: `r${n}`,
        threadId: `thr${n}`,
        title,
        phase: 'ready',
        change: change({ number: n, draft: false, checks: passed, ...overrides }),
      })
    const { client } = fakeClient({
      getHome: vi.fn(async () =>
        home({
          looked: null,
          tasks: [
            ready(21, 'Good to merge', {}),
            ready(22, 'Commits to push', { localHead: 'def456', unpushed: 3 }),
            ready(23, 'In conflict', { conflicts: true, target: 'main' }),
            ready(24, 'A check failed', { checks: change().checks }),
            ready(25, 'Checks still running', { checks: { ...passed, outcome: 'running', passed: 3, running: 2 } }),
            ready(26, 'A check cancelled', {
              checks: {
                ...passed,
                passed: 1,
                total: 2,
                list: [
                  { name: 'lint', state: 'passed', summary: null },
                  { name: 'e2e', state: 'cancelled', summary: null },
                ],
              },
            }),
          ],
          calls: [],
          events: [],
          projects: [project],
        }),
      ),
    })
    const onTask = vi.fn()
    withServices(<Home onTask={onTask} />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    const line = (title: string) => within(within(needs).getByRole('article', { name: title }))
    expect(line('Good to merge').getByText('api #21 · All 5 checks passed · +12 −3')).toBeTruthy()
    expect(line('Commits to push').getByText('api #22 · 3 commits not on the PR · +12 −3')).toBeTruthy()
    expect(line('In conflict').getByText('api #23 · Conflicts with main · +12 −3')).toBeTruthy()
    expect(line('Checks still running').getByText('api #25 · Checks running, 3 of 5 passed · +12 −3')).toBeTruthy()

    // The person's own to do, done at once, at the heads they saw.
    await userEvent.click(line('Good to merge').getByRole('button', { name: 'Accept and merge' }))
    expect(client.merge).toHaveBeenCalledWith('r21', 'abc123', 'https://github.com/meridian/api/pull/12')
    await userEvent.click(line('Commits to push').getByRole('button', { name: 'Push 3 commits' }))
    expect(client.push).toHaveBeenCalledWith('r22', 'def456', 'https://github.com/meridian/api/pull/12')
    // The lead's, as a note to it.
    await userEvent.click(line('In conflict').getByRole('button', { name: 'Ask the lead to resolve it' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thr23',
          body: expect.stringMatching(/^PR #23 conflicts with main\. Bring the branch up to date: merge main into it/),
        }),
      ),
    )
    await userEvent.click(line('A check failed').getByRole('button', { name: 'Ask the lead to fix it' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'thr24', body: 'A check on PR #24 failed: test. Fix what made it fail, then ask to push.' }),
      ),
    )
    // While checks run there's nothing to do but wait: its button opens it.
    await userEvent.click(line('Checks still running').getByRole('button', { name: 'Review' }))
    expect(onTask).toHaveBeenLastCalledWith('thr25')
    // A cancelled check is in the way, not a pass, and it is run again on the host: its button opens it.
    expect(line('A check cancelled').getByText('api #26 · e2e cancelled · +12 −3')).toBeTruthy()
    await userEvent.click(line('A check cancelled').getByRole('button', { name: 'Review' }))
    expect(onTask).toHaveBeenLastCalledWith('thr26')
  })

  it('denies where it is', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Deny' })[0]!)
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'reject' })
    expect(await within(needs).findByRole('article', { name: 'Run npm publish', description: 'Denied Once · in halyard' })).toBeTruthy()
  })

  it('offers on a permission’s card what its task’s card offers: always allow, never allow, and deny with a note', async () => {
    const offered: HomeCall = {
      ...permission,
      reason: "This project asks you before anything an agent does beyond the task's own files.",
      command: 'npm test',
      always: { command: 'npm test', prefix: 'npm test', kind: null, allow: ['exact', 'prefix'], deny: ['exact', 'prefix'] },
    }
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...busy(), calls: [offered] })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    await userEvent.click(within(needs).getByRole('button', { name: 'More answers' }))
    expect(screen.getByText('An always or a never is kept in halyard’s rules')).toBeTruthy()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Always allow commands starting “npm test”' }))
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow', always: 'prefix' })
    expect(
      await within(needs).findByRole('article', { name: 'Run npm publish', description: 'Allowed Always · kept in halyard’s rules' }),
    ).toBeTruthy()
  })

  it('denies from a permission’s card with what to do instead', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...busy(), calls: [permission] })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    await userEvent.click(within(needs).getByRole('button', { name: 'More answers' }))
    // Kept for the person by the always-ask list, and offered no always by the runtime: the note alone.
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Deny, and say what to do instead' }))
    await userEvent.type(within(needs).getByRole('textbox', { name: 'Say what to do instead' }), 'Publish from CI{Enter}')
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'reject', reason: 'Publish from CI' })
    expect(
      await within(needs).findByRole('article', { name: 'Run npm publish', description: 'Denied Once · Publish from CI' }),
    ).toBeTruthy()
  })

  it('brings back a permission whose answer didn’t go through, with what went wrong', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...busy(), calls: [permission] })) })
    vi.mocked(client.answer).mockRejectedValueOnce(new ApiError({ reason: 'AttentionClosed', message: 'That call was already answered.' }))
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    await userEvent.click(within(needs).getByRole('button', { name: 'Allow once' }))
    expect(await screen.findByText('That call was already answered.')).toBeTruthy()
    expect(await within(needs).findByRole('button', { name: 'Allow once' })).toBeTruthy()
    expect(within(needs).queryByText('Allowed')).toBeNull()
  })

  it('says in a project’s row only what is off in its work, and nothing of the agents', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home />, client)
    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    // The work in progress is in its project's row, which says only what is off: the stopped one and the one waiting.
    expect(within(projects).getByText('1 stopped · 1 waiting')).toBeTruthy()
    // Which agents are signed in is for settings, not the home.
    expect(within(projects).queryByText(/Claude Code|Codex|OpenCode/)).toBeNull()
  })

  it('keeps an answered line where it was once the runtime no longer lists its call, and says only what still waits', async () => {
    const later: HomeCall = {
      ...permission,
      id: 'a8',
      threadId: 'th8',
      title: 'Run cargo build',
      command: 'cargo build',
      createdAt: '2026-10-07T09:20:00.000Z',
      projectId: 'p1',
    }
    let calls: ReadonlyArray<HomeCall> = [permission, later]
    const { client, emit } = fakeClient({ getHome: vi.fn(async () => ({ ...busy(), tasks: [], calls })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    expect(screen.getByText('in halyard and meridian')).toBeTruthy()
    await userEvent.click(
      within(within(needs).getByRole('article', { name: 'Run npm publish' })).getByRole('button', { name: 'Allow once' }),
    )
    // The runtime has closed it: read again, the line stays first, where it was, and only meridian still waits.
    calls = [later]
    act(() => emit(changed('attention_request', 'a1', 'th3', 'p2')))
    await waitFor(() => expect(screen.getByText('in meridian')).toBeTruthy())
    expect(
      within(needs)
        .getAllByRole('article')
        .map((line) => line.getAttribute('aria-describedby') === null),
    ).toEqual([false, true])
    expect(within(needs).getByRole('article', { name: 'Run npm publish', description: 'Allowed Once · in halyard' })).toBeTruthy()
  })

  it('leaves out a plain task that finished: it waits on its board, and asks nothing of the person here', async () => {
    const one = busy()
    const finished = task({ taskId: 't20', threadId: 'th20', title: 'Which partners call v1?', slug: 'v1', phase: 'ready', kind: 'plain' })
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...one, tasks: [...one.tasks, finished] })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    expect(within(needs).getByRole('article', { name: 'Name it better' })).toBeTruthy()
    expect(screen.queryByText('Which partners call v1?')).toBeNull()
  })

  it('lists a drafted review by its pull request, whose it is and what it found, to review', async () => {
    const one = busy()
    const drafted = task({
      taskId: 't21',
      threadId: 'th21',
      title: 'Review #1199',
      slug: 'review-1199',
      phase: 'ready',
      kind: 'review',
      branch: null,
      reviewing: {
        product: 'github',
        repository: 'meridian/api',
        number: 1199,
        url: 'https://github.com/meridian/api/pull/1199',
        title: 'Retry webhooks',
        author: 'ninemate',
        outside: true,
        additions: 12,
        deletions: 3,
        findings: 3,
        blocking: 1,
        verdict: 'changes',
        posted: null,
      },
    })
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...one, tasks: [...one.tasks, drafted] })) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    const line = within(needs).getByRole('article', { name: 'Review #1199' })
    expect(within(line).getByText('Review drafted')).toBeTruthy()
    expect(within(line).getByText('api #1199 · by ninemate · 3 findings')).toBeTruthy()
    expect(within(line).getByRole('button', { name: 'Review' })).toBeTruthy()
  })

  it('lists a task with a call on its line alone, not again in its project, until the call is answered', async () => {
    const one = busy()
    const { client } = fakeClient({
      getHome: vi.fn(async () => ({ ...one, calls: [{ ...permission, id: 'a7', threadId: 'th7', taskTitle: 'Waits on a call' }] })),
    })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /needs? you/ })
    const projects = screen.getByRole('complementary', { name: 'Projects' })
    expect(within(projects).getByText('1 stopped')).toBeTruthy()
    await userEvent.click(within(needs).getByRole('button', { name: 'Allow once' }))
    expect(await within(projects).findByText('1 stopped · 1 waiting')).toBeTruthy()
  })

  it('says under its project what tasks waiting for a free agent wait for, and doesn’t count them as moving', async () => {
    const queued = { busy: 4, atOnce: 4 }
    const { client } = fakeClient({
      getHome: vi.fn(async () =>
        home({
          tasks: [
            task({ taskId: 't1', threadId: 'th1', title: 'At work', phase: 'running', step: 'implement' }),
            task({ taskId: 't2', threadId: 'th2', title: 'Next', phase: 'running', step: 'implement', projectId: 'p2', queued }),
            task({ taskId: 't3', threadId: 'th3', title: 'After it', phase: 'running', step: 'implement', projectId: 'p2', queued }),
          ],
          projects: [project, halyard],
        }),
      ),
    })
    withServices(<Home />, client)
    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    expect(within(projects).getByText('2 waiting: 4 of 4 agents busy')).toBeTruthy()
    // Only the one at work moves.
    expect(screen.getByText('1 task moving in 1 project.')).toBeTruthy()
  })

  it('gathers what needs you under its project, says what is off in each, and opens what the loop did', async () => {
    const onTask = vi.fn()
    const onProject = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home onTask={onTask} onProject={onProject} />, client)
    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    // Only what is off is said under the project's name.
    expect(within(projects).getByText('1 held for a reset')).toBeTruthy()
    // What needs you is gathered under the project it is in, in the order the first came, and opens its task.
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['halyard', 'meridian'])
    const meridian = screen.getByRole('region', { name: 'meridian' })
    await userEvent.click(within(meridian).getByRole('button', { name: 'Name it better' }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
    expect(within(meridian).queryByText('Ended on its branch')).toBeNull()

    // What the loop did is one line, which opens.
    await userEvent.click(screen.getByRole('button', { name: /things since you looked, the last day/ }))
    expect(screen.getByText('Moved to Codex.')).toBeTruthy()
    expect(screen.getByText('Answered 3 permission asks')).toBeTruthy()
    // Each opens the task it happened to, still on the home or not.
    await userEvent.click(screen.getByRole('button', { name: 'Implement finished' }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
    await userEvent.click(screen.getByRole('button', { name: 'Review settled' }))
    expect(onTask).toHaveBeenLastCalledWith('thg')

    expect(within(projects).getByText('No tasks yet')).toBeTruthy()
    await userEvent.click(within(projects).getByRole('button', { name: /^halyard/ }))
    expect(onProject).toHaveBeenCalledWith('p2')
  })

  it('leaves ⌘ and a number, and ⌘, to the window, and reads again when work changes from where it first read', async () => {
    const onProject = vi.fn()
    const getHome = vi.fn(async () => home({ looked: '2026-10-07T08:00:00.000Z', projects: [project, halyard] }))
    const { client, emit } = fakeClient({ getHome })
    const view = withServices(<Home onProject={onProject} />, client)
    await within(await screen.findByRole('complementary', { name: 'Projects' })).findByRole('button', { name: /halyard/ })
    fireEvent.keyDown(window, { key: '2', metaKey: true })
    fireEvent.keyDown(window, { key: 'x', metaKey: true })
    expect(onProject).not.toHaveBeenCalled()
    // Settings are the window's, on every screen: the home opens nothing of its own.
    fireEvent.keyDown(window, { key: ',', code: 'Comma', metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()

    emit(changed('task', 't1', 'th1', 'p2'))
    emit(changed('thread_item', 'i1'))
    await waitFor(() => expect(getHome).toHaveBeenCalledTimes(2))
    expect(getHome).toHaveBeenLastCalledWith('2026-10-06T18:00:00.000Z')

    // Leaving, the runtime hears it.
    view.unmount()
    expect(client.leftHome).toHaveBeenCalled()
    act(() => void window.dispatchEvent(new Event('pagehide')))
  })

  it('rests when nothing waits and nothing is in progress, and offers a new project’s coordinator', async () => {
    const onTalk = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ projects: [halyard] })) })
    withServices(<Home onTalk={onTalk} />, client)
    expect(await screen.findByRole('heading', { name: 'Nothing in halyard yet' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Talk to halyard’s coordinator' }))
    expect(onTalk).toHaveBeenCalledWith('p2')
    expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByText('No tasks yet')).toBeTruthy()
  })

  it('says nothing needs you once its projects have had work', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => home()) })
    withServices(<Home />, client)
    expect(await screen.findByRole('heading', { name: 'Nothing needs you' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Talk to/ })).toBeNull()
  })

  it('starts a new project in a tab of its own, with any folders dropped on it', async () => {
    const start = vi.fn()
    const tab = { start, made: vi.fn(), close: vi.fn() }
    const view = withServices(
      <NewTabContext.Provider value={tab}>
        <Home />
      </NewTabContext.Provider>,
      fakeClient().client,
    )
    await screen.findByRole('complementary', { name: 'Projects' })
    await userEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(start).toHaveBeenCalledWith()
    const root = view.container.firstElementChild as Element
    const folder = new File([], 'northwind')
    fireEvent.dragOver(root)
    fireEvent.drop(root, { dataTransfer: { files: [folder] } })
    fireEvent.drop(root, { dataTransfer: { files: [] } })
    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenLastCalledWith([folder])
    // ⌘N is the window's tabs', not the home's.
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('says what the loop did in a line each', () => {
    const projects = new Map([['p1', refOf(project)]])
    const now = new Date('2026-10-07T12:00:00.000Z')
    const step = (overrides: Partial<typeof result>): HomeEvent => ({
      kind: 'step',
      id: 'e',
      at,
      projectId: 'p1',
      task: about,
      result: { ...result, ...overrides },
    })
    expect(lineOf(step({ step: 'publish', change: change() }), projects, now)).toMatchObject({
      icon: 'pr',
      what: 'Pull request #12 opened',
      detail: 'Name it better',
    })
    expect(lineOf(step({ step: 'publish', summary: 'Pushed the branch.' }), projects, now)).toMatchObject({
      icon: 'pr',
      what: 'Pushed the branch.',
    })
    expect(lineOf(step({ step: 'review', verdict: 'pass' }), projects, now)).toMatchObject({ what: 'Review passed' })
    const finding = { severity: 'major' as const, file: null, line: null, claim: 'Wrong.' }
    expect(lineOf(step({ step: 'review', verdict: 'changes_requested', findings: [finding] }), projects, now)).toMatchObject({
      what: 'Review found 1 issue',
    })
    expect(lineOf(step({ step: 'review', verdict: 'changes_requested', findings: [finding, finding] }), projects, now)).toMatchObject({
      what: 'Review found 2 issues',
    })
    expect(lineOf(step({ step: 'review', verdict: 'changes_requested' }), projects, now)).toMatchObject({
      what: 'Review asked for changes',
    })
    expect(lineOf(step({}), projects, now)).toMatchObject({ what: 'Implement finished', detail: 'Name it better' })
    expect(lineOf(step({}), projects, now)).not.toHaveProperty('task')
    const dealt: HomeEvent = {
      kind: 'dealt',
      id: 'd',
      at,
      projectId: 'p1',
      task: about,
      about: 'stall',
      title: 'Went quiet.',
      description: 'Started afresh.',
    }
    expect(lineOf(dealt, projects, now)).toMatchObject({ icon: 'clock', what: 'Went quiet.', detail: 'Name it better' })
    expect(lineOf({ ...dealt, projectId: 'gone' }, projects, now)).toBeUndefined()
    expect(lineOf({ kind: 'answered', id: 'a', at, count: 1 }, projects, now)).toMatchObject({ what: 'Answered 1 permission ask' })
    expect(lineOf({ kind: 'answered', id: 'c', at, count: 1, by: 'coordinator' }, projects, now)).toMatchObject({
      what: 'Coordinator answered 1 permission ask',
    })
    expect(lineOf({ kind: 'answered', id: 'c', at, count: 3, by: 'coordinator' }, projects, now)).toMatchObject({
      what: 'Coordinator answered 3 permission asks',
    })
  })

  it('draws each project in its ink', () => {
    expect(refOf(project)).toEqual({ seed: 'p1', ink: ProjectInk.Teal, name: 'meridian' })
  })
})
