import { Api, ApiError, serverProtocol, type HomeSnapshot, type WatchEvent } from '@althar/contracts'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'

import type { Connection } from '../AltharClient'
import { DEMO_MAC } from '../demo/DemoClient'
import { scenario } from '../demo/scenario'
import { connectRelay, type RelayLink } from './RelayClient'
import { decode, encode, jsonPort, type TextChannel } from './jsonPort'

/*
 * The relay client's whole path, run inside the app: a runtime of the
 * contract's own, answering over a channel that carries only text, and the
 * client the phone will use. On a phone this runs on Hermes, so it says
 * whether Effect and the contract work there before the relay exists.
 */

/** Two ends of a channel carrying text, each delivered a moment later, as a network would. */
export const textChannels = (): readonly [TextChannel & { readonly sent: Array<string> }, TextChannel] => {
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

export const onlineLink: RelayLink = {
  connection: (): Connection => ({ state: 'online', mac: DEMO_MAC }),
  onConnection: () => () => {},
  pair: () => Promise.resolve(DEMO_MAC),
  unpair: () => Promise.resolve(),
}

export type Received = { readonly tag: string; readonly payload: unknown }

/** A runtime answering the calls the phone makes from the demo's afternoon, recording each command; others are refused. */
export const serveDemo = (channel: TextChannel, received: Array<Received>, now: number = Date.now()) => {
  const state = scenario(now)
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
  const notFound = (what: string) => Effect.fail(new ApiError({ reason: 'NotFound', message: `No such ${what}` }))
  const handlers: Record<string, (payload: never) => unknown> = {
    GetHome: () => Effect.succeed(home),
    GetThread: ({ threadId }: { readonly threadId: string }) => {
      const thread = state.threads.get(threadId)
      return thread === undefined ? notFound('thread') : Effect.succeed(thread)
    },
    GetFileDiff: ({ taskId, path }: { readonly taskId: string; readonly path: string }) => {
      const diff = state.diffs.get(`${taskId}:${path}`)
      return diff === undefined ? notFound('file') : Effect.succeed(diff)
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

export type Check = { readonly name: string; readonly ok: boolean; readonly detail: string; readonly ms: number }

const timed = async (name: string, run: () => Promise<string>): Promise<Check> => {
  const start = Date.now()
  try {
    return { name, ok: true, detail: await run(), ms: Date.now() - start }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error), ms: Date.now() - start }
  }
}

/** Runs the relay client's path end to end, a check at a time. */
export const selfTest = async (): Promise<ReadonlyArray<Check>> => {
  const checks: Array<Check> = []
  checks.push(
    await timed('Text carries bigints', async () => {
      const back = decode(encode({ id: 9007199254740993n })) as { id: bigint }
      if (back.id !== 9007199254740993n) throw new Error('changed in transit')
      return 'whole'
    }),
  )
  const [phone, mac] = textChannels()
  const received: Array<Received> = []
  const scope = await Effect.runPromise(Scope.make())
  try {
    checks.push(
      await timed('A runtime of the contract’s own starts', async () => {
        await Effect.runPromise(Scope.provide(serveDemo(mac, received), scope))
        return 'serving'
      }),
    )
    const client = await connectRelay(jsonPort(phone), onlineLink)
    checks.push(
      await timed('GetHome through the contract', async () => {
        const home = await client.home()
        return `${home.calls.length} calls, ${home.tasks.length} tasks`
      }),
    )
    checks.push(
      await timed('GetThread and GetFileDiff', async () => {
        const thread = await client.thread('thr_task_stripe')
        const diff = await client.fileDiff('task_stripe', 'src/webhooks/handle.ts')
        return `${thread.items.length} items, ${diff.lines.length} lines`
      }),
    )
    checks.push(
      await timed('Answer, with a command id', async () => {
        await client.answer({ attentionId: 'att_migrate', decision: 'reject' })
        const sent = received.at(-1)?.payload as { commandId?: string } | undefined
        if (sent?.commandId?.startsWith('cmd_') !== true) throw new Error('no command id')
        return sent.commandId
      }),
    )
    checks.push(
      await timed('A refusal, in the runtime’s words', async () => {
        const refused = await client.merge({ taskId: 'task_stripe', head: 'deadbee' }).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
        if (refused === null) throw new Error('merged a head that moved')
        return refused
      }),
    )
    checks.push(
      await timed('Watch, as a stream', async () => {
        const tags = await new Promise<ReadonlyArray<string>>((resolve, reject) => {
          const heard: Array<string> = []
          const timer = setTimeout(() => reject(new Error('nothing heard in 3s')), 3_000)
          const stop = client.watch((event) => {
            heard.push(event._tag)
            if (heard.length === 2) {
              clearTimeout(timer)
              stop()
              resolve(heard)
            }
          })
        })
        return tags.join(', ')
      }),
    )
    await client.close()
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  return checks
}
