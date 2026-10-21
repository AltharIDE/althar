/*
 * What the phone would do with Althar's contract, run as a script: decode and
 * encode a home, call the runtime over the contract's own port transport, and
 * call it again over a WebSocket-shaped pipe carrying JSON, as the relay will.
 * Each check prints PASS or FAIL; `run()` resolves to the number that failed.
 */
import { Cause, Effect, Exit, Fiber, Layer, Queue, Scheduler, Schema, Stream } from 'effect'
import { RpcClient, RpcSerialization, RpcServer } from 'effect/rpc'
import { Socket, SocketServer } from 'effect/socket'

import {
  Api,
  ApiError,
  AttentionRequest,
  clientProtocol,
  type HomeSnapshot as HomeSnapshotType,
  HomeSnapshot,
  type PortLike,
  serverProtocol,
  TaskCard,
  type WatchEvent,
} from '@althar/contracts'

import { scenario } from './fixtures/scenario'

const log = (line: string) => console.log(line)
let failed = 0
let passed = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) passed += 1
  else failed += 1
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`)
}
const errorText = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}` : String(error)
/** Equal as JSON, whatever order the keys come in. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .filter((key) => (value as any)[key] !== undefined)
            .sort()
            .map((key) => [key, canonical((value as any)[key])]),
        )
      : value
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

const NOW = Date.parse('2026-10-21T12:00:00.000Z')
const world = scenario(NOW)
const home: HomeSnapshotType = {
  cursor: 42,
  looked: world.looked,
  since: world.looked,
  tasks: world.tasks,
  calls: world.calls,
  events: world.events,
  projects: world.projects,
}

/* 1. Schemas ------------------------------------------------------------------ */

const schemas = () => {
  log(`-- 1. schemas: a HomeSnapshot of ${home.projects.length} projects, ${home.tasks.length} tasks, ${home.calls.length} calls, ${home.events.length} events`)
  try {
    const encoded = Schema.encodeSync(HomeSnapshot)(home)
    const wire = JSON.parse(JSON.stringify(encoded))
    const decoded = Schema.decodeUnknownSync(HomeSnapshot)(wire)
    check('HomeSnapshot encodes, survives JSON, and decodes to the same value', same(decoded, home), `${JSON.stringify(wire).length} bytes of JSON`)
  } catch (error) {
    check('HomeSnapshot encodes, survives JSON, and decodes to the same value', false, errorText(error))
  }

  try {
    const permission = home.calls.find((call) => call.kind === 'permission')
    const decoded = Schema.decodeUnknownSync(AttentionRequest)(JSON.parse(JSON.stringify(permission)))
    check('a permission call decodes as an AttentionRequest', decoded.kind === 'permission' && decoded.id === permission?.id, `${decoded.id}: ${decoded.title}`)
    const stuck = home.calls.find((call) => call.kind === 'stuck' || call.kind === 'question')
    if (stuck) {
      const other = Schema.decodeUnknownSync(AttentionRequest)(JSON.parse(JSON.stringify(stuck)))
      check(`a ${stuck.kind} call decodes as an AttentionRequest`, other.kind === stuck.kind)
    }
  } catch (error) {
    check('a permission call decodes as an AttentionRequest', false, errorText(error))
  }

  try {
    const task = home.tasks[0]!
    const card = Schema.decodeUnknownSync(TaskCard)(JSON.parse(JSON.stringify(task)))
    const back = Schema.encodeSync(TaskCard)(card)
    check('a task card decodes and encodes', card.taskId === task.taskId && back.title === task.title, `${card.title} (${card.phase})`)
  } catch (error) {
    check('a task card decodes and encodes', false, errorText(error))
  }

  // A home the runtime should never send: a negative cursor, an unknown call kind, a task without a title.
  const broken = JSON.parse(JSON.stringify(home))
  broken.cursor = -1
  broken.calls[0].kind = 'telepathy'
  delete broken.tasks[0].title
  try {
    Schema.decodeUnknownSync(HomeSnapshot)(broken, { errors: 'all' })
    check('a broken HomeSnapshot fails to decode', false, 'it decoded')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const readable = message.includes('["cursor"]') && message.includes('["calls"][0]["kind"]') && message.includes('["tasks"][0]["title"]')
    check('a broken HomeSnapshot fails to decode, with a readable error naming each path', readable)
    log(message.split('\n').slice(0, 14).map((line) => `     | ${line}`).join('\n'))
  }
}

/* The server's side: three of the API's handlers, over a subset of the real group. ---- */

