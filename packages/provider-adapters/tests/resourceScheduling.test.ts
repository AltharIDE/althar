import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { getPriority, setPriority, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { waitFor } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { keeper } from '../src/keeper'
import { BACKGROUND, spawnOwned, type OwnedProcess, workerOwner } from '../src/process'

const here = mkdtempSync(join(tmpdir(), 'althar-native-resources-'))
const canPrioritize = (() => {
  try {
    setPriority(0, getPriority())
    return true
  } catch {
    return false
  }
})()
const cgroup = "process.platform==='linux' ? require('node:fs').readFileSync('/proc/self/cgroup','utf8') : null"
const child = `console.log(JSON.stringify({pid:process.pid,priority:require('node:os').getPriority(),group:${cgroup}})); setInterval(()=>{},1000)`
const root = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore','pipe','inherit']}); let line=''; child.stdout.on('data',d=>{line+=d; if(line.includes('\\n')) {console.log(JSON.stringify({pid:process.pid,priority:require('node:os').getPriority(),group:${cgroup},child:JSON.parse(line.trim())}));child.stdout.removeAllListeners('data')}}); setInterval(()=>{},1000)`
interface Snapshot {
  pid: number
  priority: number
  group: string | null
  child: { pid: number; priority: number; group: string | null }
}
const firstLine = (owned: OwnedProcess) =>
  Effect.tryPromise(async () => {
    const reader = owned.stdout.getReader()
    let text = ''
    try {
      while (!text.includes('\n')) {
        const next = await reader.read()
        if (next.done) throw new Error(`Worker ended before reporting: ${owned.stderrTail()}`)
        text += new TextDecoder().decode(next.value)
      }
      return JSON.parse(text.trim()) as Snapshot
    } finally {
      reader.releaseLock()
    }
  })
const running = (pid: number) => {
  try {
    process.kill(pid, 0)
    if (process.platform === 'linux') return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z ') !== true
    return true
  } catch {
    return false
  }
}

describe('native worker resource scheduling', () => {
  it.live('keeps complete process families in the background, shares a worker allocation, and cleans up every child', () =>
    Effect.gen(function* () {
      const pids: number[] = []
      const paths = new Set<string>()
      yield* Effect.scoped(
        Effect.gen(function* () {
          const a = { ALTHAR_WORKER: `a-${process.pid}` }
          const b = { ALTHAR_WORKER: `b-${process.pid}` }
          const snapshots: Snapshot[] = []
          for (const env of [a, a, b]) {
            const owned = yield* spawnOwned({ command: process.execPath, args: ['-e', root], env }, here, { background: true })
            const snapshot = yield* firstLine(owned)
            pids.push(snapshot.pid, snapshot.child.pid)
            snapshots.push(snapshot)
            if (process.platform !== 'win32')
              assert.strictEqual(snapshot.pid, owned.pid, 'the Unix wrapper execs the actual worker in place')
            if (canPrioritize || process.platform === 'win32') {
              assert.strictEqual(snapshot.priority, BACKGROUND)
              assert.strictEqual(snapshot.child.priority, BACKGROUND)
            }
          }
          if (process.platform === 'linux' && process.env.ALTHAR_TEST_CGROUP_ROOT !== undefined) {
            assert.strictEqual(snapshots[0]?.group, snapshots[1]?.group, 'native commands of one worker share CPU weight')
            assert.notStrictEqual(snapshots[0]?.group, snapshots[2]?.group)
            for (const [index, snapshot] of snapshots.entries()) {
              assert.strictEqual(snapshot.group, snapshot.child.group, 'unknown child tools inherit membership')
              const member = /^0::(.*)$/m.exec(snapshot.group ?? '')?.[1]
              assert.isDefined(member)
              const path = join('/sys/fs/cgroup', `.${member}`)
              paths.add(path)
              assert.strictEqual(path.split('/').at(-1), workerOwner(index === 2 ? b : a))
              assert.strictEqual(readFileSync(join(path, 'cpu.weight'), 'utf8').trim(), '100')
              assert.strictEqual(readFileSync(join(dirname(path), 'cpu.weight'), 'utf8').trim(), '10')
            }
            process.stdout.write('Verified delegated Linux CPU groups, shared native-worker ownership and descendant inheritance.\n')
          }
          if (process.platform === 'win32') {
            const path = yield* keeper()
            const query = () => {
              try {
                return JSON.parse(
                  execFileSync(path, ['resources', workerOwner(a)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
                ) as { weight: number; processes: number }
              } catch {
                return null
              }
            }
            const current = query()
            if (current !== null && current.processes > 0) {
              const measured = yield* Effect.promise(() => waitFor(query, (value) => value !== null && value.processes >= 4))
              assert.strictEqual(measured?.weight, 1)
              process.stdout.write('Verified Windows shared CPU-weight job and child accounting.\n')
            } else
              process.stdout.write('Optional Windows CPU-weight nesting unavailable; verified inherited background-priority fallback.\n')
          }
        }),
      )
      yield* Effect.promise(() =>
        waitFor(
          () => pids.filter(running),
          (live) => live.length === 0,
        ),
      )
      for (const path of paths) assert.isFalse(existsSync(path), 'the final owned command releases its scheduling group')
    }),
  )
})
