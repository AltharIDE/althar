import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'
import type { HomeCall, HomeEvent, HomeTask, ProjectSummary } from '@althar/contracts'
import { ProjectInk } from '@althar/ui'

import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import { HomeView, lineOf, refOf } from '../src/renderer/features/home/HomeView'
import { useHome } from '../src/renderer/features/home/useHome'
import { agentGlanceOf, marksOf, SettingsPanel } from '../src/renderer/features/settings/SettingsPanel'
import { useStart } from '../src/renderer/features/start/useStart'
import {
  agents,
  card,
  models,
  change,
  changed,
  connectionList,
  fakeClient,
  fakeHost,
  githubConnection,
  home,
  project,
  usual,
  withoutOpenCode,
} from './fixtures'
import { withServices } from './render'

/*
 * The home: across projects, what waits on the person, answered where it is
 * or opened as its task; what is in progress; what the loop did since they
 * last left; the projects beside it; and settings, as a panel from the bar.
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
    expect(within(needs).getByText('Claude Code stopped before the step was done.')).toBeTruthy()
    // A change on its branch says its size; tasks are named by their titles alone, never their slugs.
    expect(within(needs).getByText('On its branch: 3 files, +40 −12')).toBeTruthy()
    expect(within(needs).getByText('On its branch')).toBeTruthy()
    expect(screen.queryByText(/althar\/branch|retry-the-call|name-it/)).toBeNull()
    // A change with its checks, the worst first, in its one line.
    expect(within(needs).getByText(/1 check failed/)).toBeTruthy()
    expect(within(needs).getByText(/no checks/)).toBeTruthy()
    expect(within(needs).getByText('The agent stopped before the step was done.')).toBeTruthy()
    expect(within(needs).getAllByText('Write outside the worktree')).toHaveLength(2)
    expect(screen.queryByText(/^Gone/)).toBeNull()

    // Allowed where it is: the line stays, quiet, with what was said where its buttons were, and has focus.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Allow once' })[0]!)
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' })
    const settled = await within(needs).findByRole('article', { name: 'Run npm publish', description: 'Allowed Once · in halyard' })
    await waitFor(() => expect(settled).toBe(document.activeElement))
    expect(within(settled).queryByRole('button', { name: /Allow once|Deny/ })).toBeNull()

    // Review opens the task itself, and the projects stay where they are; the answered line kept its project's place.
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['halyard', 'meridian'])
    await userEvent.click(within(within(needs).getByRole('article', { name: 'Name it better' })).getByRole('button', { name: 'Review' }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
    expect(screen.queryByRole('complementary', { name: 'Beside the home' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Projects' })).toBeTruthy()

    // A stuck step opens its task to be answered there; so does a line's title.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Open' })[0]!)
    expect(onTask).toHaveBeenLastCalledWith('th4')
    await userEvent.click(within(needs).getByRole('button', { name: 'Name it better' }))
    expect(onTask).toHaveBeenLastCalledWith('th5')
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

  it('has only settings at the end of the bar: no counts and no agents', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home />, client)
    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    // The work in progress is in its project's row, which says only what is off: the stopped one and the one waiting.
    expect(within(projects).getByText('1 stopped · 1 waiting')).toBeTruthy()
    const settings = screen.getByRole('button', { name: 'Settings' })
    const end = settings.parentElement!
    expect(within(end).getAllByRole('button')).toHaveLength(1)
    expect(within(end).queryByText(/running|need you|Claude Code|Codex|OpenCode/)).toBeNull()
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

  it('leaves ⌘ and a number to the window’s tabs, opens and closes settings by ⌘, and its gear, and reads again when work changes from where it first read', async () => {
    const onProject = vi.fn()
    const getHome = vi.fn(async () => home({ looked: '2026-10-07T08:00:00.000Z', projects: [project, halyard] }))
    const { client, emit } = fakeClient({ getHome })
    const view = withServices(<Home onProject={onProject} />, client)
    await within(await screen.findByRole('complementary', { name: 'Projects' })).findByRole('button', { name: /halyard/ })
    fireEvent.keyDown(window, { key: '2', metaKey: true })
    fireEvent.keyDown(window, { key: 'x', metaKey: true })
    expect(onProject).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()

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

  it('says what went wrong opening a folder, and opens one dropped', async () => {
    const { client } = fakeClient({ openProject: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const host = fakeHost()
    const view = withServices(<Home />, client, host)
    await screen.findByRole('complementary', { name: 'Projects' })
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    const root = view.container.firstElementChild as Element
    fireEvent.dragOver(root)
    fireEvent.drop(root, { dataTransfer: { files: [new File([], 'x')] } })
    fireEvent.drop(root, { dataTransfer: { files: [] } })
    await waitFor(() => expect(host.grantDropped).toHaveBeenCalledTimes(1))
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
  })

  it('draws each project in its ink', () => {
    expect(refOf(project)).toEqual({ seed: 'p1', ink: ProjectInk.Teal, name: 'meridian' })
  })
})

/* Settings, opened from the bar. */
function Settings({ start = true }: { start?: boolean }) {
  const [open, setOpen] = useState(start)
  return <SettingsPanel start={useStart()} open={open} onOpenChange={setOpen} />
}

