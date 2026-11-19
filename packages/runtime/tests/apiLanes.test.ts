import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, BACKGROUND, clientProtocol, emitterPort, LANE_HEADER, type WatchEvent } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Context, Deferred, Duration, Effect, Fiber, Layer, Queue, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

import { Behind, BEHIND_AT_ONCE, connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { deltasFor, Live, newestOf, SENT_KEPT, type Watched, watchedKey, watchedOf } from '../src/Live'
import { Secrets } from '../src/Secrets'
import { addItem } from '../src/threads'

import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * How the API keeps a press quick while agents work: reads the window's feed
 * starts go behind, a few at a time; what streams goes as what was added,
 * the newest of each to a watch that fell behind; and what a burst of changes
 * touched in a thread is read in one call.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a window's client on the other. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      agentsRoot: mkdtempSync(join(tmpdir(), 'althar-agents-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(
    Layer.launch(
      connection(
        emitterPort(channel.port1, (data) => data),
        { kind: 'window' },
      ),
    ).pipe(Effect.provideContext(context)),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  const grant = (path: string) => Context.get(context, Folders).allow(path)
  const store = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideContext(context as Context.Context<R>))
  return { client, grant, store, context }
})

const behind = { headers: { [LANE_HEADER]: BACKGROUND } }

describe('a read nobody waits on, through the API', () => {
  it.live('goes behind, a few at a time, and a press and a read a screen waits on are answered meanwhile', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, context } = yield* connected
        const lane = Context.get(context, Behind)
        // The lane is busy: every place in it is taken, as by reads under way.
        yield* lane.take(BEHIND_AT_ONCE)
        const queued = yield* Effect.forEach([1, 2, 3, 4, 5], () => Effect.forkChild(client.ListProjects(undefined, behind)))
        // A press goes on past them: it is answered while every one of them still waits.
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        // So does a read a screen waits on.
        const listed = yield* client.ListProjects()
        assert.deepStrictEqual(
          listed.projects.map((one) => one.id),
          [project.id],
        )
        // And a small read nobody waits on: only the store's large ones keep a place in the lane.
        assert.isDefined(yield* client.GetSettings({}, behind))
        for (const fiber of queued) assert.isUndefined(fiber.pollUnsafe())
        // Once the lane frees, they are answered, in turn.
        yield* lane.release(BEHIND_AT_ONCE)
        for (const fiber of queued)
          assert.deepStrictEqual(
            (yield* Fiber.join(fiber)).projects.map((one) => one.id),
            [project.id],
          )
      }),
    ),
  )

  it.live('never holds a watch in the lane, however it is asked', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, context } = yield* connected
        const watching = yield* Effect.forkChild(
          Stream.runHead(Stream.filter(client.Watch({}, behind), (event) => event._tag === 'Changed')),
        )
        // Listening before anything changes.
        yield* Effect.sleep('50 millis')
        yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        assert.strictEqual((yield* Fiber.join(watching))._tag, 'Some')
        // Its place was never taken: every one is free for the reads that go behind.
        assert.isTrue(yield* Context.get(context, Behind).takeIfAvailable(BEHIND_AT_ONCE))
      }),
    ),
  )
})

describe('what streams to a watch, through the API', () => {
  const streaming = (itemId: string, text: string) =>
    ({
      _tag: 'Streaming',
      threadId: 'thread_1',
      itemId,
      sequence: 4,
      kind: 'agent_message',
      agentId: 'codex',
      text,
    }) as const

  it.live('comes whole to a watch that didn’t ask for deltas, and as what was added to one that did', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, context } = yield* connected
        const live = Context.get(context, Live)
        // What each watch hears, as it hears it.
        const heard = (deltas: boolean) =>
          Effect.gen(function* () {
            const said = yield* Queue.unbounded<readonly [string, number | undefined]>()
            yield* Effect.forkChild(
              Stream.runForEach(client.Watch(deltas ? { deltas } : {}), (event) =>
                event._tag === 'Streaming' ? Queue.offer(said, [event.text, event.offset] as const) : Effect.void,
              ),
            )
            return said
          })
        const whole = yield* heard(false)
        const added = yield* heard(true)
        // Both listening before anything streams.
        yield* Effect.sleep('100 millis')
        const sent: Array<ReadonlyArray<readonly [string, number | undefined]>> = []
        // Each heard before the next streams, so no watch is behind and has it in place of the one before.
        for (const text of ['Look', 'Looking at', 'Looking at it.']) {
          yield* live.publish(streaming('item_1', text))
          sent.push([yield* Queue.take(whole), yield* Queue.take(added)])
        }
        assert.deepStrictEqual(sent, [
          [
            ['Look', undefined],
            ['Look', 0],
          ],
          [
            ['Looking at', undefined],
            ['ing at', 4],
          ],
          [
            ['Looking at it.', undefined],
            [' it.', 10],
          ],
        ])
      }),
    ),
  )
})

