import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import { bumpRevision, Ledger } from '@althar/persistence-sqlite'
import { spawnOwned } from '@althar/provider-adapters'
import { Context, Crypto, Deferred, Duration, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { freshCopy } from './coordinatorFolder'
import { Instance } from './Instance'
import { printedMore, servingAt, uncoloured } from './leftRunning'
import { addItem, updateItem } from './threads'
import { Live } from './Live'
import { change, fact, timestamp } from './records'
import { lineOf, type RunCommand, runOf } from './runCommand'
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
 */

/** A run as a client shows it. `taskId` is null for a copy of the default branch. */
export interface ShownLaunch {
  readonly id: string
  readonly taskId: string | null
  /** Where it runs, in words: the task's title, or the default branch. */
  readonly where: string
  readonly command: string
  readonly url: string | null
  readonly startedAt: string
  readonly ended: { readonly at: string; readonly code: number | null } | null
}

interface Launch {
  readonly id: string
  readonly projectId: string
  readonly taskId: string | null
  readonly where: string
  readonly bindingId: string
  readonly command: string
  readonly startedAt: string
  readonly scope: Scope.Closeable
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
  /** `unknown`: nothing says how it runs; `elsewhere`: no copy here to run it in; `which`: the repository named isn't one, or none was in a project of several. */
  why: Schema.Literals(['unknown', 'elsewhere', 'which']),
  message: Schema.String,
}) {}

/** How often, and for how long, a run is read for where it answers. */
const SERVING_EVERY = Duration.millis(500)
const SERVING_TRIES = 1_200
/** How long the coordinator waits for a run it started to say where it answers, so it can give the person a link. */
const ANSWERING_WITHIN = Duration.seconds(30)
/** How many of the last lines a run printed the coordinator reads, when it ended at once. */
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

type Store = SqlClient.SqlClient | Crypto.Crypto | Instance | RuntimeConfig | Live | Ledger

export class Launches extends Context.Service<
  Launches,
  {
    /**
     * Runs the project: in the task's worktree, or a copy of the default
     * branch; the repository named, or the first with a way to run it. A run
     * already there, in the same place, is the one returned.
     */
    start(input: {
      readonly projectId: string
      readonly taskId: string | null
      readonly repository?: string
      /** The thread it was asked for in, where its card goes; null for none. */
      readonly threadId: string | null
    }): Effect.Effect<ShownLaunch, unknown>
    /** Stops a run; it goes from the list. */
    stop(id: string): Effect.Effect<void>
    /** Clears a run that ended by itself from the list. */
    clear(id: string): Effect.Effect<void>
    /** The project's runs, in the order they started. */
    ofProject(projectId: string): Effect.Effect<ReadonlyArray<ShownLaunch>>
    /** What running would run, for the task or the default branch; null where no repository says how. */
    commandFor(projectId: string, taskId: string | null): Effect.Effect<string | null, unknown>
    /** Keeps how a repository runs, or, with null, goes back to working it out. Says which repository. */
    keep(input: {
      readonly projectId: string
      readonly repository?: string
      readonly run: RunCommand | null
      readonly actorId: ActorId
    }): Effect.Effect<string, unknown>
  }
