import { cp, lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, normalize, sep } from 'node:path'

import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type LaunchSpec, spawnOwned, withoutTrailingSlashes } from '@althar/provider-adapters'
import { bumpRevision } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Scope } from 'effect'
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
 * before its lead starts (ADR-023): the setup a lead recorded for its
 * repository, else the setup kept for it with set_run_command, else the
 * install its lockfile names, run whatever `node_modules` holds, which never
 * changes the lockfile.
 *
 * Nobody writes a setup. Where none is recorded, the lead is asked to get
 * its folder ready (its dependencies, what its tools download, the ignored
 * files it needs from the person's checkout, such as `.env`) and to record
 * what worked with record_setup: the files to copy and the commands, which
 * Althar keeps on the repository and replays in every later task's
 * worktree, copying the files and running the commands one after another,
 * each from the repository's folder, until one fails. Where the replay
 * fails, the lead starts all the same, told what failed, and records the
 * setup that works, which replaces the old one. The person reads it in the
 * project's settings, and can change it there or clear it.
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
  /** What it copied and the end of what it printed; null for nothing. */
  readonly last: string | null
  /** The files a recorded setup copies that it couldn't; absent for none. */
  readonly missing?: ReadonlyArray<string>
}

/** A repository's setup as a lead recorded it, or the person changed it: what Althar replays in each new task's worktree. */
export const Recorded = Schema.Struct({
  /** Ignored files and folders to copy from the person's checkout, from the repository's root. */
  copy: Schema.Array(Schema.String),
  /** The commands that get it ready, run one after another from the repository's folder, until one fails. */
  commands: Schema.Array(Schema.String),
  /** When it was recorded. */
  at: Schema.String,
  /** The task whose lead recorded it; null for the person's. */
  taskId: Schema.NullOr(Schema.String),
})
export type Recorded = typeof Recorded.Type

const decodeRecorded = Schema.decodeUnknownOption(Schema.fromJsonString(Recorded))

/** A binding's recorded setup, as its column keeps it; null for none, or one that can't be read. */
export const recordedOf = (json: string | null): Recorded | null => (json === null ? null : Option.getOrNull(decodeRecorded(json)))

/** How a recorded setup's commands run as one line: each on its own, in order, stopping at the first that fails. */
export const lineOf = (commands: ReadonlyArray<string>, platform: NodeJS.Platform): string =>
  platform === 'win32'
    ? commands.map((command) => `(${command})`).join(' && ')
    : commands.map((command) => `(\n${command}\n) || exit $?`).join('\n')

/** What a recorded setup shows as what ran: its commands, a line each, or the files it copies where it runs none. */
export const shownOf = (recorded: Pick<Recorded, 'copy' | 'commands'>): string =>
  recorded.commands.length > 0 ? recorded.commands.join('\n') : `Copy ${recorded.copy.join(', ')}`

/** A path a setup copies: from the repository's root, inside it, and never in its `.git`. */
export const copyablePath = (path: string): string | null => {
  const tidy = withoutTrailingSlashes(normalize(path.trim()).replaceAll('\\', '/'))
  if (tidy === '' || tidy === '.' || isAbsolute(tidy) || /^[a-z]:/i.test(tidy)) return null
  const parts = tidy.split('/')
  return parts.includes('..') || parts[0] === '.git' ? null : tidy
}

/**
 * Where a path in the worktree stands for a copy: `out` where a folder on
 * the way to it, or it, is a symbolic link, which a commit can make point
 * anywhere; `there` where the worktree has it already, which is never
 * copied over, nor copied into, as a folder could hold such a link; `new`
 * where the copy makes it, in real folders of the worktree.
 */
const placeOf = async (worktree: string, path: string): Promise<'out' | 'there' | 'new'> => {
  const root = await realpath(worktree).catch(() => null)
  if (root === null) return 'out'
  let at = root
  for (const part of path.split('/')) {
    at = join(at, part)
    const found = await lstat(at).catch(() => null)
    if (found === null) return 'new'
    if (found.isSymbolicLink()) return 'out'
  }
  return 'there'
}

/**
 * Copies what a setup names from the person's checkout into a worktree:
 * each that is there and stays inside the checkout, never over or into
 * what the worktree has, nor through a link out of it. It says, a line each, what it
 * copied and what it couldn't, and gives those it couldn't, which fail the
 * setup (ADR-078).
 */
