// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Api, ApiError, type DomMessagePort, emitterPort, serverProtocol, type WatchEvent } from '@charrette/contracts'
import { connection, Folders, services } from '@charrette/runtime'
import { Context, Effect, Exit, Layer, Scope, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, describe, expect, it } from 'vitest'

import { connect, messageOf, newCommandId, receivePort } from '../src/renderer/data/client'
import { fakeAgents } from '../src/runtime/fakeAgents'
import { repository } from './repository'

/*
 * The window's client against the real runtime, over a message channel as
 * the app has it, with the fake agent leading; and against a stand-in
 * runtime, for what the real one can't be made to do on cue.
 */

const scopes: Array<Scope.Closeable> = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void))
})

/** Runs a server on its own fiber, as the runtime does for each window, until the test ends. */
const serving = async (server: Layer.Layer<never>) => {
  const scope = await Effect.runPromise(Scope.make())
  scopes.push(scope)
  await Effect.runPromise(Effect.forkIn(Layer.launch(server), scope))
}

const connected = async () => {
  const channel = new MessageChannel()
  const scope = await Effect.runPromise(Scope.make())
  scopes.push(scope)
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      services({
        database: ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents,
      }),
      scope,
    ),
  )
  await serving(connection(emitterPort(channel.port1 as never, (data) => data)).pipe(Layer.provide(Layer.succeedContext(context))))
  const client = await connect(channel.port2 as unknown as DomMessagePort)
  /** A folder the person chose, as the main process allows it. */
  const grant = (path: string) => Effect.runPromise(Context.get(context, Folders).allow(path))
  return { client, grant }
}

