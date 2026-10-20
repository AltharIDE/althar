import { execFile } from 'node:child_process'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { FolderHold, FolderKind, FolderWait, FoldersFreed, TaskFolders } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Scope, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

import { Changes } from './Changes'
import { RuntimeConfig } from './Config'
import { TaskRefused } from './errors'
import { contained } from './Failures'
import { KEPT, taskThreadOf, withFolder } from './bringBack'
import { git, uncommittedFiles } from './git'
import { Instance } from './Instance'
import { quickIn } from './kinds'
import { Launches } from './Launches'
import { change, fact, timestamp } from './records'
import { reviewCopyOf } from './reviewCopy'
import { Sessions } from './Sessions'
import { addItem } from './threads'

/*
 * Finished tasks' folders, removed to free the disk (ADR-055). A task is
 * finished once it is in Settled: done or abandoned, and not a merged one
 * with commits after its pull request. Its folders go after a wait that
 * suits how it ended, as the person chose: Smart to start, a review's at
 * once, a merged change's after 3 days, a done task's after a week, an
 * abandoned one's after 2 weeks, and any of them sooner when the disk runs
 * low; or one wait for all; or only when the person cleans up. The wait
 * runs from the latest of when it settled, when its screen was opened and
 * when its folder was opened from Althar.
 *
 * Nothing that exists only in a folder goes by itself: a folder with
 * changes not committed, an abandoned change's commits pushed nowhere,
 * something running from it, or opened in an editor within the day, or one
 * git can't read, is held back, and the person can still remove it by hand,
 * but while something runs from it. Before a folder goes, its last commit
 * is kept under `refs/althar/kept/<workspace>`, so its changes still read
 * and it comes back from there (`bringBack.ts`); its branch stays. An idle
 * lead still held on it stops first. Its thread says it went, as a line.
 *
 * What each folder takes on the disk, and what holds it, is measured in
 * the background as Settings asks, kept a while, and asked again for each
 * folder just before it goes. A sweep runs a while after Althar starts,
 * every hour after, and at once when the person chooses another wait.
 */

/** Smart's waits, in days, by how a task ended. */
const SMART: Readonly<Record<FolderKind, number>> = { review: 0, merged: 3, done: 7, abandoned: 14 }

/** The other choices' waits, in days, whatever the task. */
const WAITS: Readonly<Record<Exclude<FolderWait, 'smart'>, number>> = { day: 1, week: 7, month: 30, never: Infinity }

/** How long a folder waits, in days, for a task that ended so. */
export const waitDays = (wait: FolderWait, kind: FolderKind) => (wait === 'smart' ? SMART[kind] : WAITS[wait])

/** Below this share of the disk free, Smart removes finished tasks' folders whatever their wait, the oldest first, until there is this much. */
export const LOW = 0.1
export const ROOMY = 0.15

/** A folder opened from Althar this long ago or less is held back. */
const OPENED = Duration.toMillis(Duration.days(1))

/** How long what a folder takes and what holds it are kept before Settings measures them again. */
const KEPT_FOR = Duration.toMillis(Duration.minutes(10))

/** When the first sweep runs after Althar starts, and how often after. */
export const FIRST_SWEEP = Duration.minutes(2)
export const EVERY_SWEEP = Duration.hours(1)

const KEY = 'folder_wait'

const DAY = Duration.toMillis(Duration.days(1))

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | RuntimeConfig | Sessions | Launches | Changes

/** Why a folder went: its wait was up, the disk ran low, the person cleaned up, or removed it by hand. */
type Why = 'wait' | 'low' | 'clean' | 'hand'

interface Workspace {
  readonly id: string
  readonly taskId: string
  readonly projectId: ProjectId
  readonly path: string
  readonly access: string
  readonly branched: number
  readonly baseCommit: string | null
  readonly repository: string
  /** Put back from removal, and not set up again yet. */
  readonly comingBack: number
}