const served = ['GetHome', 'Answer', 'Watch'] as const
const Phone = Api.omit(...([...Api.requests.keys()].filter((tag) => !(served as ReadonlyArray<string>).includes(tag)) as Array<any>))

const answered: Array<string> = []
const watchEvents: ReadonlyArray<WatchEvent> = [
  { _tag: 'Changed', cursor: 43, aggregateType: 'task', aggregateId: home.tasks[0]!.taskId, projectId: home.tasks[0]!.projectId, threadId: home.tasks[0]!.threadId },
  { _tag: 'Streaming', threadId: home.tasks[0]!.threadId, itemId: 'item_1', kind: 'agent_message', agentId: 'claude-code', text: 'Running the tests now…' },
  { _tag: 'Context', threadId: home.tasks[0]!.threadId, used: 51_200, size: 200_000 },
  { _tag: 'Changed', cursor: 44, aggregateType: 'attention', aggregateId: home.calls[0]!.id, projectId: home.calls[0]!.projectId, threadId: null },
]

const handlers = (Phone as any).toLayer({
  GetHome: ({ since }: { since?: string }) => Effect.succeed({ ...home, since: since ?? home.since }),
  Answer: ({ attentionId, decision }: { attentionId: string; decision: string }) =>
    home.calls.some((call) => call.id === attentionId)
      ? Effect.sync(() => void answered.push(`${attentionId}:${decision}`))
      : Effect.fail(new ApiError({ reason: 'NotFound', message: `No call ${attentionId} waits on you.` })),
  // As the runtime's does: what has happened since, then whatever happens, for as long as the client watches.
  Watch: ({ since }: { since?: number }) =>
    Stream.concat(Stream.fromIterable(watchEvents.filter((event) => event._tag !== 'Changed' || event.cursor > (since ?? 0))), Stream.never),
}) as Layer.Layer<never>

const commandId = () => {
  let hex = ''
  for (let i = 0; i < 32; i += 1) hex += Math.floor(Math.random() * 16).toString(16)
  return `cmd_${hex}`
}

/** What a phone does with a client, whichever pipe it rides on. */
const conversation = (label: string, client: any) =>
  Effect.gen(function* () {
    const got = yield* client.GetHome({ since: '2026-10-21T10:00:00.000Z' })
    check(`${label}: GetHome returns the home, decoded`, got.since === '2026-10-21T10:00:00.000Z' && same({ ...got, since: home.since }, home), `${got.tasks.length} tasks, ${got.calls.length} calls`)

    const call = home.calls.find((one) => one.kind === 'permission')!
    yield* client.Answer({ commandId: commandId(), attentionId: call.id, decision: 'allow' })
    check(`${label}: Answer reaches the server`, answered.includes(`${call.id}:allow`))

    const refused = yield* Effect.flip(client.Answer({ commandId: commandId(), attentionId: 'att_gone', decision: 'reject' }))
    check(`${label}: an unknown call fails with a typed ApiError`, refused instanceof ApiError && (refused as ApiError).reason === 'NotFound', String((refused as ApiError).message))

    const invalid = yield* Effect.exit(client.Answer({ commandId: 'not-a-command-id', attentionId: call.id, decision: 'allow' }))
    check(`${label}: a malformed command id is refused by the schema`, Exit.isFailure(invalid), Exit.isFailure(invalid) ? Cause.pretty(invalid.cause).split('\n')[0] : 'it succeeded')

    // Watch never ends on its own; the phone takes what it needs and stops watching.
    const events = (yield* Stream.runCollect(Stream.take(client.Watch({ since: 42 }), 3))) as Array<WatchEvent>
    check(`${label}: Watch streams events, and stops when the client has enough`, events.length === 3 && events.map((event) => event._tag).join(',') === 'Changed,Streaming,Context', events.map((event) => event._tag).join(', '))

    // A watch left open doesn't hold up other calls.
    const open = yield* Effect.forkChild(Stream.runDrain(client.Watch({})))
    const again = yield* client.GetHome({})
    check(`${label}: calls still answer while a Watch stays open`, again.cursor === home.cursor)
    yield* Fiber.interrupt(open)
  })

/* 2. The contract's own transport, over an in-memory port pair --------------------- */

/** Two ends of a pipe that, like a MessagePort, delivers each message later, never during `post`. */
const portPair = (): [PortLike, PortLike] => {
  const make = () => {
    const listeners = new Set<(data: unknown) => void>()
    const closers = new Set<() => void>()
    return { listeners, closers }
  }
  const a = make()
  const b = make()
  const end = (mine: ReturnType<typeof make>, theirs: ReturnType<typeof make>): PortLike => ({
    post: (message) => {
      Promise.resolve().then(() => {
        for (const listener of [...theirs.listeners]) listener(message)
      })
    },
    listen: (handler) => {
      mine.listeners.add(handler)
      return () => mine.listeners.delete(handler)
    },
    closed: (handler) => {
      mine.closers.add(handler)
      return () => mine.closers.delete(handler)
    },
  })
  return [end(a, b), end(b, a)]
}

