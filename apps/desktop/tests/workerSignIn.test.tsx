import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { HomeWorker, HomeWorkers } from '@althar/contracts'

import type { WorkerAgent, WorkerCheck, WorkerSignInEvent, WorkersHost } from '../src/workers'
import { keys } from '../src/renderer/data/reads'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import {
  checkedUnready,
  checkedWorker,
  checkText,
  unreadyOf,
  useRemoveWorker,
  useWorkerCheck,
  useWorkerProjects,
  useWorkerSignIn,
} from '../src/renderer/shared/useWorkers'
import { fakeClient, fakeHost } from './fixtures'
import { servicesFor } from './render'

/*
 * An agent's sign-in on a worker, as Settings › Computers drives it (useWorkers.ts): each step its own sign-in says, the
 * line for one run in a terminal there and its Check, and who is signed in held until a read of the home says so too.
 */

const box: HomeWorker = {
  workerId: `wrk_${'7'.repeat(32)}`,
  name: 'box',
  ssh: 'althar@box:2222',
  anyProject: true,
  signedIn: [],
  connected: true,
  busy: false,
  providers: ['claude-code', 'codex', 'opencode'],
  projects: [{ id: 'proj_m', name: 'Meridian' }],
  task: null,
}

/** A window's bridge to its workers, whose sign-in events the test says, and whose check answers as it is told. */
const bridgeOf = (agents: WorkersHost['agents'] = vi.fn(async () => []), check: WorkersHost['check'] = vi.fn(async () => null)) => {
  let listener: ((event: WorkerSignInEvent) => void) | undefined
  const bridge: WorkersHost = {
    release: vi.fn(async () => ({ kind: 'none' as const, newest: null })),
    setup: vi.fn(async () => null),
    setUp: vi.fn(async () => undefined),
    act: vi.fn(async () => undefined),
    onSetup: vi.fn(() => () => undefined),
    agents,
    check,
    signIn: vi.fn(async () => undefined),
    signInAct: vi.fn(async () => undefined),
    onSignIn: vi.fn((heard) => {
      listener = heard
      return () => undefined
    }),
  }
  return { bridge, say: (event: WorkerSignInEvent) => act(() => listener?.(event)) }
}

const hosted = <A,>(use: () => A, host: Host, client = fakeClient().client) => {
  const services = servicesFor(client, host)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  return { ...renderHook(use, { wrapper }), services, client }
}