export const copyInto = (checkout: string | null, worktree: string, paths: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const said: Array<string> = []
    const missing: Array<string> = []
    const missed = (path: string, why: string) => {
      said.push(why)
      missing.push(path)
    }
    const root = checkout === null ? null : await realpath(checkout).catch(() => null)
    for (const path of paths) {
      if (root === null) {
        missed(path, `Not copied, with no checkout of the repository on this computer: ${path}`)
        continue
      }
      const from = await realpath(join(root, path)).catch(() => null)
      if (from === null) {
        missed(path, `Not in the checkout: ${path}`)
        continue
      }
      if (from !== root && !from.startsWith(`${root}${sep}`)) {
        missed(path, `Not copied, as it leads outside the checkout: ${path}`)
        continue
      }
      const place = await placeOf(worktree, path)
      if (place === 'out') {
        missed(path, `Not copied, as it leads outside the task's folder: ${path}`)
        continue
      }
      if (place === 'there') {
        said.push(`Already there: ${path}`)
        continue
      }
      const copied = await cp(from, join(worktree, path), { recursive: true, force: false, errorOnExist: true }).then(
        () => true,
        () => false,
      )
      if (copied) said.push(`Copied ${path}`)
      else missed(path, `Couldn't copy ${path}`)
    }
    return { said, missing }
  })

/** A setup failed: something ran, and didn't end with 0, or a file it copies couldn't be. */
export const failedSetUp = (setUp: SetUp) => setUp.command !== null && (setUp.code !== 0 || (setUp.missing?.length ?? 0) > 0)

/** At most how many commands a recorded setup runs, and how long each may be. */
const MOST_COMMANDS = 20
const LONGEST_COMMAND = 2_000

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
    readonly missing?: ReadonlyArray<string>
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
  /** The setup a lead recorded for its repository, as its column keeps it. */
  readonly recorded: string | null
  /** The person's checkout of it on this computer, which a recorded setup copies from. */
  readonly checkout: string | null
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | RuntimeConfig