interface Candidate {
  readonly taskId: string
  readonly threadId: string | null
  readonly projectId: ProjectId
  readonly title: string
  readonly project: string
  readonly kind: FolderKind
  readonly quick: boolean
  readonly settledAt: string
  /** When its wait runs from, in milliseconds. */
  readonly clock: number
  /** When its folder was last opened from Althar, in milliseconds; null where never. */
  readonly opened: number | null
  readonly workspaces: ReadonlyArray<Workspace>
}

interface Held {
  readonly why: FolderHold
  readonly count: number | null
}

/** What a folder takes on the disk, what holds it of what is in it, and whether it isn't finished after all: measured, and when. */
interface Facts {
  readonly bytes: number | null
  readonly held: Held | null
  /** A merged change with commits after its pull request: it waits in Needs you, not Settled. */
  readonly unshipped: boolean
  readonly at: number
}

/** A folder's size on the disk, as `du` counts it, in bytes; null where it can't say. */
const sizeOf = (path: string) =>
  Effect.callback<number | null>((resume) => {
    execFile('du', ['-sk', path], { timeout: 120_000 }, (error, stdout) => {
      const kb = /^(\d+)/.exec(stdout)?.[1]
      resume(Effect.succeed(error !== null && kb === undefined ? null : kb === undefined ? null : Number(kb) * 1024))
    })
  })

/** The disk a folder is on, in bytes: its size and what is free; null where it can't be read. */
export const diskOf = (path: string) =>
  Effect.promise(() =>
    statfs(path).then(
      (stats) => ({
        total: stats.blocks * stats.bsize,
        free: stats.bavail * stats.bsize,
        used: (stats.blocks - stats.bfree) * stats.bsize,
      }),
      () => null,
    ),
  )

/** A size for the thread: 2.3 GB, 14 GB, 640 MB. */
export const sizeWords = (bytes: number) => {
  const gb = bytes / 1024 ** 3
  if (gb < 1) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}

const daysWords = (days: number) =>
  days === 1 ? 'a day' : days === 7 ? 'a week' : days === 30 ? 'a month' : days % 7 === 0 ? `${days / 7} weeks` : `${days} days`

/** What the thread says as a task's folder goes, as a line across it. */
export const goneWords = (why: Why, days: number, bytes: number | null) => {
  const size = bytes === null || bytes === 0 ? '' : ` · ${sizeWords(bytes)}`
  switch (why) {
    case 'wait':
      return `Folder removed ${days === 0 ? 'as the task finished' : `${daysWords(days)} after the task finished`}${size}`
    case 'low':
      return `Folder removed when this Mac ran low on space${size}`
    case 'clean':
      return `Folder removed when you cleaned up${size}`
    case 'hand':
      return `You removed its folder${size}`
  }
}

/** Removes a folder that isn't a worktree, or one git won't remove: whatever is in it. */
const erase = (path: string) =>
  Effect.try({ try: () => rmSync(path, { recursive: true, force: true }), catch: (cause) => cause }).pipe(Effect.ignore)

/** Removes a folder once nothing is left in it: the task's own, beside its repositories' worktrees. */
const eraseEmpty = (path: string) =>
  Effect.sync(() => {
    try {
      if (existsSync(path) && readdirSync(path).length === 0) rmdirSync(path)
    } catch {
      // Something else is in it, or it went already: it stays.
    }
  })

export class FolderCleanup extends Context.Service<
  FolderCleanup,
  {
    /** When finished tasks' folders go: Smart, unless the person chose otherwise. */
    readonly wait: Effect.Effect<FolderWait, SqlError>
    /** Keeps another choice, and sweeps by it at once. */
    setWait(wait: FolderWait): Effect.Effect<void, SqlError>
    /** Finished tasks' folders on this Mac, with the disk they are on; those not measured yet start being measured. */
    readonly list: Effect.Effect<TaskFolders, unknown>
    /** Removes every finished task's folder nothing holds, whatever its wait. */
    cleanUp(actorId: ActorId): Effect.Effect<FoldersFreed, unknown>
    /** Removes one finished task's folder by hand, though something of what is in it holds it; refused while something runs from it. */
    remove(taskId: string, actorId: ActorId): Effect.Effect<FoldersFreed, unknown>
    /** Removes the folders whose wait is up, and, with Smart, makes room when the disk runs low. */
    readonly sweep: Effect.Effect<void, unknown>
  }