describe('an agent’s sign-in on a worker', () => {
  it('shows each step its sign-in says, and once signed in holds who is until a read of the home says the same', () => {
    const { bridge, say } = bridgeOf()
    const { result } = hosted(useWorkerSignIn, fakeHost({ workers: bridge }))
    // Nothing under way: what the bridge says is no one's.
    say({ kind: 'failed', message: 'stray' })
    expect(result.current.signingIn).toBeNull()
    act(() => result.current.start(box, 'claude-code'))
    expect(result.current.signingIn).toEqual({ workerId: box.workerId, agent: 'claude-code', step: { kind: 'starting' } })
    expect(bridge.signIn).toHaveBeenCalledWith('althar@box:2222', 'claude-code', 'browser')
    // Its program downloading first: a share of its whole, none where the whole isn't known, never past all of it.
    say({ kind: 'getting', bytes: 50, totalBytes: 200 })
    expect(result.current.signingIn?.step).toEqual({ kind: 'getting', percent: 25 })
    say({ kind: 'getting', bytes: 50 })
    expect(result.current.signingIn?.step).toEqual({ kind: 'getting', percent: 0 })
    say({ kind: 'getting', bytes: 300, totalBytes: 200 })
    expect(result.current.signingIn?.step).toEqual({ kind: 'getting', percent: 100 })
    say({ kind: 'browser', link: 'https://claude.ai/oauth', paste: true })
    expect(result.current.signingIn?.step).toEqual({ kind: 'browser', link: 'https://claude.ai/oauth', paste: true })
    act(() => result.current.paste('CODE#1'))
    expect(bridge.signInAct).toHaveBeenCalledWith({ paste: 'CODE#1' })
    // Check is a terminal sign-in's: on a page's, it shows no checking.
    act(() => result.current.check())
    expect(result.current.signingIn?.step).toEqual({ kind: 'browser', link: 'https://claude.ai/oauth', paste: true })
    say({ kind: 'refused', message: 'That code didn’t work.' })
    expect(result.current.signingIn?.step).toMatchObject({ kind: 'browser', refused: 'That code didn’t work.' })
    // What changes nothing it shows leaves it as it is.
    say({ kind: 'open', url: 'https://claude.ai/oauth' })
    expect(result.current.signingIn?.step).toMatchObject({ kind: 'browser', refused: 'That code didn’t work.' })
    say({ kind: 'device', code: 'ABCD-1234', page: 'https://auth.openai.com/device', minutes: 15 })
    expect(result.current.signingIn?.step).toEqual({ kind: 'code', code: 'ABCD-1234', page: 'https://auth.openai.com/device' })
    // A refusal is a pasted code's: with no code pasted it changes nothing.
    say({ kind: 'refused', message: 'no' })
    expect(result.current.signingIn?.step).toEqual({ kind: 'code', code: 'ABCD-1234', page: 'https://auth.openai.com/device' })
    say({
      kind: 'agents',
      agents: [
        { id: 'claude-code', name: 'Claude Code', signedIn: true },
        { id: 'codex', name: 'Codex', signedIn: false },
      ],
    })
    expect(result.current.signingIn).toBeNull()
    expect(result.current.held.get(box.workerId)).toEqual(['claude-code'])
    // A read that doesn't say so yet leaves it held, the same map; one that does lets it go.
    const before = result.current.held
    const { signedIn: _, ...unsaid } = box
    act(() => result.current.confirmed([{ ...box, signedIn: [] }, unsaid]))
    expect(result.current.held).toBe(before)
    act(() => result.current.confirmed([{ ...box, signedIn: ['claude-code'] }]))
    expect(result.current.held.size).toBe(0)
  })

  it('says why one fails, at its start or later, and Cancel ends it here and on the worker', async () => {
    const { bridge, say } = bridgeOf()
    const { result } = hosted(useWorkerSignIn, fakeHost({ workers: bridge }))
    vi.mocked(bridge.signIn).mockRejectedValueOnce(new Error('ssh: connect to host box port 2222: Connection refused'))
    act(() => result.current.start(box, 'codex'))
    expect(bridge.signIn).toHaveBeenCalledWith('althar@box:2222', 'codex', 'device')
    await waitFor(() =>
      expect(result.current.signingIn?.step).toEqual({ kind: 'failed', message: 'ssh: connect to host box port 2222: Connection refused' }),
    )
    vi.mocked(bridge.signIn).mockRejectedValueOnce('gone')
    act(() => result.current.start(box, 'codex'))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'failed', message: 'The sign-in couldn’t start.' }))
    act(() => result.current.start(box, 'claude-code'))
    say({ kind: 'failed', message: 'Claude Code couldn’t be downloaded to box.' })
    expect(result.current.signingIn?.step).toEqual({ kind: 'failed', message: 'Claude Code couldn’t be downloaded to box.' })
    act(() => result.current.cancel())
    expect(result.current.signingIn).toBeNull()
    expect(bridge.signInAct).toHaveBeenCalledWith({ cancel: true })
    // A worker set up with no SSH address has no way to sign in from here.
    const { ssh: _, ...unreachable } = box
    act(() => result.current.start(unreachable, 'codex'))
    expect(result.current.signingIn).toBeNull()
  })

  it('keeps a sign-in run in a terminal, its line and Check, until the worker’s check finds it signed in', async () => {
    let answer: () => Promise<ReadonlyArray<WorkerAgent>> = async () => [{ id: 'opencode', name: 'OpenCode', signedIn: false }]
    const { bridge, say } = bridgeOf(vi.fn(() => answer()))
    const { result } = hosted(useWorkerSignIn, fakeHost({ workers: bridge }))
    // Check before any sign-in asks nothing.
    act(() => result.current.check())
    expect(bridge.agents).not.toHaveBeenCalled()
    act(() => result.current.start(box, 'opencode'))
    const command = "ssh -t -p 2222 althar@box '~/.althar/bin/opencode auth login'"
    say({ kind: 'terminal', command })
    expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', command })
    // Its first check, before it is run there: not signed in, so the line stays.
    say({ kind: 'agents', agents: [{ id: 'opencode', name: 'OpenCode', signedIn: false }] })
    expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', command })
    // Check shows it checking at once; not signed in yet, it says so.
    act(() => result.current.check())
    expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', command, checking: true, notYet: false })
    expect(bridge.agents).toHaveBeenCalledWith('althar@box:2222')
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', command, checking: false, notYet: true }))
    // A check that couldn't reach it says nothing either way.
    answer = async () => Promise.reject(new Error('ssh: timed out'))
    act(() => result.current.check())
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', command, checking: false, notYet: false }))
    // Signed in there: the line goes, and who is signed in is held.
    answer = async () => [
      { id: 'opencode', name: 'OpenCode', signedIn: true },
      { id: 'codex', name: 'Codex', signedIn: true },
    ]
    act(() => result.current.check())
    await waitFor(() => expect(result.current.signingIn).toBeNull())
    expect(result.current.held.get(box.workerId)).toEqual(['opencode', 'codex'])
  })

  it('lets a check’s late answer change nothing once that sign-in is over, or another is under way', async () => {
    let answered: (agents: ReadonlyArray<WorkerAgent>) => void = () => undefined
    const { bridge, say } = bridgeOf(vi.fn(() => new Promise<ReadonlyArray<WorkerAgent>>((done) => (answered = done))))
    const { result } = hosted(useWorkerSignIn, fakeHost({ workers: bridge }))
    const command = "ssh -t althar@box '~/.althar/bin/opencode auth login'"
    act(() => result.current.start(box, 'opencode'))
    say({ kind: 'terminal', command })
    act(() => result.current.check())
    act(() => result.current.cancel())
    await act(async () => answered([{ id: 'opencode', name: 'OpenCode', signedIn: false }]))
    expect(result.current.signingIn).toBeNull()
    // Asked for OpenCode, answered once Claude Code's sign-in is under way instead: Claude Code's stays as it is.
    act(() => result.current.start(box, 'opencode'))
    say({ kind: 'terminal', command })
    act(() => result.current.check())
    act(() => result.current.start(box, 'claude-code'))
    await act(async () => answered([{ id: 'opencode', name: 'OpenCode', signedIn: false }]))
    expect(result.current.signingIn).toEqual({ workerId: box.workerId, agent: 'claude-code', step: { kind: 'starting' } })
  })

  it('does nothing in a window with no way to reach workers', () => {
    const { result } = hosted(useWorkerSignIn, fakeHost({ workers: undefined }))
    act(() => result.current.start(box, 'codex'))
    act(() => result.current.paste('CODE'))
    act(() => result.current.check())
    act(() => result.current.cancel())
    expect(result.current.signingIn).toBeNull()
  })
})