const overPorts = Effect.scoped(
  Effect.gen(function* () {
    log('-- 2. RPC over the contract transport (clientProtocol/serverProtocol, in-memory PortLike pair)')
    const [serverEnd, clientEnd] = portPair()
    yield* Effect.forkScoped(Layer.launch(RpcServer.layer(Phone as any).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(serverEnd))) as any))
    const protocol = yield* Layer.build(clientProtocol(clientEnd))
    // The full API, as the phone's client would make it: every call, of which the server answers three.
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    check('ports: RpcClient.make(Api) builds a client for the whole API', typeof (client as any).GetHome === 'function', `${Api.requests.size} calls`)
    yield* conversation('ports', client)
  }),
)

/* 3. JSON over a WebSocket, as the relay will carry it -------------------------------- */

/** An in-memory WebSocket pair, shaped as RN's (and the browser's) global WebSocket. */
class MemorySocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0
  binaryType = 'blob'
  peer!: MemorySocket
  frames: Array<unknown> = []
  private listeners = new Map<string, Set<{ fn: (event: any) => void; once: boolean }>>()
  constructor(readonly url: string) {}
  /** Frames that came before anyone listened, as a server's socket holds them until its handler reads. */
  private unread: Array<any> = []
  addEventListener(type: string, fn: (event: any) => void, options?: { once?: boolean }) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add({ fn, once: options?.once === true })
    if (type === 'message' && this.unread.length > 0) {
      const unread = this.unread
      this.unread = []
      setTimeout(() => unread.forEach((event) => this.dispatch('message', event)), 0)
    }
  }
  removeEventListener(type: string, fn: (event: any) => void) {
    for (const entry of this.listeners.get(type) ?? []) if (entry.fn === fn) this.listeners.get(type)!.delete(entry)
  }
  dispatch(type: string, event: any) {
    if (type === 'message' && (this.listeners.get('message')?.size ?? 0) === 0) return void this.unread.push(event)
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      if (entry.once) this.listeners.get(type)!.delete(entry)
      entry.fn(event)
    }
  }
  open() {
    if ((globalThis as any).__SPIKE_DEBUG) log(`     [ws ${this.url === 'mac' ? 'mac' : 'phone'}] open`)
    this.readyState = 1
    this.dispatch('open', { type: 'open' })
  }
  send(data: unknown) {
    if (this.readyState !== 1) throw new Error('WebSocket is not open')
    this.frames.push(data)
    if ((globalThis as any).__SPIKE_DEBUG) log(`     [ws] send ${String(data).slice(0, 60)}`)
    const peer = this.peer
    setTimeout(() => peer.readyState === 1 && peer.dispatch('message', { type: 'message', data }), 0)
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return
    this.readyState = 3
    const peer = this.peer
    setTimeout(() => {
      this.dispatch('close', { type: 'close', code, reason })
      if (peer.readyState < 2) {
        peer.readyState = 3
        peer.dispatch('close', { type: 'close', code, reason })
      }
    }, 0)
  }
}

