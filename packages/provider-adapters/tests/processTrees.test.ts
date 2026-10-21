import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Scope } from 'effect'

import { AgentStartFailed } from '../src/errors'
import { compilerOf, KEEPER_SOURCE, keeperName } from '../src/keeper'
import { spawnOwned, stopProcessGroup } from '../src/process'
import { platformTrees, stopTree, unixTrees, type WindowsDependencies, windowsTrees } from '../src/processTrees'

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A Windows to stop trees on: each keeper and the job it holds, the kills it
 * was sent, and keepers that won't die. As on Windows, a job's processes go
 * with its keeper.
 */
const fakeWindows = (
  jobs: ReadonlyArray<{ readonly keeper: number; readonly members: ReadonlyArray<number> }>,
  options: { readonly stubborn?: ReadonlyArray<number>; readonly keeper?: Effect.Effect<string, string> } = {},
) => {
  const running = new Map(jobs.map((job) => [job.keeper, [...job.members]]))
  const killed: Array<number> = []
  const asked: Array<{ readonly keeper: string; readonly pid: number }> = []
  const dependencies: WindowsDependencies = {
    keeper: options.keeper ?? Effect.succeed('C:\\Temp\\althar\\keeper.exe'),
    startedAt: (keeper, pid) =>
      Effect.sync(() => {
        asked.push({ keeper, pid })
        return running.has(pid) ? '2026-10-19T10:00:00.000Z' : undefined
      }),
    exists: (path) => path !== 'C:\\Gone\\agent.exe' && !path.endsWith('\\gone.exe'),
    searched: () => ['C:\\Windows\\System32', 'C:\\Tools'],
    alive: (pid) => running.has(pid),
    kill: (pid) => {
      killed.push(pid)
      if (!options.stubborn?.includes(pid)) running.delete(pid)
    },
  }
  return { trees: windowsTrees(dependencies), running, killed, asked }
}

