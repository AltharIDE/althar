import { Effect, Stream } from 'effect'

import type { Follows } from './follow'

/*
 * A window of the desktop app, as the responsiveness run has one: it follows
 * the runtime's change feed over its own connection and reads again what the
 * app's window would (follow.ts, from feed.ts, useTask.ts, useProject.ts and
 * useEdge.ts), timing each read; and it makes the calls the run asks of it,
 * as the person's presses do. It runs on a thread of its own (windowWorker.ts),
 * as a window runs in a process of its own, so what it decodes is never the
 * runtime's thread's work.
 */

export interface WindowSetup {
  readonly name: string
  /** A window of the app, or the edge (the notch, or the menu bar's sheet), which reads only the home. */
  readonly kind: 'window' | 'edge'
  readonly projectId: string
  /** The task whose screen is open, by its thread: read item by item as it changes. */
  readonly thread?: string
  /** The project's screen is open: its coordinator's thread, read item by item as it changes, its cards too. */
  readonly coordinator?: boolean
  readonly follows: Follows
}

/** What the run asks of a window, and what it answers. */
export type Asked =
  | { readonly op: 'call'; readonly id: number; readonly method: string; readonly payload?: unknown; readonly want?: boolean }
  | { readonly op: 'burst'; readonly id: number; readonly method: string; readonly payloads: ReadonlyArray<unknown> }
  | { readonly op: 'stats'; readonly id: number; readonly reset: boolean }
  | { readonly op: 'stop'; readonly id: number }

export interface Answer {
  readonly id: number
  readonly ms?: number
  readonly each?: ReadonlyArray<number>
  readonly ok?: boolean
  readonly error?: string
  /** The call doesn't exist on this commit's API. */
  readonly missing?: boolean
  readonly value?: unknown
  readonly stats?: WindowStats
}

export interface WindowStats {
  readonly name: string
  /** How long it has watched since it was last reset, in ms. */
  readonly ms: number
  /** Each read it made of its own, following the feed, by what it read: how long each took, in ms. */
  readonly reads: Readonly<Record<string, ReadonlyArray<number>>>
  readonly failed: Readonly<Record<string, number>>
  /** What its watch delivered, by event: how many, and their size as JSON. */
  readonly watched: Readonly<Record<string, { readonly n: number; readonly bytes: number }>>
  /** The changes it heard, by what changed. */
  readonly changed: Readonly<Record<string, number>>
  /** The connection broke, and why. */
  readonly broke: string | null
}

type Call = (payload?: unknown) => unknown
type Client = Readonly<Record<string, Call | undefined>>

interface Item {
  readonly id: string
  readonly kind: string
  readonly input?: { readonly state?: string } | null
  readonly content?: { readonly taskId?: string }
}

/** What still waits its turn among the items a screen holds (renderer shared/items.ts `waiting`). */
const waiting = (items: ReadonlyMap<string, Item>) =>
  [...items.values()].flatMap((item) => (item.kind === 'user_message' && item.input?.state === 'queued' ? [item.id] : []))