/** A worktree of the task's, set up already or not, to set up again. */
interface Again extends Unset {
  readonly bindingSlug: string
  readonly bindingId: string
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
          const recorded = recordedOf(unset.recorded)
          // The install itself, not one that skips a `node_modules` there already: one an install cut short left isn't set up.
          // A recorded setup with nothing in it says the repository needs nothing.
          const command =
            recorded !== null
              ? recorded.commands.length === 0 && recorded.copy.length === 0
                ? null
                : shownOf(recorded)
              : (unset.kept ?? installIn(folder, unset.worktree))
          if (command === null) {
            yield* kept(unset, { at: yield* timestamp, command: null, code: null, timedOut: false, last: null })
            return undefined
          }
          // A recorded setup installs what the repository needs, as the lockfile's would: the card says so, as for that.
          const shown: Shown = {
            repository: unset.name,
            command,
            kept: recorded === null && unset.kept !== null,
            startedAt: yield* timestamp,
            ended: null,
          }
          const item = yield* addItem({ projectId: unset.projectId, threadId: unset.threadId }, 'setup', shown)
          const { said: copies, missing } =
            recorded === null ? { said: [], missing: [] } : yield* copyInto(unset.checkout, unset.worktree, recorded.copy)
          const { printed: output, ...ran } =
            recorded !== null && recorded.commands.length === 0
              ? { code: 0, timedOut: false, last: null, printed: '' }
              : yield* run(unset.projectId, folder, recorded === null ? command : lineOf(recorded.commands, process.platform))
          const printed = [...copies, ...(output === '' ? [] : [output])].join('\n')
          // What it copied, then the end of what it printed, kept either way: the thread shows it folded.
          const last = printed === '' ? null : printed
          const done: SetUp = { at: yield* timestamp, command, ...ran, last, ...(missing.length === 0 ? {} : { missing }) }
          yield* kept(unset, done)
          yield* updateItem(unset.projectId, item, {
            ...shown,
            ended: {
              at: done.at,
              code: done.code,
              timedOut: done.timedOut,
              stopped: false,
              last: done.last,
              ...(missing.length === 0 ? {} : { missing }),
            },
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
                    b.run_setup AS kept, b.recorded_setup AS recorded,
                    (SELECT l.path FROM repository_locations l WHERE l.binding_id = b.id AND l.device_id = ${instance.deviceId}) AS checkout
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
            const rows = yield* sql<{ name: string; setup: string; recorded: string | null; checkout: string | null }>`
              SELECT b.display_name AS name, w.setup, b.recorded_setup AS recorded,
                (SELECT l.path FROM repository_locations l WHERE l.binding_id = b.id AND l.device_id = ${instance.deviceId}) AS checkout
              FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
              WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready' AND w.access = 'write'
                AND w.setup IS NOT NULL
              ORDER BY b.created_at, b.rowid`
            if (rows.length === 0) return null
            return toldOf(
              rows.map((row) => ({
                name: row.name,
                setUp: JSON.parse(row.setup) as SetUp,
                recorded: recordedOf(row.recorded) !== null,
                checkout: row.checkout,
              })),
              rows.length > 1,
            )
          }),
        ).pipe(Effect.orElseSucceed(() => null))

      /* ---- What the lead can do about it ---- */

      /** The task's worktrees here a lead can set up again, the one named alone; set up already or not. */
      const againOf = (taskId: string, named: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const all = yield* sql<Again>`
            SELECT w.id, w.project_id, t.id AS thread_id, w.path AS worktree, b.folder AS within, b.display_name AS name,
              b.run_setup AS kept, b.recorded_setup AS recorded, b.slug AS binding_slug, b.id AS binding_id,
              (SELECT l.path FROM repository_locations l WHERE l.binding_id = b.id AND l.device_id = ${instance.deviceId}) AS checkout
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

      /** Keeps a repository's setup, replacing what was recorded; the project changes with it, so its settings read it again. */
      const record = (projectId: ProjectId, bindingId: string, name: string, recorded: Recorded | null, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE repository_bindings SET recorded_setup = ${recorded === null ? null : JSON.stringify(recorded)}
                WHERE id = ${bindingId}`
              const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`
              const revision = yield* bumpRevision('projects', projectId, project?.revision ?? 1)
              yield* fact({
                projectId,
                aggregateType: 'project',
                aggregateId: projectId,
                revision,
                type: recorded === null ? 'project.setup_cleared' : 'project.setup_recorded',
                payload: { repository: name, ...(recorded === null ? {} : { copy: recorded.copy, commands: recorded.commands }) },
                actorId,
              })
            }),
          )
        })

      /** How a setup the lead asked for went, in words for it, with the end of what it printed either way. */
      const saidOf = (name: string, several: boolean, ran: { readonly setUp: SetUp; readonly printed: string } | undefined) => {
        const where = several ? `${name}'s worktree` : 'the worktree'
        if (ran === undefined || ran.setUp.command === null)
          return `${several ? name : 'The repository'} has no setup recorded, and nothing Althar can tell to install: there is no lockfile or manifest it knows. If it needs one, get the folder ready yourself and record what worked with record_setup.`
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
      const recordTool = {
        name: 'record_setup',
        description:
          "Records how your repository's folder gets ready to work in, for Althar to do the same in every later task's folder before its lead starts: copy, the ignored files and folders to copy from the person's checkout (such as `.env`, a local config), from the repository's root; and commands, what installs what it needs, one after another from the repository's folder, each a line as you ran it (`bun install --frozen-lockfile`, `bunx playwright install chromium`). Althar runs the commands itself, outside any agent's sandbox, and stops at the first that fails. Record only what worked here, the whole of it: it replaces the setup recorded before, and the person sees it in the project's settings. Where the folder needs nothing, record that, with no commands and no files. Althar copies the files into your folder now, so you have them. In a task of several repositories, repository names the one.",
        input: {
          type: 'object',
          properties: {
            copy: { type: 'array', items: { type: 'string' } },
            commands: { type: 'array', items: { type: 'string' } },
            repository: { type: 'string' },
          },
          required: ['commands'],
        },
        call: (input: unknown, access: ToolAccess) =>
          Effect.gen(function* () {
            const taskId = access.taskId
            if (taskId === null) return yield* new ToolRefused({ message: 'This tool is for a task’s lead.' })
            const asked = (typeof input === 'object' && input !== null ? input : {}) as {
              readonly copy?: unknown
              readonly commands?: unknown
              readonly repository?: unknown
            }
            const strings = (value: unknown) =>
              Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').map((one) => one.trim()) : []
            const commands = strings(asked.commands).filter((one) => one !== '')
            const named = strings(asked.copy).filter((one) => one !== '')
            const copy = [...new Set(named.map(copyablePath).filter((one) => one !== null))]
            const outside = named.filter((one) => copyablePath(one) === null)
            if (outside.length > 0)
              return yield* new ToolRefused({
                message: `Name each file to copy from the repository's root, inside it and not in .git: ${outside.join(', ')}.`,
              })
            if (commands.length > MOST_COMMANDS || commands.some((one) => one.length > LONGEST_COMMAND))
              return yield* new ToolRefused({
                message: `Give at most ${MOST_COMMANDS} commands, each under ${LONGEST_COMMAND} characters: put a longer one in a script of the repository's.`,
              })
            const repository = typeof asked.repository === 'string' && asked.repository.trim() !== '' ? asked.repository : undefined
            const all = yield* provide(againOf(taskId, repository))
            const [one] = all
            if (one === undefined)
              return yield* new ToolRefused({
                message: "The task's worktree isn't on this computer, so Althar can't record its setup. Tell the person.",
              })
            if (all.length > 1)
              return yield* new ToolRefused({
                message: `Say which repository it is for, as repository: ${all.map((each) => each.name).join(', ')}.`,
              })
            const recorded: Recorded = { copy, commands, at: yield* provide(timestamp), taskId }
            yield* provide(record(one.projectId, one.bindingId, one.name, recorded, instance.systemId))
            const copied = copy.length === 0 ? [] : (yield* copyInto(one.checkout, one.worktree, copy)).said
            if (commands.length === 0 && copy.length === 0)
              return `Recorded that ${one.name} needs nothing set up: later tasks' leads won't be asked again.`
            return [
              `Recorded ${one.name}'s setup: Althar gets every later task's folder ready with it before its lead starts.`,
              ...(copied.length === 0 ? [] : [`In your folder now: ${copied.join('; ')}.`]),
            ].join(' ')
          }).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : Effect.andThen(
                    Effect.logWarning('record_setup did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not record the setup. Try again, or tell the person.' })),
                  ),
            ),
          ),
      }
      yield* (yield* ToolServer).serve('lead', [installTool, recordTool])

      return Setups.of({
        begin: (taskId) => Effect.asVoid(Effect.forkIn(ready(taskId), setupsScope)),
        ready,
        told,
      })
    }),
  )
}