describe('a process tree on Windows', () => {
  it.live('is spawned under the keeper, with the command and its arguments as Node would quote them, and no console', () =>
    Effect.gen(function* () {
      const { trees } = fakeWindows([])
      assert.deepStrictEqual(yield* trees.launch('C:\\Program Files\\Althar\\node.exe', ['adapter.js', '--acp']), {
        command: 'C:\\Temp\\althar\\keeper.exe',
        args: ['run', 'C:\\Program Files\\Althar\\node.exe', 'adapter.js', '--acp'],
        detached: false,
      })
      assert.deepStrictEqual((yield* trees.launch('cmd.exe', ['/d', '/s', '/c', 'bun dev'])).args, [
        'run',
        'cmd.exe',
        '/d',
        '/s',
        '/c',
        'bun dev',
      ])
    }),
  )

  it.live('fails to start a command that isn’t there as Node would, the keeper unasked', () =>
    Effect.gen(function* () {
      let built = false
      const { trees } = fakeWindows([], { keeper: Effect.sync(() => (built = true)).pipe(Effect.as('keeper.exe')) })
      assert.strictEqual(yield* Effect.flip(trees.launch('C:\\Gone\\agent.exe', [])), 'spawn C:\\Gone\\agent.exe ENOENT')
      // Named bare, it is looked for as CreateProcess would, with `.exe` added.
      assert.strictEqual(yield* Effect.flip(trees.launch('gone', [])), 'spawn gone ENOENT')
      assert.isFalse(built)
    }),
  )

  it.live('fails to start anything where the keeper can’t be built, rather than run a tree it can’t stop', () =>
    Effect.gen(function* () {
      const { trees } = fakeWindows([], { keeper: Effect.fail('no compiler') })
      assert.strictEqual(yield* Effect.flip(trees.launch('C:\\Althar\\agent.exe', [])), 'no compiler')
    }),
  )

  it('can’t ask a tree to stop, and doesn’t outlive its keeper', () => {
    assert.isFalse(platformTrees('win32').asks)
    assert.isFalse(platformTrees('win32').outlivesRoot)
  })

  it.live('kills the keeper after the grace period, and with it its whole job, however its processes came and went', () =>
    Effect.gen(function* () {
      // The agent (101) started a shell (102) which started a server (103) and exited: the server is still the job's.
      const windows = fakeWindows([
        { keeper: 100, members: [101, 103] },
        { keeper: 200, members: [201] },
      ])
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis'), { signal: 'SIGKILL', survivors: false })
      assert.deepStrictEqual(windows.killed, [100])
      assert.deepStrictEqual([...windows.running.keys()], [200])
    }),
  )

  it.live('kills what the agent started after the agent exited: the keeper waits for the agent, then lets its job go', () =>
    Effect.gen(function* () {
      // An agent that started a server and exited at once: its keeper exits, and the job's processes go with it.
      const windows = fakeWindows([{ keeper: 100, members: [103] }])
      windows.running.delete(100)
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis'), { signal: 'none', survivors: false })
      assert.isFalse(windows.trees.outlivesRoot)
    }),
  )

  it.live('sends nothing to a tree that stops in the grace period, after the provider was asked to', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([{ keeper: 100, members: [101] }])
      setTimeout(() => windows.running.clear(), 30)
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '2 seconds'), { signal: 'none', survivors: false })
      assert.deepStrictEqual(windows.killed, [])
    }),
  )

  it.live('leaves a tree already gone alone', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([])
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis'), { signal: 'none', survivors: false })
      assert.deepStrictEqual(windows.killed, [])
    }),
  )

  it.live('says what outlived the kill', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([{ keeper: 100, members: [101] }], { stubborn: [100] })
      assert.deepStrictEqual(yield* stopTree(windows.trees, 100, '50 millis'), { signal: 'SIGKILL', survivors: true })
    }),
  )

  it.live('gives the start the keeper reads for a process, and none where the keeper can’t be built', () =>
    Effect.gen(function* () {
      const windows = fakeWindows([{ keeper: 100, members: [] }])
      assert.strictEqual(yield* windows.trees.startedAt(100), '2026-10-19T10:00:00.000Z')
      assert.isUndefined(yield* windows.trees.startedAt(999))
      assert.deepStrictEqual(windows.asked, [
        { keeper: 'C:\\Temp\\althar\\keeper.exe', pid: 100 },
        { keeper: 'C:\\Temp\\althar\\keeper.exe', pid: 999 },
      ])
      assert.isUndefined(yield* fakeWindows([{ keeper: 100, members: [] }], { keeper: Effect.fail('no compiler') }).trees.startedAt(100))
    }),
  )

  it('builds the keeper with the .NET Framework 4 compiler Windows has, 64-bit first, and names it by its source', () => {
    const env = { SystemRoot: 'C:\\Windows' }
    const at = (framework: string) => `C:\\Windows\\Microsoft.NET\\${framework}\\v4.0.30319\\csc.exe`
    assert.strictEqual(
      compilerOf(env, () => true),
      at('Framework64'),
    )
    assert.strictEqual(
      compilerOf(env, (path) => path === at('Framework')),
      at('Framework'),
    )
    assert.isUndefined(compilerOf(env, () => false))
    assert.match(keeperName, /^althar-keeper-[0-9a-f]{16}\.exe$/)
    // The job kills its processes once the keeper has gone and holds the command from its first instruction, which runs in a console
    // of its own whose window is hidden.
    for (const part of [
      'KillOnJobClose = 0x2000',
      'CreateSuspended | CreateNewConsole',
      'UseStdHandles | UseShowWindow',
      'wShowWindow = Hide',
      'AssignProcessToJobObject(job, started.hProcess)',
    ])
      assert.include(KEEPER_SOURCE, part)
  })

  // A shell script stands in for the keeper, which Windows can't run.
  it.skipIf(process.platform === 'win32')(
    'runs an agent under the keeper, with the keeper’s pid its own, and stops it by killing the keeper',
    () =>
      Effect.gen(function* () {
        // A keeper as far as Unix can stand in for one: it runs what follows `run`, and goes when killed.
        const folder = mkdtempSync(join(tmpdir(), 'althar-keeper-test-'))
        const keeper = join(folder, 'keeper')
        writeFileSync(keeper, '#!/bin/sh\n[ "$1" = run ] || exit 2\nshift\n"$@" &\ntrap \'kill $!; exit 1\' TERM\nwait $!\n')
        chmodSync(keeper, 0o755)
        const trees = windowsTrees({
          keeper: Effect.succeed(keeper),
          startedAt: () => Effect.succeed(undefined),
          exists: () => true,
          searched: () => [],
          alive: isAlive,
          kill: (pid) => process.kill(pid, 'SIGTERM'),
        })
        const scope = yield* Scope.make()
        const owned = yield* Scope.provide(scope)(
          spawnOwned({ command: '/bin/sh', args: ['-c', 'echo started; exec sleep 30'] }, '/tmp', { trees, grace: '50 millis' }),
        )
        const reader = owned.stdout.getReader()
        assert.strictEqual(new TextDecoder().decode((yield* Effect.promise(() => reader.read())).value), 'started\n')
        reader.releaseLock()
        assert.isTrue(isAlive(owned.pid))
        yield* Scope.close(scope, Exit.void)
        assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGKILL', survivors: false })
        assert.isFalse(isAlive(owned.pid))
      }),
  )

  it.live('fails to start an agent where the keeper can’t be built', () =>
    Effect.gen(function* () {
      const trees = fakeWindows([], { keeper: Effect.fail('no compiler') }).trees
      const error = yield* Effect.flip(Effect.scoped(spawnOwned({ command: '/bin/sh', args: [] }, '/tmp', { trees })))
      assert.instanceOf(error, AgentStartFailed)
      assert.strictEqual(error.reason, 'no compiler')
    }),
  )
})