/** Opens a module of the open panel, by its title. */
const openModule = async (title: string | RegExp) => {
  const panel = await screen.findByRole('dialog', { name: 'Settings' })
  await userEvent.click(within(panel).getByRole('button', { name: typeof title === 'string' ? new RegExp(`^${title}`) : title }))
  return panel
}

describe('settings', () => {
  it('shows each part at a glance, opens one out, and steps back by Back or Escape before Escape closes it', async () => {
    const { client } = fakeClient()
    withServices(<Settings />, client)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    // OpenCode's only account is signed out: only the person can sign it in.
    expect(await within(panel).findByText('main signed out')).toBeTruthy()
    expect(within(panel).getByText('3 agents · 3 accounts')).toBeTruthy()
    expect(await within(panel).findByRole('button', { name: /^Code hosts and trackers/ })).toBeTruthy()
    expect(within(panel).queryByText('0 connected')).toBeNull()
    expect(within(panel).getByText('Althar 0.0.0')).toBeTruthy()
    // Opened, it asks the agents how they stand once, not again and again.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(vi.mocked(client.status).mock.calls.filter(([input]) => input?.recheck === true)).toHaveLength(1)

    await openModule('Agents')
    expect(within(panel).getByRole('heading', { name: 'Agents', level: 2 })).toBeTruthy()
    // It opens on the agent that needs the person.
    expect(within(panel).getByRole('tab', { name: 'OpenCode, needs you' }).getAttribute('aria-selected')).toBe('true')
    expect(within(panel).getByRole('list', { name: 'OpenCode accounts' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('tab', { name: 'Codex' }))
    expect(within(panel).getByRole('list', { name: 'Codex accounts' })).toBeTruthy()
    // Under its name, who makes it and its version.
    expect(within(panel).getByText('OpenAI · 0.159.3')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to all settings' }))
    expect(within(panel).getByRole('button', { name: /^Agents/ })).toBeTruthy()

    // Code hosts beside trackers, each kind saying what it is for, so its services don't.
    await openModule('Code hosts and trackers')
    const hosts = await within(panel).findByRole('region', { name: 'Code hosts' })
    expect(within(hosts).getByRole('list', { name: 'Code hosts' })).toBeTruthy()
    expect(within(hosts).getByText('Pull requests, their checks and review comments')).toBeTruthy()
    expect(within(within(panel).getByRole('region', { name: 'Trackers' })).getByRole('list', { name: 'Trackers' })).toBeTruthy()
    expect(within(panel).queryByText(/Not connected · /)).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(within(panel).getByRole('button', { name: /^Code hosts and trackers/ })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  })

  it('switches each agent’s models on and off beside its accounts, named as people know them', async () => {
    // The runtime keeps what was switched off, and says so when read again.
    const off = new Set<string>()
    const said = () =>
      models.map((offered) => ({ ...offered, blocked: offered.models.filter((model) => off.has(model.id)).map((model) => model.id) }))
    const { client } = fakeClient({
      getModels: vi.fn(async () => said()),
      setModelBlocked: vi.fn(async ({ model, blocked }: { agentId: string; model: string; blocked: boolean }) => {
        if (blocked) off.add(model)
        else off.delete(model)
      }),
    })
    withServices(<Settings />, client)
    const panel = await openModule('Agents')
    // Claude Code's models with their family, its own default not among them.
    await userEvent.click(within(panel).getByRole('tab', { name: 'Claude Code' }))
    const claude = await within(panel).findByRole('group', { name: 'Claude Code models' })
    expect(within(claude).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(claude).getByRole('checkbox', { name: 'Claude Opus' })).toBeTruthy()
    expect(within(panel).getByText('all 2 used')).toBeTruthy()
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: true })
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('false')
    expect(within(panel).getByText('1 of 2 used')).toBeTruthy()
    // Once the runtime has answered and been read again, it says the same: still off.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('false')
    // Read again slowly: until the runtime's answer arrives, the switch stays as it was set, not as it was read last.
    let answer: () => void = () => undefined
    vi.mocked(client.getModels).mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve(said()))))
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenLastCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: false })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('true')
    act(() => answer())
    await waitFor(() => expect(within(panel).getByText('all 2 used')).toBeTruthy())
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('true')
    // One the runtime didn't switch goes back to how it was.
    vi.mocked(client.setModelBlocked).mockRejectedValueOnce(new Error('No'))
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Opus' }))
    await waitFor(() => expect(within(claude).getByRole('checkbox', { name: 'Claude Opus' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('says where each agent stands in a word, and each code host by its mark', () => {
    const now = new Date('2026-10-03T12:00:00')
    const [claude, codex] = agents
    expect(agentGlanceOf(claude!, now)).toMatchObject({ name: 'Claude Code', line: '1 account' })
    const resting = { ...codex!, accounts: [{ ...usual('acc_codex', 'signed_in'), outUntil: '2026-10-03T14:00:00' }] }
    expect(agentGlanceOf(resting, now)).toMatchObject({ tone: 'quiet' })
    expect(agentGlanceOf(resting, now).line).toMatch(/^main out until /)
    // One mark for a service's Cloud and its own servers; faint where none is connected, a dot where one asks to sign in again.
    const [github, linear] = connectionList.products
    const marks = marksOf({
      ...connectionList,
      products: [
        github!,
        { ...github!, product: 'bitbucket_cloud', name: 'Bitbucket' },
        { ...github!, product: 'bitbucket_dc', name: 'Bitbucket' },
        linear!,
      ],
      connections: [{ ...githubConnection, state: 'reauth_required' }],
    })
    expect(marks.map((mark) => mark.name)).toEqual(['GitHub', 'Bitbucket', 'Linear'])
    expect(marks.find((mark) => mark.id === 'github')).toMatchObject({ yours: true })
    expect(marks.find((mark) => mark.id === 'github')?.faint).toBeUndefined()
    expect(marks.find((mark) => mark.id === 'bitbucket')).toMatchObject({ faint: true })
  })

  it('has Althar as co-author of what it sends until the person turns it off, and then says why it would stay', async () => {
    const { client } = fakeClient()
    withServices(<Settings />, client)
    await openModule('Code hosts and trackers')
    const credit = await screen.findByRole('switch', { name: 'Althar as co-author' })
    expect(credit.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(/no marketing budget/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'See the line' }))
    expect(screen.getByText('Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>')).toBeTruthy()

    await userEvent.click(credit)
    expect(client.setCoAuthor).toHaveBeenCalledWith(false)
    expect(credit.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/Althar is free, and we have no marketing budget/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Turn it back on' }))
    expect(client.setCoAuthor).toHaveBeenLastCalledWith(true)
    expect(credit.getAttribute('aria-checked')).toBe('true')
  })

  it('turns co-authoring back when the change can’t be kept, and says so', async () => {
    const { client } = fakeClient()
    vi.mocked(client.setCoAuthor).mockRejectedValue(new Error('disk full'))
    withServices(<Settings />, client)
    await openModule('Code hosts and trackers')
    const credit = await screen.findByRole('switch', { name: 'Althar as co-author' })
    await userEvent.click(credit)
    expect((await screen.findByRole('alert')).textContent).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(credit.getAttribute('aria-checked')).toBe('true'))
    // Off and on again, both lost: it shows what the runtime kept, not the opposite of the last try.
    const reads = vi.mocked(client.getSettings).mock.calls.length
    await userEvent.click(credit)
    await userEvent.click(credit)
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
    expect(credit.getAttribute('aria-checked')).toBe('true')
  })

  it('shows the icon the app has, and gives it another', async () => {
    const host = fakeHost({ appIcon: vi.fn(async () => 'paper') })
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^App icon\s*Paper/)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(
      within(icons)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Cobalt', 'Lapis', 'Paper', 'Ink', 'Keystone', 'Monolith'])
    expect(within(icons).getByRole('radio', { name: 'Paper' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(icons).getByRole('radio', { name: 'Ink' }))
    expect(host.setAppIcon).toHaveBeenCalledWith('ink')
    expect(within(icons).getByRole('radio', { name: 'Ink' }).getAttribute('aria-checked')).toBe('true')
  })

  it('starts on cobalt when the app has no icon it knows, and goes back when one can’t be kept', async () => {
    const host = fakeHost({
      appIcon: vi.fn(async () => 'neon'),
      setAppIcon: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^App icon\s*Cobalt/)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(icons).getByRole('radio', { name: 'Keystone' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That icon couldn’t be kept. Try again.')
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
  })

  it('offers where Althar shows in another app, on a Mac with a notch, and keeps a choice', async () => {
    const host = fakeHost()
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^While you’re in another app\s*Round the notch/)
    const places = await screen.findByRole('radiogroup', { name: 'While you’re in another app' })
    expect(
      within(places)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-checked')),
    ).toEqual(['true', 'false'])
    // Each place as the screen would look; with nothing under way, a busy moment, said as such.
    expect(screen.getByText('With nothing under way yet, here is how a busy moment would look.')).toBeTruthy()
    expect(places.textContent).toContain('Publish the SDK to npm')
    await userEvent.click(within(places).getByRole('radio', { name: /In the menu bar/ }))
    expect(host.setEdge).toHaveBeenCalledWith('menu')
    expect(
      within(places)
        .getByRole('radio', { name: /In the menu bar/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('says nothing of it without a notch, where it is the menu bar', async () => {
    withServices(<Settings />, fakeClient().client, fakeHost({ edge: vi.fn(async () => ({ place: 'island', notch: false })) }))
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    await within(panel).findByRole('button', { name: /^App icon/ })
    expect(within(panel).queryByRole('button', { name: /^While you’re in another app/ })).toBeNull()
  })

  it('goes back to where it was when a choice can’t be kept', async () => {
    const host = fakeHost({
      edge: vi.fn(async () => ({ place: 'menu', notch: true })),
      setEdge: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^While you’re in another app\s*In the menu bar/)
    const places = await screen.findByRole('radiogroup', { name: 'While you’re in another app' })
    await userEvent.click(within(places).getByRole('radio', { name: /Round the notch/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('That couldn’t be kept. Try again.')
    expect(
      within(places)
        .getByRole('radio', { name: /In the menu bar/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('offers no icon where there is no Dock to show one', async () => {
    withServices(<Settings />, fakeClient().client, fakeHost({ appIcon: vi.fn(async () => null) }))
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    await within(panel).findByText('Althar 0.0.0')
    expect(within(panel).queryByRole('button', { name: /^App icon/ })).toBeNull()
  })

  it('lets only the latest choice go back, to the last icon kept', async () => {
    const answers: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    const host = fakeHost({
      setAppIcon: vi.fn(() => new Promise<void>((resolve, reject) => void answers.push({ resolve, reject }))),
    })
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^App icon\s*Cobalt/)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    const checked = () =>
      within(icons)
        .getAllByRole('radio')
        .find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent

    // Ink, then Paper before Ink is kept: Paper is kept, and Ink failing after says nothing.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Ink' }))
    await userEvent.click(within(icons).getByRole('radio', { name: 'Paper' }))
    await act(async () => answers[1]!.resolve())
    await act(async () => answers[0]!.reject(new Error('late')))
    expect(checked()).toBe('Paper')
    expect(screen.queryByRole('alert')).toBeNull()

    // Keystone, which can't be kept: Paper, the last kept, comes back.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Keystone' }))
    await act(async () => answers[2]!.reject(new Error('no picture')))
    expect(checked()).toBe('Paper')
    expect((await screen.findByRole('alert')).textContent).toBe('That icon couldn’t be kept. Try again.')
  })

  it('starts on cobalt when the main process can’t say', async () => {
    const host = fakeHost({ appIcon: vi.fn(async () => Promise.reject(new Error('gone'))) })
    withServices(<Settings />, fakeClient().client, host)
    await openModule(/^App icon\s*Cobalt/)
    expect(
      within(await screen.findByRole('radiogroup', { name: 'App icon' }))
        .getByRole('radio', { name: 'Cobalt' })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })
})

describe('the app’s own preferences in settings', () => {
  it('keeps the Mac awake by a round switch, and opens out to on battery too and the editor files open in', async () => {
    const host = fakeHost()
    const { client } = fakeClient({
      listEditors: vi.fn(async () => [
        { id: 'cursor', name: 'Cursor' },
        { id: 'zed', name: 'Zed' },
        { id: 'finder', name: 'Finder' },
      ]),
    })
    withServices(<Settings />, client, host)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    const awake = await within(panel).findByRole('switch', { name: 'Keep awake' })
    expect(awake.getAttribute('aria-checked')).toBe('true')
    expect(within(panel).getByRole('button', { name: /^Keep awake\s*While work runs/ })).toBeTruthy()
    await userEvent.click(awake)
    expect(host.setPreference).toHaveBeenCalledWith('keepAwake', false)
    expect(within(panel).getByRole('button', { name: /^Keep awake\s*Off/ })).toBeTruthy()

    await openModule(/^Keep awake/)
    expect(within(panel).getByRole('heading', { name: 'This Mac', level: 2 })).toBeTruthy()
    const battery = within(panel).getByRole('switch', { name: 'On battery too' })
    // Nothing to add to while it is off.
    expect((battery as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(within(panel).getByRole('switch', { name: 'Keep this Mac awake while work runs' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('keepAwake', true)
    await userEvent.click(battery)
    expect(host.setPreference).toHaveBeenLastCalledWith('awakeOnBattery', true)
    // Each editor by its own icon; the first one found until one is chosen.
    const editors = within(panel).getByRole('radiogroup', { name: 'Open files in' })
    expect(within(editors).getByRole('radio', { name: 'Cursor' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(editors.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cursor'))
    await userEvent.click(within(editors).getByRole('radio', { name: 'Zed' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('editor', 'zed')
    await waitFor(() => expect(within(editors).getByRole('radio', { name: 'Zed' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('turns every kind of notification off and on at once, and each on its own, with the count and a sound', async () => {
    const host = fakeHost()
    withServices(<Settings />, fakeClient().client, host)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    expect(await within(panel).findByRole('button', { name: /^Notifications\s*Silent/ })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('switch', { name: 'Notifications' }))
    for (const key of ['notifyCalls', 'notifyReady', 'notifyStopped']) expect(host.setPreference).toHaveBeenCalledWith(key, false)
    expect(within(panel).getByRole('button', { name: /^Notifications\s*Off/ })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('switch', { name: 'Notifications' }))

    await openModule(/^Notifications/)
    expect(within(panel).getByText('Only while Althar isn’t in front. Never for progress.')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('switch', { name: 'A task is ready for you' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('notifyReady', false)
    await userEvent.click(within(panel).getByRole('switch', { name: 'Count them on the Dock icon' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('badge', false)
    // The sound is one of the Mac's, heard as it is chosen, and again by its play button.
    await userEvent.click(within(panel).getByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Glass' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'Glass')
    expect(host.playSound).toHaveBeenCalledWith('Glass')
    await userEvent.click(within(panel).getByRole('button', { name: 'Play Glass' }))
    expect(host.playSound).toHaveBeenCalledTimes(2)
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to all settings' }))
    // One kind still on is notifications on, saying its sound.
    expect(within(panel).getByRole('button', { name: /^Notifications\s*Glass/ })).toBeTruthy()
  })

  it('shows what was kept, and goes back to it when a change can’t be kept', async () => {
    const host = fakeHost({
      preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, keepAwake: false, sound: 'Purr' })),
      setPreference: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    withServices(<Settings />, fakeClient().client, host)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    await waitFor(() => expect(within(panel).getByRole('switch', { name: 'Keep awake' }).getAttribute('aria-checked')).toBe('false'))
    expect(within(panel).getByRole('button', { name: /^Notifications\s*Purr/ })).toBeTruthy()
    // Said where the switch was pressed, at a glance as well as opened out.
    await userEvent.click(within(panel).getByRole('switch', { name: 'Keep awake' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(within(panel).getByRole('switch', { name: 'Keep awake' }).getAttribute('aria-checked')).toBe('false'))
    await openModule(/^Notifications/)
    await userEvent.click(within(panel).getByRole('switch', { name: 'A task is ready for you' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('That couldn’t be kept. Try again.')
    await waitFor(() =>
      expect(within(panel).getByRole('switch', { name: 'A task is ready for you' }).getAttribute('aria-checked')).toBe('true'),
    )
  })
})

describe('preference changes made together', () => {
  it('keeps a change made before the first read came, and shows only the latest answer of several', async () => {
    let answer: (preferences: typeof DEFAULT_PREFERENCES) => void = () => {}
    const answers: Array<() => void> = []
    let kept = DEFAULT_PREFERENCES
    const host = fakeHost({
      preferences: vi.fn(() => new Promise<typeof DEFAULT_PREFERENCES>((resolve) => void (answer = resolve))),
      setPreference: vi.fn(
        (key, value) =>
          new Promise<typeof DEFAULT_PREFERENCES>((resolve) => {
            kept = { ...kept, [key]: value }
            const now = kept
            answers.push(() => resolve(now))
          }),
      ),
    })
    withServices(<Settings />, fakeClient().client, host)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    const awake = within(panel).getByRole('switch', { name: 'Keep awake' })
    await userEvent.click(awake)
    await waitFor(() => expect(awake.getAttribute('aria-checked')).toBe('false'))
    // The read that was on its way answers late, with what was there before: the change stands.
    act(() => answer(DEFAULT_PREFERENCES))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(awake.getAttribute('aria-checked')).toBe('false')
    // Two changes; the first answers last: the switch shows the second.
    await userEvent.click(awake)
    await waitFor(() => expect(awake.getAttribute('aria-checked')).toBe('true'))
    await act(async () => {
      answers[2]?.()
      answers[1]?.()
      answers[0]?.()
    })
    expect(awake.getAttribute('aria-checked')).toBe('true')
  })
})

describe('a change that can’t be kept among several', () => {
  it('is said even when changes after it were kept, and what was kept is read again', async () => {
    const host = fakeHost({
      setPreference: vi.fn(async (key, value) => {
        if (key === 'notifyCalls') throw new Error('disk full')
        return { ...DEFAULT_PREFERENCES, notifyCalls: true, [key]: value }
      }),
    })
    withServices(<Settings />, fakeClient().client, host)
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    await userEvent.click(await within(panel).findByRole('switch', { name: 'Notifications' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(host.preferences).mock.calls.length).toBeGreaterThan(1))
  })
})

describe('an agent that isn’t on this Mac, in settings', () => {
  it('says so at a glance, and in its tab offers to download it', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: withoutOpenCode })) })
    withServices(<Settings />, client, fakeHost())
    const panel = await screen.findByRole('dialog', { name: 'Settings' })
    expect(await within(panel).findByText('Not on this Mac')).toBeTruthy()
    await openModule('Agents')
    await userEvent.click(within(panel).getByRole('tab', { name: /OpenCode/ }))
    const install = within(panel).getByRole('region', { name: 'OpenCode isn’t on this Mac' })
    expect(within(install).getByText(/from GitHub, about 45 MB, check it against the release/)).toBeTruthy()
    await userEvent.click(within(install).getByRole('button', { name: 'Download OpenCode' }))
    expect(client.installAgent).toHaveBeenCalledWith('opencode')
  })
})