/** How a setup that failed ended, in words for the lead. */
const howItFailed = (setUp: SetUp) => {
  const ended = setUp.timedOut
    ? 'it ran out of time and was stopped'
    : setUp.code === null
      ? "it didn't finish"
      : setUp.code === 0
        ? null
        : `it failed with exit code ${setUp.code}`
  const missing = setUp.missing ?? []
  const copied = missing.length === 0 ? null : `couldn't copy ${missing.map((path) => `\`${path}\``).join(', ')}`
  return ended === null ? `it ${copied ?? 'went through'}` : copied === null ? ended : `${ended}, and ${copied}`
}

/** What a lead is told of how its task's worktrees were set up, each by name where there are several. */
export const toldOf = (
  each: ReadonlyArray<{
    readonly name: string
    readonly setUp: SetUp
    /** It ran the setup a lead recorded for the repository. */
    readonly recorded: boolean
    readonly checkout: string | null
  }>,
  several: boolean,
) =>
  each
    .flatMap(({ name, setUp, recorded, checkout }) => {
      const where = several ? `${name}'s worktree` : 'the worktree'
      const how = recorded ? "the repository's recorded setup" : `\`${setUp.command}\``
      const ran =
        setUp.command === null
          ? null
          : !failedSetUp(setUp)
            ? `When ${where} was made, Althar set it up with ${how}, and that went through: what it installs and copies is there, so don't run it again.`
            : [
                `When ${where} was made, Althar set it up with ${how}, and ${howItFailed(setUp)}.`,
                ...(setUp.last === null ? [] : [`What it did, and the end of what it printed:\n\`\`\`\n${setUp.last}\n\`\`\``]),
              ].join(' ')
      const from = checkout === null ? "the person's checkout" : `the person's checkout at ${checkout}`
      const asked = recorded
        ? failedSetUp(setUp)
          ? `See why first, then get ${where} ready yourself, and record the setup that works with record_setup: it replaces the one that failed, for every later task.`
          : null
        : `No setup is recorded for ${several ? name : 'the repository'} yet, so get ${where} ready to work in before anything else: install what it needs, its dependencies and what its tools download (Electron's build, Playwright's browsers), and copy the ignored files it needs from ${from}, such as \`.env\`, by naming them to record_setup. Then record what worked with record_setup, or that it needs nothing, so Althar gets every later task's folder ready the same way before its lead starts.`
      return [ran, asked].filter((said) => said !== null)
    })
    .join('\n\n')
