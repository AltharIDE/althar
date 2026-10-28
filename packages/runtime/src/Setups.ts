import { basename, isAbsolute, join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type LaunchSpec, spawnOwned } from '@althar/provider-adapters'
import { Cause, Context, type Crypto, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { makeKeyedLock } from './keyedLock'
import { Instance } from './Instance'
import { printedMore, uncoloured } from './leftRunning'
import { change, fact, timestamp } from './records'
import { installIn } from './runCommand'
import { addItem, updateItem } from './threads'
import { type ToolAccess, ToolRefused, ToolServer } from './ToolServer'

/*
 * A task's worktree set up by Althar itself, outside any agent's sandbox,
 * before its lead starts (ADR-023): the setup kept for its repository, else
 * the install its lockfile names, run whatever `node_modules` holds, which
 * never changes the lockfile. A lead in
 * a fresh worktree would otherwise install first, and its sandbox refuses the
 * package manager's cache and temporary folders outside the worktree.
 *
 * It starts as the worktree is made, and the lead's first turn waits for it.
 * Never in a copy a task only reads, such as the pull request a review reads:
 * nothing of someone else's code runs there.
 * It runs once per worktree: how it went is kept on the workspace, so a lead
 * that resumes doesn't set it up again, and a worktree made again (a reopened
 * task's whose folder went) is. It runs in the person's login shell, so it
 * finds their tools as their terminal would, as Althar's own process (purpose
 * `setup`) in a process group of its own, for ten minutes at most. The task's
 * thread shows it as it goes, and the end of what it printed if it failed;
 * the lead is told how it went. A setup that fails never holds the task up:
 * the lead starts all the same, told what failed.
 *
 * The lead can have it run again, as it ran then, with install_dependencies:
 * where its sandbox refuses an install (a lock in `.git`, the package
 * manager's cache), or something it changed needs installing. Only the setup
 * runs, never a command the lead names, and it is kept on the workspace as
 * the first was.
 */

/** How a worktree's setup went, as its workspace keeps it. */
export interface SetUp {
  /** When it ended. */
  readonly at: string
  /** What ran; null for nothing to run. */
  readonly command: string | null
  /** Its exit code, 0 for done; null where it didn't end by itself, or couldn't start. */
  readonly code: number | null
  /** It ran out of time, and was stopped. */
  readonly timedOut: boolean
  /** The end of what it printed, where it failed. */
  readonly last: string | null
}

/** A setup failed: something ran, and didn't end with 0. */
export const failedSetUp = (setUp: SetUp) => setUp.command !== null && setUp.code !== 0

/** How long a setup may run, unless a test says otherwise. */
const WITHIN = Duration.minutes(10)
/** How many of the last lines a failed setup printed are kept, and at most how much of them. */
const LAST_LINES = 20
const LAST_CHARACTERS = 4_000

/** Shells a line can be given to as it is, with a login shell's flags. */
const POSIX = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

/**
 * How a line runs in the person's login shell, interactive, so it reads what
 * puts their tools on their PATH (Homebrew's, Bun's, nvm's) as a terminal
 * would, with nothing to read from the person, and what it writes to stderr
 * in the same stream as the rest. The line runs in a subshell of its own, so
 * an `exit` in it ends only that, and a login shell doesn't say "logout". A
 * shell that isn't a POSIX one, such as fish, gives way to zsh on a Mac, else
 * sh. On Windows, cmd.
 */
export const shellFor = (line: string, platform: NodeJS.Platform, shell: string | undefined): LaunchSpec => {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/s', '/c', `"(${line}) 2>&1"`], verbatim: true }
  const own = shell !== undefined && isAbsolute(shell) && POSIX.has(basename(shell)) ? shell : undefined
  return { command: own ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), args: ['-i', '-l', '-c', `exec 2>&1\n(\n${line}\n)`] }
}

/** The last lines of what a command printed, without its colours or the lines a progress bar rewrote. */
export const lastLinesOf = (printed: string) => {
  const lines = uncoloured(printed)
    .split(/\r?\n/)
    .map((line) => line.split('\r').at(-1) ?? '')
    .map((line) => line.trimEnd())
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  const last = lines.slice(-LAST_LINES).join('\n')
  return last.length > LAST_CHARACTERS ? `…${last.slice(-LAST_CHARACTERS)}` : last
}

/** What a setup's item in the thread says: the repository, what runs, and how it ended. */
interface Shown {
  readonly repository: string
  readonly command: string
  readonly kept: boolean
  readonly startedAt: string
  readonly ended: {
    readonly at: string
    readonly code: number | null
    readonly timedOut: boolean
    /** Althar quit as it ran. */
    readonly stopped: boolean
    readonly last: string | null
  } | null
}

