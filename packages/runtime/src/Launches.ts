import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import { bumpRevision, Ledger } from '@althar/persistence-sqlite'
import { spawnOwned } from '@althar/provider-adapters'
import { Context, Crypto, Deferred, Duration, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { freshCopy } from './coordinatorFolder'
import { bringBackThen } from './bringBack'
import { Instance } from './Instance'
import { makeKeyedLock } from './keyedLock'
import { printedMore, servingAt, uncoloured } from './leftRunning'
import { addItem, updateItem } from './threads'
import { Live } from './Live'
import { change, fact, timestamp } from './records'
import { shortCommand } from './rules'
import { lineOf, type RunCommand, runOf, type Script, scriptsIn, setupIn } from './runCommand'
import { shotOf, shotWords, VIEWPORT } from './screenshots'
import { Setups } from './Setups'
import { type Tool, type ToolAccess, ToolRefused, ToolServer } from './ToolServer'

/*
 * The project run by Althar itself, with no agent (ADR-023): the command that
 * runs a repository, such as `bun run dev`, kept for it or worked out from it,
 * started in a task's worktree to see what the task built, or in a copy of the
 * default branch to see the project as it is. Althar owns the process: it is
 * recorded as its own, in a process group of its own, stops when the person
 * stops it or Althar quits, and one an earlier launch left is stopped as an
 * agent's is. What it prints is read for where it answers, as what an agent
 * leaves running is. Runs are kept in memory: none outlives Althar.
 *
 * A project runs many things (ADR-044): its runnables, a list in the person's
 * order, the first its default, each in one of its repositories. One with no
 * command of its own is its repository's own way to run, as above; the rest
 * say theirs, and are made ready with their repository's setup. Several run
 * at once, one of each in a place; runs of the default branch share their
 * repository's copy, made fresh only where nothing of it runs there.
 */

/** A run as a client shows it. `taskId` is null for a copy of the default branch. */
export interface ShownLaunch {
  readonly id: string
  readonly taskId: string | null
  /** Which of the project's runnables it runs. */
  readonly runnableId: string | null
  /** Where it runs, in words: the task's title, or the default branch. */
  readonly where: string
  readonly command: string
  /** What it is at a glance: the runnable's name, or the command as it reads at a glance (rules.ts, shortCommand). */
  readonly label: string
  readonly url: string | null
  readonly startedAt: string
  readonly ended: { readonly at: string; readonly code: number | null } | null
}

/** One of a project's runnables as a client shows it: what it runs where it is shown, and who said how. */
export interface ShownRunnable {
  readonly id: string
  readonly name: string | null
  readonly command: string
  /** The repository it runs in, by name. */
  readonly repository: string
  /** It is its repository's own way to run, with no command of its own. */
  readonly own: boolean
  readonly from: 'repository' | 'person' | 'coordinator' | 'agent'
}

interface Launch {
  readonly id: string
  readonly projectId: string
  readonly taskId: string | null
  readonly runnableId: string | null
  readonly name: string | null
  readonly where: string
  readonly bindingId: string
  readonly command: string
  readonly startedAt: string
  readonly scope: Scope.Closeable
  /** Its process, the leader of its group. */
  readonly pid: number
  /** Its card, in the thread it was asked for in; null where it was asked for in none. */
  card: string | null
  /** The end of what it printed, both streams. */
  printed: string
  url: string | null
  ended: { readonly at: string; readonly code: number | null } | null
  /** It was stopped, not ended by itself. */
  stopped: boolean
}

/** Why the project can't run that way, in words for the person or an agent. */
export class LaunchRefused extends Schema.TaggedError<LaunchRefused>()('LaunchRefused', {
  /** `unknown`: nothing says how it runs; `elsewhere`: no copy here to run it in; `which`: the repository or runnable named isn't one, or none was in a project of several. */
  why: Schema.Literals(['unknown', 'elsewhere', 'which']),
  message: Schema.String,
}) {}

/** How often, and for how long, a run is read for where it answers. */
const SERVING_EVERY = Duration.millis(500)
const SERVING_TRIES = 1_200
/** How long an agent waits for a run it started to say where it answers, so it can give the person a link, or read it. */
const ANSWERING_WITHIN = Duration.seconds(30)
/** How many of the last lines a run printed an agent reads, when it ended at once. */
const LAST_LINES = 15

interface Binding {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly base: string | null
  readonly within: string | null
  readonly repository: string
  readonly runCommand: string | null
  readonly runSetup: string | null
}

/** One of a project's runnables as kept: a null command is its repository's own way; who kept it, by their actor's kind and agent. */
interface Kept {
  readonly id: string
  readonly bindingId: string
  readonly name: string | null
  readonly command: string | null
  readonly actorKind: string | null
  readonly agentId: string | null
}

type Store = SqlClient.SqlClient | Crypto.Crypto | Instance | RuntimeConfig | Live | Ledger

export class Launches extends Context.Service<
  Launches,
  {
    /**
     * Runs one of the project's runnables, the one asked for, else the first
     * that says how it runs here, of the repository named where one is: in
     * the task's worktree, or a copy of the default branch. A run of it
     * already there, in the same place, is the one returned.
     */
    start(input: {
      readonly projectId: string
      readonly taskId: string | null
      readonly runnableId?: string
      readonly repository?: string
      /** The thread it was asked for in, where its card goes; null for none. */
      readonly threadId: string | null
    }): Effect.Effect<ShownLaunch, unknown>
    /** Stops a run; it goes from the list. */
    stop(id: string): Effect.Effect<void>
    /** Clears a run that ended by itself from the list. */
    clear(id: string): Effect.Effect<void>
    /**
     * Stops every run of the project, or only the task's, and clears those
     * that ended: the project is removed, or the task settled, and nothing is
     * left to stop them from.
     */
    stopAll(projectId: string, taskId?: string): Effect.Effect<void>
    /** The project's runs, in the order they started. */
    ofProject(projectId: string): Effect.Effect<ReadonlyArray<ShownLaunch>>
    /** Every run still running, by its process, in every project: for how hard each works (`MachineLoad.ts`). */
    processes(): Effect.Effect<ReadonlyArray<{ readonly pid: number; readonly projectId: string; readonly taskId: string | null }>>
    /** Whether something runs from the task's folder, or is starting to: it stays while it does (ADR-056). */
    using(taskId: string): Effect.Effect<boolean>
    /** What the project runs, in its order, as run for the task or the default branch: those that say how they run there. */
    runnables(projectId: string, taskId: string | null): Effect.Effect<ReadonlyArray<ShownRunnable>, unknown>
    /** Keeps how a repository runs, or, with null, goes back to working it out. Says which repository. */
    keep(input: {
      readonly projectId: string
      readonly repository?: string
      readonly run: RunCommand | null
      readonly actorId: ActorId
    }): Effect.Effect<string, unknown>
    /**
     * Keeps something for the project to run: a new one, at the end of the
     * list, unless the same is kept already; or, by id, a change to one. A
     * null command is its repository's own way. Says which it is.
     */
    keepRunnable(input: {
      readonly projectId: string
      readonly id?: string
      readonly name: string | null
      readonly command: string | null
      readonly repository?: string
      readonly actorId: ActorId
    }): Effect.Effect<{ readonly id: string; readonly name: string | null; readonly repository: string }, unknown>
    /** Drops one of the project's runnables; a run of it goes on until stopped. */
    dropRunnable(input: { readonly projectId: string; readonly id: string; readonly actorId: ActorId }): Effect.Effect<void, unknown>
    /** Puts the project's runnables in this order, the first its default; any not named keep theirs, after. */
    orderRunnables(input: {
      readonly projectId: string
      readonly ids: ReadonlyArray<string>
      readonly actorId: ActorId
    }): Effect.Effect<void, unknown>
    /** The scripts in the project's package.json files, each repository's as it is here. */
    scripts(projectId: string): Effect.Effect<ReadonlyArray<Script & { readonly repository: string }>, unknown>
  }
>()('@althar/runtime/Launches') {
  static readonly layer: Layer.Layer<Launches, never, Store | ToolServer | Setups> = Layer.effect(
    Launches,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const setups = yield* Setups
      const live = yield* Live
      const config = yield* RuntimeConfig
      const toolServer = yield* ToolServer
      // Every run lives in this scope: closed, as Althar stops, each run's process group is stopped.
      const launchesScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const launches = new Map<string, Launch>()
      // A run's card an earlier launch left open says its run stopped: none outlives Althar.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const open = yield* sql<{ id: string; projectId: string; content: string }>`
            SELECT id, project_id, content FROM thread_items WHERE kind = 'run' AND json_extract(content, '$.ended') IS NULL`
          const at = yield* timestamp
          for (const card of open)
            yield* updateItem(card.projectId as ProjectId, card.id, {
              ...(JSON.parse(card.content) as Record<string, unknown>),
              ended: { at, code: null, stopped: true, last: null },
            })
        }),
      ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not close the cards of earlier runs', cause)))

      const shown = (launch: Launch): ShownLaunch => ({
        id: launch.id,
        taskId: launch.taskId,
        runnableId: launch.runnableId,
        where: launch.where,
        command: launch.command,
        label: launch.name ?? shortCommand(launch.command),
        url: launch.url,
        startedAt: launch.startedAt,
        ended: launch.ended,
      })
      const ofProject = (projectId: string) => [...launches.values()].filter((launch) => launch.projectId === projectId).map(shown)
      const told = (projectId: string) => live.publish({ _tag: 'Launches', projectId, launches: ofProject(projectId) })

      const bindingsOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<Binding>`
            SELECT b.id, b.slug, b.display_name AS name, b.default_base_ref AS base, b.folder AS within,
              l.path AS repository, b.run_command, b.run_setup
            FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
            ORDER BY b.created_at, b.rowid`
        })

      /** The project's runnables as kept, in its order. */
      const keptOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<Kept>`
            SELECT r.id, r.binding_id, r.name, r.command, a.kind AS actor_kind, a.agent_id
            FROM runnables r LEFT JOIN actors a ON a.id = r.kept_by_actor_id
            WHERE r.project_id = ${projectId} AND r.dropped_at IS NULL
            ORDER BY r.position, r.created_at, r.rowid`
        })

      /** Where a repository runs for a task: its worktree, or the folder in it the project is about; never a copy it only reads, as a review's. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ bindingId: string; path: string }>`
            SELECT binding_id, path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND access = 'write'`
          return new Map(rows.map((row) => [row.bindingId, row.path]))
        })

      const within = (binding: Binding, root: string) => (binding.within === null ? root : join(root, binding.within))

      /** How a repository runs in a folder: as kept for it, else as what is in the folder says. */
      const runIn = (binding: Binding, folder: string, root: string): RunCommand | null =>
        runOf({ command: binding.runCommand, setup: binding.runSetup }, folder, root)

      /** How a runnable runs from a root: its repository's own way, or its command after its repository's setup; null where its own way can't be told. */
      const runOfKept = (kept: Kept, binding: Binding, root: string): RunCommand | null => {
        const folder = within(binding, root)
        return kept.command === null
          ? runIn(binding, folder, root)
          : { command: kept.command, setup: binding.runSetup ?? setupIn(folder, root) }
      }

      /** Who said how a runnable runs: worked out from its repository, or kept by the person, the coordinator or another agent. */
      const fromOf = (kept: Kept, binding: Binding): ShownRunnable['from'] =>
        kept.command === null
          ? binding.runCommand === null
            ? 'repository'
            : 'agent'
          : kept.actorKind === 'person'
            ? 'person'
            : kept.agentId === 'coordinator'
              ? 'coordinator'
              : 'agent'

      /** The repositories a run can be in, the one named first and alone, each with the root it runs from now. */
      const placesOf = (projectId: string, taskId: string | null, named: string | undefined) =>
        Effect.gen(function* () {
          const bindings = yield* bindingsOf(projectId)
          const worktrees = taskId === null ? null : yield* worktreesOf(taskId)
          const here = bindings.flatMap((binding) => {
            const root = worktrees === null ? binding.repository : worktrees.get(binding.id)
            return root === undefined ? [] : [{ binding, root }]
          })
          if (named === undefined) return here
          const wanted = named.trim().toLowerCase()
          const found = here.filter(({ binding }) => binding.name.toLowerCase() === wanted || binding.slug === wanted)
          if (found.length === 0)
            return yield* new LaunchRefused({
              why: 'which',
              message: `There's no repository called ${named} ${taskId === null ? 'in the project' : 'in the task'}. Its repositories: ${here.map(({ binding }) => binding.name).join(', ') || 'none'}.`,
            })
          return found
        })

      const runnables = (projectId: string, taskId: string | null) =>
        provide(
          Effect.gen(function* () {
            const places = yield* placesOf(projectId, taskId, undefined)
            return (yield* keptOf(projectId)).flatMap((kept): ReadonlyArray<ShownRunnable> => {
              const place = places.find(({ binding }) => binding.id === kept.bindingId)
              // A finished task's folder that was removed says how it runs from its repository's own folder, until running
              // brings it back (ADR-056).
              const root = place === undefined ? null : existsSync(place.root) ? place.root : place.binding.repository
              const run = place === undefined || root === null ? null : runOfKept(kept, place.binding, root)
              return place === undefined || run === null
                ? []
                : [
                    {
                      id: kept.id,
                      name: kept.name,
                      command: run.command,
                      repository: place.binding.name,
                      own: kept.command === null,
                      from: fromOf(kept, place.binding),
                    },
                  ]
            })
          }),
        )

      /**
       * A copy of the repository's default branch to run, Althar's own: made
       * fresh as a run starts, unless something of the repository runs from it
       * now, which a fresh copy would change under it.
       */
      const runCopy = (projectId: string, binding: Binding) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${projectId}`
          const folder = join(config.worktreeRoot, project?.slug ?? projectId, '.run')
          mkdirSync(folder, { recursive: true })
          const path = join(folder, binding.slug)
          const busy = [...launches.values()].some(
            (launch) => launch.taskId === null && launch.bindingId === binding.id && launch.ended === null,
          )
          if (!busy || !existsSync(path)) yield* freshCopy(binding.repository, path, binding.base ?? 'main')
          return path
        })

      /** A run's card as its thread keeps it: what it runs, where it answers, and how it ended, with its last line. */
      const cardOf = (launch: Launch) => ({
        launchId: launch.id,
        taskId: launch.taskId,
        runnableId: launch.runnableId,
        where: launch.where,
        command: launch.command,
        url: launch.url,
        startedAt: launch.startedAt,
        ended:
          launch.ended === null
            ? null
            : {
                ...launch.ended,
                stopped: launch.stopped,
                last: launch.stopped ? null : uncoloured(launch.printed).trimEnd().split('\n').at(-1)?.trim() || null,
              },
      })
      /** Keeps a run's card in step with it. */
      const toldCard = (launch: Launch) =>
        launch.card === null
          ? Effect.void
          : provide(updateItem(launch.projectId as ProjectId, launch.card, cardOf(launch))).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not keep a run’s card', cause)),
            )

      /** Reads what a run prints, now and then, until it says where it answers, ends, or a while goes by. */
      const watchServing = (launch: Launch, stderr: () => string) =>
        Effect.gen(function* () {
          for (let tries = 0; tries < SERVING_TRIES; tries += 1) {
            if (launch.url !== null || launch.ended !== null || !launches.has(launch.id)) return
            const url = servingAt(`${launch.printed}\n${stderr()}`)
            if (url !== null) {
              launch.url = url
              yield* toldCard(launch)
              return yield* told(launch.projectId)
            }
            yield* Effect.sleep(SERVING_EVERY)
          }
        })

      /*
       * One run starts at a time in a place, the default branch's copy or a
       * task's worktree: a second asking waits until the first is in
       * `launches`, so it neither freshens the copy under it nor starts the
       * same one twice.
       */
      const startLocks = makeKeyedLock()
      const placeKey = (projectId: string, taskId: string | null) => `${projectId}:${taskId ?? ''}`

      /** Tasks something is starting to run from, by how many: their folders stay while it does (ADR-056). */
      const startingFrom = new Map<string, number>()
      /**
       * Runs `effect`, which starts something from the task's folder: a
       * folder removed once it finished comes back first, and is marked as
       * being started from before anything can remove it again, until what
       * starts runs, or doesn't (ADR-056).
       */
      const fromFolder = <A, E, R>(taskId: string | null, effect: Effect.Effect<A, E, R>) =>
        taskId === null
          ? effect
          : Effect.acquireUseRelease(
              bringBackThen(
                taskId,
                instance.personId,
                Effect.sync(() => void startingFrom.set(taskId, (startingFrom.get(taskId) ?? 0) + 1)),
              ),
              () => effect,
              () =>
                Effect.sync(() => {
                  const left = (startingFrom.get(taskId) ?? 1) - 1
                  if (left > 0) startingFrom.set(taskId, left)
                  else startingFrom.delete(taskId)
                }),
            )

      const start = (input: {
        readonly projectId: string
        readonly taskId: string | null
        readonly runnableId?: string
        readonly repository?: string
        /** The thread it was asked for in, where its card goes; null for none. */
        readonly threadId: string | null
      }) =>
        provide(
          startLocks.withLock(
            placeKey(input.projectId, input.taskId),
            fromFolder(
              input.taskId,
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient
                // A task's folder is set up before anything runs from it, however it came back: here, or as it opened, or before (ADR-056).
                if (input.taskId !== null) yield* setups.ready(input.taskId)
                const places = yield* placesOf(input.projectId, input.taskId, input.repository)
                if (places.length === 0)
                  return yield* new LaunchRefused({
                    why: 'elsewhere',
                    message:
                      input.taskId === null
                        ? 'The project has no repository on this computer to run.'
                        : 'The task has no worktree here to run.',
                  })
                const kept = yield* keptOf(input.projectId)
                const asked = input.runnableId === undefined ? undefined : kept.find((one) => one.id === input.runnableId)
                if (input.runnableId !== undefined && asked === undefined)
                  return yield* new LaunchRefused({ why: 'which', message: 'The project has nothing like that to run any more.' })
                if (asked !== undefined && !places.some(({ binding }) => binding.id === asked.bindingId))
                  return yield* new LaunchRefused({
                    why: 'elsewhere',
                    message:
                      input.taskId === null
                        ? 'Its repository has no copy on this computer to run it in.'
                        : 'The task has no worktree of its repository here to run it in.',
                  })
                // The one asked for, else the first of those here that says how it runs, as the place's copy is now.
                let chosen: { readonly kept: Kept; readonly binding: Binding } | undefined
                for (const one of asked === undefined ? kept : [asked]) {
                  const place = places.find(({ binding }) => binding.id === one.bindingId)
                  if (place !== undefined && runOfKept(one, place.binding, place.root) !== null) {
                    chosen = { kept: one, binding: place.binding }
                    break
                  }
                }
                if (chosen === undefined)
                  return yield* new LaunchRefused({
                    why: 'unknown',
                    message: `Althar can't tell how ${places.map(({ binding }) => binding.name).join(' or ')} runs: it has no dev, start or serve script, Procfile or Makefile target. Ask the coordinator to keep how it runs.`,
                  })
                // A run of it already going in the same place is the one there is: two would want the same port.
                const running = [...launches.values()].find(
                  (launch) => launch.taskId === input.taskId && launch.runnableId === chosen.kept.id && launch.ended === null,
                )
                if (running !== undefined) return shown(running)
                // One that ended there by itself goes as this one starts: this one says how it runs now.
                for (const ended of launches.values())
                  if (ended.taskId === input.taskId && ended.runnableId === chosen.kept.id && ended.ended !== null)
                    launches.delete(ended.id)
                const { binding } = chosen
                const at =
                  input.taskId === null
                    ? yield* runCopy(input.projectId, binding)
                    : (places.find((place) => place.binding.id === binding.id)?.root ?? '')
                const folder = within(binding, at)
                const run = runOfKept(chosen.kept, binding, at)
                if (run === null)
                  return yield* new LaunchRefused({
                    why: 'unknown',
                    message: `Althar can't tell how ${binding.name} runs: it has no dev, start or serve script, Procfile or Makefile target. Ask the coordinator to keep how it runs.`,
                  })
                const line = lineOf(run)
                const spec =
                  process.platform === 'win32'
                    ? // The line as it is: cmd.exe takes off the outer quotes (/s).
                      { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true as const }
                    : { command: '/bin/sh', args: ['-c', line] }
                const id = yield* newId(Ids.process)
                // Recorded before it is spawned, so a crash in between leaves a trace to reconcile.
                yield* sql`INSERT INTO processes ${sql.insert({
                  id,
                  projectId: input.projectId,
                  deviceId: instance.deviceId,
                  runtimeInstanceId: instance.id,
                  purpose: 'run',
                  executable: spec.command,
                  argsRedacted: JSON.stringify(spec.args),
                  controllerGeneration: 1,
                  state: 'launching',
                  launchedAt: yield* timestamp,
                })}`
                const scope = yield* Scope.fork(launchesScope, 'sequential')
                const owned = yield* spawnOwned(spec, folder).pipe(
                  Scope.provide(scope),
                  Effect.tapError(() =>
                    Effect.andThen(
                      Scope.close(scope, Exit.void),
                      change('processes', id, { state: 'unknown', endedAt: new Date().toISOString() }),
                    ),
                  ),
                )
                yield* change('processes', id, {
                  pid: owned.pid,
                  processGroupId: owned.pid,
                  osStartedAt: owned.osStartedAt ?? null,
                  environmentDigest: owned.environmentDigest,
                  state: 'running',
                })
                // Where it runs, in words: what the task is, or the default branch it is a copy of.
                const [task] =
                  input.taskId === null ? [] : yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${input.taskId}`
                const launch: Launch = {
                  id,
                  projectId: input.projectId,
                  taskId: input.taskId,
                  runnableId: chosen.kept.id,
                  name: chosen.kept.name,
                  where: task?.title ?? binding.base ?? 'main',
                  bindingId: binding.id,
                  command: run.command,
                  startedAt: yield* timestamp,
                  scope,
                  pid: owned.pid,
                  card: null,
                  printed: '',
                  url: null,
                  ended: null,
                  stopped: false,
                }
                launches.set(id, launch)
                // Its card goes in the thread it was asked for in; a run doesn't wait on its card.
                if (input.threadId !== null)
                  launch.card = yield* addItem(
                    { projectId: input.projectId as ProjectId, threadId: input.threadId },
                    'run',
                    cardOf(launch),
                  ).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not post a run’s card', cause), null)))
                // What it prints is read as it comes, so it never waits on a full pipe.
                yield* Effect.forkIn(
                  Effect.promise(async () => {
                    const reader = owned.stdout.getReader()
                    const decoder = new TextDecoder()
                    for (;;) {
                      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
                      if (done || value === undefined) return
                      launch.printed = printedMore(launch.printed, decoder.decode(value, { stream: true }))
                    }
                  }),
                  scope,
                )
                yield* Effect.forkIn(watchServing(launch, owned.stderrTail), scope)
                // Ended by itself, it stays, to say how, and anything it left behind is stopped with its group.
                yield* Effect.forkIn(
                  provide(
                    Effect.gen(function* () {
                      const exit = yield* Deferred.await(owned.exited)
                      if (!launches.has(id)) return
                      const at = yield* timestamp
                      launch.ended = { at, code: exit.code }
                      yield* change('processes', id, { state: 'exited', exitCode: exit.code, signal: exit.signal, endedAt: at })
                      yield* toldCard(launch)
                      yield* told(input.projectId)
                      yield* Scope.close(scope, Exit.void)
                    }),
                  ),
                  launchesScope,
                )
                yield* told(input.projectId)
                return shown(launch)
              }),
            ),
          ),
        )

      const stop = (id: string) =>
        provide(
          Effect.gen(function* () {
            const launch = launches.get(id)
            if (launch === undefined) return
            launches.delete(id)
            if (launch.ended === null) {
              yield* Scope.close(launch.scope, Exit.void)
              const at = yield* timestamp
              yield* change('processes', id, { state: 'killed', endedAt: at })
              launch.ended = { at, code: null }
              launch.stopped = true
              yield* toldCard(launch)
            }
            yield* told(launch.projectId)
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not stop a run', cause)))

      const clear = (id: string) =>
        Effect.gen(function* () {
          const launch = launches.get(id)
          if (launch === undefined || launch.ended === null) return
          launches.delete(id)
          yield* told(launch.projectId)
        })

      const stopAll = (projectId: string, taskId?: string) => {
        const ours = (launch: Launch) => launch.projectId === projectId && (taskId === undefined || launch.taskId === taskId)
        const stopping = Effect.suspend(() =>
          Effect.forEach([...launches.values()].filter(ours), (launch) => (launch.ended === null ? stop(launch.id) : clear(launch.id)), {
            discard: true,
          }),
        )
        // A task's run starting meanwhile is in the list once it has, and goes with the rest.
        return taskId === undefined ? stopping : startLocks.withLock(placeKey(projectId, taskId), stopping)
      }

      /** The project changes with what it runs, so every screen that offers to run it reads it again; and the change is on the record. */
      const recorded = (projectId: string, actorId: ActorId, type: string, payload: Record<string, unknown>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`
          const revision = yield* bumpRevision('projects', projectId, project?.revision ?? 1)
          yield* fact({
            projectId: projectId as ProjectId,
            aggregateType: 'project',
            aggregateId: projectId,
            revision,
            type,
            payload,
            actorId,
          })
        })

      const keep = (input: {
        readonly projectId: string
        readonly repository?: string
        readonly run: RunCommand | null
        readonly actorId: ActorId
      }) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const bindings = yield* placesOf(input.projectId, null, input.repository)
            const [binding] = bindings
            if (binding === undefined)
              return yield* new LaunchRefused({
                why: 'elsewhere',
                message: 'The project has no repository on this computer to keep a way to run.',
              })
            if (input.repository === undefined && bindings.length > 1)
              return yield* new LaunchRefused({
                why: 'which',
                message: `Say which repository it runs, as repository: ${bindings.map(({ binding }) => binding.name).join(', ')}.`,
              })
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`UPDATE repository_bindings SET ${sql.update({
                  runCommand: input.run?.command ?? null,
                  runSetup: input.run?.setup ?? null,
                })} WHERE id = ${binding.binding.id}`
                yield* recorded(input.projectId, input.actorId, 'project.run_command_kept', {
                  repository: binding.binding.name,
                  command: input.run?.command ?? null,
                  setup: input.run?.setup ?? null,
                })
              }),
            )
            return binding.binding.name
          }),
        )

      /** Words with nothing in them are none. */
      const trimmed = (words: string | null) => {
        const kept = words?.trim() ?? ''
        return kept === '' ? null : kept
      }

      const keepRunnable = (input: {
        readonly projectId: string
        readonly id?: string
        readonly name: string | null
        readonly command: string | null
        readonly repository?: string
        readonly actorId: ActorId
      }) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const name = trimmed(input.name)
            const command = trimmed(input.command)
            const kept = yield* keptOf(input.projectId)
            const bindings = yield* bindingsOf(input.projectId)
            const was = input.id === undefined ? undefined : kept.find((one) => one.id === input.id)
            if (input.id !== undefined && was === undefined)
              return yield* new LaunchRefused({ why: 'which', message: 'The project has nothing like that to run any more.' })
            // Its repository: the one named, else the one it runs in already, else the project's only one.
            const places = yield* placesOf(input.projectId, null, input.repository)
            const binding =
              input.repository !== undefined
                ? places[0]?.binding
                : was !== undefined
                  ? bindings.find((one) => one.id === was.bindingId)
                  : places.length === 1
                    ? places[0]?.binding
                    : undefined
            if (binding === undefined)
              return yield* new LaunchRefused(
                places.length === 0
                  ? { why: 'elsewhere', message: 'The project has no repository on this computer to run it in.' }
                  : {
                      why: 'which',
                      message: `Say which repository it runs in, as repository: ${places.map((place) => place.binding.name).join(', ')}.`,
                    },
              )
            const at = yield* timestamp
            if (was === undefined) {
              // The same kept already is the one there is: a list doesn't need it twice.
              const same = kept.find((one) => one.bindingId === binding.id && one.command === command)
              if (same !== undefined) return { id: same.id, name: same.name, repository: binding.name }
              const id = yield* newId(Ids.runnable)
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  // At the end of the list: after every one, dropped or not, so positions never meet.
                  const [last] = yield* sql<{ position: number | null }>`
                    SELECT max(position) AS position FROM runnables WHERE project_id = ${input.projectId}`
                  yield* sql`INSERT INTO runnables ${sql.insert({
                    id,
                    projectId: input.projectId,
                    bindingId: binding.id,
                    name,
                    command,
                    position: (last?.position ?? -1) + 1,
                    keptByActorId: input.actorId,
                    createdAt: at,
                  })}`
                  yield* recorded(input.projectId, input.actorId, 'project.runnable_kept', { name, command, repository: binding.name })
                }),
              )
              return { id, name, repository: binding.name }
            }
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`UPDATE runnables SET ${sql.update({
                  bindingId: binding.id,
                  name,
                  command,
                  keptByActorId: input.actorId,
                })}, revision = revision + 1 WHERE id = ${was.id}`
                yield* recorded(input.projectId, input.actorId, 'project.runnable_kept', {
                  id: was.id,
                  name,
                  command,
                  repository: binding.name,
                })
              }),
            )
            return { id: was.id, name, repository: binding.name }
          }),
        )

      const dropRunnable = (input: { readonly projectId: string; readonly id: string; readonly actorId: ActorId }) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const kept = (yield* keptOf(input.projectId)).find((one) => one.id === input.id)
            if (kept === undefined) return
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`UPDATE runnables SET ${sql.update({
                  droppedAt: yield* timestamp,
                  droppedByActorId: input.actorId,
                })}, revision = revision + 1 WHERE id = ${kept.id}`
                yield* recorded(input.projectId, input.actorId, 'project.runnable_dropped', {
                  id: kept.id,
                  name: kept.name,
                  command: kept.command,
                })
              }),
            )
          }),
        )

      const orderRunnables = (input: { readonly projectId: string; readonly ids: ReadonlyArray<string>; readonly actorId: ActorId }) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const kept = yield* keptOf(input.projectId)
            const named = input.ids.flatMap((id) => kept.filter((one) => one.id === id))
            const order = [...new Set([...named, ...kept])]
            yield* sql.withTransaction(
              Effect.gen(function* () {
                for (const [position, one] of order.entries())
                  yield* sql`UPDATE runnables SET position = ${position}, revision = revision + 1 WHERE id = ${one.id}`
                yield* recorded(input.projectId, input.actorId, 'project.runnables_ordered', { ids: order.map((one) => one.id) })
              }),
            )
          }),
        )

      const scripts = (projectId: string) =>
        provide(
          Effect.gen(function* () {
            const places = yield* placesOf(projectId, null, undefined)
            return places.flatMap(({ binding, root }) =>
              scriptsIn(within(binding, root), root).map((script) => ({ ...script, repository: binding.name })),
            )
          }),
        )

      /* ---- What agents can do about it ---- */

      const KeptCommand = Schema.Struct({
        command: Schema.NullOr(Schema.String),
        setup: Schema.optional(Schema.NullOr(Schema.String)),
        repository: Schema.optional(Schema.String),
      })
      const KeptRun = Schema.Struct({
        name: Schema.String,
        command: Schema.NullOr(Schema.String),
        repository: Schema.optional(Schema.String),
      })
      const Asked = Schema.Struct({
        task: Schema.optional(Schema.String),
        run: Schema.optional(Schema.String),
        repository: Schema.optional(Schema.String),
      })
      const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
        Schema.decodeUnknownEffect(schema)(input).pipe(
          Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
        )
      /** A refusal in words for the agent; anything else, said as Althar's own failing. */
      const said = <A>(effect: Effect.Effect<A, unknown>) =>
        effect.pipe(
          Effect.catch((error) =>
            error instanceof ToolRefused
              ? Effect.fail(error)
              : error instanceof LaunchRefused
                ? Effect.fail(
                    new ToolRefused({
                      message:
                        error.why === 'unknown'
                          ? `${error.message.replace(/ Ask the coordinator to keep how it runs\.$/, '')} Read the repository and keep how it runs with set_run_command, then run it again.`
                          : error.message,
                    }),
                  )
                : Effect.andThen(
                    Effect.logWarning('A run tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  ),
          ),
        )

      /** What the project runs, a line each, for an agent: by name, what it runs, and which is the default. */
      const listed = (projectId: string) =>
        Effect.gen(function* () {
          const all = yield* runnables(projectId, null)
          if (all.length === 0) return 'The project has nothing to run that Althar can tell.'
          return `What the project runs, the first by default:\n${all
            .map(
              (one) =>
                `- ${one.name ?? one.command}${one.name === null ? '' : `: \`${one.command}\``}${one.own ? ` (${one.repository}'s own way to run)` : ''}`,
            )
            .join('\n')}`
        })

      const keepTool = (actorOf: (access: ToolAccess) => ActorId): Tool => ({
        name: 'set_run_command',
        description:
          "Keeps how the project runs, for Althar to run it for the person with no agent: the command that runs it (such as `bun run dev`), and setup, what makes a fresh copy ready (such as `test -d node_modules || bun install --frozen-lockfile`). Althar runs the setup itself, outside any agent's sandbox: before each run, and in each new task's worktree as it is made, before its lead starts, so the lead finds its dependencies installed. Without a setup, Althar works it out: installing the packages the lockfile names, never changing the lockfile. Use it when Althar can't work out how it runs, or works it out wrong, or when you change how it runs or what it needs installed first. A null command goes back to working both out from the repository. In a project of several repositories, say which, as repository. For more things to run beside it, such as Storybook or a watcher, use keep_run.",
        input: {
          type: 'object',
          properties: {
            command: { type: ['string', 'null'] },
            setup: { type: ['string', 'null'] },
            repository: { type: 'string' },
          },
          required: ['command'],
        },
        call: (input, access) =>
          said(
            Effect.gen(function* () {
              const asked = yield* read(KeptCommand, input)
              const command = asked.command?.trim() ?? ''
              const setup = asked.setup?.trim() ?? ''
              const repository = yield* keep({
                projectId: access.projectId,
                ...(asked.repository === undefined ? {} : { repository: asked.repository }),
                run: command === '' ? null : { command, setup: setup === '' ? null : setup },
                actorId: actorOf(access),
              })
              return command === ''
                ? `Althar works out how ${repository} runs from the repository again.`
                : `Kept: ${repository} runs with \`${command}\`${setup === '' ? '' : `, after \`${setup}\`, which sets up each new task's worktree too`}.`
            }),
          ),
      })

      const keepRunTool = (actorOf: (access: ToolAccess) => ActorId): Tool => ({
        name: 'keep_run',
        description:
          "Keeps something more for the project to run, beside how it runs by default, for the person to run with no agent from the Run button's list: a dev server, Storybook, the app itself, tests in watch mode, a docs site, a one-off script. Give it a short name the person knows it by (Storybook) and the command that runs it from the repository's root (`bun --filter @althar/ui storybook`); Althar runs its repository's setup first. A name kept already changes to the command given; a null command drops it. Keep only what is worth running by hand: not every script. In a project of several repositories, say which, as repository. It says what the project runs after.",
        input: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            command: { type: ['string', 'null'] },
            repository: { type: 'string' },
          },
          required: ['name', 'command'],
        },
        call: (input, access) =>
          said(
            Effect.gen(function* () {
              const asked = yield* read(KeptRun, input)
              const name = asked.name.trim()
              if (name === '') return yield* new ToolRefused({ message: 'Give it a name, such as Storybook.' })
              const all = yield* runnables(access.projectId, null)
              const same = all.find((one) => one.name?.toLowerCase() === name.toLowerCase())
              const command = asked.command?.trim() ?? ''
              if (command === '') {
                if (same === undefined) return yield* new ToolRefused({ message: `The project runs nothing called ${name}.` })
                yield* dropRunnable({ projectId: access.projectId, id: same.id, actorId: actorOf(access) })
                return `Dropped ${name}. ${yield* listed(access.projectId)}`
              }
              yield* keepRunnable({
                projectId: access.projectId,
                ...(same === undefined ? {} : { id: same.id }),
                name,
                command,
                ...(asked.repository === undefined ? {} : { repository: asked.repository }),
                actorId: actorOf(access),
              })
              return `Kept: ${name} runs with \`${command}\`. ${yield* listed(access.projectId)}`
            }),
          ),
      })

      /** A run once it says where it answers, or ends, or `within` goes by; what it was then, or nothing once it's gone. */
      const settled = (id: string, within: Duration.Duration) =>
        Effect.gen(function* () {
          const until = Date.now() + Duration.toMillis(within)
          for (;;) {
            const launch = launches.get(id)
            if (launch === undefined || launch.url !== null || launch.ended !== null || Date.now() > until) return launch
            yield* Effect.sleep(Duration.millis(250))
          }
        })
      const lastLines = (printed: string) => uncoloured(printed).trimEnd().split('\n').slice(-LAST_LINES).join('\n') || '(nothing)'

      /** The project's runnable an agent names, by its name or its command; its default without one. */
      const namedRun = (projectId: string, run: string | undefined) =>
        Effect.gen(function* () {
          const wanted = run?.trim().toLowerCase()
          if (wanted === undefined || wanted === '') return undefined
          const named = (yield* runnables(projectId, null)).find(
            (one) => one.name?.toLowerCase() === wanted || one.command.toLowerCase() === wanted,
          )
          if (named === undefined)
            return yield* new ToolRefused({ message: `The project runs nothing called ${run}. ${yield* listed(projectId)}` })
          return named
        })

      /** Starts a run an agent asked for, and says how it is once it says where it answers, or ends, or a while goes by. */
      const runFor = (
        access: ToolAccess,
        task: { readonly id: string; readonly slug: string } | undefined,
        asked: typeof Asked.Type,
        place: string,
        after: { readonly answering: string; readonly quiet: string },
      ) =>
        Effect.gen(function* () {
          const named = yield* namedRun(access.projectId, asked.run)
          const started = yield* start({
            projectId: access.projectId,
            taskId: task?.id ?? null,
            threadId: access.threadId,
            ...(named === undefined ? {} : { runnableId: named.id }),
            ...(asked.repository === undefined ? {} : { repository: asked.repository }),
          })
          // It mostly says where it answers within seconds: waiting for that gives the person a link at once.
          const launch = yield* settled(started.id, ANSWERING_WITHIN)
          const running = `Running \`${started.command}\` in ${place}`
          if (launch?.ended != null)
            return `\`${started.command}\` in ${place} ended at once${launch.ended.code === null ? '' : `, with exit code ${launch.ended.code}`}. Its last lines:\n\n${lastLines(launch.printed)}\n\n${after.quiet}`
          if (launch?.url != null) return `${running}, at ${launch.url}. ${after.answering}`
          return `${running}. It hasn't said where it answers yet; the person sees it in the Running pill, with its address once it says, and stops it there.`
        })

      const runTool: Tool = {
        name: 'run_project',
        description:
          "Runs the project for the person, with no agent: Althar starts its default run command itself, or with run the one of its runnables by that name, and shows it over the composer, with where it answers once it says. With task, in that task's worktree, to see what it built; without, in a fresh copy of the default branch. It stays running until the person stops it. In a project of several repositories, say which, as repository.",
        input: {
          type: 'object',
          properties: {
            task: { type: 'string', description: "The task's slug." },
            run: {
              type: 'string',
              description: 'The name of one of the things the project runs, as keep_run kept it; its default without.',
            },
            repository: { type: 'string' },
          },
        },
        call: (input, access) =>
          said(
            provide(
              Effect.gen(function* () {
                const asked = yield* read(Asked, input)
                const sql = yield* SqlClient.SqlClient
                const [task] =
                  asked.task === undefined
                    ? []
                    : yield* sql<{ id: string; slug: string }>`
                        SELECT id, slug FROM tasks WHERE project_id = ${access.projectId} AND (id = ${asked.task} OR slug = ${asked.task})`
                if (asked.task !== undefined && task === undefined)
                  return yield* new ToolRefused({ message: `This project has no task ${asked.task}. list_tasks shows them.` })
                return yield* runFor(
                  access,
                  task,
                  asked,
                  task === undefined ? 'a fresh copy of the default branch' : `${task.slug}'s worktree`,
                  {
                    answering:
                      "Give the person that address as a link, with the page on it they'd want, if one; they can open and stop it from the Running pill too.",
                    quiet:
                      'Tell the person why, in a sentence; if how it runs is wrong, keep how with set_run_command or keep_run and run it again.',
                  },
                )
              }),
            ),
          ),
      }

      /*
       * A lead runs the project in its own worktree, as the coordinator runs a
       * task's: the same run, with its card in the task's thread and in the
       * Running pill, which the person opens and stops as any other. It stops
       * only its task's runs.
       */
      const LeadAsked = Schema.Struct({ run: Schema.optional(Schema.String), repository: Schema.optional(Schema.String) })
      const leadRunTool: Tool = {
        name: 'run_project',
        description:
          'Runs the project in your worktree, outside your sandbox, as Althar runs it for the person: its default run command, or with run the one of the things it runs by that name (Storybook), after its setup. Use it rather than starting a dev server yourself: it answers on localhost as it would, and the person sees it in the Running pill over the composer, with where it answers, and can open or stop it there. It returns once it says where it answers, or ends, with its last lines if it did; a run of it already going is the one returned. It stays running until you stop it with stop_project, or the person stops it: stop it once you no longer need it. In a task of several repositories, say which, as repository.',
        input: {
          type: 'object',
          properties: {
            run: {
              type: 'string',
              description: 'The name of one of the things the project runs, as keep_run kept it; its default without.',
            },
            repository: { type: 'string' },
          },
        },
        call: (input, access) =>
          said(
            provide(
              Effect.gen(function* () {
                if (access.taskId === null) return yield* new ToolRefused({ message: 'This tool is for a task’s lead.' })
                const asked = yield* read(LeadAsked, input)
                const sql = yield* SqlClient.SqlClient
                const [task] = yield* sql<{ id: string; slug: string }>`SELECT id, slug FROM tasks WHERE id = ${access.taskId}`
                if (task === undefined) return yield* new ToolRefused({ message: 'Althar can’t find this task. Tell the person.' })
                return yield* runFor(access, task, asked, 'your worktree', {
                  answering:
                    'Read it there, or take a screenshot of it with screenshot; stop it with stop_project once you no longer need it.',
                  quiet: 'Fix what stopped it, or, if how it runs is wrong, keep how with set_run_command or keep_run, and run it again.',
                })
              }),
            ),
          ),
      }

      const StopAsked = Schema.Struct({ run: Schema.optional(Schema.String) })
      const stopTool: Tool = {
        name: 'stop_project',
        description:
          "Stops what you ran with run_project in your worktree, or the person ran there: with run, the one by that name or command; without, each of the task's runs. It goes from the Running pill. What runs from the default branch, or another task's worktree, isn't yours to stop.",
        input: { type: 'object', properties: { run: { type: 'string' } } },
        call: (input, access) =>
          said(
            Effect.gen(function* () {
              if (access.taskId === null) return yield* new ToolRefused({ message: 'This tool is for a task’s lead.' })
              const asked = yield* read(StopAsked, input)
              const ours = [...launches.values()].filter(
                (launch) => launch.projectId === access.projectId && launch.taskId === access.taskId,
              )
              const wanted = asked.run?.trim().toLowerCase()
              const chosen =
                wanted === undefined || wanted === ''
                  ? ours
                  : ours.filter((launch) => launch.name?.toLowerCase() === wanted || launch.command.toLowerCase() === wanted)
              if (chosen.length === 0)
                return ours.length === 0
                  ? 'Nothing runs in your worktree, so there was nothing to stop.'
                  : yield* new ToolRefused({
                      message: `Nothing called ${asked.run} runs in your worktree. What runs there: ${ours.map((launch) => launch.name ?? launch.command).join(', ')}.`,
                    })
              for (const launch of chosen) yield* stop(launch.id)
              return `Stopped ${chosen.map((launch) => `\`${launch.command}\``).join(', ')} in your worktree.`
            }),
          ),
      }

      /*
       * A screenshot Althar takes itself, headless, outside the agent's
       * sandbox, where Chromium in the agent's would fail: of a page served on
       * this computer, a run's or a dev server's, given back as a picture.
       */
      const screenshotTool: Tool = {
        name: 'screenshot',
        description: `Takes a screenshot of a web page served on this computer, such as what run_project runs or a dev server or Storybook on localhost, and gives it back to you as a picture, at 1×. Althar draws it itself, headless, outside your sandbox, so use it rather than starting a browser yourself. The viewport is ${VIEWPORT.width}×${VIEWPORT.height} without width and height; full_page takes the whole page, as tall as it is; selector takes only the first element a CSS selector finds. It waits for the page to load, not for what it fetches after: for a page that fills in later, take it again. Pages on the internet aren't taken. Each picture stays in your context, so take only what you need to see.`,
        input: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The page, such as http://localhost:5173/settings.' },
            width: { type: 'integer', minimum: 240, maximum: 3840 },
            height: { type: 'integer', minimum: 160, maximum: 2160 },
            full_page: { type: 'boolean' },
            selector: { type: 'string', description: 'A CSS selector, for one element of the page.' },
          },
          required: ['url'],
        },
        call: (input, access) =>
          Effect.gen(function* () {
            const take = config.screenshot
            if (take === undefined)
              return yield* new ToolRefused({ message: 'This Althar can’t take screenshots: only the desktop app draws pages.' })
            // What Althar runs for the project answers where it says, which may be by this computer's name rather than localhost.
            const running = [...launches.values()].flatMap((launch) =>
              launch.projectId === access.projectId && launch.ended === null && launch.url !== null ? [launch.url] : [],
            )
            const shot = shotOf(input, running)
            if (typeof shot === 'string') return yield* new ToolRefused({ message: shot })
            const taken = yield* take(shot).pipe(Effect.mapError((why) => new ToolRefused({ message: `Althar couldn’t take it: ${why}` })))
            return { text: shotWords(shot, taken), image: { data: taken.png, mimeType: 'image/png' } }
          }),
      }

      yield* toolServer.serve('coordinator', [
        screenshotTool,
        runTool,
        keepTool(() => instance.coordinatorId),
        keepRunTool(() => instance.coordinatorId),
      ])
      yield* toolServer.serve('lead', [
        keepTool(() => instance.systemId),
        keepRunTool(() => instance.systemId),
        leadRunTool,
        stopTool,
        screenshotTool,
      ])

      return Launches.of({
        start,
        stop,
        clear,
        stopAll,
        ofProject: (projectId) => Effect.sync(() => ofProject(projectId)),
        processes: () =>
          Effect.sync(() =>
            [...launches.values()].flatMap((launch) =>
              launch.ended === null ? [{ pid: launch.pid, projectId: launch.projectId, taskId: launch.taskId }] : [],
            ),
          ),
        using: (taskId) =>
          Effect.sync(
            () => startingFrom.has(taskId) || [...launches.values()].some((launch) => launch.ended === null && launch.taskId === taskId),
          ),
        runnables,
        keep,
        keepRunnable,
        dropRunnable,
        orderRunnables,
        scripts,
      })
    }),
  )
}