describe('a worker taken out, or its projects changed', () => {
  const read: HomeWorkers = { enabled: true, workers: [box, { ...box, workerId: `wrk_${'8'.repeat(32)}`, name: 'other' }] }

  it('is off the list at once, and back with the home’s words or ours where it refuses', async () => {
    const { client } = fakeClient()
    const { result, services } = hosted(useRemoveWorker, fakeHost(), client)
    services.cache.setQueryData(keys.workers, read)
    vi.mocked(client.removeWorker).mockRejectedValueOnce(new Error('It’s running a task.'))
    act(() => result.current.remove(box.workerId))
    expect(services.cache.getQueryData<HomeWorkers>(keys.workers)?.workers.map(({ name }) => name)).toEqual(['other'])
    await waitFor(() => expect(result.current.failed).toBe('It’s running a task.'))
    vi.mocked(client.removeWorker).mockRejectedValueOnce('gone')
    act(() => result.current.remove(box.workerId))
    await waitFor(() => expect(result.current.failed).toBe('Couldn’t remove the worker.'))
    // With nothing read yet, there is nothing to take it off.
    services.cache.removeQueries({ queryKey: keys.workers })
    act(() => result.current.remove(box.workerId))
    expect(services.cache.getQueryData(keys.workers)).toBeUndefined()
    await waitFor(() => expect(result.current.failed).toBeNull())
  })

  it('shows its projects at once, on it alone, and takes them back with why where the home refuses', async () => {
    const { client } = fakeClient()
    const { result, services } = hosted(useWorkerProjects, fakeHost(), client)
    services.cache.setQueryData(keys.workers, read)
    vi.mocked(client.setWorkerProjects).mockRejectedValueOnce(new Error('No such project.'))
    act(() => result.current.set(box.workerId, []))
    const now = services.cache.getQueryData<HomeWorkers>(keys.workers)?.workers
    expect(now?.map(({ projects }) => projects.length)).toEqual([0, 1])
    expect(client.setWorkerProjects).toHaveBeenCalledWith(box.workerId, [])
    await waitFor(() => expect(result.current.failed).toBe('No such project.'))
    vi.mocked(client.setWorkerProjects).mockRejectedValueOnce('gone')
    act(() => result.current.set(box.workerId, [{ id: 'proj_m', name: 'Meridian' }]))
    await waitFor(() => expect(result.current.failed).toBe('Couldn’t change its projects.'))
    services.cache.removeQueries({ queryKey: keys.workers })
    act(() => result.current.set(box.workerId, []))
    expect(services.cache.getQueryData(keys.workers)).toBeUndefined()
  })
})

