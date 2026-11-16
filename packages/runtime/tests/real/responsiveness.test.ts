import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { FakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option, Tracer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../../src/Connections'
import { failuresLayer } from '../../src/Failures'
import { Folders } from '../../src/Folders'
import { Instance } from '../../src/Instance'
import { Nudges } from '../../src/Nudges'
import { Projects } from '../../src/Projects'
import { Queries } from '../../src/Queries'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { recorder } from '../../src/threads'
import { UsageData } from '../../src/UsageData'
import { fakeConnectors, HOST, runtime, until } from '../support'
import { BUDGETS, counted, loop, type Row, table, timed } from './budgets'
import { follows } from './follow'
import { lag, type Priority, profiled, spans, spawns, stalledOn, stalls, stress, summary } from './load'
import { git, history, idle, lengthen, lengthenCoordinator, type Made, onGitHub, ready, settled } from './seed'
import { stormingAgents } from './storm'
import type { Answer, WindowSetup, WindowStats } from './window'
import { openWindows } from './windows'

/*
 * How quickly the runtime answers the window while the computer is busy, run
 * by hand, never in CI:
 *
 *   cd packages/runtime
 *   ALTHAR_PHASES=idle ALTHAR_RESPONSIVENESS_OUT=idle.json bun run test:responsiveness   # idle only
 *   ALTHAR_RESPONSIVENESS_OUT=before.json bun run test:responsiveness                    # idle, then every core and the disk busy
 *   bun tests/real/compare.ts before.json after.json                                     # two runs' summaries, row by row
 *
 * It builds a profile the size of a real one on a store on disk: a project of
 * 400 tasks, one with 5,000 items and 500 turns in its thread, a coordinator's
 * thread of 2,000 items with its task cards, and a million rows of the change
 * feed's history. Then it opens the app's windows, each a thread of its own
 * with its own connection to the API, following the feed as the app's do
 * (follow.ts: the board, the home and the projects read again on what
 * feed.ts says; a task's and a coordinator's thread item by item), and the
 * edge; and sets agents to work (storm.ts: message after message streamed,
 * a tool call between each). With nothing else running, and again with every
 * core busy and the disk written to as agents' builds do, it times what the
 * person waits on, from the window: a task's view opening, the coordinator,
 * the board, the home, the projects, a burst of items, search, settings and
 * rules; and presses, from the call to its answer: send, take back, a model
 * picked, a rename, stop, Done and Ship. It counts what the agents' work
 * makes the runtime do (the change feed's rows, the cards it works out, the
 * windows' reads, how late its loop runs), what one tool call's update
 * costs in all, and what each window is sent. Each is held to its budget
 * (budgets.ts) in a table at the end; `ALTHAR_STRICT=1` fails the run on any
 * over it. All it found goes to `ALTHAR_RESPONSIVENESS_OUT`, as JSON whose
 * `summary` compare.ts reads.
 */

/*
 * What it runs, from the environment, else from `test-results/responsiveness-run.json`, so it can be run on a line of its
 * own, outside an agent's sandbox, where processes' priorities can be set.
 */
const file = join(import.meta.dirname, '../../test-results/responsiveness-run.json')
const kept: Readonly<Record<string, string>> = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {}
const setting = (name: string, otherwise: string) => process.env[name] ?? kept[name] ?? otherwise

const PHASES = setting('ALTHAR_PHASES', 'idle,load').split(',') as ReadonlyArray<'idle' | 'load' | 'load-bg'>
const REPEATS = Number(setting('ALTHAR_REPEATS', '6'))
const PRESSES = Number(setting('ALTHAR_PRESSES', String(REPEATS)))
const SHIPS = Number(setting('ALTHAR_SHIPS', '3'))
const DONES = Number(setting('ALTHAR_DONES', '2'))
const ITEMS = Number(setting('ALTHAR_ITEMS', '5000'))
const TURNS = Number(setting('ALTHAR_TURNS', '500'))
const COORDINATOR_ITEMS = Number(setting('ALTHAR_COORDINATOR_ITEMS', '2000'))
const CHANGES = Number(setting('ALTHAR_CHANGES', '1000000'))
/** Windows of the app, each following the feed; and the edge, unless `ALTHAR_EDGE=0`. */
const WINDOWS = Math.max(1, Number(setting('ALTHAR_WINDOWS', '2')))
const EDGE = setting('ALTHAR_EDGE', '1') !== '0'
/** Agents at work at once, each in a task of its own. */
const AGENTS = Number(setting('ALTHAR_AGENTS', '8'))
/** Tasks open: the long one, Ship's, the presses', the agents' and Done's for each phase. The rest of the 400 settled. */
const OPEN = 3 + AGENTS + DONES * PHASES.length
const SETTLED = Number(setting('ALTHAR_SETTLED', String(Math.max(0, Number(setting('ALTHAR_TASKS', '400')) - OPEN))))
/** Each agent's turn: messages, chunks of each, characters a chunk, ms between chunks. */
const [CALLS = 8, CHUNKS = 30, SIZE = 40, EVERY = 15] = setting('ALTHAR_STORM', '8,30,40,15').split(',').map(Number)
/** Items read at once, as a task's view reads what changed while it was away. */
const BURST = Number(setting('ALTHAR_BURST', '50'))
/** The load: processes keeping a core busy each, and writers syncing the disk. */
const [CORES = cpus().length, DISKS = 2] = setting('ALTHAR_STRESS', `${cpus().length},2`).split(',').map(Number)
const STRICT = setting('ALTHAR_STRICT', '0') === '1'
const PROFILE = setting('ALTHAR_PROFILE_CPU', '0') === '1'
const OUT = setting('ALTHAR_RESPONSIVENESS_OUT', join(import.meta.dirname, '../../test-results/responsiveness.json'))
/** How far away the host is: each of its API's calls waits this long, as GitHub's took on average in the person's log. */
const HOST_MS = Number(setting('ALTHAR_HOST_MS', '400'))

/** A line of what it found, on stdout, where the run's output is read. */
const say = (...what: ReadonlyArray<unknown>) =>
  void process.stdout.write(`${what.map((one) => (typeof one === 'string' ? one : JSON.stringify(one, null, 1))).join(' ')}\n`)

/**
 * Statements the runtime runs at 9cde0f5 for what the run counts, where no span names it: the card watcher's look at
 * what changed, once a round (Queries `cardsMoved`), and the read each card on a board starts with (`cardOnBoard`).
 */
const SIGNATURES = {
  cardRound: /^sql:\s+SELECT c\.cursor, c\.project_id, CASE c\.aggregate_type WHEN 'task'/,
  cardOnBoard: /^sql:\s+SELECT \(SELECT max\(updated_at\) FROM external_links WHERE task_id = \? AND kind = 'change'\) AS seen/,
}

/** The runtime's statements, not those the run reads the feed by while it waits for an update's cost to settle. */
const STATEMENTS = /^sql:(?!.*AS probe FROM change_log)(?!.*count\(\*\) AS n FROM change_log)/

const store = join(mkdtempSync(join(tmpdir(), 'althar-responsive-')), 'althar.sqlite')
const traced = spans()
const started = spawns()
/** No wait on the host while the store is made: making it would take minutes more. */
let hostMs = 0

/** The runtime's services as the app makes them for its windows (Api.ts `services`), the agents playing `[storm]` turns. */
const runtimeWith = (github: FakeService) =>
  Layer.mergeAll(Nudges.layer, UsageData.layer, Folders.layer).pipe(
    Layer.provideMerge(Queries.layer),
    Layer.provideMerge(
      runtime(
        store,
        {},
        { connectors: fakeConnectors({ github }), agents: stormingAgents({ calls: CALLS, chunks: CHUNKS, size: SIZE, every: EVERY }) },
      ),
    ),
    Layer.provideMerge(failuresLayer),
    Layer.provideMerge(Layer.succeed(Tracer.Tracer, traced.tracer)),
  )

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const timedHere = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const began = performance.now()
    yield* effect
    return performance.now() - began
  })

