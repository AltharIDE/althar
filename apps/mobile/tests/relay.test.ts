import { Api, ApiError, serverProtocol, type HomeSnapshot, type WatchEvent } from '@althar/contracts'
import { Effect, Layer, Scope, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, describe, expect, it } from 'vitest'

import type { Connection } from '../src/client/AltharClient'
import { DEMO_MAC } from '../src/client/demo/DemoClient'
import { scenario } from '../src/client/demo/scenario'
import { connectRelay, newCommandId, type RelayLink } from '../src/client/relay/RelayClient'
import { decode, encode, jsonPort, type TextChannel } from '../src/client/relay/jsonPort'

/*
 * The relay client against the runtime's own contract: a server answering
 * a few of the API's calls, over a channel that carries only text, as the
 * relay's will. What crosses is checked by the contract's schemas on both
 * sides, so the demo's records are shown to be ones the runtime could send.
 */

const NOW = Date.parse('2026-10-21T15:00:00.000Z')

/** Two ends of a channel carrying text, delivered a moment later, as a network would. */
const channels = (): readonly [TextChannel & { readonly sent: Array<string> }, TextChannel] => {
  const listeners: [Set<(text: string) => void>, Set<(text: string) => void>] = [new Set(), new Set()]
  const sent: Array<string> = []
  const end = (mine: 0 | 1) => ({
    send: (text: string) => {
      sent.push(text)
      setTimeout(() => listeners[mine === 0 ? 1 : 0].forEach((listener) => listener(text)), 0)
    },
    onText: (handler: (text: string) => void) => {
      listeners[mine].add(handler)
      return () => listeners[mine].delete(handler)
    },
  })
  return [{ ...end(0), sent }, end(1)]
}

const link: RelayLink = {
  connection: (): Connection => ({ state: 'online', mac: DEMO_MAC }),
  onConnection: () => () => {},
  pair: () => Promise.resolve(DEMO_MAC),
  unpair: () => Promise.resolve(),
}

type Received = { readonly tag: string; readonly payload: unknown }

/** A runtime answering the calls the phone makes, recording each. */
const serve = (channel: TextChannel, received: Array<Received>) => {
  const state = scenario(NOW)
  const home: HomeSnapshot = {
    cursor: 7,
    looked: state.looked,
    since: state.looked,
    tasks: state.tasks,
    calls: state.calls,
    events: state.events,
    projects: state.projects,
  }
  const record = (tag: string) => (payload: unknown) => Effect.sync(() => void received.push({ tag, payload }))
  const handlers: Record<string, (payload: never) => unknown> = {
    GetHome: (payload) => Effect.as(record('GetHome')(payload), home),
    GetThread: ({ threadId }: { readonly threadId: string }) => {
      const thread = state.threads.get(threadId)
      return thread === undefined ? Effect.fail(new ApiError({ reason: 'NotFound', message: 'No such thread' })) : Effect.succeed(thread)
    },
    GetFileDiff: ({ taskId, path }: { readonly taskId: string; readonly path: string }) => {
      const diff = state.diffs.get(`${taskId}:${path}`)
      return diff === undefined ? Effect.fail(new ApiError({ reason: 'NotFound', message: 'No such file' })) : Effect.succeed(diff)
    },
    Answer: record('Answer'),
    Merge: (payload: { readonly head: string }) =>
      payload.head === '9f3c2ab'
        ? record('Merge')(payload)
        : Effect.fail(new ApiError({ reason: 'Moved', message: 'It changed since you looked' })),
    Watch: () =>
      Stream.fromIterable<WatchEvent>([
        {
          _tag: 'Changed',
          cursor: 8,
          aggregateType: 'task',
          aggregateId: 'task_webhooks',
          projectId: 'proj_meridian',
          threadId: 'thr_task_webhooks',
        },
        {
          _tag: 'Streaming',
          threadId: 'thr_task_backfill',
          itemId: 'item_9',
          kind: 'agent_message',
          agentId: 'claude-code',
          text: 'March matches.',
        },
      ]),
  }
  const all = new Proxy(handlers, {
    get: (target, tag: string) =>
      target[tag] ?? (() => Effect.fail(new ApiError({ reason: 'NotServed', message: `${tag} isn't served here` }))),
  })
  return Effect.forkScoped(
    Layer.launch(RpcServer.layer(Api).pipe(Layer.provide(Api.toLayer(all as never)), Layer.provide(serverProtocol(jsonPort(channel))))),
  )
}

let scope: Scope.Closeable | undefined
afterEach(async () => {
  if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Effect.void as never))
})

const connected = async () => {
  const [phone, mac] = channels()
  const received: Array<Received> = []
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Scope.provide(serve(mac, received), scope))
  const client = await connectRelay(jsonPort(phone), link)
  return { client, received, sent: phone.sent }
}

describe('the relay client', () => {
  it('reads the home through the contract, as text', async () => {
    const { client, sent } = await connected()
    const home = await client.home()
    expect(home.cursor).toBe(7)
    expect(home.calls.map((call) => call.id)).toEqual(['att_migrate', 'att_breakpoint', 'att_rounds'])
    expect(sent.length).toBeGreaterThan(0)
    expect(() => sent.forEach((text) => JSON.parse(text))).not.toThrow()
    await client.close()
  })

  it('answers with a command id the contract takes', async () => {
    const { client, received } = await connected()
    await client.answer({ attentionId: 'att_migrate', decision: 'reject', reason: 'Not on staging today' })
    expect(received).toEqual([
      {
        tag: 'Answer',
        payload: {
          commandId: expect.stringMatching(/^cmd_[0-9a-f]{32}$/),
          attentionId: 'att_migrate',
          decision: 'reject',
          reason: 'Not on staging today',
        },
      },
    ])
    await client.close()
  })

  it('says the runtime’s refusal in its own words, and doesn’t retry it', async () => {
    const { client, received } = await connected()
    await expect(client.merge({ taskId: 'task_stripe', head: 'deadbee' })).rejects.toThrow('It changed since you looked')
    await client.merge({ taskId: 'task_stripe', head: '9f3c2ab' })
    expect(received.map((one) => one.tag)).toEqual(['Merge'])
    await client.close()
  })

  it('reads a thread and a diff the demo holds', async () => {
    const { client } = await connected()
    const thread = await client.thread('thr_task_stripe')
    expect(thread.task.title).toBe('Upgrade the Stripe SDK to v19')
    const diff = await client.fileDiff('task_stripe', 'src/webhooks/handle.ts')
    expect(diff.lines.some((line) => line.kind === 'added')).toBe(true)
    await client.close()
  })

  it('hears what changes', async () => {
    const { client } = await connected()
    const heard = await new Promise<Array<WatchEvent>>((resolve) => {
      const events: Array<WatchEvent> = []
      const stop = client.watch((event) => {
        events.push(event)
        if (events.length === 2) {
          stop()
          resolve(events)
        }
      })
    })
    expect(heard.map((event) => event._tag)).toEqual(['Changed', 'Streaming'])
    await client.close()
  })
})

describe('the relay’s text', () => {
  it('carries bigints whole', () => {
    expect(decode(encode({ id: 12345678901234567890n, list: [1n] }))).toEqual({ id: 12345678901234567890n, list: [1n] })
  })

  it('makes command ids as the contract has them', () => {
    expect(newCommandId()).toMatch(/^cmd_[0-9a-f]{32}$/)
    expect(newCommandId((bytes) => bytes.fill(171))).toBe(`cmd_${'ab'.repeat(16)}`)
  })
})
