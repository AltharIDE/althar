import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Cause, Effect, Layer, Schema, Stream } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcServer } from 'effect/rpc'

import {
  Api,
  ApiError,
  ClientAuthority,
  ConnectionList,
  HeardAttention,
  HeardEvent,
  isKnownAttention,
  isKnownEvent,
  OpenLiterals,
  OpenUnion,
  ThreadItem,
  ThreadItems,
  ThreadSnapshot,
  WatchEvent,
} from '../src/index'
import { clientProtocol, emitterPort, serverProtocol } from '../src/transport'

/*
 * A client built before a home it reads: what the home says that the client
 * doesn't know yet takes its fallback, or is left out, and the rest of the
 * answer reads as before.
 */

const base = { id: 'i1', sequence: 1, agentId: null, createdAt: '2026-11-26T09:00:00.000Z' }
const notice = (role?: string) => ({
  ...base,
  kind: 'notice',
  content: { source: 'runtime', severity: 'info', title: 'Context compacted', description: null, ...(role === undefined ? {} : { role }) },
})
const said = { ...base, id: 'i2', sequence: 2, kind: 'agent_message', content: { text: 'Done.', pictures: [], files: [] } }
/** An item of a kind a newer home has: a poll the agent put to the person. */
const poll = { ...base, id: 'i3', sequence: 3, kind: 'poll', content: { question: 'Ship it?' } }

const call = (kind: string) => ({
  id: `a_${kind}`,
  kind,
  title: 'Run the tests',
  reason: 'Asks',
  command: null,
  stuck: null,
  createdAt: base.createdAt,
})

const roleOf = (item: ThreadItem) => (item.kind === 'notice' ? item.content.role : null)

describe('a client of an older version', () => {
  it('reads a role it doesn’t know as unknown, and one it knows as itself', () => {
    const decode = Schema.decodeUnknownSync(ThreadItem)
    assert.strictEqual(roleOf(decode(notice('summarised'))), 'unknown')
    assert.strictEqual(roleOf(decode(notice('compacted'))), 'compacted')
    assert.isUndefined(roleOf(decode(notice())))
    // Only a role it doesn't know: one that isn't a word at all still fails.
    assert.throws(() => decode(notice(7 as never)))
  })

  it('leaves out of a thread an item of a kind it doesn’t know, and reads the rest', () => {
    const items = Schema.decodeUnknownSync(ThreadItems)([notice('aside'), poll, said])
    assert.deepStrictEqual(
      items.map((item) => item.id),
      ['i1', 'i2'],
    )
    // An item of a kind it knows, said wrong, fails as it did.
    assert.throws(() => Schema.decodeUnknownSync(ThreadItems)([{ ...said, content: { text: 3 } }]))
    // The thread's page and its reports alike.
    assert.strictEqual(ThreadSnapshot.fields.reports, ThreadItems)
  })

  it('reads one item of a kind it doesn’t know as none, as one the thread keeps for Althar', () => {
    const rpc = Api.requests.get('GetThreadItem')
    assert.isDefined(rpc)
    const decode = Schema.decodeUnknownSync(rpc?.successSchema ?? Schema.Never)
    assert.isNull(decode(poll))
    assert.isNull(decode(null))
    assert.deepStrictEqual(decode(said), Schema.decodeUnknownSync(ThreadItem)(said))
  })

  it('leaves out a call it couldn’t answer, and a connection to a product it doesn’t know', () => {
    const calls = Schema.decodeUnknownSync(ThreadSnapshot.fields.attention)([call('permission'), call('vote')])
    assert.deepStrictEqual(
      calls.map((one) => one.kind),
      ['permission'],
    )
    const connection = (product: string) => ({
      id: `conn_${product}`,
      product,
      name: product,
      webUrl: 'https://example.com',
      account: { login: 'you', name: null },
      auth: 'token',
      state: 'ready',
    })
    const connections = Schema.decodeUnknownSync(ConnectionList.fields.connections)([connection('github'), connection('gitea')])
    assert.deepStrictEqual(
      connections.map((one) => one.product),
      ['github'],
    )
  })

  it('takes a failure for a reason it doesn’t know, which is words already', () => {
    const failure = Schema.decodeUnknownSync(ApiError)({ _tag: 'ApiError', reason: 'QuotaReached', message: 'The home is full.' })
    assert.strictEqual(failure.reason, 'QuotaReached')
  })

  it('hears an event of a type it doesn’t know as Unknown, and passes it over', () => {
    const decode = Schema.decodeUnknownSync(HeardEvent)
    const heard = [
      { _tag: 'Weather', sky: 'clear' },
      { _tag: 'Context', threadId: 'th1', used: 1, size: 2 },
    ].map((event) => decode(event))
    assert.deepStrictEqual(heard[0], { _tag: 'Unknown' })
    assert.deepStrictEqual(heard.filter(isKnownEvent), [{ _tag: 'Context', threadId: 'th1', used: 1, size: 2 }])
    const attention = Schema.decodeUnknownSync(HeardAttention)({ _tag: 'Snoozed', until: 'noon' })
    assert.isFalse(isKnownAttention(attention))
  })

  it.live('hears a newer home’s watch over a port, the events it knows and not the one it doesn’t', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The home's API has a type of event more than the client's.
        const Weather = Schema.Struct({ _tag: Schema.Literal('Weather'), sky: Schema.String })
        const Newer = RpcGroup.make(
          Rpc.make('Watch', {
            payload: { since: Schema.optional(Schema.Number), deltas: Schema.optional(Schema.Boolean) },
            success: Schema.Union([...WatchEvent.members, Weather]),
            error: ApiError,
            stream: true,
          }),
        )
        const changed = (cursor: number) =>
          ({ _tag: 'Changed', cursor, aggregateType: 'task', aggregateId: 't1', projectId: 'p1', threadId: 'th1' }) as const
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        yield* Effect.forkScoped(
          Layer.launch(
            RpcServer.layer(Newer).pipe(
              Layer.provide(
                Newer.toLayer({ Watch: () => Stream.make(changed(1), { _tag: 'Weather', sky: 'clear' } as const, changed(2)) }),
              ),
              Layer.provide(serverProtocol(emitterPort(channel.port1, (data) => data))),
            ),
          ),
        )
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))

        const heard = yield* Stream.runCollect(client.Watch({}))
        assert.deepStrictEqual(
          heard.map((event) => event._tag),
          ['Changed', 'Unknown', 'Changed'],
        )
        assert.deepStrictEqual(
          heard.filter(isKnownEvent).map((event) => event._tag === 'Changed' && event.cursor),
          [1, 2],
        )
      }),
    ),
  )
})

