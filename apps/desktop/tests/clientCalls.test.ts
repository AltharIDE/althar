// @vitest-environment node
import { Api, ApiError, type DomMessagePort, emitterPort, type PlanStep, serverProtocol, type WatchEvent } from '@althar/contracts'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@althar/testing'

import { type Client, connect, newProjectId } from '../src/renderer/data/client'

/*
 * What the window's client puts on the wire for each call: what it was
 * given, and nothing for what it wasn't, so the runtime's own default holds.
 * A stand-in runtime hears each call and refuses it, which a command takes
 * as its answer, so each is heard once.
 */

const scopes: Array<Scope.Closeable> = []
const clients: Array<Client> = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void))
})

interface Heard {
  readonly tag: string
  readonly payload: Record<string, unknown>
}

/** A runtime that hears every call, refuses it, and, asked to watch, says one change and ends. */
const standIn = async (): Promise<{ client: Client; heard: Array<Heard> }> => {
  const channel = new MessageChannel()
  const heard: Array<Heard> = []
  const handlers = new Proxy(
    {},
    {
      get: (_, tag: string) => (payload: Record<string, unknown>) => {
        heard.push({ tag, payload })
        if (tag === 'Watch')
          return Stream.make({
            _tag: 'Changed' as const,
            cursor: 7,
            aggregateType: 'task',
            aggregateId: 't1',
            projectId: 'p1',
            threadId: 'th1',
          })
        return Effect.fail(new ApiError({ reason: 'Heard', message: `Heard ${tag}.` }))
      },
    },
  )
  const scope = await Effect.runPromise(Scope.make())
  scopes.push(scope)
  // Every handler the stand-in has needs nothing, whatever the contract allows them.
  const server = RpcServer.layer(Api).pipe(
    Layer.provide(Api.toLayer(Effect.succeed(Api.of(handlers as Parameters<typeof Api.of>[0])))),
    Layer.provide(serverProtocol(emitterPort(channel.port1 as never, (data) => data))),
  ) as Layer.Layer<never>
  await Effect.runPromise(Effect.forkIn(Layer.launch(server), scope))
  const client = await connect(channel.port2 as unknown as DomMessagePort)
  clients.push(client)
  return { client, heard }
}

/** What the runtime heard of one call, without the command's id. */
const sent = async (heard: Array<Heard>, call: Promise<unknown>) => {
  const failure = await call.then(
    () => null,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(ApiError)
  const last = heard.at(-1)
  const payload = Object.fromEntries(Object.entries(last?.payload ?? {}).filter(([name]) => name !== 'commandId'))
  return { tag: last?.tag, payload }
}

describe('what the client sends', () => {
  it('opens a project by the id and ink the window drew its mark from, and leaves them to the runtime otherwise', async () => {
    const { client, heard } = await standIn()
    const projectId = newProjectId()
    expect(await sent(heard, client.openProject('grant_1', { projectId, ink: 'teal' }))).toEqual({
      tag: 'OpenProject',
      payload: { grant: 'grant_1', projectId, ink: 'teal' },
    })
    expect((await sent(heard, client.openProject('grant_1'))).payload).toEqual({ grant: 'grant_1' })
  })

  it('reads the home since when it was last left, or all of it', async () => {
    const { client, heard } = await standIn()
    expect(await sent(heard, client.getHome('2026-10-06T18:00:00.000Z'))).toEqual({
      tag: 'GetHome',
      payload: { since: '2026-10-06T18:00:00.000Z' },
    })
    expect((await sent(heard, client.getHome())).payload).toEqual({})
  })

  it('changes a plan’s steps, and how it ends where that was changed too', async () => {
    const { client, heard } = await standIn()
    const steps: ReadonlyArray<PlanStep> = [{ key: 'implement', agentId: 'codex', model: null, skipped: false }]
    expect((await sent(heard, client.changePlan('plan_1', steps))).payload).toEqual({ planId: 'plan_1', steps })
    expect((await sent(heard, client.changePlan('plan_1', steps, 'ready'))).payload).toEqual({
      planId: 'plan_1',
      steps,
      end: 'ready',
    })
  })

  it('removes an account, anyway only where the person said so', async () => {
    const { client, heard } = await standIn()
    expect((await sent(heard, client.removeAccount('acc_1'))).payload).toEqual({ accountId: 'acc_1' })
    expect((await sent(heard, client.removeAccount('acc_1', true))).payload).toEqual({ accountId: 'acc_1', anyway: true })
  })

  it('acts on the task’s own pull request, or on the one it names', async () => {
    const { client, heard } = await standIn()
    const url = 'https://github.com/meridian/web/pull/4'
    expect((await sent(heard, client.markReady('t1'))).payload).toEqual({ taskId: 't1' })
    expect((await sent(heard, client.merge('t1', 'abc'))).payload).toEqual({ taskId: 't1', head: 'abc' })
    expect((await sent(heard, client.push('t1', 'abc'))).payload).toEqual({ taskId: 't1', head: 'abc' })
    expect((await sent(heard, client.push('t1', 'abc', url))).payload).toEqual({ taskId: 't1', head: 'abc', url })
    expect(await sent(heard, client.replacePullRequest('t1', 'abc', 'def'))).toEqual({
      tag: 'ReplacePullRequest',
      payload: { taskId: 't1', head: 'abc', replaces: 'def' },
    })
    expect((await sent(heard, client.replacePullRequest('t1', 'abc', 'def', url))).payload).toEqual({
      taskId: 't1',
      head: 'abc',
      replaces: 'def',
      url,
    })
    expect(await sent(heard, client.mergeNote('t1'))).toEqual({ tag: 'MergeNote', payload: { taskId: 't1' } })
    expect((await sent(heard, client.mergeNote('t1', url))).payload).toEqual({ taskId: 't1', url })
  })

  it('runs the project’s usual runnable, or the one picked', async () => {
    const { client, heard } = await standIn()
    expect(await sent(heard, client.runProject('p1', 't1', 'th1'))).toEqual({
      tag: 'RunProject',
      payload: { projectId: 'p1', taskId: 't1', threadId: 'th1' },
    })
    expect((await sent(heard, client.runProject('p1', null, null, 'rnbl_storybook'))).payload).toEqual({
      projectId: 'p1',
      taskId: null,
      threadId: null,
      runnableId: 'rnbl_storybook',
    })
  })

  it('watches from the start when it has heard nothing yet', async () => {
    const { client, heard } = await standIn()
    const events: Array<WatchEvent> = []
    const unwatch = client.watch((event) => events.push(event))
    await waitFor(() => events.length)
    unwatch()
    expect(heard.find((one) => one.tag === 'Watch')?.payload).toEqual({})
    expect(events[0]).toMatchObject({ _tag: 'Changed', cursor: 7 })
  })
})