const eventually = async <A>(read: () => Promise<A>, check: (value: A) => boolean): Promise<A> => {
  for (let tries = 0; tries < 250; tries += 1) {
    const value = await read()
    if (check(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out')
}

describe('the client', () => {
  it('opens a project by its grant, starts a task, talks to its lead, and hears what changes', async () => {
    const { client, grant } = await connected()
    expect((await client.status()).agents.map((agent) => [agent.name, agent.signIn])).toEqual([
      ['Claude Code', 'signed_in'],
      ['Codex', 'signed_in'],
    ])
    expect((await client.status({ recheck: true })).agents).toHaveLength(2)
    const project = await client.openProject(await grant(repository()))
    const listed = await client.listProjects()
    expect(listed.projects).toHaveLength(1)
    const events: Array<WatchEvent> = []
    const unwatch = client.watch((event) => events.push(event), listed.cursor)

    const task = await client.createTask({ projectId: project.id, title: 'Say hello' })
    expect((await client.listTasks(project.id)).tasks.map((each) => each.title)).toEqual(['Say hello'])
    await client.startSession({ threadId: task.threadId, agentId: 'claude-code' })
    await eventually(
      () => client.getThread(task.threadId),
      (thread) => thread.session?.turnRunning === false && thread.items.length > 0,
    )
    await client.send({ threadId: task.threadId, body: 'hello', disposition: 'after_current' })
    const thread = await eventually(
      () => client.getThread(task.threadId),
      (snapshot) => snapshot.items.some((item) => 'text' in item.content && item.content.text === 'Hello'),
    )
    expect(thread.session?.agentName).toBe('Claude Code')
    const reply = thread.items.at(-1)
    expect(await client.getThreadItem(task.threadId, reply?.id ?? '')).toEqual(reply)
    await eventually(
      async () => events,
      (seen) => seen.some((event) => event._tag === 'Changed' && event.threadId === task.threadId),
    )
    expect(events.some((event) => event._tag === 'Streaming' && event.threadId === task.threadId)).toBe(true)

    await client.setModel({ threadId: task.threadId, model: 'large' })
    await client.setEffort({ threadId: task.threadId, effort: 'high' })
    const offered = await client.getModels()
    expect(offered.find((agent) => agent.agentId === 'claude-code')).toMatchObject({ model: 'large', effort: 'high' })
    await client.interrupt(task.threadId)
    await client.switchAgent({ threadId: task.threadId, agentId: 'codex', model: 'small', effort: 'low' })
    await client.stopSession(task.threadId)
    unwatch()
    await client.close()
  })

  it('asks the coordinator for a task, holds, changes and starts its plan, and starts one the person planned', async () => {
    const { client, grant } = await connected()
    const project = await client.openProject(await grant(repository()))
    const coordinator = await client.getCoordinator(project.id)
    expect(coordinator.suggested?.agentId).toBe('claude-code')
    await client.send({ threadId: coordinator.threadId, body: 'Add a retry. [coordinator:plan]', disposition: 'after_current' })
    const planned = await eventually(
      () => client.getCoordinator(project.id, { limit: 50 }),
      (snapshot) => snapshot.items.some((item) => item.kind === 'task'),
    )
    const card = planned.items.find((item) => item.kind === 'task')
    const planId = card?.kind === 'task' ? (card.content.plan?.id ?? '') : ''
    await client.holdPlan(planId)
    await client.changePlan(planId, [{ key: 'implement', agentId: 'codex', model: null, skipped: false }])
    const held = await client.getThreadItem(coordinator.threadId, card?.id ?? '')
    expect(held.kind === 'task' && [held.content.phase, held.content.plan?.steps.map((step) => step.agentId)]).toEqual(['held', ['codex']])
    await client.startPlan(planId)
    await eventually(
      () => client.getThreadItem(coordinator.threadId, card?.id ?? ''),
      (item) => item.kind === 'task' && item.content.phase === 'running',
    )

    const task = await client.startTask({
      projectId: project.id,
      title: 'Tidy the README',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
    })
    expect(task.title).toBe('Tidy the README')
    await client.close()
  })

  it('rejects with what went wrong, in words', async () => {
    const { client } = await connected()
    const failure = await client.openProject('grant_nobody_gave').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(messageOf(failure)).toBe("That folder isn't there any more.")
    await expect(client.answer({ attentionId: 'nothing', decision: 'allow' })).rejects.toBeInstanceOf(ApiError)
    expect(messageOf(await client.openChange('task_none').catch((error: unknown) => error))).toBe("That task isn't there any more.")
    await client.close()
  })

  it('tries a command once more, under the same id, when the runtime gave no answer; and watches again from the last change', async () => {
    const channel = new MessageChannel()
    const commands: Array<string> = []
    const watches: Array<number | undefined> = []
    const refuse = (): Effect.Effect<never, ApiError> =>
      Effect.fail(new ApiError({ reason: 'NoSession', message: 'No agent is working on this task.' }))
    const handlers = Api.toLayer(
      Effect.succeed(
        Api.of({
          Status: () => Effect.die('unused'),
          GetFileDiff: () => Effect.die('unused'),
          GetBoard: () => Effect.die('unused'),
          Merge: () => Effect.die('unused'),
          ListProjects: () => Effect.die('unused'),
          OpenProject: () => Effect.die('unused'),
          ListTasks: () => Effect.die('unused'),
          CreateTask: () => Effect.die('unused'),
          GetThread: () => Effect.die('unused'),
          GetThreadItem: () => Effect.die('unused'),
          // The first try gets no answer the client can read; the second works.
          StartSession: ({ commandId }) => {
            commands.push(commandId)
            return commands.length === 1 ? Effect.die('lost on the way') : Effect.succeed('s1')
          },
          SwitchAgent: () => Effect.die('unused'),
          SetModel: () => Effect.die('unused'),
          SetEffort: () => Effect.die('unused'),
          GetModels: () => Effect.die('unused'),
          SetDefaultEffort: () => Effect.die('unused'),
          // A refusal is an answer: it isn't tried again.
          Interrupt: ({ commandId }) => {
            commands.push(commandId)
            return refuse()
          },
          StopSession: () => Effect.die('unused'),
          Send: () => Effect.die('unused'),
          Answer: () => Effect.die('unused'),
          GetCoordinator: () => Effect.die('unused'),
          StartTask: () => Effect.die('unused'),
          StartPlan: () => Effect.die('unused'),
          HoldPlan: () => Effect.die('unused'),
          ChangePlan: () => Effect.die('unused'),
          AnswerStuck: () => Effect.die('unused'),
          ListConnections: () => Effect.die('unused'),
          StartSignIn: () => Effect.die('unused'),
          GetSignIn: () => Effect.die('unused'),
          CancelSignIn: () => Effect.die('unused'),
          ConnectToken: () => Effect.die('unused'),
          Disconnect: () => Effect.die('unused'),
          ListIssues: () => Effect.die('unused'),
          MarkReady: () => Effect.die('unused'),
          SetUsageLimit: () => Effect.die('unused'),
          RenameAccount: () => Effect.die('unused'),
          RemoveAccount: () => Effect.die('unused'),
          OrderAccounts: () => Effect.die('unused'),
          AddAccount: () => Effect.die('unused'),
          FindAccounts: () => Effect.die('unused'),
          SignInAccount: () => Effect.die('unused'),
          OpenChange: () => Effect.die('unused'),
          RefreshTask: () => Effect.die('unused'),
          Watch: ({ since }) => {
            watches.push(since)
            return Stream.make({
              _tag: 'Changed' as const,
              cursor: (since ?? 0) + 5,
              aggregateType: 'task',
              aggregateId: 't1',
              projectId: 'p1',
              threadId: 'th1',
            })
          },
        }),
      ),
    )
    await serving(
      RpcServer.layer(Api).pipe(
        Layer.provide(handlers),
        Layer.provide(serverProtocol(emitterPort(channel.port1 as never, (data) => data))),
      ),
    )
    const client = await connect(channel.port2 as unknown as DomMessagePort)

    expect(await client.startSession({ threadId: 'th1', agentId: 'codex' })).toBe('s1')
    expect(commands).toHaveLength(2)
    expect(commands[0]).toBe(commands[1])
    await expect(client.interrupt('th1')).rejects.toBeInstanceOf(ApiError)
    expect(commands).toHaveLength(3)

    const heard: Array<WatchEvent> = []
    const unwatch = client.watch((event) => heard.push(event), 10)
    await eventually(
      async () => watches,
      (seen) => seen.length >= 2,
    )
    unwatch()
    expect(watches.slice(0, 2)).toEqual([10, 15])
    expect(heard[0]?._tag === 'Changed' && heard[0].cursor).toBe(15)
    await client.close()
  })
})

describe('messages', () => {
  it('says what went wrong: the runtime’s words, or that it didn’t answer', () => {
    expect(messageOf(new ApiError({ reason: 'NotARepository', message: 'Not a repository' }))).toBe('Not a repository')
    expect(messageOf(new Error('RpcClientError: the port closed'))).toBe(
      "Charrette's runtime didn't answer. If it keeps happening, restart Charrette.",
    )
  })

  it('makes command ids as the contract has them', () => {
    expect(newCommandId()).toMatch(/^cmd_[0-9a-f]{32}$/)
    expect(newCommandId()).not.toBe(newCommandId())
  })

  it('takes the port the preload hands on, and nothing else', async () => {
    const target = new EventTarget()
    const received = receivePort(target)
    const { port1 } = new MessageChannel()
    target.dispatchEvent(new MessageEvent('message', { data: 'something else', ports: [port1] }))
    target.dispatchEvent(new MessageEvent('message', { data: 'charrette:port' }))
    target.dispatchEvent(new MessageEvent('message', { data: 'charrette:port', ports: [port1] }))
    expect(await received).toBe(port1)
    port1.close()
  })
})