>()('@althar/runtime/FolderCleanup') {
  static readonly layer: Layer.Layer<FolderCleanup, never, Store> = Layer.effect(
    FolderCleanup,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const config = yield* RuntimeConfig
      const sessions = yield* Sessions
      const launches = yield* Launches
      const changes = yield* Changes
      const scope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const diskAt = config.disk ?? diskOf
      const facts = new Map<string, Facts>()
      let measuring = false
      // One sweep, clean-up or removal at a time.
      const one = Semaphore.makeUnsafe(1)

      const wait = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${KEY}`
        const value = kept?.value
        return value === 'day' || value === 'week' || value === 'month' || value === 'never' ? value : ('smart' as const)
      })

      /** Every finished task with a folder here, the latest settled first. */
      const candidates = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const tasks = yield* sql<{
          taskId: string
          threadId: string | null
          projectId: ProjectId
          title: string
          project: string
          state: string
          settledAt: string
          seenAt: string | null
          openedAt: string | null
          review: number
          quick: number
        }>`
          SELECT k.id AS task_id, k.project_id, k.title, p.name AS project, k.state, k.settled_at, k.seen_at, k.opened_at,
            EXISTS (SELECT 1 FROM external_links rl WHERE rl.task_id = k.id AND rl.kind = 'review') AS review,
            CASE WHEN ${sql.unsafe(quickIn('k'))} THEN 1 ELSE 0 END AS quick,
            (SELECT t.id FROM threads t WHERE t.task_id = k.id AND t.kind = 'task' ORDER BY t.created_at, t.rowid LIMIT 1) AS thread_id
          FROM tasks k JOIN projects p ON p.id = k.project_id
          WHERE k.state IN ('done', 'abandoned') AND k.settled_at IS NOT NULL AND p.archived_at IS NULL
            AND EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = k.id AND w.device_id = ${instance.deviceId} AND w.state = 'ready')
          ORDER BY k.settled_at DESC, k.id`
        const workspaces = yield* sql<Workspace>`
          SELECT w.id, w.task_id, w.project_id, w.path, w.access, w.branched_at IS NOT NULL AS branched, w.base_commit, l.path AS repository,
            (w.access = 'write' AND w.cleaned_at IS NOT NULL AND w.setup IS NULL) AS coming_back
          FROM workspaces w
          JOIN tasks k ON k.id = w.task_id
          JOIN repository_bindings b ON b.id = w.binding_id
          JOIN repository_locations l ON l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}
          WHERE w.device_id = ${instance.deviceId} AND w.state = 'ready' AND k.state IN ('done', 'abandoned')
          ORDER BY b.created_at, b.rowid`
        return tasks.map((task): Candidate => {
          const opened = task.openedAt === null ? null : Date.parse(task.openedAt)
          const kind: FolderKind =
            task.review === 1 ? 'review' : task.state === 'abandoned' ? 'abandoned' : task.quick === 1 ? 'done' : 'merged'
          return {
            taskId: task.taskId,
            threadId: task.threadId,
            projectId: task.projectId,
            title: task.title,
            project: task.project,
            kind,
            quick: task.quick === 1,
            settledAt: task.settledAt,
            clock: Math.max(Date.parse(task.settledAt), task.seenAt === null ? 0 : Date.parse(task.seenAt), opened ?? 0),
            opened,
            workspaces: workspaces.filter((workspace) => workspace.taskId === task.taskId),
          }
        })
      })

      /** What holds a task's folder that can be told at once: something running from it, or opened within the day. */
      const heldNow = (candidate: Candidate) =>
        Effect.gen(function* () {
          const launched = (yield* launches.processes()).some((process) => process.taskId === candidate.taskId)
          const working = (yield* sessions.onTasks).some(
            (session) => session.taskId === candidate.taskId && (session.turnRunning || session.background),
          )
          if (launched || working || candidate.workspaces.some((workspace) => workspace.comingBack === 1))
            return { why: 'running', count: null } satisfies Held
          if (candidate.opened !== null && Date.now() - candidate.opened < OPENED) return { why: 'opened', count: null } satisfies Held
          return null
        })

      /** What a task's folder takes, and what of what is in it holds it: changes not committed, an abandoned change's commits pushed nowhere, or git can't say. */
      const measure = (candidate: Candidate) =>
        Effect.gen(function* () {
          let bytes = 0
          let known = true
          let held: Held | null = null
          for (const workspace of candidate.workspaces) {
            if (!existsSync(workspace.path)) continue
            const size = yield* sizeOf(workspace.path)
            const copy = reviewCopyOf(workspace.path)
            const copied = workspace.access === 'write' && existsSync(copy) ? yield* sizeOf(copy) : 0
            if (size === null) known = false
            bytes += (size ?? 0) + (copied ?? 0)
            if (workspace.access !== 'write' || held !== null) continue
            const changed = yield* uncommittedFiles(workspace.path).pipe(Effect.option)
            if (changed._tag === 'None') held = { why: 'unreadable', count: null }
            else if (changed.value.length > 0) held = { why: 'uncommitted', count: changed.value.length }
            else if (candidate.kind === 'abandoned' && !candidate.quick && workspace.branched === 1) {
              const ahead = yield* git(
                workspace.path,
                'rev-list',
                '--count',
                'HEAD',
                '--not',
                ...(workspace.baseCommit === null ? [] : [workspace.baseCommit]),
                '--remotes',
                '--glob=refs/althar/pushed/*',
              ).pipe(
                Effect.map(Number),
                Effect.orElseSucceed(() => 0),
              )
              if (ahead > 0) held = { why: 'unpushed', count: ahead }
            }
          }
          const unshipped =
            candidate.kind === 'merged' && (yield* changes.unshipped(candidate.taskId).pipe(Effect.orElseSucceed(() => []))).length > 0
          const measured: Facts = { bytes: known ? bytes : null, held, unshipped, at: Date.now() }
          facts.set(candidate.taskId, measured)
          return measured
        })

      /** Measures, in the background, the folders whose facts are missing or old; one round at a time. */
      const measureLater = (all: ReadonlyArray<Candidate>) =>
        Effect.gen(function* () {
          const stale = all.filter((candidate) => (facts.get(candidate.taskId)?.at ?? 0) < Date.now() - KEPT_FOR)
          if (stale.length === 0 || measuring) return
          measuring = true
          yield* Effect.forkIn(
            provide(
              Effect.forEach(stale, (candidate) => measure(candidate), { concurrency: 2, discard: true }).pipe(
                contained('Folders.measure', () => undefined),
                Effect.ensuring(Effect.sync(() => (measuring = false))),
              ),
            ),
            scope,
          )
        })

      const list = Effect.gen(function* () {
        const all = yield* candidates
        yield* measureLater(all)
        const disk = yield* diskAt(config.worktreeRoot)
        const folders = []
        for (const candidate of all) {
          const known = facts.get(candidate.taskId)
          if (known?.unshipped === true) continue
          const held = (yield* heldNow(candidate)) ?? known?.held ?? null
          folders.push({
            taskId: candidate.taskId,
            threadId: candidate.threadId ?? '',
            title: candidate.title,
            project: candidate.project,
            kind: candidate.kind,
            settledAt: candidate.settledAt,
            bytes: known?.bytes ?? null,
            held,
          })
        }
        return {
          disk: disk === null ? null : { total: disk.total, used: disk.used },
          folders,
          measuring,
        } satisfies TaskFolders
      })

      /** What holds a task's folder now, asked afresh just before it goes; `unshipped` where it isn't finished after all. */
      const holdOf = (candidate: Candidate) =>
        Effect.gen(function* () {
          const now = yield* heldNow(candidate)
          if (now !== null) return now
          const measured = yield* measure(candidate)
          return measured.unshipped ? ('unshipped' as const) : measured.held
        })

      /**
       * Removes a finished task's folders, by hand or not: an idle lead held
       * on it stops first, and the task's thread is kept from starting while
       * they go. What went, in bytes as `du` counted it; null where nothing
       * did, as when the task went back to work meanwhile.
       */
      const removeTask = (candidate: Candidate, why: Why, actorId: ActorId, days: number) =>
        Effect.gen(function* () {
          const held = (yield* sessions.onTasks).filter((session) => session.taskId === candidate.taskId)
          if (held.some((session) => session.turnRunning || session.background)) return null
          for (const session of held) yield* sessions.stop(session.threadId).pipe(Effect.ignore)
          const go = withFolder(
            candidate.taskId,
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              // Still finished, and still here: it may have gone back to work, or been brought back, meanwhile.
              const [still] = yield* sql<{ settled: number }>`
                SELECT state IN ('done', 'abandoned') AND settled_at IS NOT NULL AS settled FROM tasks WHERE id = ${candidate.taskId}`
              if (still?.settled !== 1) return null
              const bytes = facts.get(candidate.taskId)?.bytes ?? null
              for (const workspace of candidate.workspaces) {
                const [here] = yield* sql<{ state: string }>`SELECT state FROM workspaces WHERE id = ${workspace.id}`
                if (here?.state !== 'ready') continue
                if (workspace.access === 'write') {
                  if (existsSync(workspace.path)) {
                    // Its last commit is kept, so its changes still read and it comes back from there; its branch stays.
                    yield* git(workspace.path, 'update-ref', `${KEPT}${workspace.id}`, 'HEAD').pipe(Effect.ignore)
                    const copy = reviewCopyOf(workspace.path)
                    if (existsSync(copy)) {
                      yield* git(copy, 'update-ref', `${KEPT}${workspace.id}-review`, 'HEAD').pipe(Effect.ignore)
                      yield* git(workspace.repository, 'worktree', 'remove', '--force', '--force', copy).pipe(
                        Effect.catch(() => erase(copy)),
                      )
                      yield* erase(dirname(copy))
                    }
                    yield* git(workspace.repository, 'worktree', 'remove', '--force', '--force', workspace.path).pipe(
                      Effect.catch(() => erase(workspace.path)),
                    )
                  }
                  yield* git(workspace.repository, 'worktree', 'prune').pipe(Effect.ignore)
                } else yield* erase(workspace.path)
                yield* eraseEmpty(dirname(workspace.path))
                yield* sql.withTransaction(
                  Effect.gen(function* () {
                    const at = yield* timestamp
                    const revision = yield* change('workspaces', workspace.id, { state: 'cleaned', cleanedAt: at })
                    yield* fact({
                      projectId: workspace.projectId,
                      aggregateType: 'workspace',
                      aggregateId: workspace.id,
                      revision,
                      type: 'workspace.cleaned',
                      payload: { why, bytes },
                      actorId,
                    })
                  }),
                )
              }
              facts.delete(candidate.taskId)
              const thread = yield* taskThreadOf(candidate.taskId)
              if (thread !== null)
                yield* addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  title: goneWords(why, days, bytes),
                  description: null,
                  role: 'folder',
                })
              return bytes ?? 0
            }),
          )
          // Nothing starts on the task's thread while its folders go.
          return candidate.threadId === null ? yield* go : yield* sessions.quiet(candidate.threadId, go)
        })

      /** Removes what it is given, one by one, by what the disk says it freed; how many couldn't go. */
      const removeAll = (
        chosen: ReadonlyArray<{ readonly candidate: Candidate; readonly why: Why; readonly days: number }>,
        actorId: ActorId,
        enough?: () => Effect.Effect<boolean>,
      ) =>
        Effect.gen(function* () {
          const before = yield* diskAt(config.worktreeRoot)
          let failed = 0
          for (const { candidate, why, days } of chosen) {
            if (enough !== undefined && (yield* enough())) break
            const went = yield* removeTask(candidate, why, actorId, days).pipe(
              contained('Folders.remove', () => null),
              Effect.catch(() => Effect.succeed(null)),
            )
            if (went === null) failed += 1
          }
          const after = yield* diskAt(config.worktreeRoot)
          const freed = before === null || after === null ? 0 : Math.max(0, after.free - before.free)
          return { freed, failed } satisfies FoldersFreed
        })

      const sweep = one.withPermits(1)(
        Effect.gen(function* () {
          const chosen = yield* wait
          if (chosen === 'never') return
          const all = yield* candidates
          const now = Date.now()
          const oldest = all.toSorted((a, b) => a.clock - b.clock)
          const due = []
          for (const candidate of oldest) {
            const days = waitDays(chosen, candidate.kind)
            if (candidate.clock + days * DAY > now) continue
            if ((yield* holdOf(candidate)) === null) due.push({ candidate, why: 'wait' as const, days })
          }
          yield* removeAll(due, instance.systemId)
          if (chosen !== 'smart') return
          // Smart makes room when the disk runs low: the oldest finished folders first, whatever their wait, until there is enough.
          const disk = yield* diskAt(config.worktreeRoot)
          if (disk === null || disk.free / disk.total >= LOW) return
          const gone = new Set(due.map((one) => one.candidate.taskId))
          const rest = []
          for (const candidate of oldest)
            if (!gone.has(candidate.taskId) && (yield* holdOf(candidate)) === null)
              rest.push({ candidate, why: 'low' as const, days: waitDays(chosen, candidate.kind) })
          yield* removeAll(rest, instance.systemId, () =>
            diskAt(config.worktreeRoot).pipe(Effect.map((now) => now === null || now.free / now.total >= ROOMY)),
          )
        }),
      )

      const cleanUp = (actorId: ActorId) =>
        one.withPermits(1)(
          Effect.gen(function* () {
            const chosen = yield* wait
            const all = yield* candidates
            const free = []
            for (const candidate of all)
              if ((yield* holdOf(candidate)) === null)
                free.push({ candidate, why: 'clean' as const, days: waitDays(chosen, candidate.kind) })
            return yield* removeAll(free, actorId)
          }),
        )

      const remove = (taskId: string, actorId: ActorId) =>
        one.withPermits(1)(
          Effect.gen(function* () {
            const candidate = (yield* candidates).find((one) => one.taskId === taskId)
            if (candidate === undefined) return { freed: 0, failed: 0 } satisfies FoldersFreed
            if ((yield* heldNow(candidate))?.why === 'running') return yield* new TaskRefused({ taskId, why: 'left_running' })
            const chosen = yield* wait
            return yield* removeAll([{ candidate, why: 'hand', days: waitDays(chosen, candidate.kind) }], actorId)
          }),
        )

      const setWait = (next: FolderWait) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (next === 'smart') yield* sql`DELETE FROM settings WHERE key = ${KEY}`
          else {
            const at = yield* timestamp
            yield* sql`INSERT INTO settings ${sql.insert({ key: KEY, value: next, updatedAt: at })}
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          }
          // The new wait takes effect at once, in the background.
          yield* Effect.forkIn(provide(sweep.pipe(contained('Folders.sweep', () => undefined))), scope)
        })

      // A while after Althar starts, then every hour: what came due while it was closed goes too.
      yield* Effect.forkIn(
        provide(
          Effect.sleep(config.foldersFirst ?? FIRST_SWEEP).pipe(
            Effect.andThen(
              Effect.forever(
                sweep.pipe(
                  contained('Folders.sweep', () => undefined),
                  Effect.andThen(Effect.sleep(config.foldersEvery ?? EVERY_SWEEP)),
                ),
              ),
            ),
          ),
        ),
        scope,
      )

      return FolderCleanup.of({
        wait: provide(wait),
        setWait: (next) => provide(setWait(next)),
        list: provide(list),
        cleanUp: (actorId) => provide(cleanUp(actorId)),
        remove: (taskId, actorId) => provide(remove(taskId, actorId)),
        sweep: provide(sweep),
      })
    }),
  )
}
