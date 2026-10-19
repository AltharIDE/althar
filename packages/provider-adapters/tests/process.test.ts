import { existsSync, mkdtempSync, readdirSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Scope, Stream } from 'effect'

import { connect } from '../src/AgentConnection'
import { AgentExited, AgentStartFailed } from '../src/errors'
import { adapterNode, asNode, type CapturedFrame, childEnvironment, environmentDigest, spawnOwned } from '../src/process'
import { agents } from '../src/registry'
import { fakeAgentMain, scenarios } from '../src/testing'
import { text } from './contract'

const fakeProcess = { _tag: 'Process' as const, spec: { command: 'bun', args: [fakeAgentMain] }, cwd: '/tmp' }
const reject = () => Effect.succeed({ decision: 'reject' as const })

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether a process is gone within a second: one Althar did not start is reaped by the OS, in its own time. */
const goneSoon = (pid: number) =>
  Effect.gen(function* () {
    for (let waited = 0; isAlive(pid) && waited < 1_000; waited += 25) yield* Effect.sleep('25 millis')
    return !isAlive(pid)
  })

describe('the process transport', () => {
  it.live('runs a turn with the agent as a process it owns, and records what it started', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect({ transport: fakeProcess, onPermission: reject })
        assert.isAbove(connection.process?.pid ?? 0, 0)
        assert.match(connection.process?.environmentDigest ?? '', /^[0-9a-f]{64}$/)
        assert.isFalse(Number.isNaN(Date.parse(connection.process?.osStartedAt ?? '')))
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
      }),
    ),
  )

  it.live('captures the raw protocol in both directions, in order', () =>
    Effect.gen(function* () {
      const frames: Array<CapturedFrame> = []
      yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connect({ transport: { ...fakeProcess, capture: (frame) => frames.push(frame) }, onPermission: reject })
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          yield* Stream.runCollect(session.prompt(scenarios.hello))
        }),
      )
      assert.deepStrictEqual(
        frames.map((frame) => frame.sequence),
        frames.map((_, index) => index + 1),
      )
      const decoded = frames.map((frame) => [frame.direction, new TextDecoder().decode(frame.bytes)] as const)
      assert.isTrue(decoded[0]?.[0] === 'to_agent' && decoded[0][1].includes('"initialize"'))
      assert.isTrue(decoded.some(([direction, body]) => direction === 'from_agent' && body.includes('agent_message_chunk')))
    }),
  )

  it.live('says the agent has gone when its process exits mid-turn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect({ transport: fakeProcess, onPermission: reject })
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        const error = yield* Effect.flip(Stream.runCollect(session.prompt(scenarios.exit)))
        assert.instanceOf(error, AgentExited)
        assert.strictEqual((error as AgentExited).code, 3)
        assert.deepStrictEqual(yield* connection.closed, { code: 3, signal: null })
      }),
    ),
  )

  it.live('keeps a question waiting when the agent that asked it goes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>()
        const answered = yield* Deferred.make<void>()
        let dropped = false
        const connection = yield* connect({
          transport: fakeProcess,
          onPermission: reject,
          onQuestion: () =>
            Deferred.succeed(asked, undefined).pipe(
              Effect.andThen(Deferred.await(answered)),
              Effect.as({ action: 'cancel' as const }),
              Effect.onInterrupt(() => Effect.sync(() => (dropped = true))),
            ),
        })
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        const turn = yield* Effect.forkChild(Effect.flip(Stream.runCollect(session.prompt(scenarios.question))))
        yield* Deferred.await(asked)
        process.kill(connection.process?.pid ?? 0, 'SIGKILL')
        assert.instanceOf(yield* Fiber.join(turn), AgentExited)
        yield* connection.closed
        yield* Effect.sleep('50 millis')
        // Its going is not its taking the question back: whoever asked through Althar lets it go.
        assert.isFalse(dropped)
        yield* Deferred.succeed(answered, undefined)
      }),
    ),
  )

  it.live('stops the whole process group when the scope closes, and says how', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const connection = yield* Scope.provide(scope)(connect({ transport: fakeProcess, onPermission: reject }))
      const pid = connection.process?.pid ?? 0
      assert.isTrue(isAlive(pid))
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(pid))
      assert.deepStrictEqual(yield* connection.process?.stopped ?? Effect.die('no process'), { signal: 'SIGTERM', survivors: false })
    }),
  )

  it.live('keeps what a process printed though it exited before it was read, every time', () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (let n = 0; n < 20; n += 1) {
          const owned = yield* spawnOwned({ command: '/bin/sh', args: ['-c', 'echo done; exit 3'] }, '/tmp')
          assert.strictEqual((yield* Deferred.await(owned.exited)).code, 3)
          const printed = yield* Effect.promise(() => new Response(owned.stdout).text())
          assert.strictEqual(printed, 'done\n')
        }
      }),
    ),
  )

  it.live('gives a process that asks a temporary folder of its own, and removes it once it has stopped', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(
        spawnOwned(
          { command: '/bin/sh', args: ['-c', 'echo "$TMPDIR $TEMP $TMP" >&2; touch "$TMPDIR/unpacked"; sleep 30'], privateTemp: true },
          '/tmp',
        ),
      )
      const temp = owned.temp ?? ''
      assert.match(temp, /althar-agent-/)
      for (let waited = 0; !existsSync(join(temp, 'unpacked')) && waited < 2_000; waited += 25) yield* Effect.sleep('25 millis')
      assert.strictEqual(owned.stderrTail().trim(), `${temp} ${temp} ${temp}`)
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(existsSync(temp))
      // One that doesn't ask shares Althar's.
      const shared = yield* Effect.scoped(spawnOwned({ command: '/bin/sh', args: ['-c', 'exit 0'] }, '/tmp'))
      assert.isUndefined(shared.temp)
    }),
  )

  it.live('removes the temporary folder of a command that never started', () =>
    Effect.gen(function* () {
      const before = readdirSync(tmpdir()).filter((name) => name.startsWith('althar-agent-')).length
      yield* Effect.flip(Effect.scoped(spawnOwned({ command: 'althar-no-such-agent', args: [], privateTemp: true }, '/tmp')))
      assert.isAtMost(readdirSync(tmpdir()).filter((name) => name.startsWith('althar-agent-')).length, before)
    }),
  )

  it.live('fails to start a command that does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const error = yield* Effect.flip(spawnOwned({ command: 'althar-no-such-agent', args: [] }, '/tmp'))
        assert.instanceOf(error, AgentStartFailed)
      }),
    ),
  )

  it.live('kills a process that ignores TERM once the grace period ends', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(
        spawnOwned({ command: 'bun', args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"] }, '/tmp', {
          grace: '200 millis',
        }),
      )
      yield* Effect.sleep('300 millis')
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(owned.pid))
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGKILL', survivors: false })
      assert.strictEqual(owned.stderrTail(), '')
    }),
  )

  it.live('stops what an agent left running after it exited', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned({ command: '/bin/sh', args: ['-c', 'sleep 30 & echo $! >&2'] }, '/tmp'))
      yield* Deferred.await(owned.exited)
      yield* Effect.sleep('50 millis')
      const orphan = Number(owned.stderrTail().trim())
      assert.isTrue(isAlive(orphan))
      yield* Scope.close(scope, Exit.void)
      assert.isTrue(yield* goneSoon(orphan))
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGTERM', survivors: false })
    }),
  )

  it.live('hands on what the process writes to stderr as it comes, with its pid, for the app’s log', () =>
    Effect.gen(function* () {
      const heard: Array<readonly [string, number]> = []
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(
        spawnOwned({ command: '/bin/sh', args: ['-c', 'echo one >&2; echo two >&2'] }, '/tmp', {
          stderr: (chunk, pid) => heard.push([chunk, pid]),
        }),
      )
      yield* Deferred.await(owned.exited)
      yield* Effect.sleep('50 millis')
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(heard.map(([chunk]) => chunk).join(''), 'one\ntwo\n')
      assert.isTrue(heard.every(([, pid]) => pid === owned.pid))
      // It is still kept for an error, too.
      assert.strictEqual(owned.stderrTail(), 'one\ntwo\n')
    }),
  )

  it.live('stops an adapter on a Node of its own, and all it started, though it ignores TERM', () =>
    Effect.gen(function* () {
      // A Node at a path of its own, as the app ships one: not the binary the runtime runs on.
      const node = join(mkdtempSync(join(tmpdir(), 'althar-node-')), 'node')
      symlinkSync(process.execPath, node)
      const adapter = [
        "process.on('SIGTERM', () => {})",
        "const started = require('node:child_process').spawn('sleep', ['30'])",
        'process.stderr.write(`${started.pid}\\n`)',
        "process.stdout.write(String(process.env.ELECTRON_RUN_AS_NODE ?? 'none'))",
        'setInterval(() => {}, 1000)',
      ].join(';')
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(
        spawnOwned({ command: node, args: ['-e', adapter], env: { ALTHAR_NODE: node } }, '/tmp', { grace: '200 millis' }),
      )
      const reader = owned.stdout.getReader()
      const said = new TextDecoder().decode((yield* Effect.promise(() => reader.read())).value)
      reader.releaseLock()
      for (let waited = 0; owned.stderrTail() === '' && waited < 2_000; waited += 25) yield* Effect.sleep('25 millis')
      const started = Number(owned.stderrTail().trim())
      assert.strictEqual(said, 'none')
      assert.isTrue(isAlive(started))
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(owned.pid))
      assert.isTrue(yield* goneSoon(started))
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGKILL', survivors: false })
      assert.deepStrictEqual(yield* Deferred.await(owned.exited), { code: null, signal: 'SIGKILL' })
    }),
  )

  it.live('has nothing to stop when the group has already gone', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned({ command: '/usr/bin/true', args: [] }, '/tmp'))
      yield* Deferred.await(owned.exited)
      yield* Effect.sleep('50 millis')
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'none', survivors: false })
    }),
  )

  it.live('runs a spec where it says it lives, with the cwd and environment it assembled', () =>
    Effect.gen(function* () {
      const said: Array<{ cwd?: string; env: Readonly<Record<string, string | undefined>> }> = []
      const spec = {
        command: 'nowhere',
        args: [] as ReadonlyArray<string>,
        onDevice: (at: { cwd?: string; env: Readonly<Record<string, string | undefined>> }) => {
          said.push(at)
          return {
            command: '/bin/sh',
            args: ['-c', 'sleep 0.1; printf %s "$PWD|$SMOKE"'],
            env: { SMOKE: 'yes' },
            inheritEnv: ['DBUS_SESSION_BUS_ADDRESS'],
          }
        },
      }
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned(spec, '/tmp'))
      const reader = owned.stdout.getReader()
      let text = ''
      for (;;) {
        const { done, value } = yield* Effect.promise(() => reader.read())
        if (done) break
        text += new TextDecoder().decode(value)
      }
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(text, `${realpathSync('/tmp')}|yes`)
      assert.strictEqual(said[0]?.cwd, '/tmp')
      assert.strictEqual(said[0]?.env.SMOKE, undefined)
    }),
  )
})

