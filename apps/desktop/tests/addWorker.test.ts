import { describe, expect, it } from 'vitest'

import type { HomeWorker } from '@althar/contracts'

import {
  checkedLine,
  checkProblem,
  codeView,
  problemOf,
  setupView,
  sshTargetOf,
  unavailableOf,
} from '../src/renderer/features/settings/useAddWorker'
import { computerWorkerOf, loadWorkerOf, mibOf, workerKindOf, workerStateOf } from '../src/renderer/shared/useWorkers'

describe('adding a worker, in words', () => {
  it('reads an address as it would be typed after ssh, with a port', () => {
    expect(sshTargetOf('ssh build@box:2222')).toEqual({ target: 'build@box', port: 2222 })
    expect(sshTargetOf('box')).toEqual({ target: 'box' })
    expect(sshTargetOf('box:70000')).toBeNull()
    expect(sshTargetOf('not an address')).toBeNull()
  })

  it('stops a login that doesn’t linger with the line for its administrator, and tries again once it has run', () => {
    const setup = { name: 'box', target: { target: 'build@box' } }
    expect(problemOf('LingerOff', setup, 'sudo loginctl enable-linger -- build')).toEqual({
      title: 'box would stop the worker whenever you log out.',
      body: 'Its login can’t keep services running on its own. Have its administrator run this, then try again:',
      command: 'sudo loginctl enable-linger -- build',
      retry: true,
    })
    expect(problemOf('NoRelease', setup).retry).toBe(false)
    expect(problemOf('AuthFailed', setup).command).toBe('ssh build@box')
  })
})

describe('where adding a worker stopped, in words', () => {
  const setup = { name: 'box', target: { target: 'build@box' } }

  it('says each stop, whether trying again can help, and what it said where it said anything', () => {
    const codes = [
      'Unreachable',
      'HostKeyChanged',
      'UnsupportedOS',
      'UnsupportedArchitecture',
      'NoSystemd',
      'NoUserManager',
      'NotEnoughDisk',
      'ReleaseRejected',
      'AccountConflict',
      'NoPublicKey',
      'Stopped',
    ]
    for (const code of codes) expect(problemOf(code, setup).title.length).toBeGreaterThan(0)
    expect(problemOf('HostKeyChanged', setup).command).toBe('ssh-keygen -R box')
    expect(problemOf('UnsupportedOS', setup).retry).toBe(false)
    expect(problemOf('NoUserManager', setup).retry).toBe(false)
    expect(problemOf('AccountConflict', setup).retry).toBe(false)
    // SSH's and the worker's own words go to main.log: the window says a short line.
    expect(problemOf('CannotDownload', setup, 'curl: (6) Could not resolve host: github.com').body).toBeUndefined()
    expect(problemOf('UploadFailed', setup).body).toBeUndefined()
    expect(problemOf('LingerOff', setup).command).toBeUndefined()
    expect(problemOf('WorkerNotAdded', setup, 'The home is busy.').title).toBe('The home is busy.')
    expect(problemOf('WorkerNotAdded', setup).title).toBe('The home couldn’t sign the worker’s key.')
    expect(problemOf('Whatever', setup, 'it broke').body).toBeUndefined()
    expect(problemOf('Whatever', setup).body).toBeUndefined()
  })

  it('says plainly where no release can add a worker, the newest it found, and to check again', () => {
    expect(problemOf('NoWorkerRelease', setup, '0.1.0')).toEqual({
      title: 'There’s no Althar release with workers yet.',
      body: 'The newest host release, 0.1.0, came before workers. Check again once a newer one is out.',
      retry: true,
    })
    expect(problemOf('NoWorker', setup).title).toBe('There’s no Althar release with workers yet.')
    expect(problemOf('NoWorker', { ...setup, version: '0.1.0' }, 'This release carries no worker.').body).toBe(
      'The newest host release, 0.1.0, came before workers. Check again once a newer one is out.',
    )
    expect(unavailableOf({ kind: 'none', newest: '0.1.0' })?.title).toBe('There’s no Althar release with workers yet.')
    expect(unavailableOf({ kind: 'none', newest: null })?.body).toBe('No host release is published. Check again once one is out.')
    expect(unavailableOf({ kind: 'ready', version: '0.2.0', base: 'https://x' })).toBeNull()
    expect(unavailableOf(null)).toBeNull()
  })

  it('draws a setup as the dialog has it: its progress, its host key and where it stopped', () => {
    const base = { name: 'box', target: { target: 'box' }, phase: 'running' as const, at: 2, log: [] }
    expect(setupView(base)).toMatchObject({ name: 'box', at: 2, progress: undefined, hostKey: undefined, problem: undefined })
    expect(setupView({ ...base, progress: { bytes: 0, total: 0 } }).progress).toEqual({ fraction: 0, megabytes: 0, sending: false })
    expect(setupView({ ...base, progress: { bytes: 1_048_576, total: 2_097_152 }, sending: true }).progress).toEqual({
      fraction: 0.5,
      megabytes: 2,
      sending: true,
    })
    expect(setupView({ ...base, hostKey: { host: 'box', type: 'RSA', fingerprint: 'SHA256:x' } }).hostKey).toEqual({
      fingerprint: 'SHA256:x',
      type: 'RSA',
    })
    expect(setupView({ ...base, phase: 'failed', problem: { code: 'Unreachable' } }).problem?.retry).toBe(true)
  })
})