/** Agents at work in other tasks: each given a turn of work as soon as it has none, as long as the run lasts. */
const working = (threads: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    for (let index = 0; ; index += 1) {
      for (const threadId of threads) {
        if (yield* sessions.busy(threadId)) continue
        const body = `Keep going ${index}. [storm]`
        const live = Option.isSome(yield* sessions.running(threadId))
        yield* Effect.ignore(sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body }))
        if (!live) yield* Effect.ignore(sessions.startLast(threadId))
      }
      yield* Effect.sleep(Duration.millis(500))
    }
  })

/** The change feed's rows after `from`, by what changed. */
const feedSince = (from: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ type: string; n: number }>`
      SELECT aggregate_type AS type, count(*) AS n FROM change_log WHERE cursor > ${from} GROUP BY aggregate_type ORDER BY n DESC`
    return Object.fromEntries(rows.map((row) => [row.type, row.n]))
  })

const sum = (values: Iterable<number>) => [...values].reduce((all, one) => all + one, 0)

/** What the windows read of their own, following the feed, by what, all windows together. */
const followed = (seen: ReadonlyArray<WindowStats>) => {
  const by = new Map<string, Array<number>>()
  for (const window of seen) for (const [what, times] of Object.entries(window.reads)) by.set(what, [...(by.get(what) ?? []), ...times])
  return by
}

