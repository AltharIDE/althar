import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Api, clientProtocol } from '@althar/contracts'
import { Agents, authenticateApiClient, LocalApiEndpoint, openApiSocket } from '@althar/runtime'
import { fakeAgent, codexLikeMeanings } from '@althar/provider-adapters/testing'
import { until } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer, Schema, Scope } from 'effect'
import { RpcClient } from 'effect/rpc'

import { initializeHome, serveHome, type HomeReady } from '../src/home'
import { parseOptions } from '../src/options'
import { hostStatus } from '../src/status'
import { temporary } from './support'

const fixture = () => {
  const root = temporary()
  const repo = join(root, 'source')
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
  execFileSync(
    'git',
    ['-c', 'user.name=Host Fixture', '-c', 'user.email=balazs@otakomaiya.com', 'commit', '--allow-empty', '-m', 'Initial'],
    { cwd: repo, stdio: 'ignore' },
  )
  const options = parseOptions(
    ['init', '--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master'), '--project', repo],
    {},
    root,
  )
  return {
    root,
    options,
    dependencies: {
      agents: Layer.succeed(Agents, Agents.from([])),
      agentConfigs: { homeDir: join(root, 'agent-home'), folder: join(root, 'agent-sync') },
    },
  }
}
const start = (options: ReturnType<typeof fixture>['options'], dependencies: ReturnType<typeof fixture>['dependencies']) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<HomeReady, unknown>()
    const fiber = yield* Effect.forkScoped(
      serveHome(options, (value) => Effect.asVoid(Deferred.succeed(ready, value)), dependencies).pipe(
        Effect.catchCause((cause) => Effect.andThen(Deferred.failCause(ready, cause), Effect.failCause(cause))),
      ),
    )
    return { fiber, info: yield* Deferred.await(ready) }
  })
const client = (profile: string) =>
  Effect.gen(function* () {
    const endpoint = Schema.decodeUnknownSync(LocalApiEndpoint)(JSON.parse(readFileSync(join(profile, 'api/endpoint.json'), 'utf8')))
    const port = yield* openApiSocket(endpoint.address)
    yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
    const protocol = yield* Layer.build(clientProtocol(port))
    return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  })