describe('what a worker’s check found, in words', () => {
  const claude = { id: 'claude-code', name: 'Claude Code', signedIn: true }
  const codex = { id: 'codex', name: 'Codex', signedIn: true }
  const starts = { starts: true } as const
  const fails = (problem: string, fix?: string) => ({ starts: false, problem, ...(fix === undefined ? {} : { fix }) }) as const

  it('says what started where nothing stops a task', () => {
    expect(checkedLine({ sandbox: starts, agents: [] })).toBe('Its sandbox starts. Sign its agents in on its sheet.')
    expect(checkedLine({ sandbox: starts, agents: [{ ...claude, started: true }] })).toBe('Its sandbox starts, and Claude Code started.')
    expect(
      checkedLine({
        sandbox: starts,
        agents: [
          { ...claude, started: true },
          { ...codex, started: true },
        ],
      }),
    ).toBe('Its sandbox starts, and Claude Code and Codex started.')
    expect(checkProblem({ sandbox: starts, agents: [{ ...claude, started: true }] }, 'box')).toBeUndefined()
  })

  it('says why its sandbox can’t start, what lets it, and where sudo couldn’t or didn’t', () => {
    const fix = 'sudo sh -c x'
    expect(checkProblem({ sandbox: fails('NoUserNamespaces', fix), agents: [] }, 'box')).toEqual({
      title: 'Its agents’ sandbox can’t start on box.',
      body: 'This Linux lets only programs it names make the namespaces the sandbox needs. Allow the worker’s once, as an administrator:',
      command: fix,
      retry: true,
    })
    expect(checkProblem({ sandbox: fails('NoUserNamespaces'), agents: [] }, 'box')).not.toHaveProperty('command')
    expect(checkProblem({ sandbox: fails('NoUserNamespaces'), agents: [] }, 'box')?.body).toContain('keeps user namespaces off')
    expect(checkProblem({ sandbox: fails('NoUserNamespaces', fix), agents: [], allowed: 'NeedsAdministrator' }, 'box')?.body).toContain(
      'can’t use sudo without a password',
    )
    expect(checkProblem({ sandbox: fails('NoUserNamespaces', fix), agents: [], allowed: 'SandboxStillFails' }, 'box')?.body).toContain(
      'still can’t after that',
    )
    for (const problem of ['NoBubblewrap', 'NoSocat'])
      expect(checkProblem({ sandbox: fails(problem), agents: [] }, 'box')?.title).toBe(
        'The worker on box is missing what its sandbox needs.',
      )
    expect(checkProblem({ sandbox: fails('Failed'), agents: [] }, 'box')?.body).toBe('Althar’s log says what it found.')
  })

  it('says which agent couldn’t start, in its own words where it gave some', () => {
    expect(checkProblem({ sandbox: starts, agents: [{ ...codex, started: false, message: 'Not signed in.' }] }, 'box')).toEqual({
      title: 'Codex couldn’t start on box.',
      body: 'Not signed in.',
      retry: true,
    })
    expect(checkProblem({ sandbox: starts, agents: [{ ...codex, started: false }] }, 'box')).not.toHaveProperty('body')
  })
})

