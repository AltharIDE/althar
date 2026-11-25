import { describe, expect, it } from 'vitest'

import type { HomeWorker } from '@althar/contracts'

import { codeView, problemOf, setupView, sshTargetOf, WORKER_SCRIPT } from '../src/renderer/features/settings/useAddWorker'
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
    expect(problemOf('CannotDownload', setup, 'no route').body).toBe('no route')
    expect(problemOf('UploadFailed', setup).body).toBeUndefined()
    expect(problemOf('LingerOff', setup).command).toBeUndefined()
    expect(problemOf('WorkerNotAdded', setup, 'The home is busy.').title).toBe('The home is busy.')
    expect(problemOf('WorkerNotAdded', setup).title).toBe('The home couldn’t sign the worker’s key.')
    expect(problemOf('Whatever', setup, 'it broke').body).toBe('it broke')
    expect(problemOf('Whatever', setup).body).toBeUndefined()
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
})

describe('a code’s way, as the dialog draws it', () => {
  it('gives its line and how long it lasts, says it is being made, or why the home made none', () => {
    const now = 1_000_000
    expect(codeView({ code: 'althar-worker1.e30', expiresAt: now + 600_000 }, null, now)).toEqual({
      command: `curl -fsSL ${WORKER_SCRIPT} | sh -s -- join 'althar-worker1.e30'`,
      lasts: '10 minutes',
    })
    expect(codeView({ code: 'c', expiresAt: now + 20_000 }, null, now).lasts).toBe('a minute')
    expect(codeView({ code: 'c', expiresAt: now }, null, now)).toEqual({ command: null, lasts: null })
    expect(codeView(null, null, now)).toEqual({ command: null, lasts: null })
    expect(codeView(null, 'The home is busy.', now)).toEqual({ command: null, lasts: null, failed: 'The home is busy.' })
  })
})