describe('childEnvironment', () => {
  const parent = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    LC_ALL: 'C',
    HTTPS_PROXY: 'http://proxy',
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: 'test-key',
    CLAUDE_CONFIG_DIR: '/tmp/claude',
    ALTHAR_DATABASE: '/tmp/althar.db',
  }

  it('passes on only the allowlist, what the agent names, and its own variables', () => {
    assert.deepStrictEqual(
      childEnvironment(
        { command: 'agent', args: [], inheritEnv: ['CLAUDE_CONFIG_DIR'], env: { MODE: 'x', PATH: '/opt/bin' } },
        parent,
        false,
      ),
      {
        PATH: '/opt/bin',
        HOME: '/Users/someone',
        LC_ALL: 'C',
        HTTPS_PROXY: 'http://proxy',
        CLAUDE_CONFIG_DIR: '/tmp/claude',
        MODE: 'x',
      },
    )
  })

  it('runs the bundled adapters on the Node the app names, else on the binary it runs on', () => {
    assert.strictEqual(
      adapterNode({ ALTHAR_NODE: '/Applications/Althar.app/Contents/Resources/node/bin/node' }),
      '/Applications/Althar.app/Contents/Resources/node/bin/node',
    )
    assert.strictEqual(adapterNode({}), process.execPath)
    assert.strictEqual(adapterNode({ ALTHAR_NODE: '' }), process.execPath)
  })

  it('never tells the Node the app ships to run as Electron, even under Electron', () => {
    const node = '/Applications/Althar.app/Contents/Resources/node/bin/node'
    const spec = agents['claude-code'].launch(node)
    assert.strictEqual(spec.command, node)
    assert.isUndefined(childEnvironment(spec, { ELECTRON_RUN_AS_NODE: '1' }, true).ELECTRON_RUN_AS_NODE)
    assert.deepStrictEqual(asNode(spec, true), {})
  })

  it("runs Electron's own binary as Node", () => {
    assert.strictEqual(childEnvironment({ command: process.execPath, args: [] }, {}, true).ELECTRON_RUN_AS_NODE, '1')
    assert.isUndefined(childEnvironment({ command: 'opencode', args: [] }, {}, true).ELECTRON_RUN_AS_NODE)
    assert.isUndefined(childEnvironment({ command: process.execPath, args: [] }, {}, false).ELECTRON_RUN_AS_NODE)
    // The sign-in check runs the same binary, with the same flag.
    assert.deepStrictEqual(asNode({ command: process.execPath, args: [] }, true), { ELECTRON_RUN_AS_NODE: '1' })
    assert.deepStrictEqual(asNode({ command: 'claude', args: [] }, true), {})
  })

  it('digests an environment whatever order it is in', () => {
    assert.strictEqual(environmentDigest({ A: '1', B: '2' }), environmentDigest({ B: '2', A: '1' }))
    assert.notStrictEqual(environmentDigest({ A: '1' }), environmentDigest({ A: '2' }))
  })
})