describe('a persistent headless home', () => {
  it.live('keeps serving after clients leave, preserves identity and work on restart, and releases the single-writer lock', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options, dependencies } = fixture()
        const initialized = yield* initializeHome(options, dependencies)
        const home = yield* start(options, dependencies)
        assert.strictEqual(home.info.homeId, initialized.homeId)
        assert.strictEqual((yield* hostStatus(options.profile)).homeId, initialized.homeId)
        const busy = yield* Effect.flip(initializeHome({ ...options, projects: [] }, dependencies))
        assert.strictEqual(busy._tag, 'DatabaseInUse')
        const scope = yield* Scope.make()
        const api = yield* Effect.gen(function* () {
          const endpoint = Schema.decodeUnknownSync(LocalApiEndpoint)(
            JSON.parse(readFileSync(join(options.profile, 'api/endpoint.json'), 'utf8')),
          )
          const port = yield* openApiSocket(endpoint.address)
          yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
          const protocol = yield* Layer.build(clientProtocol(port))
          return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
        }).pipe(Scope.provide(scope))
        const projectId = initialized.projects[0]
        if (projectId === undefined) throw new Error('Missing provisioned project')
        const task = yield* api.CreateTask({ commandId: `cmd_${'1'.repeat(32)}`, projectId, title: 'Work persists' })
        yield* Scope.close(scope, Exit.void)
        assert.strictEqual((yield* hostStatus(options.profile)).state, 'ready')
        yield* Fiber.interrupt(home.fiber)
        assert.isFalse(existsSync(join(options.profile, 'api/endpoint.json')))
        const resumed = yield* start(options, dependencies)
        assert.strictEqual(resumed.info.homeId, home.info.homeId)
        const endpoint = Schema.decodeUnknownSync(LocalApiEndpoint)(
          JSON.parse(readFileSync(join(options.profile, 'api/endpoint.json'), 'utf8')),
        )
        const port = yield* openApiSocket(endpoint.address)
        yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
        const protocol = yield* Layer.build(clientProtocol(port))
        const again = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
        const restored = yield* again.GetThread({ threadId: task.threadId })
        assert.strictEqual(restored.task.title, 'Work persists')
      }),
    ),
  )

  it.live('fails closed before publishing an endpoint when the encryption key is wrong', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { options, dependencies } = fixture()
        yield* initializeHome(options, dependencies)
        const original = readFileSync(options.keyFile)
        writeFileSync(options.keyFile, Buffer.alloc(32, 9))
        const error = yield* Effect.flip(serveHome(options, () => Effect.die('reported ready with the wrong key'), dependencies))
        assert.strictEqual(error._tag, 'HostError')
        assert.isFalse(existsSync(join(options.profile, 'api/endpoint.json')))
        writeFileSync(options.keyFile, original)
        yield* start(options, dependencies)
      }),
    ),
  )

  it.live('keeps an agent turn alive after its client disconnects and retains the result across restart', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = fixture()
        let waiting = false
        let released = false
        const agents = Layer.succeed(
          Agents,
          Agents.from([
            {
              definition: {
                id: 'codex',
                name: 'Host fixture',
                source: 'bundled',
                launch: () => ({ command: process.execPath, args: ['-e', ''] }),
                modes: { ask: 'ask', readOnly: 'read-only', reader: 'read-only' },
                options: { mode: 'mode', model: 'model', effort: 'effort' },
                signIn: {
                  status: () => ({ command: process.execPath, args: ['-e', 'process.stdout.write("signed-in")'] }),
                  read: () => true,
                  paidBy: () => 'plan',
                  login: 'fixture-only',
                },
                home: { variable: 'HOST_FIXTURE_HOME', usual: () => join(at.root, 'provider'), shared: () => [] },
                permissions: codexLikeMeanings,
                ownHelpers: { off: true, how: 'Fixture', kept: 'None' },
                skills: null,
                knownGaps: [],
              },
              transport: () => ({
                _tag: 'InProcess',
                agent: fakeAgent({
                  holds: {
                    has: (marker) => marker === '[answers-after:5s]',
                    open: () => {
                      released = true
                    },
                    opened: () => {
                      waiting = true
                      return released
                    },
                  },
                }),
              }),
            },
          ]),
        )
        const dependencies = { ...at.dependencies, agents }
        const initialized = yield* initializeHome(at.options, dependencies)
        const host = yield* start(at.options, dependencies)
        const scope = yield* Scope.make()
        const api = yield* client(at.options.profile).pipe(Scope.provide(scope))
        const projectId = initialized.projects[0]
        if (projectId === undefined) throw new Error('Missing provisioned project')
        const task = yield* api.CreateTask({ commandId: `cmd_${'2'.repeat(32)}`, projectId, title: 'Independent work' })
        yield* api.StartSession({ commandId: `cmd_${'3'.repeat(32)}`, threadId: task.threadId, agentId: 'codex' })
        yield* until(api.GetThread({ threadId: task.threadId }), (thread) => thread.session !== null && !thread.session.turnRunning)
        yield* api.Send({
          commandId: `cmd_${'4'.repeat(32)}`,
          threadId: task.threadId,
          body: '[answers-after:5s]',
          disposition: 'after_current',
        })
        yield* until(
          Effect.sync(() => waiting),
          Boolean,
        )
        yield* Scope.close(scope, Exit.void)
        released = true
        const reconnectedScope = yield* Scope.make()
        const reconnected = yield* client(at.options.profile).pipe(Scope.provide(reconnectedScope))
        const finished = yield* until(
          reconnected.GetThread({ threadId: task.threadId }),
          (thread) =>
            thread.session !== null &&
            !thread.session.turnRunning &&
            thread.items.some((item) => 'text' in item.content && item.content.text?.startsWith('Looked into it:')),
        )
        assert.isFalse(finished.session?.turnRunning)
        yield* Scope.close(reconnectedScope, Exit.void)
        yield* Fiber.interrupt(host.fiber)
        yield* start(at.options, dependencies)
        const restored = yield* (yield* client(at.options.profile)).GetThread({ threadId: task.threadId })
        assert.isTrue(restored.items.some((item) => 'text' in item.content && item.content.text?.startsWith('Looked into it:')))
      }),
    ),
  )
})