>()('@althar/runtime/Launches') {
  static readonly layer: Layer.Layer<Launches, never, Store | ToolServer> = Layer.effect(
    Launches,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
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
        where: launch.where,
        command: launch.command,
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

      /** Where a repository runs for a task: its worktree, or the folder in it the project is about. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ bindingId: string; path: string }>`
            SELECT binding_id, path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId}`
          return new Map(rows.map((row) => [row.bindingId, row.path]))
        })

      const within = (binding: Binding, root: string) => (binding.within === null ? root : join(root, binding.within))

      /** How a repository runs in a folder: as kept for it, else as what is in the folder says. */
      const runIn = (binding: Binding, folder: string, root: string): RunCommand | null =>
        runOf({ command: binding.runCommand, setup: binding.runSetup }, folder, root)

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

      const commandFor = (projectId: string, taskId: string | null) =>
        provide(
          Effect.gen(function* () {
            for (const { binding, root } of yield* placesOf(projectId, taskId, undefined)) {
              const run = runIn(binding, within(binding, root), root)
              if (run !== null) return run.command
            }
            return null
          }),
        )

      /** A copy of the repository's default branch to run, Althar's own, fresh each time it starts. */
      const runCopy = (projectId: string, binding: Binding) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${projectId}`
          const folder = join(config.worktreeRoot, project?.slug ?? projectId, '.run')
          mkdirSync(folder, { recursive: true })
          const path = join(folder, binding.slug)
          yield* freshCopy(binding.repository, path, binding.base ?? 'main')
          return path
        })

      /** A run's card as its thread keeps it: what it runs, where it answers, and how it ended, with its last line. */
      const cardOf = (launch: Launch) => ({
        launchId: launch.id,
        taskId: launch.taskId,
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

      const start = (input: {
        readonly projectId: string
        readonly taskId: string | null
        readonly repository?: string
        /** The thread it was asked for in, where its card goes; null for none. */
        readonly threadId: string | null
      }) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const places = yield* placesOf(input.projectId, input.taskId, input.repository)
            if (places.length === 0)
              return yield* new LaunchRefused({
                why: 'elsewhere',
                message:
                  input.taskId === null ? 'The project has no repository on this Mac to run.' : 'The task has no worktree here to run.',
              })
            // A run already going in the same place is the one there is: two would want the same port.
            for (const { binding } of places) {
              const running = [...launches.values()].find(
                (launch) => launch.taskId === input.taskId && launch.bindingId === binding.id && launch.ended === null,
              )
              if (running !== undefined) return shown(running)
            }
            // The first repository that says how it runs, as its copy is now.
            let chosen: { readonly binding: Binding; readonly folder: string; readonly run: RunCommand } | undefined
            for (const { binding, root } of places) {
              const at = input.taskId === null ? yield* runCopy(input.projectId, binding) : root
              const run = runIn(binding, within(binding, at), at)
              if (run !== null) {
                chosen = { binding, folder: within(binding, at), run }
                break
              }
            }
            if (chosen === undefined)
              return yield* new LaunchRefused({
                why: 'unknown',
                message: `Althar can't tell how ${places.map(({ binding }) => binding.name).join(' or ')} runs: it has no dev, start or serve script, Procfile or Makefile target. Ask the coordinator to keep how it runs.`,
              })
            const { binding, folder, run } = chosen
            const line = lineOf(run)
            const spec =
              process.platform === 'win32'
                ? { command: 'cmd.exe', args: ['/d', '/s', '/c', line] }
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
            const [task] = input.taskId === null ? [] : yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${input.taskId}`
            const launch: Launch = {
              id,
              projectId: input.projectId,
              taskId: input.taskId,
              where: task?.title ?? binding.base ?? 'main',
              bindingId: binding.id,
              command: run.command,
              startedAt: yield* timestamp,
              scope,
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
                message: 'The project has no repository on this Mac to keep a way to run.',
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
                // The project changes with it, so every screen that offers to run it reads it again.
                const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${input.projectId}`
                const revision = yield* bumpRevision('projects', input.projectId, project?.revision ?? 1)
                yield* fact({
                  projectId: input.projectId as ProjectId,
                  aggregateType: 'project',
                  aggregateId: input.projectId,
                  revision,
                  type: 'project.run_command_kept',
                  payload: { repository: binding.binding.name, command: input.run?.command ?? null, setup: input.run?.setup ?? null },
                  actorId: input.actorId,
                })
              }),
            )
            return binding.binding.name
          }),
        )

      /* ---- What agents can do about it ---- */

      const Kept = Schema.Struct({
        command: Schema.NullOr(Schema.String),
        setup: Schema.optional(Schema.NullOr(Schema.String)),
        repository: Schema.optional(Schema.String),
      })
      const Asked = Schema.Struct({ task: Schema.optional(Schema.String), repository: Schema.optional(Schema.String) })
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

      const keepTool = (actorOf: (access: ToolAccess) => ActorId): Tool => ({
        name: 'set_run_command',
        description:
          "Keeps how the project runs, for Althar to run it for the person with no agent: the command that runs it (such as `bun run dev`), and setup, what makes a fresh copy ready (such as `test -d node_modules || bun install --frozen-lockfile`). Althar runs the setup itself, outside any agent's sandbox: before each run, and in each new task's worktree as it is made, before its lead starts, so the lead finds its dependencies installed. Without a setup, Althar works it out: installing the packages the lockfile names, never changing the lockfile. Use it when Althar can't work out how it runs, or works it out wrong, or when you change how it runs or what it needs installed first. A null command goes back to working both out from the repository. In a project of several repositories, say which, as repository.",
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
              const asked = yield* read(Kept, input)
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

      const runTool: Tool = {
        name: 'run_project',
        description:
          "Runs the project for the person, with no agent: Althar starts its run command itself and shows it over the composer, with where it answers once it says. With task, in that task's worktree, to see what it built; without, in a fresh copy of the default branch. It stays running until the person stops it. In a project of several repositories, say which, as repository.",
        input: {
          type: 'object',
          properties: { task: { type: 'string', description: "The task's slug." }, repository: { type: 'string' } },
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
                const started = yield* start({
                  projectId: access.projectId,
                  taskId: task?.id ?? null,
                  threadId: access.threadId,
                  ...(asked.repository === undefined ? {} : { repository: asked.repository }),
                })
                // It mostly says where it answers within seconds: waiting for that gives the person a link at once.
                const launch = yield* settled(started.id, ANSWERING_WITHIN)
                const place = task === undefined ? 'a fresh copy of the default branch' : `${task.slug}'s worktree`
                const running = `Running \`${started.command}\` in ${place}`
                if (launch?.ended != null)
                  return `\`${started.command}\` in ${place} ended at once${launch.ended.code === null ? '' : `, with exit code ${launch.ended.code}`}. Its last lines:\n\n${lastLines(launch.printed)}\n\nTell the person why, in a sentence; if how it runs is wrong, keep how with set_run_command and run it again.`
                if (launch?.url != null)
                  return `${running}, at ${launch.url}. Give the person that address as a link, with the page on it they'd want, if one; they can open and stop it from the Running pill too.`
                return `${running}. It hasn't said where it answers yet; the person sees it in the Running pill, with its address once it says, and stops it there.`
              }),
            ),
          ),
      }

      yield* toolServer.serve('coordinator', [runTool, keepTool(() => instance.coordinatorId)])
      yield* toolServer.serve('lead', [keepTool(() => instance.systemId)])

      return Launches.of({
        start,
        stop,
        clear,
        ofProject: (projectId) => Effect.sync(() => ofProject(projectId)),
        commandFor,
        keep,
      })
    }),
  )
}
