import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path/posix'

import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit } from 'effect'

import { spawnOwned, workerOwner } from '../src/process'
import { scheduledUnixTrees, unixTrees, windowsTrees } from '../src/processTrees'
import { type GroupFiles, linuxGroups } from '../src/resourceGroups'

/** A cgroup filesystem: control files are virtual, so an empty group can be removed without unlinking them. */
const filesystem = (options: { denied?: boolean; controllers?: string; member?: string; failWeight?: boolean } = {}) => {
  const dirs = new Set(['/delegated'])
  const values = new Map<string, string>([
    ['/membership', options.member ?? '0::/delegated/runtime'],
    ['/delegated/cgroup.controllers', options.controllers ?? 'cpu memory pids'],
  ])
  const writes: Array<[string, string]> = []
  const removed: Array<string> = []
  const files: GroupFiles = {
    read: async (path) => values.get(path) ?? '',
    writable: async () => {
      if (options.denied) throw new Error('EACCES')
    },
    make: async (path) => {
      if (!dirs.has(dirname(path)) || dirs.has(path)) throw new Error('Cannot create group')
      dirs.add(path)
    },
    write: async (path, value) => {
      if (options.failWeight && path.endsWith('/cpu.weight')) throw new Error('EPERM')
      assert.isTrue(dirs.has(dirname(path)), path)
      writes.push([path, value])
      values.set(path, value)
    },
    remove: async (path) => {
      if ([...dirs].some((one) => one !== path && dirname(one) === path)) throw new Error('EBUSY')
      dirs.delete(path)
      removed.push(path)
    },
  }
  return { files, writes, removed, dirs }
}

describe('work-conserving resource groups', () => {
  it.each([false, true])('rechecks teardown during a pending acquisition (yield before release: %s)', async (pause) => {
    const fs = filesystem()
    const write = fs.files.write.bind(fs.files)
    let unblock: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      unblock = resolve
    })
    fs.files.write = async (path, value) => {
      if (path.endsWith('/worker/cgroup.kill')) await held
      await write(path, value)
    }
    const groups = linuxGroups({ parent: '/delegated', files: fs.files })
    const first = await groups.acquire('worker')
    // The acquisition yields before the old command begins teardown.
    const next = groups.acquire('worker')
    if (pause) await Promise.resolve()
    const closing = first?.release()
    const other = await groups.acquire('another-worker')
    unblock()
    await closing
    const replacement = await next
    assert.isDefined(replacement)
    assert.isTrue(fs.dirs.has(replacement?.path ?? ''))
    await replacement?.release()
    await other?.release()
    assert.deepStrictEqual([...fs.dirs], ['/delegated'])
  })
  it('waits for teardown before reacquiring the same worker and protects other pending acquisitions', async () => {
    const fs = filesystem()
    const write = fs.files.write.bind(fs.files)
    let unblock: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      unblock = resolve
    })
    let tearingDown: () => void = () => {}
    const entered = new Promise<void>((resolve) => {
      tearingDown = resolve
    })
    fs.files.write = async (path, value) => {
      if (path.endsWith('/worker/cgroup.kill')) {
        tearingDown()
        await held
      }
      await write(path, value)
    }
    const groups = linuxGroups({ parent: '/delegated', files: fs.files })
    const first = await groups.acquire('worker')
    const closing = first?.release()
    await entered
    const next = groups.acquire('worker')
    const other = await groups.acquire('another-worker')
    unblock()
    await closing
    const replacement = await next
    assert.isDefined(replacement)
    assert.isTrue(fs.dirs.has(other?.path ?? ''), 'old teardown leaves the other worker alone')
    assert.isTrue(fs.dirs.has(replacement?.path ?? ''))
    await replacement?.release()
    await other?.release()
    assert.deepStrictEqual([...fs.dirs], ['/delegated'])
  })
  it('shares one allocation between concurrent commands of a worker, gives other workers equal weight, and releases after the last command', async () => {
    const fs = filesystem()
    const groups = linuxGroups({ parent: '/delegated', files: fs.files })
    const [a, again, b] = await Promise.all([groups.acquire('worker-a'), groups.acquire('worker-a'), groups.acquire('worker-b')])
    assert.isDefined(a)
    assert.strictEqual(a?.path, again?.path)
    assert.notStrictEqual(a?.path, b?.path)
    assert.deepStrictEqual(
      fs.writes.filter(([path]) => path.endsWith('/cpu.weight')).map(([, weight]) => weight),
      ['10', '100', '100'],
    )
    await a?.release()
    await a?.release()
    assert.isFalse(fs.writes.some(([path]) => path === `${a?.path}/cgroup.kill`))
    await again?.release()
    assert.isTrue(fs.writes.some(([path, value]) => path === `${a?.path}/cgroup.kill` && value === '1'))
    assert.isTrue(fs.dirs.has(b?.path ?? ''))
    await b?.release()
    assert.deepStrictEqual([...fs.dirs], ['/delegated'])
    const next = await groups.acquire('worker-a')
    assert.isDefined(next)
    assert.notStrictEqual(next?.path, a?.path, 'a completed generation cannot kill a new worker')
    await next?.release()
  })

  it('finds the delegated parent without moving existing processes', async () => {
    const fs = filesystem()
    const groups = linuxGroups({ mount: '/', membership: '/membership', files: fs.files })
    const worker = await groups.acquire('worker')
    assert.isDefined(worker)
    assert.isFalse(fs.writes.some(([path]) => path.endsWith('/cgroup.procs')))
    await worker?.release()
  })

  it('falls back for denied delegation, unavailable controllers, malformed membership and partial setup failures', async () => {
    for (const options of [{ denied: true }, { controllers: 'memory pids' }, { member: '0::/../../escape' }, { failWeight: true }]) {
      const fs = filesystem(options)
      const groups = linuxGroups({
        mount: '/sys/fs/cgroup',
        membership: '/membership',
        files: fs.files,
        ...(options.member === undefined ? { parent: '/delegated' } : {}),
      })
      assert.isUndefined(await groups.acquire('worker'))
    }
    const fs = filesystem()
    assert.isUndefined(await linuxGroups({ parent: '/delegated', files: fs.files }).acquire('../escape'))
    assert.strictEqual(fs.writes.length, 0)
  })

  it('uses a stable identity across native commands without sharing unrelated workers or anonymous launches', () => {
    assert.strictEqual(workerOwner({ ALTHAR_WORKER: 'a' }), workerOwner({ ALTHAR_WORKER: 'a' }))
    assert.notStrictEqual(workerOwner({ ALTHAR_WORKER: 'a' }), workerOwner({ ALTHAR_WORKER: 'b' }))
    assert.notStrictEqual(workerOwner({}), workerOwner({}))
    assert.match(workerOwner({ ALTHAR_WORKER: '../../$(a)' }), /^[a-f0-9]{32}$/)
  })
})

