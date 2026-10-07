import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { HomeCall, HomeEvent, HomeTask, ProjectSummary } from '@althar/contracts'
import { ProjectInk, RuntimeState } from '@althar/ui'

import { agentMarkOf, HomeView, lineOf, refOf } from '../src/renderer/features/home/HomeView'
import { useHome } from '../src/renderer/features/home/useHome'
import { SettingsView } from '../src/renderer/features/settings/SettingsView'
import { useAppIcon } from '../src/renderer/features/settings/useAppIcon'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useStart } from '../src/renderer/features/start/useStart'
import { agents, card, change, changed, fakeClient, fakeHost, home, project, usual } from './fixtures'
import { withServices } from './render'

/*
 * The home: across projects, what waits on the person, answered where it is
 * or opened in the dock; what runs; what the loop did since they last left;
 * the projects beside it; and the bar's way to settings.
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
  onTask = vi.fn(),
  onSettings = vi.fn(),
}: Partial<Record<'onProject' | 'onTask' | 'onSettings', (id: string) => void>>) {
  return <HomeView model={useHome()} start={useStart()} onProject={onProject} onTask={onTask} onSettings={() => onSettings('settings')} />
}

describe('the home', () => {
  it('shows what waits on you across projects, answers a permission where it is, and opens the rest in the dock', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home onTask={onTask} />, client)
    const needs = await screen.findByRole('region', { name: /Needs you/ })
    expect(within(needs).getByText('npm publish')).toBeTruthy()
    expect(within(needs).getByText('Claude Code stopped before the step was done.')).toBeTruthy()
    // A change on its branch says its size; tasks are named by their titles alone, never their slugs.
    expect(within(needs).getByText('On its branch: 3 files, +40 −12')).toBeTruthy()
    expect(within(needs).getByText('On its branch')).toBeTruthy()
    expect(screen.queryByText(/althar\/branch|retry-the-call|name-it/)).toBeNull()
    // A change with its checks, the worst first.
    expect(within(needs).getByText('1 check failed')).toBeTruthy()
    expect(within(needs).getByText('No checks')).toBeTruthy()
    expect(within(needs).getByText('The agent stopped before the step was done.')).toBeTruthy()
    expect(within(needs).getAllByText('Write outside the worktree')).toHaveLength(2)
    expect(screen.queryByText(/^Gone/)).toBeNull()

    // Allowed where it is: the card folds to what was said.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Allow once' })[0]!)
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' })
    expect(await within(needs).findByText('Allowed npm publish')).toBeTruthy()
    expect(within(needs).getByText('in halyard')).toBeTruthy()

    // Review opens the change in the dock, in the projects' place.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Review' })[0]!)
    const dock = await screen.findByRole('complementary', { name: 'Beside the home' })
    expect(screen.queryByRole('complementary', { name: 'Projects' })).toBeNull()
    await userEvent.click(within(dock).getByRole('button', { name: 'Close the panel' }))
    expect(await screen.findByRole('complementary', { name: 'Projects' })).toBeTruthy()

    // A stuck step opens in the dock to be answered there.
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Open' })[0]!)
    expect(await screen.findByRole('complementary', { name: 'Beside the home' })).toBeTruthy()
    await userEvent.click(
      within(screen.getByRole('complementary', { name: 'Beside the home' })).getByRole('button', { name: 'Open the task' }),
    )
    expect(onTask).toHaveBeenCalledWith('th4')
  })

  it('denies where it is, and opens the first thing that waits from the bar', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /Needs you/ })
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Deny' })[0]!)
    expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'reject' })
    expect(await within(needs).findByText('Didn’t allow npm publish')).toBeTruthy()
    await userEvent.click(within(screen.getAllByRole('banner')[0]!).getByRole('button', { name: /need you/ }))
    expect(await screen.findByRole('complementary', { name: 'Beside the home' })).toBeTruthy()
  })

  it('opens the first ready task from the bar when no call waits, and answers a call opened in the dock', async () => {
    const one = busy()
    const { client } = fakeClient({ getHome: vi.fn(async () => ({ ...one, calls: [] })) })
    withServices(<Home />, client)
    await screen.findByRole('heading', { name: 'Name it better', level: 3 })
    await userEvent.click(within(screen.getAllByRole('banner')[0]!).getByRole('button', { name: /needs? you/ }))
    const dock = await screen.findByRole('complementary', { name: 'Beside the home' })
    expect(within(dock).getByRole('heading', { name: 'Name it better' })).toBeTruthy()
  })

  it('closes the dock when the call it holds is answered on its card', async () => {
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home />, client)
    const needs = await screen.findByRole('region', { name: /Needs you/ })
    await userEvent.click(within(needs).getByRole('button', { name: 'Run npm publish' }))
    expect(await screen.findByRole('complementary', { name: 'Beside the home' })).toBeTruthy()
    await userEvent.click(within(needs).getAllByRole('button', { name: 'Allow once' })[0]!)
    expect(await screen.findByRole('complementary', { name: 'Projects' })).toBeTruthy()
  })

  it('shows what runs, what the loop did, and the projects, and opens each', async () => {
    const onTask = vi.fn()
    const onProject = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => busy()) })
    withServices(<Home onTask={onTask} onProject={onProject} />, client)
    const runningNow = await screen.findByRole('region', { name: /Running/ })
    expect(within(runningNow).getByText(/Waits for Claude Code, back at/)).toBeTruthy()
    expect(within(runningNow).getByText('No agent is working on it')).toBeTruthy()
    expect(within(runningNow).getByText('Waits on you')).toBeTruthy()
    await userEvent.click(within(runningNow).getByRole('button', { name: 'Retry the call' }))
    expect(await screen.findByRole('complementary', { name: 'Beside the home' })).toBeTruthy()

    const since = screen.getByRole('region', { name: /Since you looked, the last day/ })
    expect(within(since).getByText('Moved to Codex.')).toBeTruthy()
    expect(within(since).getByText('Answered 3 permission asks')).toBeTruthy()
    // One still on the home opens in the dock; one that isn't opens its task.
    await userEvent.click(within(since).getByRole('button', { name: 'Implement finished' }))
    await userEvent.click(within(since).getByRole('button', { name: 'Review settled' }))
    expect(onTask).toHaveBeenCalledWith('thg')
    await userEvent.click(screen.getByRole('button', { name: 'Close the panel' }))

    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    expect(within(projects).getByText('No tasks yet')).toBeTruthy()
    await userEvent.click(within(projects).getByRole('button', { name: /halyard/ }))
    expect(onProject).toHaveBeenCalledWith('p2')
  })

  it('leaves ⌘ and a number to the window’s tabs, opens settings by ⌘, and reads again when work changes from where it first read', async () => {
    const onProject = vi.fn()
    const onSettings = vi.fn()
    const getHome = vi.fn(async () => home({ looked: '2026-10-07T08:00:00.000Z', projects: [project, halyard] }))
    const { client, emit } = fakeClient({ getHome })
    const view = withServices(<Home onProject={onProject} onSettings={onSettings} />, client)
    await screen.findByRole('button', { name: /halyard/ })
    fireEvent.keyDown(window, { key: '2', metaKey: true })
    fireEvent.keyDown(window, { key: 'x', metaKey: true })
    expect(onProject).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    expect(onSettings).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(2)

    emit(changed('task', 't1', 'th1', 'p2'))
    emit(changed('thread_item', 'i1'))
    await waitFor(() => expect(getHome).toHaveBeenCalledTimes(2))
    expect(getHome).toHaveBeenLastCalledWith('2026-10-06T18:00:00.000Z')

    // Leaving, the runtime hears it.
    view.unmount()
    expect(client.leftHome).toHaveBeenCalled()
    act(() => void window.dispatchEvent(new Event('pagehide')))
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

  it('draws each project in its ink, and each agent in the bar as it stands', () => {
    expect(refOf(project)).toEqual({ seed: 'p1', ink: ProjectInk.Teal, name: 'meridian' })
    const now = new Date('2026-10-07T12:00:00')
    const [claude, codex, opencode] = agents
    expect(agentMarkOf(claude!, now).state).toBe(RuntimeState.Ready)
    expect(agentMarkOf(codex!, now)).not.toHaveProperty('brand', undefined)
    expect(agentMarkOf(opencode!, now).state).toBe(RuntimeState.SignedOut)
    const out = {
      ...claude!,
      accounts: [
        { ...usual('acc_1', 'signed_in'), outUntil: '2026-10-07T14:20:00' },
        { ...usual('acc_2', 'signed_in'), outUntil: '2026-10-07T13:00:00' },
      ],
    }
    expect(agentMarkOf(out, now)).toMatchObject({ state: RuntimeState.OutOfUsage, back: expect.stringMatching(/1:00|13:00/) })
    const partly = {
      ...claude!,
      accounts: [{ ...usual('acc_1', 'signed_in'), outUntil: '2026-10-07T14:20:00' }, usual('acc_2', 'signed_in')],
    }
    expect(agentMarkOf(partly, now).state).toBe(RuntimeState.Ready)
  })
})

function Settings({ onBack = () => {} }: { onBack?: () => void }) {
  return <SettingsView model={useStart()} connections={useConnections()} appIcon={useAppIcon()} onBack={onBack} />
}

describe('settings', () => {
  it('goes back home by its crumb or Escape', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient()
    withServices(<Settings onBack={onBack} />, client)
    await screen.findByRole('heading', { name: 'Agents on this Mac' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await userEvent.click(screen.getByRole('button', { name: /Home/ }))
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('shows the icon the app has, and gives it another', async () => {
    const host = fakeHost({ appIcon: vi.fn(async () => 'paper') })
    withServices(<Settings />, fakeClient().client, host)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(
      within(icons)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Cobalt', 'Cobalt, dark', 'Paper', 'Ink', 'Solid', 'Solid, dark'])
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
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(icons).getByRole('radio', { name: 'Solid' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That icon couldn’t be kept. Try again.')
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
  })

  it('offers no icon where there is no Dock to show one', async () => {
    withServices(<Settings />, fakeClient().client, fakeHost({ appIcon: vi.fn(async () => null) }))
    await screen.findByRole('heading', { name: 'Agents on this Mac' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'App icon' })).toBeNull())
    expect(screen.queryByRole('radiogroup', { name: 'App icon' })).toBeNull()
  })

  it('lets only the latest choice go back, to the last icon kept', async () => {
    const answers: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    const host = fakeHost({
      setAppIcon: vi.fn(() => new Promise<void>((resolve, reject) => void answers.push({ resolve, reject }))),
    })
    withServices(<Settings />, fakeClient().client, host)
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

    // Solid, which can't be kept: Paper, the last kept, comes back.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Solid' }))
    await act(async () => answers[2]!.reject(new Error('no picture')))
    expect(checked()).toBe('Paper')
    expect((await screen.findByRole('alert')).textContent).toBe('That icon couldn’t be kept. Try again.')
  })

  it('starts on cobalt when the main process can’t say', async () => {
    const host = fakeHost({ appIcon: vi.fn(async () => Promise.reject(new Error('gone'))) })
    withServices(<Settings />, fakeClient().client, host)
    expect(
      within(await screen.findByRole('radiogroup', { name: 'App icon' }))
        .getByRole('radio', { name: 'Cobalt' })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })
})