describe('a watch opened while the coordinator drafts', () => {
  it.live('is told what is being drafted at once, not only at its next change, and nothing once drafting is over', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, context } = yield* connected
        const live = Context.get(context, Live)
        const sizing = {
          key: 'draft_1',
          title: 'Explore the roles',
          brief: true,
          taskId: 't1',
          slug: 'explore-the-roles',
          planning: false,
          lead: null,
          review: null,
          noReview: false,
          preset: null,
          planned: false,
          held: false,
          unplanned: false,
          discarded: false,
        }
        // Drafted before the window watched: a draft elsewhere, then one that is over.
        yield* live.publish({ _tag: 'Drafting', threadId: 'th1', drafts: [sizing] })
        yield* live.publish({ _tag: 'Drafting', threadId: 'th2', drafts: [{ ...sizing, key: 'draft_2', taskId: 't2' }] })
        yield* live.publish({ _tag: 'Drafting', threadId: 'th2', drafts: [] })
        const heard = yield* Stream.runHead(
          Stream.filter(client.Watch({}), (event): event is Extract<WatchEvent, { _tag: 'Drafting' }> => event._tag === 'Drafting'),
        ).pipe(Effect.timeout('5 seconds'))
        assert.deepStrictEqual(heard._tag === 'Some' ? [heard.value.threadId, heard.value.drafts] : null, ['th1', [sizing]])
      }),
    ),
  )
})

