import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { waitFor } from '@althar/testing'
import { describe, expect, it } from 'vitest'

import { type Command, startApart, startHere } from '../src/spawner'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    // An orphan reaped by the test container's init may remain a zombie briefly; it no longer runs.
    return (
      process.platform !== 'linux' ||
      readFileSync(`/proc/${pid}/stat`, 'utf8')
        .replace(/^.*\) /, '')
        .split(' ')[0] !== 'Z'
    )
  } catch {
    return false
  }
}

const stopChild = (pid: number) => {
  try {
    if (alive(pid)) process.kill(pid)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

describe.each([
  ['runner thread', (command: Command) => startApart(command, 1)],
  ['current thread', startHere],
] as const)('inherited output on the %s', (_name, start) => {
  it('releases a cancelled command after its root exits, even while a descendant holds its output', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-inherited-pipe-'))
    const mark = join(folder, 'pids')
    const gate = join(folder, 'open')
    const held = `const fs = require('node:fs'); const timer = setInterval(() => fs.existsSync(${JSON.stringify(gate)}) && (clearInterval(timer), process.exit(0)), 20); process.send('ready')`
    // A detached child can outlive its parent on Windows too. Its IPC receipt proves it really holds the inherited pipes.
    const command = `const fs = require('node:fs'); const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(held)}], { detached: true, windowsHide: true, stdio: ['ignore', 1, 2, 'ipc'] }); child.once('message', () => { fs.writeFileSync(${JSON.stringify(mark)}, JSON.stringify({ root: process.pid, child: child.pid })); child.disconnect(); child.unref(); process.exit(0) }); child.once('error', error => { fs.writeFileSync(${JSON.stringify(mark)}, JSON.stringify({ error: error.message })); process.exit(1) })`
    let child: number | undefined
    const running = start({ command: process.execPath, args: ['-e', command], env: process.env, detached: false, max: 1_024 })
    try {
      await waitFor(() => existsSync(mark), Boolean)
      const pids = JSON.parse(readFileSync(mark, 'utf8')) as { root: number; child: number; error?: string }
      expect(pids.error).toBeUndefined()
      child = pids.child
      await waitFor(() => !alive(pids.root), Boolean)
      expect(alive(pids.child)).toBe(true)
      let ended = false
      void running.result.then(() => (ended = true))
      await Promise.resolve()
      expect(ended).toBe(false)
      running.stop()
      const result = await running.result
      expect(result.error).toBeNull()
      expect(result.code).toBe(0)
      // The next command can use the lane without opening the descendant's gate.
      const next = await start({
        command: process.execPath,
        args: ['-e', "process.stdout.write('next')"],
        env: process.env,
        detached: false,
        max: 1_024,
      }).result
      expect(next.stdout).toBe('next')
    } finally {
      writeFileSync(gate, '')
      running.stop()
      if (child !== undefined) {
        stopChild(child)
        await waitFor(() => !alive(child!), Boolean)
      }
      await running.result
    }
  })
})