/** The windows' whole reads, as against those of an item or a thread's head. */
const WHOLE = ['projects', 'home', 'board', 'edge.home', 'coordinator.whole', 'connections', 'rules', 'automations']

describe.runIf(setting('ALTHAR_RUN', 'responsiveness') === 'responsiveness')('the runtime under load', () => {
  it.live(
    'answers the window as quickly busy as idle',
    () => {
      const { working: checkout, bare, github } = onGitHub(() => hostMs)
      return Effect.gen(function* () {
        const connections = yield* Connections
        const instance = yield* Instance
        const queries = yield* Queries
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const results: Record<string, unknown> = {}
        const rows: Array<Row> = []
        const skipped: Array<{ readonly what: string; readonly why: string }> = []
        const { follows: following, variant } = follows()
        say('the windows follow the feed as', JSON.stringify(variant))

        yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: checkout })
        const projectId = project.projectId
        const seeding = performance.now()
        const made = yield* ready(projectId, 3 + AGENTS)
        const [long, shipped, pressed, ...agents] = made
        if (long === undefined || shipped === undefined || pressed === undefined) return assert.fail('no tasks')
        const doneable = DONES > 0 ? yield* ready(projectId, DONES * PHASES.length, true) : []
        yield* lengthen(long.threadId, ITEMS, TURNS)
        const old = yield* settled(long, SETTLED)
        const { cardEvery } = yield* lengthenCoordinator(projectId, COORDINATOR_ITEMS, [
          ...made.map((one) => one.taskId),
          ...doneable.map((one) => one.taskId),
          ...old,
        ])
        yield* history(CHANGES)
        hostMs = HOST_MS
        const page = yield* queries.coordinator(projectId)
        const seeded = {
          tasks: made.length + doneable.length + old.length,
          open: made.length + doneable.length,
          items: ITEMS,
          turns: TURNS,
          coordinatorItems: COORDINATOR_ITEMS,
          // A card in so many of the coordinator's items, as it made them; and those its latest page holds, which a window
          // showing it reads again, one by one, on a change of its project's tasks.
          cardEvery,
          cardsOnPage: page.items.filter((item) => item.kind === 'task').length,
          changes: CHANGES,
          seconds: Math.round((performance.now() - seeding) / 1000),
        }
        say('seeded', seeded)

        // What each read starts, with nothing else at work: the git commands and the statements a read runs.
        yield* Effect.sleep(Duration.seconds(3))
        const quiet: Record<string, unknown> = {}
        const alone: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown>]> = [
          ['open', queries.thread(long.threadId, { fresh: true })],
          ['open again', queries.thread(long.threadId)],
          ['coordinator', queries.coordinator(projectId)],
          ['board', queries.board(projectId)],
          ['home', queries.home()],
        ]
        for (const [what, read] of alone) {
          started.clear()
          traced.clear()
          const ms = yield* timedHere(read)
          quiet[what] = { ms: Math.round(ms), sql: traced.count(/^sql:/), spawned: started.top(12), spans: traced.top(8) }
        }
        say('quiet', quiet)

        // The windows: the first with the long task open, the second its project's coordinator, and so on; and the edge.
        const setups: Array<WindowSetup> = Array.from({ length: WINDOWS }, (_, index) => ({
          name: `window-${index + 1}`,
          kind: 'window' as const,
          projectId,
          follows: following,
          ...(index % 2 === 0 ? { thread: long.threadId } : { coordinator: true }),
        }))
        if (EDGE) setups.push({ name: 'edge', kind: 'edge', projectId, follows: following })
        const windows = yield* openWindows(setups)
        const press = (method: string, payload: Record<string, unknown> = {}, want = false) =>
          windows.call(0, method, { commandId: commandId(), ...payload }, want)
        const read = (method: string, payload?: unknown, want = false) => windows.call(0, method, payload, want)

        for (const [at, phase] of PHASES.entries()) {
          const load =
            phase === 'idle' ? undefined : stress(phase === 'load-bg' ? ('background' satisfies Priority) : 'normal', CORES, DISKS)
          // Its processes take a moment to take the cores.
          yield* Effect.sleep(Duration.seconds(2))
          // What one tool call's update makes the runtime and the windows do, before the agents start, once all is at rest:
          // on the task the first window has open, so its screen reads what changed as it would.
          const amplification = yield* amplify(long, projectId, phase, windows.stats)
          yield* windows.stats(true)
          traced.clear()
          started.clear()
          const from = yield* queries.cursor
          const began = performance.now()
          const delay = lag()
          const still = stalls()
          const profile = PROFILE ? yield* Effect.promise(profiled) : undefined
          const busy = yield* Effect.forkChild(working(agents.map((one) => one.threadId)))
          // The agents at work before anything is timed.
          yield* Effect.sleep(Duration.seconds(2))

          const times = new Map<string, Array<number>>()
          const failures = new Map<string, { n: number; why: string }>()
          const missing = new Set<string>()
          const keep = (what: string, answer: Answer) => {
            if (answer.missing === true) return void missing.add(what)
            if (answer.ok !== true)
              failures.set(what, { n: (failures.get(what)?.n ?? 0) + 1, why: failures.get(what)?.why ?? answer.error ?? '' })
            if (answer.ms !== undefined) times.set(what, [...(times.get(what) ?? []), answer.ms])
            return answer
          }

          // What a window waits on, as the person opens it: each from the window, to its answer.
          const opened = yield* read('GetThread', { threadId: long.threadId, limit: BURST }, true)
          // Its newest items: as many as `BURST`, whatever the page held.
          const latest = ((opened.value as { items?: ReadonlyArray<{ id: string }> } | undefined)?.items ?? [])
            .map((item) => item.id)
            .slice(-BURST)
          for (let index = 0; index < REPEATS; index += 1) {
            keep('task open', yield* read('GetThread', { threadId: long.threadId, fresh: true }))
            keep('task open again', yield* read('GetThread', { threadId: long.threadId }))
            keep('coordinator open', yield* read('GetCoordinator', { projectId }))
            keep('board', yield* read('GetBoard', { projectId }))
            keep('home', yield* read('GetHome', {}))
            keep('projects', yield* read('ListProjects'))
            const burst = yield* windows.burst(
              0,
              'GetThreadItem',
              latest.map((itemId) => ({ threadId: long.threadId, itemId })),
            )
            keep('item burst', burst)
            for (const ms of burst.each ?? []) times.set('item', [...(times.get('item') ?? []), ms])
            keep('search', yield* read('SearchTasks', { text: 'retry' }))
            keep('settings', yield* read('GetSettings', {}))
            keep('rules', yield* read('GetProjectRules', { projectId }))
          }

          // Presses, from the call to its answer, while the agents work and the windows read behind them.
          const head = yield* read('GetThread', { threadId: pressed.threadId, limit: 0 }, true)
          const models = (head.value as { session?: { models?: ReadonlyArray<string> } | null } | undefined)?.session?.models ?? []
          for (let index = 0; index < PRESSES; index += 1) {
            keep('rename', yield* press('RenameTask', { taskId: pressed.taskId, title: `Pressed, ${phase} ${index}` }))
            if (models.length > 0)
              keep('set model', yield* press('SetModel', { threadId: pressed.threadId, model: models[index % models.length] }))
            // Said to its lead, which works on it until it is stopped; said again while it works, which waits its turn, and
            // taken back; and the turn stopped.
            yield* idle(pressed.threadId)
            const live = Option.isSome(yield* sessions.running(pressed.threadId))
            keep(
              'send',
              yield* press('Send', {
                threadId: pressed.threadId,
                body: `Look again, ${phase} ${index}. [storm:until-stopped]`,
                disposition: 'after_current',
              }),
            )
            if (!live) yield* Effect.ignore(sessions.startLast(pressed.threadId))
            yield* until(sessions.busy(pressed.threadId), (working) => working, 'the turn under way')
            keep(
              'send queued',
              yield* press('Send', { threadId: pressed.threadId, body: `And then this, ${phase} ${index}.`, disposition: 'after_current' }),
            )
            // Which item waits, read from the store: what the window would hold of it, without a read of its own to time.
            const [queued] = yield* sql<{ id: string }>`
              SELECT i.id FROM thread_items i JOIN user_inputs u ON u.id = i.user_input_id
              WHERE i.thread_id = ${pressed.threadId} AND u.state = 'queued' ORDER BY i.sequence DESC LIMIT 1`
            if (queued === undefined) failures.set('take back', { n: (failures.get('take back')?.n ?? 0) + 1, why: 'nothing queued' })
            else keep('take back', yield* press('TakeBack', { itemId: queued.id }))
            keep('interrupt', yield* press('Interrupt', { threadId: pressed.threadId }))
            yield* idle(pressed.threadId)
          }
          // Done, on tasks whose lead built nothing, which it settles as they are.
          for (const task of doneable.slice(at * DONES, (at + 1) * DONES)) {
            keep('done', yield* press('MarkTaskDone', { taskId: task.taskId }))
            yield* press('SettledWithOnePress', { taskId: task.taskId, action: 'done' })
          }
          // Ship: what the person asked of the lead after its review, committed in a turn and held for it.
          const answered: Array<number> = []
          const up: Array<number> = []
          for (let index = 0; index < SHIPS; index += 1) {
            const body = `Tidy it, ${phase} ${index}. tidy pls [lead:commit]`
            const live = Option.isSome(yield* sessions.running(shipped.threadId))
            yield* sessions.send({
              envelope: yield* Runtime.envelope('thread.send', { threadId: shipped.threadId, body }),
              threadId: shipped.threadId,
              body,
            })
            if (!live) yield* Effect.ignore(sessions.startLast(shipped.threadId))
            yield* until(
              sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${shipped.taskId}`,
              (rows) => rows[0]?.heldAt != null,
              'the commit held',
            )
            yield* idle(shipped.threadId)
            const before = git(bare, 'rev-parse', shipped.branch)
            const pressedAt = performance.now()
            const shipping = keep('ship answered', yield* press('Ship', { taskId: shipped.taskId }))
            if (shipping?.ms !== undefined) answered.push(shipping.ms)
            // Up once the host has the branch as it is here: what the turn committed, and anything the round added.
            yield* until(
              Effect.sync(() => {
                const there = git(bare, 'rev-parse', shipped.branch)
                return there !== before && there === git(shipped.path, 'rev-parse', 'HEAD')
              }),
              (up) => up,
              'the commit on the host',
            )
            up.push(performance.now() - pressedAt)
            yield* until(
              sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${shipped.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
              (rows) => rows[0]?.state !== 'running',
              'the ship over',
            )
            yield* idle(shipped.threadId)
          }

          const loopDelay = delay.read()
          still.stop()
          const cpu = profile === undefined ? undefined : yield* Effect.promise(() => profile.stop())
          yield* Fiber.interrupt(busy)
          const seconds = (performance.now() - began) / 1000
          const to = yield* queries.cursor
          const feed = yield* feedSince(from)
          const seen = yield* windows.stats(true)
          const reads = followed(seen)
          const named = traced.named()
          const phaseSpans = traced.top(30)
          const phaseSpawns = started.top(30)
          const rounds = traced.count(SIGNATURES.cardRound).n
          const per = (n: number) => n / seconds

          // The agents' turns over, before the next phase's are timed.
          for (const one of [pressed, ...agents]) yield* idle(one.threadId)

          load?.stop()
          const of = (what: string) => summary(times.get(what) ?? [])
          results[phase] = {
            seconds: Math.round(seconds),
            reads: Object.fromEntries([...times].map(([what, list]) => [what, summary(list)])),
            failed: Object.fromEntries(failures),
            missing: [...missing],
            shipUp: summary(up),
            windows: Object.fromEntries(
              seen.map((window) => [
                window.name,
                {
                  reads: Object.fromEntries(Object.entries(window.reads).map(([what, list]) => [what, summary(list)])),
                  failed: window.failed,
                  watched: window.watched,
                  changed: window.changed,
                  broke: window.broke,
                },
              ]),
            ),
            activity: {
              agents: agents.length,
              feed,
              rows: to - from,
              rounds,
              named: Object.fromEntries(Object.entries(named).map(([name, list]) => [name, summary(list)])),
            },
            amplification,
            eventLoopDelay: loopDelay,
            spans: phaseSpans,
            spawned: phaseSpawns,
            longTransactions: traced.long(),
            stalls: still.windows(),
            ...(cpu === undefined ? {} : { cpu: cpu.top, stalledOn: stalledOn(cpu.profile, still.windows()) }),
          }
          say(JSON.stringify({ phase, ...(results[phase] as object) }, null, 1))

          // Its rows: what a window waits on, the presses, the windows' own reads, the loop, the agents' work and what it costs.
          for (const what of [
            'task open',
            'task open again',
            'coordinator open',
            'board',
            'home',
            'projects',
            'item',
            'search',
            'settings',
            'rules',
          ])
            rows.push(timed(phase, 'read', what, of(what), BUDGETS.call, missing.has(what) ? 'no such call on this commit' : undefined))
          rows.push(timed(phase, 'read', 'item burst', of('item burst'), null, `${latest.length} items at once, all answered`))
          for (const what of ['rename', 'set model', 'send', 'send queued', 'take back', 'interrupt', 'done', 'ship answered'])
            rows.push(
              timed(
                phase,
                'command',
                what,
                of(what),
                BUDGETS.call,
                failures.has(what) ? `${failures.get(what)?.n} failed: ${failures.get(what)?.why.slice(0, 60)}` : undefined,
              ),
            )
          rows.push(timed(phase, 'command', 'ship up', summary(up), null, 'to its commit on the host'))
          for (const what of [...reads.keys()].sort()) rows.push(timed(phase, 'window', what, summary(reads.get(what) ?? [])))
          rows.push(...loop(phase, 'loop', loopDelay))
          rows.push(counted(phase, 'activity', 'agents at work', agents.length, 'n'))
          rows.push(counted(phase, 'activity', 'change log rows', per(to - from), '/s'))
          rows.push(counted(phase, 'activity', 'card notifies', per(feed.card ?? 0), '/s'))
          rows.push(counted(phase, 'activity', 'card rounds', per(rounds), '/s', 'by its statement at 9cde0f5'))
          const roundSpans = Object.entries(named).filter(([name]) => /card/i.test(name) && /round|moved|watch/i.test(name))
          if (roundSpans.length > 0)
            rows.push(
              timed(
                phase,
                'activity',
                'card round',
                summary(roundSpans.flatMap(([, list]) => list)),
                null,
                roundSpans.map(([name]) => name).join(', '),
              ),
            )
          else {
            rows.push(counted(phase, 'activity', 'card round', undefined, 'ms', 'no span names a round on this commit'))
            if (at === 0)
              skipped.push({
                what: 'card round duration',
                why: 'no span names the card watcher’s round on this commit: rounds counted by their statement only',
              })
          }
          rows.push(counted(phase, 'activity', 'whole re-reads', per(sum(WHOLE.map((what) => reads.get(what)?.length ?? 0))), '/s'))
          for (const what of ['board', 'home', 'projects', 'edge.home'])
            rows.push(counted(phase, 'activity', `${what} re-reads`, per(reads.get(what)?.length ?? 0), '/s'))
          rows.push(
            counted(
              phase,
              'activity',
              'item re-reads',
              per(sum([...reads].filter(([what]) => what.endsWith('.item')).map(([, list]) => list.length))),
              '/s',
            ),
          )
          for (const window of seen) {
            const streamed = window.watched.Streaming ?? { n: 0, bytes: 0 }
            const all = Object.values(window.watched)
            rows.push(counted(phase, 'fan-out', `${window.name} events`, sum(all.map((one) => one.n)) / (window.ms / 1000), '/s'))
            rows.push(counted(phase, 'fan-out', `${window.name} KB`, sum(all.map((one) => one.bytes)) / 1024 / (window.ms / 1000), 'KB/s'))
            rows.push(counted(phase, 'fan-out', `${window.name} streaming events`, streamed.n / (window.ms / 1000), '/s'))
            rows.push(counted(phase, 'fan-out', `${window.name} streaming KB`, streamed.bytes / 1024 / (window.ms / 1000), 'KB/s'))
            if (window.broke !== null) rows.push(counted(phase, 'fan-out', `${window.name} broke`, 1, 'n', window.broke.slice(0, 80)))
          }
          if (amplification === undefined)
            rows.push(counted(phase, 'amplification', 'one tool call update', undefined, 'n', 'no session to update'))
          else
            for (const [what, value] of Object.entries(amplification.counts))
              rows.push(
                counted(
                  phase,
                  'amplification',
                  what,
                  value,
                  what.endsWith('ms') || what === 'settled in' ? 'ms' : what.endsWith('per s') ? '/s' : 'n',
                  what === 'settled in' && !(amplification.atRest && amplification.settled)
                    ? `the runtime ${amplification.atRest ? 'never settled after it' : 'was not at rest before it'}`
                    : undefined,
                ),
              )
          yield* Effect.sleep(Duration.seconds(2))
        }

        results.version = 1
        results.commit = git(import.meta.dirname, 'rev-parse', 'HEAD')
        results.variant = variant
        results.settings = {
          phases: PHASES,
          repeats: REPEATS,
          presses: PRESSES,
          ships: SHIPS,
          dones: DONES,
          windows: WINDOWS,
          edge: EDGE,
          agents: AGENTS,
          storm: { calls: CALLS, chunks: CHUNKS, size: SIZE, every: EVERY },
          burst: BURST,
          stress: { cores: CORES, disks: DISKS },
          hostMs: HOST_MS,
          cores: cpus().length,
        }
        results.seeded = seeded
        results.quiet = quiet
        results.skipped = skipped
        results.summary = rows
        const over = rows.filter((row) => row.verdict === 'OVER')
        say(
          `\n${table(rows)}\n\n${over.length} over budget${skipped.length === 0 ? '' : `; not measured here: ${skipped.map((one) => one.what).join(', ')}`}`,
        )
        mkdirSync(dirname(OUT), { recursive: true })
        writeFileSync(OUT, JSON.stringify(results, null, 2))
        say(`written to ${OUT}`)
        if (STRICT)
          assert.deepStrictEqual(
            over.map((row) => row.id),
            [],
            'every measurement within its budget',
          )
      }).pipe(
        Effect.scoped,
        Effect.provide(runtimeWith(github)),
        // Its store goes once the runtime has closed it: hundreds of MB at the person's size.
        Effect.ensuring(Effect.sync(() => rmSync(dirname(store), { recursive: true, force: true }))),
      )
    },
    // An hour unless it says: a wait gives up near it, so a short one, for a run that tries a setting, fails sooner.
    Number(setting('ALTHAR_MINUTES', '60')) * 60_000,
  )
})

/**
 * What follows one tool call's update in a task, written as its session writes it (threads.ts `recorder`): the change
 * feed's rows it makes, the cards worked out again, the statements run, the git processes started and the windows' reads,
 * until nothing more comes; with no agent at work, so all of it is the update's, but for what the runtime does on its
 * timers, counted for as long before it as `idle sql` and `idle git`.
 */
const amplify = (
  task: Made,
  projectId: string,
  phase: string,
  windowStats: (reset: boolean) => Effect.Effect<ReadonlyArray<WindowStats>>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const queries = yield* Queries
    const [session] = yield* sql<{
      id: string
    }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY rowid DESC LIMIT 1`
    if (session === undefined) return undefined
    const writer = recorder({ projectId: projectId as never, threadId: task.threadId, sessionId: session.id })
    const toolCallId = `probe-${phase}-${randomBytes(4).toString('hex')}`
    yield* writer.record({
      _tag: 'ToolCall',
      toolCallId,
      title: 'Read README.md',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: 'README.md' },
    })
    /**
     * Until nothing has been recorded, no process started and no window read for `ms`, or `most` ms have gone: when the
     * last of it happened, and whether it all stopped.
     */
    const settle = (ms: number, most: number) =>
      Effect.gen(function* () {
        const now = () =>
          Effect.gen(function* () {
            const reads = sum((yield* windowStats(false)).map((window) => sum(Object.values(window.reads).map((list) => list.length))))
            // A statement of its own, which the count of what the update cost leaves out.
            const [top] = yield* sql<{ probe: number | null }>`SELECT max(cursor) AS probe FROM change_log`
            return `${top?.probe ?? 0} ${reads} ${started.count()}`
          })
        let last = { said: yield* now(), at: performance.now() }
        const began = performance.now()
        while (performance.now() - last.at < ms && performance.now() - began < most) {
          yield* Effect.sleep(Duration.millis(50))
          const said = yield* now()
          if (said !== last.said) last = { said, at: performance.now() }
        }
        return { at: last.at, still: performance.now() - last.at >= ms }
      })
    // At rest first: what the agents set going, reviews and rounds among it, over.
    const rest = yield* settle(1_500, 60_000)
    // What the runtime does on its own, for as long, with nothing to do.
    traced.clear()
    started.clear()
    const quietFor = performance.now()
    yield* Effect.sleep(Duration.seconds(1))
    const idleSql = traced.count(STATEMENTS).n / ((performance.now() - quietFor) / 1000)
    const idleGit = started.count(/^git/) / ((performance.now() - quietFor) / 1000)
    traced.clear()
    started.clear()
    yield* windowStats(true)
    const from = yield* queries.cursor
    const began = performance.now()
    yield* writer.record({ _tag: 'ToolCallUpdate', toolCallId, status: 'completed', rawOutput: { lines: 40 } })
    const wrote = performance.now() - began
    const over = yield* settle(800, 20_000)
    const feed = yield* feedSince(from)
    const seen = followed(yield* windowStats(true))
    const reads = (matching: (what: string) => boolean) => sum([...seen].filter(([what]) => matching(what)).map(([, list]) => list.length))
    const named = Object.entries(traced.named()).filter(([name]) => /^(cardFor|cardOnBoard|Queries\.card)/i.test(name))
    return {
      counts: {
        'change log rows': sum(Object.values(feed)),
        'card notifies': feed.card ?? 0,
        'sql statements': traced.count(STATEMENTS).n,
        'sql ms': traced.count(STATEMENTS).ms,
        'card computations': named.length > 0 ? sum(named.map(([, list]) => list.length)) : traced.count(SIGNATURES.cardOnBoard).n,
        'card rounds': traced.count(SIGNATURES.cardRound).n,
        'git processes': started.count(/^git/),
        'window whole re-reads': reads((what) => WHOLE.includes(what)),
        'window item re-reads': reads((what) => what.endsWith('.item')),
        'window head re-reads': reads((what) => what.endsWith('.head')),
        'idle sql per s': idleSql,
        'idle git per s': idleGit,
        'write ms': wrote,
        'settled in': over.at - began,
      },
      atRest: rest.still,
      settled: over.still,
      feed,
      reads: Object.fromEntries([...seen].map(([what, list]) => [what, summary(list)])),
      cardComputationsBy: named.length > 0 ? named.map(([name]) => name) : 'its first statement (cardOnBoard at 9cde0f5)',
      spans: traced.top(20),
      spawned: started.top(10),
    }
  })