describe('what a watch that fell behind is sent', () => {
  it.effect('is the newest of each thing, in the order each last changed, and nothing of the rest', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const streamed = (itemId: string, text: string): Watched => ({
          _tag: 'Streaming',
          threadId: 'thread_1',
          itemId,
          sequence: 1,
          kind: 'agent_message',
          agentId: 'codex',
          text,
        })
        const events: ReadonlyArray<Watched> = [
          ...['a', 'ab', 'abc'].map((text) => streamed('item_1', text)),
          { _tag: 'Context', threadId: 'thread_1', used: 1, size: 10 },
          { _tag: 'Output', threadId: 'thread_1', itemId: 'item_2', text: 'one', dropped: 0 },
          { _tag: 'Context', threadId: 'thread_1', used: 5, size: 10 },
          { _tag: 'Context', threadId: 'thread_2', used: 2, size: 10 },
          { _tag: 'Launches', projectId: 'proj_1', launches: [] },
        ]
        // All of it comes while the watch takes nothing, and is taken as it comes all the same.
        const taken = yield* Deferred.make<void>()
        const newest = yield* newestOf(
          Stream.concat(Stream.fromIterable(events), Stream.drain(Stream.fromEffect(Deferred.succeed(taken, undefined)))),
          watchedKey,
        )
        yield* Deferred.await(taken)
        const sent = yield* Stream.runCollect(Stream.take(newest, 5))
        assert.deepStrictEqual(
          sent.map((event) => watchedKey(event)),
          ['Streaming:item_1', 'Output:item_2', 'Context:thread_1', 'Context:thread_2', 'Launches:proj_1'],
        )
        assert.deepStrictEqual(sent[0]?._tag === 'Streaming' ? sent[0].text : undefined, 'abc')
        assert.deepStrictEqual(sent[2]?._tag === 'Context' ? sent[2].used : undefined, 5)
      }),
    ),
  )

  it('is what a client shows of what happens now, and nothing that is the runtime’s own', () => {
    const shown = [
      watchedOf({ _tag: 'Streaming', threadId: 't', itemId: 'i', sequence: 2, kind: 'agent_message', agentId: 'codex', text: 'Hi' }),
      watchedOf({ _tag: 'Output', threadId: 't', itemId: 'i', text: 'ok', dropped: 1 }),
      watchedOf({ _tag: 'Agent', threadId: 't', event: { _tag: 'ContextUsage', used: 3, size: 9 } }),
      watchedOf({ _tag: 'Background', threadId: 't', background: [] }),
      watchedOf({ _tag: 'Launches', projectId: 'p', launches: [] }),
      watchedOf({ _tag: 'Drafting', threadId: 't', drafts: [] }),
    ]
    assert.deepStrictEqual(
      shown.map((event) => (event === undefined ? undefined : watchedKey(event))),
      ['Streaming:i', 'Output:i', 'Context:t', 'Background:t', 'Launches:p', 'Drafting:t'],
    )
    assert.deepStrictEqual(shown[2], { _tag: 'Context', threadId: 't', used: 3, size: 9 })
    // An agent's other events, and the runtime's turns and sessions, are not a client's to be sent this way.
    assert.isUndefined(watchedOf({ _tag: 'Agent', threadId: 't', event: { _tag: 'AgentMessage', text: 'Hi' } }))
    assert.isUndefined(watchedOf({ _tag: 'TurnStarted', threadId: 't', turnId: 'turn' }))
    assert.isUndefined(watchedOf({ _tag: 'PersonSaid', threadId: 't' }))
  })

  it('sends a message whole the first time, then what was added, and whole again once it is forgotten', () => {
    const sent = deltasFor()
    const streamed = (itemId: string, text: string): WatchEvent => ({
      _tag: 'Streaming',
      threadId: 'thread_1',
      itemId,
      sequence: 1,
      kind: 'agent_thought',
      agentId: 'codex',
      text,
    })
    const said = (event: WatchEvent | undefined) => (event?._tag === 'Streaming' ? [event.text, event.offset] : event)
    assert.deepStrictEqual(said(sent(streamed('item_1', 'Thinking'))), ['Thinking', 0])
    assert.deepStrictEqual(said(sent(streamed('item_1', 'Thinking it over'))), [' it over', 8])
    // Nothing came since: nothing is sent.
    assert.isUndefined(sent(streamed('item_1', 'Thinking it over')))
    // What isn't a message goes as it is.
    const output: WatchEvent = { _tag: 'Output', threadId: 'thread_1', itemId: 'item_9', text: 'ok', dropped: 0 }
    assert.strictEqual(sent(output), output)
    // Past what it remembers, the first message is sent whole again.
    for (let n = 0; n < SENT_KEPT; n++) sent(streamed(`other_${n}`, 'x'))
    assert.deepStrictEqual(said(sent(streamed('item_1', 'Thinking it over.'))), ['Thinking it over.', 0])
  })
})

describe('several items of a thread, through the API', () => {
  it.live('come in one call: those the thread shows, each as it is read alone', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, store } = yield* connected
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Read them together' })
        const place = { projectId: project.id as ProjectId, threadId: task.threadId }
        const first = yield* store(addItem(place, 'agent_message', { text: 'One' }))
        const second = yield* store(addItem(place, 'agent_message', { text: 'Two' }))
        // What its lead could see, which the thread keeps for Althar and never shows.
        const hidden = yield* store(
          addItem(place, 'notice', { source: 'runtime', severity: 'info', role: 'skills', title: 'x', hidden: true, skills: [] }),
        )
        const read = yield* client.GetThreadItems({ threadId: task.threadId, itemIds: [second, first, hidden, 'item_gone', first] })
        assert.sameMembers(
          read.map((item) => item.id),
          [first, second],
        )
        for (const item of read) assert.deepStrictEqual(item, yield* client.GetThreadItem({ threadId: task.threadId, itemId: item.id }))
        assert.isEmpty(yield* client.GetThreadItems({ threadId: task.threadId, itemIds: [] }))
      }),
    ),
  )
})