/** A worktree still to set up, with where its task's thread is. */
interface Unset {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly worktree: string
  readonly within: string | null
  readonly name: string
  readonly kept: string | null
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | RuntimeConfig

/** A worktree of the task's, set up already or not, to set up again. */
interface Again extends Unset {
  readonly bindingSlug: string
}

export class Setups extends Context.Service<
  Setups,
  {
    /** Sets up each of the task's worktrees that isn't yet, without waiting: as they are made. */
    begin(taskId: string): Effect.Effect<void>
    /**
     * Waits until each of the task's worktrees is set up, setting up any that
     * isn't yet: before its lead's first turn. Never fails; one that doesn't
     * set up says so in the thread, and to the lead.
     */
    ready(taskId: string): Effect.Effect<void>
    /** What the task's lead is told of how its worktrees were set up; null where nothing ran. */
    told(taskId: string): Effect.Effect<string | null>
  }
>()('@althar/runtime/Setups') {
  static readonly layer: Layer.Layer<Setups, never, Store | ToolServer> = Layer.effect(
    Setups,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const options = (yield* RuntimeConfig).setups ?? {}
      const within = options.within ?? WITHIN
      // Every setup runs in this scope: closed, as Althar stops, each one's process group is stopped.
      const setupsScope = yield* Scope.fork(yield* Effect.scope, 'sequential')

      // A setup an earlier launch left going was stopped with it: its item says so, and its worktree is set up again when next wanted.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const open = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
            SELECT id, project_id, content FROM thread_items WHERE kind = 'setup' AND json_extract(content, '$.ended') IS NULL`
          const at = yield* timestamp
          for (const item of open)
            yield* updateItem(item.projectId, item.id, {
              ...(JSON.parse(item.content) as Record<string, unknown>),
              ended: { at, code: null, timedOut: false, stopped: true, last: null },
            })
        }),
      ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not close the setups of an earlier launch', cause)))

      /** Keeps how a worktree's setup went on its workspace, as a fact of its own. */
      const kept = (unset: Unset, setUp: SetUp) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('workspaces', unset.id, { setup: JSON.stringify(setUp) })
              yield* fact({
                projectId: unset.projectId,
                aggregateType: 'workspace',
                aggregateId: unset.id,
                revision,
                type: 'workspace.set_up',
                payload: { command: setUp.command, code: setUp.code, timedOut: setUp.timedOut },
                actorId: instance.systemId,
              })
            }),
          )
        })

      /** Runs a setup in a folder, recorded as Althar's own process, until it ends or its time is up. */
      const run = (projectId: ProjectId, folder: string, command: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const spec = shellFor(command, process.platform, options.shell ?? process.env.SHELL)
            const id = yield* newId(Ids.process)
            // Recorded before it is spawned, so a crash in between leaves a trace to reconcile.
            yield* sql`INSERT INTO processes ${sql.insert({
              id,
              projectId,
              deviceId: instance.deviceId,
              runtimeInstanceId: instance.id,
              purpose: 'setup',
              executable: spec.command,
              argsRedacted: JSON.stringify(spec.args),
              controllerGeneration: 1,
              state: 'launching',
              launchedAt: yield* timestamp,
            })}`
            const spawned = yield* Effect.exit(spawnOwned(spec, folder))
            if (Exit.isFailure(spawned)) {
              yield* change('processes', id, { state: 'unknown', endedAt: yield* timestamp })
              const reason = Option.match(Cause.findErrorOption(spawned.cause), {
                onNone: () => Cause.pretty(spawned.cause),
                onSome: (error) => error.reason,
              })
              const last = `Althar couldn't start it: ${reason}`
              return { code: null, timedOut: false, last, printed: last }
            }
            const owned = spawned.value
            yield* change('processes', id, {
              pid: owned.pid,
              processGroupId: owned.pid,
              osStartedAt: owned.osStartedAt ?? null,
              environmentDigest: owned.environmentDigest,
              state: 'running',
            })
            // Nothing in it waits on the person: what it would read ends at once.
            yield* Effect.promise(() => owned.stdin.close().catch(() => undefined))
            // What it prints is read as it comes, so it never waits on a full pipe.
            let printed = ''
            const reading = yield* Effect.forkScoped(
              Effect.promise(async () => {
                const reader = owned.stdout.getReader()
                const decoder = new TextDecoder()
                for (;;) {
                  const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
                  if (done || value === undefined) return
                  printed = printedMore(printed, decoder.decode(value, { stream: true }))
                }
              }),
            )
            const exit = yield* Deferred.await(owned.exited).pipe(Effect.timeoutOption(within))
            // Ended, what it printed last is read before it is kept; something it left holding the pipe isn't waited on.
            if (Option.isSome(exit)) yield* Fiber.await(reading).pipe(Effect.timeoutOption(Duration.seconds(2)))
            const at = yield* timestamp
            yield* change(
              'processes',
              id,
              Option.isSome(exit)
                ? { state: 'exited', exitCode: exit.value.code, signal: exit.value.signal, endedAt: at }
                : { state: 'killed', endedAt: at },
            )
            const code = Option.isSome(exit) ? exit.value.code : null
            // What the line printed, both streams; what the shell said on its own before it, such as an interactive sh's
            // "no job control", isn't the setup's. Kept only where it failed; the lead that asked for it reads it either way.
            const last = lastLinesOf(printed)
            return { code, timedOut: Option.isNone(exit), last: code === 0 || last === '' ? null : last, printed: last }
          }),
        )

      /** Sets up a worktree that isn't yet: its item in the thread first, then the setup, kept, then the item saying how it ended. */
      const setUp = (unset: Unset) =>
        Effect.gen(function* () {
          const folder = unset.within === null ? unset.worktree : join(unset.worktree, unset.within)
          // The install itself, not one that skips a `node_modules` there already: one an install cut short left isn't set up.
          const command = unset.kept ?? installIn(folder, unset.worktree)
          if (command === null) {
            yield* kept(unset, { at: yield* timestamp, command: null, code: null, timedOut: false, last: null })
            return undefined
          }
          const shown: Shown = { repository: unset.name, command, kept: unset.kept !== null, startedAt: yield* timestamp, ended: null }
          const item = yield* addItem({ projectId: unset.projectId, threadId: unset.threadId }, 'setup', shown)
          const { printed, ...ran } = yield* run(unset.projectId, folder, command)
          const done: SetUp = { at: yield* timestamp, command, ...ran }
          yield* kept(unset, done)
          yield* updateItem(unset.projectId, item, {
            ...shown,
            ended: { at: done.at, code: done.code, timedOut: done.timedOut, stopped: false, last: done.last },
          } satisfies Shown)
          return { setUp: done, printed }
        })

      /*
       * One worktree is set up at a time: a second asking waits for the first,
       * then finds it set up. What isn't set up is read under the lock.
       */
      const locks = makeKeyedLock()
      const locked = locks.withLock
      const settle = (workspaceId: string) =>
        locked(
          workspaceId,
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              // Not for an abandoned task, but one whose folder came back once it was removed (ADR-056); nor one whose project was removed.
              const [unset] = yield* sql<Unset>`
                  SELECT w.id, w.project_id, t.id AS thread_id, w.path AS worktree, b.folder AS within, b.display_name AS name,
                    b.run_setup AS kept
                  FROM workspaces w
                  JOIN repository_bindings b ON b.id = w.binding_id
                  JOIN tasks k ON k.id = w.task_id AND (k.state <> 'abandoned' OR w.cleaned_at IS NOT NULL)
                  JOIN projects p ON p.id = w.project_id AND p.archived_at IS NULL
                  JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
                  WHERE w.id = ${workspaceId} AND w.state = 'ready' AND w.access = 'write' AND w.setup IS NULL`
              if (unset !== undefined) yield* setUp(unset)
            }),
          ),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not set up a task’s worktree', cause)))

      const ready = (taskId: string) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const unset = yield* sql<{ id: string }>`
              SELECT w.id FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
              WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready' AND w.access = 'write' AND w.setup IS NULL
              ORDER BY b.created_at, b.rowid`
            // Each in a fiber of Althar's own, side by side: a lead that stops waiting doesn't stop its worktree's setup.
            const fibers = yield* Effect.forEach(unset, (workspace) => Effect.forkIn(settle(workspace.id), setupsScope))
            yield* Effect.forEach(fibers, Fiber.await, { discard: true })
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not set up a task’s worktrees', cause)))

      const told = (taskId: string) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const rows = yield* sql<{ name: string; setup: string }>`
              SELECT b.display_name AS name, w.setup FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
              WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready' AND w.setup IS NOT NULL
              ORDER BY b.created_at, b.rowid`
            const several = rows.length > 1
            const ran = rows.flatMap((row) => {
              const setUp = JSON.parse(row.setup) as SetUp
              return setUp.command === null ? [] : [{ name: row.name, setUp }]
            })
            return ran.length === 0 ? null : toldOf(ran, several)
          }),
        ).pipe(Effect.orElseSucceed(() => null))

      /* ---- What the lead can do about it ---- */

      /** The task's worktrees here a lead can set up again, the one named alone; set up already or not. */
      const againOf = (taskId: string, named: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const all = yield* sql<Again>`
            SELECT w.id, w.project_id, t.id AS thread_id, w.path AS worktree, b.folder AS within, b.display_name AS name,
              b.run_setup AS kept, b.slug AS binding_slug
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready' AND w.access = 'write'
            ORDER BY b.created_at, b.rowid`
          if (named === undefined) return all
          const wanted = named.trim().toLowerCase()
          const found = all.filter((one) => one.name.toLowerCase() === wanted || one.bindingSlug === wanted)
          if (found.length === 0)
            return yield* new ToolRefused({
              message: `This task has no worktree of a repository called ${named}. Its repositories: ${all.map((one) => one.name).join(', ') || 'none'}.`,
            })
          return found
        })

      /** How a setup the lead asked for went, in words for it, with the end of what it printed either way. */
      const saidOf = (name: string, several: boolean, ran: { readonly setUp: SetUp; readonly printed: string } | undefined) => {
        const where = several ? `${name}'s worktree` : 'the worktree'
        if (ran === undefined || ran.setUp.command === null)
          return `${several ? name : 'The repository'} has no setup kept, and nothing Althar can tell to install: there is no lockfile or manifest it knows. If it needs one, keep it with set_run_command.`
        const { setUp, printed } = ran
        const ended = failedSetUp(setUp) ? howItFailed(setUp) : 'it went through'
        return [
          `Althar ran \`${setUp.command}\` in ${where}, outside your sandbox, and ${ended}.`,
          ...(printed === '' ? [] : [`The end of what it printed:\n\`\`\`\n${printed}\n\`\`\``]),
        ].join(' ')
      }

      const installTool = {
        name: 'install_dependencies',
        description:
          "Runs the project's setup again in your worktree, outside your sandbox, as Althar ran it when the worktree was made: the setup kept for the repository (set_run_command keeps it), else the install its lockfile names, which never changes the lockfile. Use it where an install fails in your sandbox (a lock in .git, the package manager's cache or its temporary folders), or once what you changed needs installing, such as a dependency added to package.json with its lockfile. It runs only that setup, never a command you give, for ten minutes at most, and returns once it ends, with how it went and the end of what it printed; the task's thread shows it too. In a task of several repositories, repository names the one; without, each is set up.",
        input: { type: 'object', properties: { repository: { type: 'string' } } },
        call: (input: unknown, access: ToolAccess) =>
          Effect.gen(function* () {
            const taskId = access.taskId
            if (taskId === null) return yield* new ToolRefused({ message: 'This tool is for a task’s lead.' })
            const asked = (typeof input === 'object' && input !== null ? input : {}) as { readonly repository?: unknown }
            const named = typeof asked.repository === 'string' && asked.repository.trim() !== '' ? asked.repository : undefined
            const again = yield* provide(againOf(taskId, named))
            if (again.length === 0)
              return yield* new ToolRefused({
                message: "The task's worktree isn't on this computer, so Althar can't set it up. Tell the person.",
              })
            // One at a time in a worktree: one being set up as it was made is waited for, then this runs after it.
            const ran = yield* Effect.forEach(again, (one) => locked(one.id, provide(setUp(one))))
            return again.map((one, at) => saidOf(one.name, again.length > 1, ran[at])).join('\n\n')
          }).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : Effect.andThen(
                    Effect.logWarning('install_dependencies did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not run the setup. Try again, or tell the person.' })),
                  ),
            ),
          ),
      }
      yield* (yield* ToolServer).serve('lead', [installTool])

      return Setups.of({
        begin: (taskId) => Effect.asVoid(Effect.forkIn(ready(taskId), setupsScope)),
        ready,
        told,
      })
    }),
  )
}