const here = mkdtempSync(join(tmpdir(), 'althar-resource-launch-'))

describe('optional Unix scheduling', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    it.live.skipIf(process.platform === 'win32')(`keeps missing-command start failures with ${platform} scheduling`, () =>
      Effect.gen(function* () {
        const trees = scheduledUnixTrees(platform, {
          acquire: async () => {
            throw new Error('No allocation should be acquired for a missing command')
          },
        })
        for (const command of ['althar-resource-no-such-command', '/definitely/missing/althar-worker', '.']) {
          const result = yield* Effect.scoped(spawnOwned({ command, args: [] }, here, { background: true, trees })).pipe(Effect.exit)
          assert.isTrue(Exit.isFailure(result), command)
        }
      }),
    )
    it.live.skipIf(process.platform === 'win32')(
      `preserves arguments, PID, stdin and protocol output with ${platform} scheduling and failed optional controls`,
      () =>
        Effect.gen(function* () {
          let released = 0
          yield* Effect.scoped(
            Effect.gen(function* () {
              const trees = scheduledUnixTrees(platform, {
                acquire: async () => ({
                  path: '/not/a/writable/cgroup',
                  release: async () => {
                    released++
                  },
                }),
              })
              const arg = 'a space; $(touch forbidden) "quoted"'
              const processCode =
                "let input=''; process.stdin.on('data', d => input+=d); process.stdin.on('end', () => console.log(JSON.stringify({pid:process.pid,arg:process.argv[1],input})))"
              const owned = yield* spawnOwned({ command: process.execPath, args: ['-e', processCode, arg] }, here, {
                background: true,
                trees,
              })
              const writer = owned.stdin.getWriter()
              yield* Effect.promise(() => writer.write(new TextEncoder().encode('protocol input')).then(() => writer.close()))
              const text = yield* Effect.promise(() => new Response(owned.stdout).text())
              assert.deepStrictEqual(JSON.parse(text), { pid: owned.pid, arg, input: 'protocol input' })
              assert.strictEqual((yield* Deferred.await(owned.exited)).code, 0)
              // Resource cleanup is registered on the owned scope, not on a provider's claim that its tool ended.
              assert.strictEqual(released, 0)
            }),
          )
          assert.strictEqual(released, platform === 'linux' ? 1 : 0)
        }),
    )
  }

  it.live.skipIf(process.platform === 'win32')(
    'falls back when preparing scheduling fails, and releases allocations when spawn fails',
    () =>
      Effect.gen(function* () {
        const fallback = scheduledUnixTrees('linux', {
          acquire: async () => {
            throw new Error('denied')
          },
        })
        assert.deepStrictEqual(yield* fallback.launch('node', ['x'], { background: true }), yield* unixTrees.launch('node', ['x']))
        let released = 0
        const result = yield* Effect.scoped(
          spawnOwned({ command: '/definitely/missing/althar-worker', args: [] }, here, {
            background: true,
            trees: {
              ...unixTrees,
              launch: () =>
                Effect.succeed({
                  command: '/definitely/missing/althar-worker',
                  args: [],
                  detached: true,
                  release: Effect.sync(() => {
                    released++
                  }),
                }),
            },
          }),
        ).pipe(Effect.exit)
        assert.isTrue(Exit.isFailure(result))
        assert.strictEqual(released, 1)
      }),
  )

  it.live('asks the Windows keeper for background scheduling using a launcher-owned key', () =>
    Effect.gen(function* () {
      const trees = windowsTrees({
        keeper: Effect.succeed('keeper.exe'),
        startedAt: () => Effect.succeed(undefined),
        exists: () => true,
        searched: () => [],
        alive: () => false,
        kill: () => {},
      })
      assert.deepStrictEqual(yield* trees.launch('C:\\Tools\\node.exe', ['a b'], { background: true, owner: 'worker-a' }), {
        command: 'keeper.exe',
        args: ['background-worker-a', 'C:\\Tools\\node.exe', 'a b'],
        detached: false,
      })
    }),
  )
})