const overWebSocket = (format: 'json' | 'ndjson') =>
  Effect.scoped(
    Effect.gen(function* () {
      log(`-- 3. RPC over a WebSocket with RpcSerialization.${format} (RpcClient.layerProtocolSocket / RpcServer.layerProtocolSocketServer)`)
      const incoming = yield* Queue.unbounded<MemorySocket>()
      const phoneSockets: Array<MemorySocket> = []
      const relay = SocketServer.SocketServer.of({
        address: { _tag: 'TcpAddress', hostname: 'relay.memory', port: 443 } as any,
        run: (handler) =>
          Effect.gen(function* () {
            while (true) {
              const ws = yield* Queue.take(incoming)
              const socket = yield* Socket.fromWebSocket(Effect.succeed(ws as any))
              yield* Effect.forkChild(handler(socket))
            }
          }) as any,
      })
      // What `new WebSocket(url)` does on the phone: dial, and the other end is the Mac's runtime.
      const dial = (url: string) => {
        const phone = new MemorySocket(url)
        const mac = new MemorySocket(url)
        phone.peer = mac
        mac.peer = phone
        phoneSockets.push(phone)
        setTimeout(() => {
          mac.open()
          phone.open()
          Queue.offerUnsafe(incoming, mac)
        }, 0)
        return phone as unknown as globalThis.WebSocket
      }
      const serialization = format === 'json' ? RpcSerialization.layerJson : RpcSerialization.layerNdjson

      const server = RpcServer.layer(Phone as any).pipe(
        Layer.provide(handlers),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(Layer.mergeAll(Layer.succeed(SocketServer.SocketServer, relay), serialization)),
      )
      yield* Effect.forkScoped(Layer.launch(server as any))

      const protocol = yield* Layer.build(
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide(
            Layer.mergeAll(
              Socket.layerWebSocket('wss://relay.memory/pair/abc').pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, dial as any))),
              serialization,
            ),
          ),
        ),
      )
      const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      yield* conversation(format, client)

      const frames = phoneSockets.flatMap((socket) => socket.frames)
      const texts = frames.filter((frame): frame is string => typeof frame === 'string')
      let parsed = 0
      for (const text of texts) {
        for (const line of format === 'ndjson' ? text.split('\n').filter(Boolean) : [text]) {
          JSON.parse(line)
          parsed += 1
        }
      }
      check(`${format}: every frame the phone sent is JSON text`, frames.length > 0 && texts.length === frames.length && parsed >= frames.length, `${frames.length} frames, e.g. ${texts.find((text) => text.includes('Answer'))?.slice(0, 160)}`)
    }),
  )

/* 4. Scheduling as React Native's bridgeless runtime does it ---------------------------- */

/*
 * In bridgeless mode (the only architecture since RN 0.82) `setImmediate` is
 * a shim over `queueMicrotask`. Effect's default scheduler yields a busy
 * fiber every 2048 operations through `setImmediate` when there is one, so on
 * RN those yields are microtasks: a timer (or a touch, or a WebSocket message)
 * waits until the fiber is done. This measures when a 0 ms timer runs while a
 * fiber does 200,000 steps, with each kind of `setImmediate`.
 */
const STEPS = 200_000
/** A scheduler whose yields are macrotasks whatever `setImmediate` is: what the app could provide. */
const yieldingScheduler = new Scheduler.MixedScheduler('async', (fn) => {
  const timer = setTimeout(fn, 0)
  return () => clearTimeout(timer)
})
const starvation = (label: string, setImmediateFn: ((fn: () => void) => unknown) | undefined, scheduler?: Scheduler.Scheduler) =>
  new Promise<void>((resolve) => {
    const g = globalThis as any
    const original = g.setImmediate
    if (setImmediateFn) g.setImmediate = setImmediateFn
    let ops = 0
    let opsWhenTimerFired = -1
    const began = Date.now()
    setTimeout(() => {
      opsWhenTimerFired = ops
    }, 0)
    const busy = Effect.gen(function* () {
      for (let i = 0; i < STEPS; i += 1) yield* Effect.sync(() => (ops += 1))
    })
    Effect.runPromise(scheduler ? Effect.provideService(busy, Scheduler.Scheduler, scheduler) : busy).then(() => {
      const took = Date.now() - began
      setTimeout(() => {
        g.setImmediate = original
        const when = opsWhenTimerFired < 0 ? 'only after it finished' : opsWhenTimerFired >= STEPS ? 'only after it finished' : `after ${opsWhenTimerFired} steps`
        log(`     ${label}: the timer ran ${when} (fiber took ${took} ms)`)
        resolve()
      }, 1)
    })
  })

export const run = async (): Promise<number> => {
  const started = Date.now()
  schemas()
  for (const [name, program] of [
    ['ports', overPorts],
    ['json', overWebSocket('json')],
    ['ndjson', overWebSocket('ndjson')],
  ] as const) {
    const exit = await Effect.runPromiseExit(program.pipe(Effect.timeout('10 seconds')) as Effect.Effect<unknown, unknown>)
    if (Exit.isFailure(exit)) check(`${name}: the round trip completes`, false, Cause.pretty(exit.cause).split('\n').slice(0, 12).join('\n'))
  }
  log('-- 4. scheduling: does a busy fiber let timers run?')
  await starvation('setImmediate as a macrotask (setTimeout 0, as browsers/Node yield)', (fn) => setTimeout(fn, 0))
  const rnShim = (fn: () => void) => {
    Promise.resolve().then(fn)
    return 0
  }
  await starvation('setImmediate as RN bridgeless shims it (queueMicrotask)', rnShim)
  await starvation("RN's shim, with Effect's scheduler given setTimeout to yield with", rnShim, yieldingScheduler)
  log(`== ${passed} passed, ${failed} failed (${Date.now() - started} ms)`)
  return failed
}