/** How a setup that failed ended, in words for the lead. */
const howItFailed = (setUp: SetUp) =>
  setUp.timedOut
    ? 'it ran out of time and was stopped'
    : setUp.code === null
      ? "it didn't finish"
      : `it failed with exit code ${setUp.code}`

/** What a lead is told of how its task's worktrees were set up, each by name where there are several. */
export const toldOf = (ran: ReadonlyArray<{ readonly name: string; readonly setUp: SetUp }>, several: boolean) => {
  const failed = ran.filter(({ setUp }) => failedSetUp(setUp))
  const each = ran.map(({ name, setUp }) => {
    const where = several ? `${name}'s worktree` : 'the worktree'
    if (!failedSetUp(setUp))
      return `When ${where} was made, Althar set it up with \`${setUp.command}\`, and that went through: what it installs is there, so don't run it again.`
    return [
      `When ${where} was made, Althar set it up with \`${setUp.command}\`, and ${howItFailed(setUp)}.`,
      ...(setUp.last === null ? [] : [`The end of what it printed:\n\`\`\`\n${setUp.last}\n\`\`\``]),
    ].join(' ')
  })
  return [
    ...each,
    ...(failed.length === 0
      ? []
      : [
          "Its dependencies may not all be installed: see why first, then install what's missing, or, where your sandbox was in the way, have Althar run the setup again with install_dependencies. If the setup is wrong for the repository, keep the right one with set_run_command, so the next task's worktree gets it.",
        ]),
  ].join('\n\n')
}