describe('a home', () => {
  it('sends only what its contract lists, never a fallback', () => {
    const Role = OpenLiterals(['aside', 'relayed'], 'unknown')
    assert.strictEqual(Schema.encodeUnknownSync(Role)('aside'), 'aside')
    assert.throws(() => Schema.encodeUnknownSync(Role)('unknown'))
    assert.throws(() => Schema.encodeUnknownSync(HeardEvent)({ _tag: 'Unknown' }))
    assert.throws(() => Schema.encodeUnknownSync(ThreadItems)([{ kind: 'unknown' }]))
    // What it knows encodes as before.
    const item = Schema.decodeUnknownSync(ThreadItem)(said)
    assert.deepStrictEqual(Schema.encodeUnknownSync(ThreadItems)([item]), Schema.encodeUnknownSync(Schema.Array(ThreadItem))([item]))
  })

  it.live('fails a watch it would answer with a fallback, rather than sending it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        const Watching = RpcGroup.make(Rpc.make('Watch', { payload: {}, success: HeardEvent, error: ApiError, stream: true })).middleware(
          ClientAuthority,
        )
        yield* Effect.forkScoped(
          Layer.launch(
            RpcServer.layer(Watching).pipe(
              Layer.provide(Layer.succeed(ClientAuthority, (effect) => effect)),
              Layer.provide(Watching.toLayer({ Watch: () => Stream.make({ _tag: 'Unknown' } as const) })),
              Layer.provide(serverProtocol(emitterPort(channel.port1, (data) => data))),
            ),
          ),
        )
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        const client = yield* RpcClient.make(Watching).pipe(Effect.provideContext(protocol))
        const exit = yield* Effect.exit(Stream.runCollect(client.Watch({})))
        assert.include(exit._tag === 'Failure' ? Cause.pretty(exit.cause) : 'sent', 'never sent')
      }),
    ),
  )

  it('takes members only as structs that say their tag', () => {
    assert.throws(() => OpenUnion('_tag', [Schema.Struct({ name: Schema.String })], 'Unknown'))
    assert.throws(() => OpenUnion('_tag', [Schema.Struct({ _tag: Schema.Literal('Unknown') })], 'Unknown'))
  })
})
