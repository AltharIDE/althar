import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { expect, it, vi } from 'vitest'

import { startHere } from '../src/spawner'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

it.each(['gone', 'running', 'denied', 'recorded'] as const)(
  'cancels Windows inherited pipes with the root %s, preserving an exit the OS already knows',
  async (state) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      exitCode: state === 'recorded' ? 0 : null,
      signalCode: null as string | null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        child.signalCode = 'SIGTERM'
        child.emit('exit', null, 'SIGTERM')
        return true
      }),
    })
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>)
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      if (state === 'gone' || state === 'denied') throw Object.assign(new Error(state), { code: state === 'gone' ? 'ESRCH' : 'EPERM' })
      return true
    })
    let running: ReturnType<typeof startHere>
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      running = startHere({ command: 'command', args: [], env: {}, detached: false, max: 1024 })
      running.stop()
      expect(child.kill).toHaveBeenCalledTimes(state === 'gone' || state === 'recorded' ? 0 : 1)
      // Node's exit callback catches up after cancellation. A descendant still owns the write ends.
      child.exitCode = child.signalCode === null ? 0 : null
      child.emit('exit', child.exitCode, child.signalCode)
      expect(child.stdout.destroyed).toBe(true)
      expect(child.stderr.destroyed).toBe(true)
      child.emit('close', child.exitCode, child.signalCode)
    } finally {
      Object.defineProperty(process, 'platform', platform)
      probe.mockRestore()
    }
    await expect(running.result).resolves.toMatchObject({ code: state === 'gone' || state === 'recorded' ? 0 : null, error: null })
  },
)