describe('Check again on a worker’s sandbox problem', () => {
  const fix = "sudo sh -c 'apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap'"
  const blocked: HomeWorker = {
    ...box,
    readiness: { sandbox: { starts: false, problem: 'NoUserNamespaces', fix }, tools: [], models: [] },
  }
  const starts: HomeWorker = { ...blocked, readiness: { sandbox: { starts: true }, tools: [], models: [] } }

  it('clears the problem as soon as the check says the sandbox starts, and lets go once the home says so too', async () => {
    let answer: (check: WorkerCheck | null) => void = () => undefined
    const check = vi.fn(() => new Promise<WorkerCheck | null>((resolve) => (answer = resolve)))
    const { bridge } = bridgeOf(undefined, check)
    const { result } = hosted(useWorkerCheck, fakeHost({ workers: bridge }))
    act(() => result.current.check(blocked))
    expect(check).toHaveBeenCalledWith('althar@box:2222')
    // At once: the press says it checks, over the problem as the home still has it.
    const view = () => result.current.checks.get(box.workerId)
    expect(view()).toEqual({ kind: 'checking' })
    const under = checkedUnready(unreadyOf(checkedWorker(blocked, view())), view(), 'box')
    expect(under).toMatchObject({ title: 'Its agents’ sandbox can’t start.', command: fix, checking: true })
    // A read of the home that still says it fails changes nothing while it checks.
    act(() => result.current.confirmed([blocked]))
    expect(view()).toEqual({ kind: 'checking' })
    await act(async () => answer({ sandbox: { starts: true }, agents: [] }))
    expect(view()).toEqual({ kind: 'checked', sandbox: { starts: true } })
    // Its problem is gone at once, though the home hasn't heard yet.
    expect(unreadyOf(checkedWorker(blocked, view()))).toBeUndefined()
    act(() => result.current.confirmed([blocked]))
    expect(view()).toBeDefined()
    act(() => result.current.confirmed([starts]))
    expect(view()).toBeUndefined()
  })

  it('says it still fails with the check’s own command, and why where it couldn’t check', async () => {
    const answers: Array<() => Promise<WorkerCheck | null>> = [
      async () => ({ sandbox: { starts: false, problem: 'NoUserNamespaces', fix: 'sudo sh -c new' }, agents: [] }),
      async () => {
        throw new Error('Unreachable')
      },
      async () => null,
    ]
    const check = vi.fn(() => (answers.shift() ?? (async () => null))())
    const { bridge } = bridgeOf(undefined, check)
    const { result } = hosted(useWorkerCheck, fakeHost({ workers: bridge }))
    const view = () => result.current.checks.get(box.workerId)
    act(() => result.current.check(blocked))
    await waitFor(() => expect(view()?.kind).toBe('checked'))
    expect(checkedUnready(unreadyOf(checkedWorker(blocked, view())), view(), 'box')).toMatchObject({
      command: 'sudo sh -c new',
      note: checkText.stillFails,
    })
    // The home agreeing it fails keeps the line; the press again checks again.
    act(() => result.current.confirmed([blocked]))
    expect(view()?.kind).toBe('checked')
    act(() => result.current.check(blocked))
    await waitFor(() => expect(view()).toEqual({ kind: 'failed' }))
    expect(checkedUnready(unreadyOf(blocked), view(), 'box')?.note).toBe('Couldn’t check box over SSH. Althar’s log says why.')
    // A release that doesn't say its check: the home's reads stand.
    act(() => result.current.check(blocked))
    await waitFor(() => expect(view()).toBeUndefined())
    // A worker without an SSH address isn't checked from here.
    act(() => result.current.check({ ...blocked, ssh: undefined }))
    expect(check).toHaveBeenCalledTimes(3)
    expect(view()).toBeUndefined()
  })
})