describe('a worker, as the window lists it', () => {
  const capacity = { platform: 'linux', architecture: 'arm64', cpuCores: 1, freeMemoryMib: 2048, freeDiskMib: 640 } as const
  const worker: HomeWorker = {
    workerId: `wrk_${'1'.repeat(32)}`,
    connected: true,
    busy: false,
    providers: ['codex'],
    projects: [],
    task: null,
  }
  const task = { taskId: 'tsk_1', threadId: 'thr_1', title: 'Fix it', project: 'Meridian' }

  it('says where each stands, and what it has free', () => {
    expect(workerStateOf({ ...worker, connected: false })).toBe('offline')
    expect(workerStateOf({ ...worker, busy: true })).toBe('working')
    expect(workerStateOf({ ...worker, capacity: { ...capacity, freeDiskMib: 0 } })).toBe('full')
    expect(workerStateOf({ ...worker, capacity: { ...capacity, freeMemoryMib: 0 } })).toBe('full')
    expect(workerStateOf({ ...worker, capacity })).toBe('free')
    expect(mibOf(2048)).toBe('2 GB')
    expect(mibOf(640)).toBe('640 MB')
    expect(workerKindOf(capacity)).toBe('Linux · arm64 · 1 core')
    expect(workerKindOf({ ...capacity, cpuCores: 8 })).toBe('Linux · arm64 · 8 cores')
  })

  it('lists it for the load popover by where it stands', () => {
    expect(loadWorkerOf({ ...worker, connected: false }).detail).toBe('Not connected')
    expect(loadWorkerOf({ ...worker, connected: false, busy: true, task }).detail).toBe('Went offline during Fix it')
    expect(loadWorkerOf({ ...worker, capacity: { ...capacity, freeDiskMib: 0 } }).detail).toBe('Out of memory or disk space')
    expect(loadWorkerOf({ ...worker, busy: true }).detail).toBe('Running a task')
    expect(loadWorkerOf({ ...worker, busy: true, task }).detail).toBe('Fix it · Meridian')
    expect(loadWorkerOf(worker).detail).toBe('Ready for a task')
    expect(loadWorkerOf({ ...worker, capacity }).detail).toBe('2 GB memory free')
  })

  it('lists it for Settings › Computers, with who is signed in where it says, and whether its agents sign in from here', () => {
    const plain = computerWorkerOf(worker, (id) => id.toUpperCase())
    expect(plain).toMatchObject({
      kind: null,
      memoryFree: null,
      diskFree: null,
      task: null,
      managed: false,
      reachable: false,
      stranded: false,
    })
    expect(plain.agents).toEqual([expect.objectContaining({ id: 'codex', name: 'CODEX' })])
    expect(plain.agents[0]).not.toHaveProperty('signedIn')
    const added = computerWorkerOf(
      { ...worker, name: 'box', ssh: 'build@box', anyProject: true, signedIn: ['codex'], capacity, connected: false, busy: true, task },
      (id) => id,
      true,
    )
    expect(added).toMatchObject({
      name: 'box',
      kind: 'Linux · arm64 · 1 core',
      memoryFree: '2 GB',
      diskFree: '640 MB',
      task: { id: 'thr_1', title: 'Fix it', project: 'Meridian' },
      managed: true,
      reachable: true,
      stranded: true,
    })
    expect(added.agents[0]?.signedIn).toBe(true)
    expect(computerWorkerOf({ ...worker, signedIn: [] }, (id) => id, true)).toMatchObject({ reachable: false })
  })

  it('says why its agents’ sandbox can’t start, with the one command that lets it where its check found one', () => {
    const fails = (problem: string, fix?: string) =>
      computerWorkerOf(
        { ...worker, readiness: { sandbox: { starts: false, problem, ...(fix === undefined ? {} : { fix }) }, tools: [], models: [] } },
        (id) => id,
      ).unready
    expect(computerWorkerOf(worker, (id) => id)).not.toHaveProperty('unready')
    expect(computerWorkerOf({ ...worker, readiness: { sandbox: { starts: true }, tools: [], models: [] } }, (id) => id)).not.toHaveProperty(
      'unready',
    )
    expect(fails('NoUserNamespaces', 'sudo sh -c x')).toEqual({
      title: 'Its agents’ sandbox can’t start.',
      body: 'This Linux lets only programs it names make the namespaces it needs. Have its administrator run this once there:',
      command: 'sudo sh -c x',
    })
    expect(fails('NoUserNamespaces')).toMatchObject({ body: expect.stringContaining('keeps user namespaces off') })
    expect(fails('NoBubblewrap')).toMatchObject({ body: expect.stringContaining('add it again') })
    expect(fails('NoSocat')).toMatchObject({ body: expect.stringContaining('add it again') })
    expect(fails('Failed')).toMatchObject({ body: 'Its check found bubblewrap couldn’t make a sandbox there.' })
  })
})

describe('a code’s way, as the dialog draws it', () => {
  it('gives its line and how long it lasts, says it is being made, or why the home made none', () => {
    const now = 1_000_000
    const base = 'https://github.com/AltharIDE/althar/releases/download/host-v0.2.0'
    // From the host release that has workers, not the repository's latest, which is the desktop's.
    expect(codeView({ code: 'althar-worker1.e30', expiresAt: now + 600_000 }, null, now, base)).toEqual({
      command: `curl -fsSL ${base}/althar-worker.sh | ALTHAR_RELEASE_BASE=${base} sh -s -- join 'althar-worker1.e30'`,
      lasts: '10 minutes',
    })
    expect(codeView({ code: 'c', expiresAt: now + 20_000 }, null, now, base).lasts).toBe('a minute')
    expect(codeView({ code: 'c', expiresAt: now }, null, now, base)).toEqual({ command: null, lasts: null })
    expect(codeView({ code: 'c', expiresAt: now + 20_000 }, null, now, null)).toEqual({ command: null, lasts: null })
    expect(codeView(null, null, now, base)).toEqual({ command: null, lasts: null })
    expect(codeView(null, 'The home is busy.', now, base)).toEqual({ command: null, lasts: null, failed: 'The home is busy.' })
  })
})
