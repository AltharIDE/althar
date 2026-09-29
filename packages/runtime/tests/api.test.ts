import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type WatchEvent } from '@charrette/contracts'
import { scenarios } from '@charrette/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

import { serve } from '../src/Api'
import { fakeAgents, repository } from './support'

/** The runtime serving the API on one end of a channel, and a client on the other, as the app's window has it. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  yield* Layer.build(
    serve(
      emitterPort(channel.port1, (data) => data),
      {
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents(),
      },
    ),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
})

const eventually = <A>(effect: Effect.Effect<A, unknown>, check: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 250; tries += 1) {
      const value = yield* Effect.orDie(effect)
      if (check(value)) return value
      yield* Effect.sleep('20 millis')
    }
    return yield* Effect.die(new Error('Timed out'))
  })

describe('the API', () => {
  it.live('opens a project, runs a task with an agent, and streams what changes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected
        const status = yield* client.Status()
        assert.strictEqual(status.apiVersion, 1)
        assert.deepStrictEqual(
          status.agents.map((agent) => [agent.id, agent.signIn]),
          [
            ['claude-code', 'signed_in'],
            ['codex', 'signed_in'],
            ['opencode', 'signed_in'],
          ],
        )

        const project = yield* client.OpenProject({ path: repository() })
        assert.strictEqual(project.tasks, 0)
        const task = yield* client.CreateTask({ projectId: project.id, title: 'Say hello', description: 'Briefly.' })
        assert.strictEqual(task.branch, 'charrette/say-hello')
        assert.deepStrictEqual(
          (yield* client.ListProjects()).map((summary) => [summary.id, summary.tasks]),
          [[project.id, 1]],
        )
        assert.deepStrictEqual(
          (yield* client.ListTasks({ projectId: project.id })).map((summary) => summary.title),
          ['Say hello'],
        )

        const watched = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(client.Watch(), (event) => event._tag === 'Streaming'),
              1,
            ),
          ),
        )
        const changed = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.filter(client.Watch(), (event) => event._tag === 'Changed'),
              1,
            ),
          ),
        )
        yield* Effect.sleep('50 millis')
        yield* client.StartSession({ threadId: task.threadId, agentId: 'codex' })
        // The session's brief goes first; then what the person says.
        yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (thread) => thread.turns.length === 1 && thread.turns[0]?.state === 'completed',
        )
        yield* client.Send({ threadId: task.threadId, body: scenarios.hello, disposition: 'after_current' })
        const thread = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (value) => value.turns.filter((turn) => turn.state === 'completed').length === 2,
        )
        assert.strictEqual(thread.task.title, 'Say hello')
        assert.strictEqual(thread.session?.agentId, 'codex')
        assert.deepStrictEqual(thread.session?.models, ['small', 'large'])
        assert.deepStrictEqual(
          thread.items.slice(-2).map((item) => [item.kind, (item.content as { text?: string }).text]),
          [
            ['user_message', 'hello'],
            ['agent_message', 'Hello'],
          ],
        )
        const [streamed] = (yield* Fiber.join(watched)) as ReadonlyArray<WatchEvent>
        assert.strictEqual(streamed?._tag === 'Streaming' ? streamed.threadId : undefined, task.threadId)
        const [change] = (yield* Fiber.join(changed)) as ReadonlyArray<WatchEvent>
        assert.strictEqual(change?._tag === 'Changed' ? change.projectId : undefined, project.id)

        yield* client.SetModel({ threadId: task.threadId, model: 'large' })
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).session?.model, 'large')
        yield* client.StopSession({ threadId: task.threadId })
        assert.isNull((yield* client.GetThread({ threadId: task.threadId })).session)
      }),
    ),
  )

  it.live('asks the person, and takes their answer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected
        const project = yield* client.OpenProject({ path: repository() })
        const task = yield* client.CreateTask({ projectId: project.id, title: 'Deploy' })
        yield* client.StartSession({ threadId: task.threadId, agentId: 'codex' })
        yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.turns[0]?.state === 'completed')
        yield* client.Send({ threadId: task.threadId, body: scenarios.commandChoices, disposition: 'after_current' })
        const waiting = yield* eventually(client.GetThread({ threadId: task.threadId }), (thread) => thread.attention.length === 1)
        assert.deepStrictEqual(
          { title: waiting.attention[0]?.title, reason: waiting.attention[0]?.reason, command: waiting.attention[0]?.command },
          { title: 'Run make deploy', reason: 'Deploying or publishing always asks.', command: 'Run make deploy' },
        )
        assert.strictEqual((yield* client.ListProjects())[0]?.waiting, 1)
        yield* client.Answer({ attentionId: waiting.attention[0]?.id ?? '', decision: 'reject', reason: 'Not today' })
        const after = yield* eventually(
          client.GetThread({ threadId: task.threadId }),
          (thread) => thread.turns.length === 2 && thread.turns[1]?.state === 'completed',
        )
        assert.strictEqual(after.attention.length, 0)
      }),
    ),
  )

  it.live('says what went wrong, by name', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected
        const error = yield* Effect.flip(client.OpenProject({ path: mkdtempSync(join(tmpdir(), 'charrette-plain-')) }))
        assert.instanceOf(error, ApiError)
        assert.strictEqual(error.reason, 'NotARepository')
        assert.strictEqual((yield* Effect.flip(client.GetThread({ threadId: 'thr_missing' }))).reason, 'NotFound')
        assert.strictEqual((yield* Effect.flip(client.StopSession({ threadId: 'thr_missing' }))).reason, 'NoSession')
      }),
    ),
  )
})