export const runWindow = (client: Client, setup: WindowSetup, post: (answer: Answer) => void) => {
  const { follows } = setup
  let began = performance.now()
  let reads = new Map<string, Array<number>>()
  let failed = new Map<string, number>()
  let watched = new Map<string, { n: number; bytes: number }>()
  let changed = new Map<string, number>()
  let broke: string | null = null

  const call = async (method: string, payload?: unknown): Promise<unknown> => {
    const made = client[method]?.(payload)
    if (made === undefined) throw new Error(`no call ${method}`)
    return Effect.runPromise(made as Effect.Effect<unknown, unknown>)
  }
  /** A read the window makes of its own, timed under `what`. */
  const timed = async (what: string, method: string, payload?: unknown) => {
    const start = performance.now()
    try {
      return await call(method, payload)
    } catch {
      failed.set(what, (failed.get(what) ?? 0) + 1)
      return undefined
    } finally {
      const list = reads.get(what) ?? []
      list.push(performance.now() - start)
      reads.set(what, list)
    }
  }

  /* The whole reads (feed.ts `wholeReads`): one at a time each, read once more as it ends where a change came meanwhile. */
  const whole = new Map<string, { running: boolean; again: boolean }>()
  const readWhole = (key: string, what: string, method: string, payload?: unknown): void => {
    const state = whole.get(key) ?? { running: false, again: false }
    whole.set(key, state)
    if (state.running && follows.oneAtATime) return void (state.again = true)
    state.running = true
    void timed(what, method, payload).finally(() => {
      state.running = false
      if (state.again) {
        state.again = false
        readWhole(key, what, method, payload)
      }
    })
  }
  const due = new Map<string, () => void>()
  let gathering: ReturnType<typeof setTimeout> | undefined
  const gather = (key: string, read: () => void, ms: number) => {
    due.set(key, read)
    gathering ??= setTimeout(() => {
      gathering = undefined
      const now = [...due.values()]
      due.clear()
      for (const one of now) one()
    }, ms)
  }

  /* A thread on screen (useTask.ts, useProject.ts): what changed, item by item, and its head where anything else did. */
  const screen = (what: 'thread' | 'coordinator') => {
    const items = new Map<string, Item>()
    // A coordinator's thread is named by its first read.
    let threadId = what === 'thread' ? (setup.thread ?? '') : ''
    let changes = { head: false, cards: false, automations: false, items: new Set<string>(), tasks: new Set<string>() }
    let timer: ReturnType<typeof setTimeout> | undefined
    const keep = (value: unknown) => {
      const page = value as { readonly threadId?: string; readonly items?: ReadonlyArray<Item> } | undefined
      if (page?.threadId !== undefined) threadId = page.threadId
      for (const item of page?.items ?? []) items.set(item.id, item)
    }
    const readItems = (ids: Iterable<string>) =>
      Promise.all(
        [...ids].map((itemId) =>
          timed(`${what}.item`, 'GetThreadItem', { threadId, itemId }).then((item) =>
            item === null ? void items.delete(itemId) : item === undefined ? undefined : void items.set(itemId, item as Item),
          ),
        ),
      )
    const readHead = (also: Iterable<string>) =>
      timed(
        `${what}.head`,
        what === 'thread' ? 'GetThread' : 'GetCoordinator',
        what === 'thread' ? { threadId, limit: 0 } : { projectId: setup.projectId, limit: 0 },
      ).finally(() => readItems(new Set([...also, ...waiting(items)])))
    const readChanged = () => {
      timer = undefined
      const now = changes
      changes = { head: false, cards: false, automations: false, items: new Set(), tasks: new Set() }
      const read = new Set(now.items)
      // Every task card it holds, as at 9cde0f5; or, where the app's source no longer says so, those of the tasks that changed.
      for (const item of items.values())
        if (now.cards && item.kind === 'task' && (follows.everyCard || now.tasks.has(item.content?.taskId ?? ''))) read.add(item.id)
      if (now.automations) for (const item of items.values()) if (item.kind === 'automation') read.add(item.id)
      void (now.head ? readHead(read) : readItems(read))
    }
    const open = async () =>
      keep(
        await timed(
          `${what}.open`,
          what === 'thread' ? 'GetThread' : 'GetCoordinator',
          what === 'thread' ? { threadId } : { projectId: setup.projectId },
        ),
      )
    const heard = (event: Changed) => {
      if (what === 'coordinator' && event.threadId === threadId && event.aggregateType === 'thread') {
        readWhole('coordinator', 'coordinator.whole', 'GetCoordinator', { projectId: setup.projectId })
        return
      }
      const ofItsRules = what === 'thread' && event.aggregateType === 'policy' && event.projectId === setup.projectId
      if (event.threadId === threadId || ofItsRules) {
        if (event.aggregateType === 'thread_item') changes.items.add(event.aggregateId)
        else changes.head = true
        if (event.aggregateType === 'user_input') for (const id of waiting(items)) changes.items.add(id)
      } else if (what === 'thread') return
      else if (event.aggregateType === 'connection') changes.head = true
      else if (event.projectId === setup.projectId && follows.cards.includes(event.aggregateType)) {
        changes.cards = true
        if (event.aggregateType === 'card' || event.aggregateType === 'task') changes.tasks.add(event.aggregateId)
      } else if (event.projectId === setup.projectId && follows.automations.includes(event.aggregateType)) changes.automations = true
      else return
      timer ??= setTimeout(readChanged, follows.threadGather)
    }
    return { open, heard }
  }
  const screens = [
    ...(setup.thread === undefined ? [] : [screen('thread')]),
    ...(setup.coordinator === true ? [screen('coordinator')] : []),
  ]

  let edgeTimer: ReturnType<typeof setTimeout> | undefined
  const heard = (event: WatchEvent) => {
    const tag = event._tag
    const was = watched.get(tag) ?? { n: 0, bytes: 0 }
    was.n += 1
    was.bytes += JSON.stringify(event).length
    watched.set(tag, was)
    if (tag !== 'Changed') return
    const change = event as Changed
    changed.set(change.aggregateType, (changed.get(change.aggregateType) ?? 0) + 1)
    const type = change.aggregateType
    if (setup.kind === 'edge') {
      // The edge's own read of the home (useEdge.ts `followEdge`): a burst once, never a permission the rules answered.
      if (!follows.home.includes(type) || follows.homeShown.includes(type)) return
      edgeTimer ??= setTimeout(() => {
        edgeTimer = undefined
        void timed('edge.home', 'GetHome', {})
      }, follows.edgeGather)
      return
    }
    // The window's whole reads: its home off screen, behind the screen that is open.
    if (follows.projects.includes(type)) gather('projects', () => readWhole('projects', 'projects', 'ListProjects'), follows.gather)
    if (follows.home.includes(type) && !follows.homeShown.includes(type))
      gather('home', () => readWhole('home', 'home', 'GetHome', {}), follows.gather)
    if (change.projectId === setup.projectId && follows.board.includes(type))
      gather('board', () => readWhole('board', 'board', 'GetBoard', { projectId: setup.projectId }), follows.gather)
    if (follows.connections.includes(type))
      gather('connections', () => readWhole('connections', 'connections', 'ListConnections'), follows.gather)
    // What only a project's screen shows (reads.ts `projectReads`), read again while it shows.
    if (setup.coordinator === true && change.projectId === setup.projectId) {
      if (follows.rules.includes(type))
        gather('rules', () => readWhole('rules', 'rules', 'GetProjectRules', { projectId: setup.projectId }), follows.gather)
      if (follows.automations.includes(type))
        gather(
          'automations',
          () => readWhole('automations', 'automations', 'GetAutomations', { projectId: setup.projectId }),
          follows.gather,
        )
    }
    for (const one of screens) one.heard(change)
  }

  const watch = client.Watch?.({}) as Stream.Stream<WatchEvent, unknown> | undefined
  if (watch !== undefined)
    Effect.runFork(
      Stream.runForEach(watch, (event) => Effect.sync(() => heard(event))).pipe(
        Effect.catchCause((cause) => Effect.sync(() => void (broke = String(cause).slice(0, 400)))),
      ),
    )
  // What it shows as it opens, read once: the projects, the home, its project's board, and the screen that is open.
  if (setup.kind === 'edge') void timed('edge.home', 'GetHome', {})
  else {
    void timed('projects', 'ListProjects')
    void timed('home', 'GetHome', {})
    void timed('board', 'GetBoard', { projectId: setup.projectId })
    void timed('connections', 'ListConnections')
    if (setup.coordinator === true) {
      void timed('rules', 'GetProjectRules', { projectId: setup.projectId })
      void timed('automations', 'GetAutomations', { projectId: setup.projectId })
    }
    for (const one of screens) void one.open()
  }

  const stats = (reset: boolean): WindowStats => {
    const made: WindowStats = {
      name: setup.name,
      ms: performance.now() - began,
      reads: Object.fromEntries(reads),
      failed: Object.fromEntries(failed),
      watched: Object.fromEntries(watched),
      changed: Object.fromEntries(changed),
      broke,
    }
    if (reset) {
      began = performance.now()
      reads = new Map()
      failed = new Map()
      watched = new Map()
      changed = new Map()
    }
    return made
  }

  /** What the run asks: a press's call, a burst of calls at once, what it has counted, or to stop. */
  return async (asked: Asked) => {
    if (asked.op === 'stats') return post({ id: asked.id, stats: stats(asked.reset) })
    if (asked.op === 'stop') return post({ id: asked.id, ok: true })
    if (client[asked.method] === undefined) return post({ id: asked.id, missing: true, ok: false })
    if (asked.op === 'burst') {
      const start = performance.now()
      const each = await Promise.all(
        asked.payloads.map(async (payload) => {
          const one = performance.now()
          await call(asked.method, payload).catch(() => undefined)
          return performance.now() - one
        }),
      )
      return post({ id: asked.id, ms: performance.now() - start, each, ok: true })
    }
    const start = performance.now()
    try {
      const value = await call(asked.method, asked.payload)
      const ms = performance.now() - start
      // Copied as JSON: what decoding made may not cross to the run's thread as it is.
      return post({ id: asked.id, ms, ok: true, ...(asked.want === true ? { value: JSON.parse(JSON.stringify(value ?? null)) } : {}) })
    } catch (error) {
      return post({ id: asked.id, ms: performance.now() - start, ok: false, error: String(error).slice(0, 400) })
    }
  }
}

interface Changed {
  readonly _tag: 'Changed'
  readonly aggregateType: string
  readonly aggregateId: string
  readonly projectId: string | null
  readonly threadId: string | null
}

type WatchEvent = { readonly _tag: string } & Partial<Changed>