describe('a process tree on macOS and Linux', () => {
  it.live('is the process group, spawned detached, which can be asked to stop and outlives its leader', () =>
    Effect.gen(function* () {
      assert.strictEqual(platformTrees('darwin'), unixTrees)
      assert.strictEqual(platformTrees('linux'), unixTrees)
      assert.deepStrictEqual(yield* unixTrees.launch('/bin/sh', ['-c', 'true']), {
        command: '/bin/sh',
        args: ['-c', 'true'],
        detached: true,
      })
      assert.isTrue(unixTrees.asks)
      assert.isTrue(unixTrees.outlivesRoot)
    }),
  )
})

/**
 * Starts a node that runs `code`, as a provider would start a tool: not asking
 * to be hidden. Detached, it outlives the node that started it, as what a
 * shell starts does; Node on Windows otherwise ends a child with its parent.
 */
const node = (code: string, detached = false) =>
  `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(code)}], { stdio: ['ignore', 'pipe', 'ignore'], detached: ${detached} })`

/** PowerShell saying whether it has a console window, and whether that window shows: `<handle> <visible>`. */
const consoleWindow = [
  'Add-Type -Name W -Namespace A -MemberDefinition',
  '\'[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr w);\';',
  '$w = [A.W]::GetConsoleWindow(); [Console]::Out.Write([string]$w + " " + [A.W]::IsWindowVisible($w))',
].join(' ')

describe.runIf(process.platform === 'win32')('a real process tree on Windows', () => {
  /** Spawns `code` as an agent, the way Althar does, and gives it with the first line it prints. */
  const started = (code: string) =>
    Effect.gen(function* () {
      const trees = platformTrees()
      const launch = yield* trees.launch(process.execPath, ['-e', code])
      const root = spawn(launch.command, [...launch.args], {
        detached: launch.detached,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
      const said = yield* Effect.promise(() => new Promise<string>((resolve) => root.stdout.once('data', (data) => resolve(String(data)))))
      return { trees, root: root.pid ?? 0, line: said.trim(), said: said.trim().split(' ').map(Number) }
    })

  it.live(
    'is gone, grandchildren and all, once stopped, though the parent between them has exited',
    () =>
      Effect.gen(function* () {
        // An agent starts a shell, which starts a server, says its pid and exits; the agent says both pids.
        const server = 'setInterval(() => {}, 1000)'
        const shell = `const s = ${node(server, true)}; s.unref(); process.stdout.write(s.pid + '\\n', () => process.exit(0))`
        const agent = `const c = ${node(shell)}; c.stdout.once('data', (d) => console.log(c.pid + ' ' + String(d).trim())); setInterval(() => {}, 1000)`
        const { trees, root, said } = yield* started(agent)
        const [shellPid = 0, serverPid = 0] = said
        yield* Effect.sleep('500 millis')
        assert.isFalse(isAlive(shellPid))
        assert.isTrue(isAlive(serverPid))
        assert.isString(yield* trees.startedAt(root))
        assert.deepStrictEqual(yield* stopProcessGroup(root, '200 millis'), { signal: 'SIGKILL', survivors: false })
        yield* Effect.sleep('200 millis')
        assert.isFalse(isAlive(serverPid))
      }),
    120_000,
  )

  it.live(
    'shares a hidden console with the console programs an agent starts, though they don’t ask to be hidden',
    () =>
      Effect.gen(function* () {
        // An agent starts PowerShell as a provider starts a tool, with Node's defaults, and says what PowerShell says of its window.
        const tool = `require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ${JSON.stringify(consoleWindow)}], { stdio: ['ignore', 'pipe', 'ignore'] })`
        const agent = `const t = ${tool}; let said = ''; t.stdout.on('data', (d) => (said += d)); t.on('exit', () => console.log(said.trim())); setInterval(() => {}, 1000)`
        const { root, line } = yield* started(agent)
        const [handle, visible] = line.split(' ')
        assert.notStrictEqual(handle, '0')
        assert.strictEqual(visible, 'False')
        assert.deepStrictEqual(yield* stopProcessGroup(root, '200 millis'), { signal: 'SIGKILL', survivors: false })
      }),
    120_000,
  )

  it.live(
    'takes what an agent started with it when the agent exits at once',
    () =>
      Effect.gen(function* () {
        // A launcher that starts the real agent, says its pid and exits before anything could have been listed.
        const server = 'setInterval(() => {}, 1000)'
        const launcher = `const s = ${node(server)}; s.unref(); process.stdout.write(s.pid + '\\n', () => process.exit(0))`
        const { root, said } = yield* started(launcher)
        const [serverPid = 0] = said
        yield* Effect.sleep('1 second')
        assert.isFalse(isAlive(root))
        assert.isFalse(isAlive(serverPid))
      }),
    120_000,
  )
})
