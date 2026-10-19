import { spawn } from 'node:child_process'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { stopProcessGroup } from '../src/process'
import { type Listed, listingOf, platformTrees, stopTree, treeOf, unixTrees, windowsTrees } from '../src/processTrees'

const at = (second: number) => new Date(Date.UTC(2026, 9, 19, 10, 0, second)).toISOString()
const listed = (pid: number, parent: number, second: number): Listed => ({ pid, parent, startedAt: at(second) })
const pids = (tree: ReadonlyArray<Listed>) => tree.map((member) => member.pid).toSorted((a, b) => a - b)

/** A Windows to stop trees on: its processes, the kills it was sent, and those that don't die. */
const fakeWindows = (processes: ReadonlyArray<Listed>, options: { readonly stubborn?: ReadonlyArray<number> } = {}) => {
  const running = new Map(processes.map((process) => [process.pid, process]))
  const killed: Array<number> = []
  const trees = windowsTrees({
    list: Effect.sync(() => [...running.values()]),
    kill: (pid) => {
      killed.push(pid)
      if (!options.stubborn?.includes(pid)) running.delete(pid)
    },
  })
  return { trees, running, killed }
}

describe('a process tree on Windows', () => {
  const agent = listed(100, 4, 10)

  it('is the agent and everything it started, however deep', () => {
    const listing = [listed(4, 0, 0), agent, listed(101, 100, 11), listed(102, 101, 12), listed(103, 102, 13), listed(200, 4, 14)]
    assert.deepStrictEqual(pids(treeOf(listing, 100, agent.startedAt)), [100, 101, 102, 103])
  })

  it('leaves out a process that names a parent which started after it: the pid it names was another process’s', () => {
    const listing = [agent, listed(101, 100, 11), listed(300, 100, 5)]
    assert.deepStrictEqual(pids(treeOf(listing, 100, agent.startedAt)), [100, 101])
  })

  it('still has what the agent started after the agent has exited', () => {
    const listing = [listed(101, 100, 11), listed(102, 101, 12)]
    assert.deepStrictEqual(pids(treeOf(listing, 100, agent.startedAt)), [101, 102])
  })

  it('takes no child of a gone agent whose start wasn’t recorded, as nothing says it was the agent’s', () => {
    assert.deepStrictEqual(treeOf([listed(101, 100, 11)], 100), [])
  })

  it('leaves out a later process given the agent’s pid, and what that one started', () => {
    const listing = [listed(100, 4, 20), listed(101, 100, 11), listed(105, 100, 21)]
    assert.deepStrictEqual(pids(treeOf(listing, 100, agent.startedAt)), [101])
  })

  it('reads PowerShell’s listing, a line it can’t read left out', () => {
    assert.deepStrictEqual(listingOf(`100 4 ${at(10)}\r\n\r\nWARNING: something\r\n101 100 2026-10-19T10:00:11.250Z\r\n`), [
      agent,
      { pid: 101, parent: 100, startedAt: '2026-10-19T10:00:11.250Z' },
    ])
  })

  it('spawns the agent sharing a console with what it starts, as a detached one has none and each child would open its own', () => {
    assert.isFalse(windowsTrees().spawn.detached)
    assert.strictEqual(platformTrees('win32').spawn.detached, false)
    assert.isFalse(platformTrees('win32').asks)
  })

  it.live('kills the whole tree after the grace period, the leaves first, and nothing else', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([listed(4, 0, 0), agent, listed(101, 100, 11), listed(102, 101, 12), listed(200, 4, 14)])
      const report = yield* stopTree(windows.trees, 100, '50 millis', agent.startedAt)
      assert.deepStrictEqual(report, { signal: 'SIGKILL', survivors: false })
      assert.deepStrictEqual(windows.killed, [102, 101, 100])
      assert.deepStrictEqual([...windows.running.keys()], [4, 200])
    }),
  )

  it.live('kills what the agent left running after it exited', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([listed(101, 100, 11), listed(102, 101, 12)])
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis', agent.startedAt), { signal: 'SIGKILL', survivors: false })
      assert.strictEqual(windows.running.size, 0)
    }),
  )

  it.live('sends nothing to a tree that stops in the grace period, after the provider was asked to', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([agent, listed(101, 100, 11)])
      setTimeout(() => windows.running.clear(), 30)
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '2 seconds', agent.startedAt), { signal: 'none', survivors: false })
      assert.deepStrictEqual(windows.killed, [])
    }),
  )

  it.live('leaves a tree already gone alone', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([listed(4, 0, 0)])
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis', agent.startedAt), { signal: 'none', survivors: false })
      assert.deepStrictEqual(windows.killed, [])
    }),
  )

  it.live('says what outlived the kill', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([agent, listed(101, 100, 11)], { stubborn: [101] })
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis', agent.startedAt), { signal: 'SIGKILL', survivors: true })
      assert.deepStrictEqual([...windows.running.keys()], [101])
    }),
  )

  it.live('gives the start it records for the process, from the listing', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([agent])
      assert.strictEqual(yield* windows.trees.startedAt(100), agent.startedAt)
      assert.isUndefined(yield* windows.trees.startedAt(999))
    }),
  )
})

describe('a process tree on macOS and Linux', () => {
  it('is the process group, spawned detached, which can be asked to stop', () => {
    assert.strictEqual(platformTrees('darwin'), unixTrees)
    assert.strictEqual(platformTrees('linux'), unixTrees)
    assert.isTrue(unixTrees.spawn.detached)
    assert.isTrue(unixTrees.asks)
  })
})

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.runIf(process.platform === 'win32')('a real process tree on Windows', () => {
  it.live(
    'is gone, grandchildren and all, once stopped',
    () =>
      Effect.gen(function* () {
        // An agent that starts a child, which starts a grandchild, and says their pids.
        const grandchild = 'setInterval(() => {}, 1000)'
        const child = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore', windowsHide: true }); console.log(c.pid); setInterval(() => {}, 1000)`
        const agent = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); c.stdout.once('data', (d) => console.log(c.pid + ' ' + String(d).trim())); setInterval(() => {}, 1000)`
        const trees = platformTrees()
        const root = spawn(process.execPath, ['-e', agent], {
          detached: trees.spawn.detached,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        const said = yield* Effect.promise(
          () => new Promise<string>((resolve) => root.stdout.once('data', (data) => resolve(String(data)))),
        )
        const tree = [root.pid ?? 0, ...said.trim().split(' ').map(Number)]
        assert.isTrue(tree.every(isAlive))
        const report = yield* stopProcessGroup(root.pid ?? 0, '200 millis', yield* trees.startedAt(root.pid ?? 0))
        assert.deepStrictEqual(report, { signal: 'SIGKILL', survivors: false })
        assert.isTrue(tree.every((pid) => !isAlive(pid)))
      }),
    60_000,
  )
})
