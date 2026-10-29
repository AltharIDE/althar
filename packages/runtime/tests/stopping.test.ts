import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'

import { stopProcesses } from '../src/stopping'
import { until } from './support'

/*
 * Stopping a process Althar doesn't run itself stops its whole group: a
 * process asked to stop that starts another as it goes, in its group, and
 * ends, leaves that one to be killed with the group, not running on.
 */

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform === 'win32')('stopping a process', () => {
  it.live(
    'kills the group it led, though it ended as it was asked to stop and left another in it',
    () =>
      Effect.gen(function* () {
        const pidFile = join(mkdtempSync(join(tmpdir(), 'althar-stopping-')), 'replacement')
        // Asked to stop, it starts one that won't stop when asked, in its own group, says which, and ends.
        const replacement = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`
        const leader = spawn(
          process.execPath,
          [
            '-e',
            `process.on('SIGTERM', () => {
              const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(replacement)}], { stdio: 'ignore' })
              require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
              setTimeout(() => process.exit(0), 100)
            }); setInterval(() => {}, 1000)`,
          ],
          { detached: true, stdio: 'ignore' },
        )
        const pid = leader.pid ?? 0
        // Wait until it listens for being asked to stop.
        yield* Effect.sleep(Duration.millis(500))
        const outlived = yield* stopProcesses([pid], Duration.seconds(1))
        assert.deepStrictEqual(outlived, [])
        const started = Number(readFileSync(pidFile, 'utf8'))
        assert.isAbove(started, 0)
        assert.isFalse(alive(pid))
        yield* until(
          Effect.sync(() => (alive(started) ? [started] : [])),
          (left) => left.length === 0,
          Duration.seconds(2),
        )
      }),
    20_000,
  )
})
