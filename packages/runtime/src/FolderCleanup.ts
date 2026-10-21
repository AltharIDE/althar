import { execFile } from 'node:child_process'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { FolderHeld, FolderKind, FolderWait, FoldersFreed, TaskFolders } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Scope, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

import { Changes } from './Changes'
import { RuntimeConfig } from './Config'
import { ChangedSinceSeen, FolderStayed, TaskRefused } from './errors'
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
 * but while something runs from it. What holds a folder is asked again just
 * before it goes, while nothing can start on its thread, bring it back, open
 * it or start running from it (`withFolder`); by hand, it stays where more
 * would be lost with it than the person was told. A folder goes only once
 * its last commit is kept under `refs/althar/kept/<workspace>`, so its
 * changes still read and it comes back from there (`bringBack.ts`), and
 * counts as gone only once nothing of it is left; its branch stays. An idle
 * lead still held on it stops first. Its thread says it went, as a line.
 *
 * What each folder takes on the disk, and what holds it, is measured in
 * the background as Settings asks, and kept a while. A sweep runs a while
 * after Althar starts, every hour after, and at once when the person
 * chooses another wait.
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

/** A folder to remove: why it goes, the wait it had, and, by hand, what the person was told holds it as they chose to. */
interface Chosen {
  readonly candidate: Candidate
  readonly why: Why
  readonly days: number
  readonly seen?: FolderHeld | null
}

/** What a folder takes on the disk, what of what is in it would be lost with it, and whether it isn't finished after all: measured, and when. */
interface Facts {
  readonly bytes: number | null
  readonly lost: FolderHeld | null
  /** A merged change with commits after its pull request: it waits in Needs you, not Settled. */
  readonly unshipped: boolean
  readonly at: number
}

/** What would be lost with a folder, the gravest first: files not committed, then what git can't read, then commits pushed nowhere. */
const GRAVITY: ReadonlyArray<FolderHeld['why']> = ['uncommitted', 'unreadable', 'unpushed']

/** What holds a folder, the gravest where several do: something running from it, then what would be lost with it, then its being opened lately. */
const holdOf = (running: boolean, lost: FolderHeld | null, opened: boolean): FolderHeld | null =>
  running ? { why: 'running', count: null } : (lost ?? (opened ? { why: 'opened', count: null } : null))

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
      return `Folder removed when this computer ran low on space${size}`
    case 'clean':
      return `Folder removed when you cleaned up${size}`
    case 'hand':
      return `You removed its folder${size}`
  }
}

/** Fails unless nothing of a folder is left. */
const gone = (path: string) => Effect.suspend(() => (existsSync(path) ? Effect.fail(new FolderStayed({ path })) : Effect.void))

/** Removes a folder that isn't a worktree, or one git won't remove: whatever is in it. Fails unless nothing of it is left. */
const erase = (path: string) =>
  Effect.try({ try: () => rmSync(path, { recursive: true, force: true }), catch: () => new FolderStayed({ path }) }).pipe(
    Effect.andThen(gone(path)),
  )

/** Removes a worktree, or, where git won't, whatever is in its folder. Fails unless nothing of it is left. */
const removeWorktree = (repository: string, path: string) =>
  git(repository, 'worktree', 'remove', '--force', '--force', path).pipe(
    Effect.catch(() => erase(path)),
    Effect.andThen(gone(path)),
  )

/** Keeps a checkout's last commit under `ref`, in the repository it shares its refs with. Fails where it can't. */
const keep = (checkout: string, ref: string) =>
  Effect.gen(function* () {
    const head = yield* git(checkout, 'rev-parse', '--verify', 'HEAD^{commit}')
    yield* git(checkout, 'update-ref', ref, head)
  })

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
    /**
     * Removes one finished task's folder by hand, though something of what is
     * in it holds it: refused while something runs from it, and where more
     * would be lost with it than `seen`, what the person was told holds it.
     */
    remove(taskId: string, seen: FolderHeld | null, actorId: ActorId): Effect.Effect<FoldersFreed, unknown>
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

      /** Something runs from a task's folder, or is starting to; an agent works in it; or it is coming back, not set up again yet. */
      const runningFrom = (candidate: Candidate) =>
        Effect.gen(function* () {
          if (yield* launches.using(candidate.taskId)) return true
          const working = (yield* sessions.onTasks).some(
            (session) => session.taskId === candidate.taskId && (session.turnRunning || session.background),
          )
          return working || candidate.workspaces.some((workspace) => workspace.comingBack === 1)
        })

      /** Opened from Althar within the day. */
      const openedLately = (candidate: Candidate) => candidate.opened !== null && Date.now() - candidate.opened < OPENED

      /**
       * What of what is in a task's folders would be lost with them, the
       * gravest where several repositories differ: changes not committed,
       * what git can't read, or an abandoned change's commits pushed nowhere.
       */
      const lostWith = (candidate: Candidate) =>
        Effect.gen(function* () {
          const found: Array<FolderHeld> = []
          for (const workspace of candidate.workspaces) {
            if (workspace.access !== 'write' || !existsSync(workspace.path)) continue
            const changed = yield* uncommittedFiles(workspace.path).pipe(Effect.option)
            if (changed._tag === 'None') found.push({ why: 'unreadable', count: null })
            else if (changed.value.length > 0) found.push({ why: 'uncommitted', count: changed.value.length })
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
              if (ahead > 0) found.push({ why: 'unpushed', count: ahead })
            }
          }
          const gravest = GRAVITY.find((why) => found.some((one) => one.why === why))
          if (gravest === undefined) return null
          const counts = found.filter((one) => one.why === gravest).map((one) => one.count)
          return {
            why: gravest,
            count: counts.includes(null) ? null : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0),
          } satisfies FolderHeld
        })

      /** What a task's folders take on the disk, as `du` counts them, their review copies too; null where it can't say. */
      const sizeOfAll = (candidate: Candidate) =>
        Effect.gen(function* () {
          let bytes = 0
          for (const workspace of candidate.workspaces) {
            if (!existsSync(workspace.path)) continue
            const size = yield* sizeOf(workspace.path)
            if (size === null) return null
            const copy = reviewCopyOf(workspace.path)
            bytes += size + (workspace.access === 'write' && existsSync(copy) ? ((yield* sizeOf(copy)) ?? 0) : 0)
          }
          return bytes
        })

      /** A merged change with commits after its pull request: not finished after all. */
      const unshippedOf = (candidate: Candidate) =>
        candidate.kind === 'merged'
          ? changes.unshipped(candidate.taskId).pipe(
              Effect.map((after) => after.length > 0),
              Effect.orElseSucceed(() => false),
            )
          : Effect.succeed(false)

      /** What a task's folder takes, what of what is in it would be lost with it, and whether it is finished after all; kept a while. */
      const measure = (candidate: Candidate) =>
        Effect.gen(function* () {
          const bytes = yield* sizeOfAll(candidate)
          const lost = yield* lostWith(candidate)
          const measured: Facts = { bytes, lost, unshipped: yield* unshippedOf(candidate), at: Date.now() }
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
          folders.push({
            taskId: candidate.taskId,
            threadId: candidate.threadId ?? '',
            title: candidate.title,
            project: candidate.project,
            kind: candidate.kind,
            settledAt: candidate.settledAt,
            bytes: known?.bytes ?? null,
            held: holdOf(yield* runningFrom(candidate), known?.lost ?? null, openedLately(candidate)),
          })
        }
        return {
          disk: disk === null ? null : { total: disk.total, used: disk.used },
          folders,
          measuring,
        } satisfies TaskFolders
      })

      /** Whether a folder stays by itself as things stand: something holds it, or it isn't finished after all. */
      const staysBy = (candidate: Candidate) =>
        Effect.gen(function* () {
          if (yield* runningFrom(candidate)) return true
          if (holdOf(false, yield* lostWith(candidate), openedLately(candidate)) !== null) return true
          return yield* unshippedOf(candidate)
        })

      /** Those of `all` nothing holds as things stand, chosen to go so; each is asked again as it goes. */
      const free = (all: ReadonlyArray<Candidate>, why: Exclude<Why, 'hand'>, wait: FolderWait) =>
        Effect.filter(all, (candidate) => Effect.map(staysBy(candidate), (stays) => !stays)).pipe(
          Effect.map((chosen) => chosen.map((candidate): Chosen => ({ candidate, why, days: waitDays(wait, candidate.kind) }))),
        )

      /**
       * Removes a task's folders, each once its last commit is kept, and
       * marks each removed once nothing of it is left: a review copy beside
       * a worktree goes with it. Where the person removes one git can't read,
       * knowing whatever is in it goes, it goes though its commit can't be
       * kept. Fails at the first that stays; those before it are removed.
       */
      const removeFolders = (candidate: Candidate, unreadable: boolean, why: Why, bytes: number | null, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const kept = (checkout: string, ref: string) => (unreadable ? Effect.ignore(keep(checkout, ref)) : keep(checkout, ref))
          for (const workspace of candidate.workspaces) {
            if (workspace.access === 'write') {
              if (existsSync(workspace.path)) {
                // Its last commit is kept, so its changes still read and it comes back from there; its branch stays.
                yield* kept(workspace.path, `${KEPT}${workspace.id}`)
                const copy = reviewCopyOf(workspace.path)
                if (existsSync(copy)) {
                  yield* kept(copy, `${KEPT}${workspace.id}-review`)
                  yield* removeWorktree(workspace.repository, copy)
                }
                yield* removeWorktree(workspace.repository, workspace.path)
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
          // What its reviews read, beside its folders: their copies went with them, and what is left is the reviewers' evidence.
          const [first] = candidate.workspaces
          if (first !== undefined && first.access === 'write') yield* erase(dirname(reviewCopyOf(first.path))).pipe(Effect.ignore)
        })

      /**
       * Removes a finished task's folders, by hand or not. What holds them is
       * asked again while nothing can start on its thread, bring them back,
       * open them or start running from them: by itself, one held stays; by
       * hand, one something runs from is refused, as is one where more would
       * be lost than the person was told. An idle lead held on it stops
       * first. What went, in bytes as `du` counted it; null where nothing
       * did, as when the task went back to work meanwhile; the refusal, by
       * hand.
       */
      const removeTask = ({ candidate, why, days, seen = null }: Chosen, actorId: ActorId) =>
        Effect.gen(function* () {
          const bytes = facts.get(candidate.taskId)?.bytes ?? (yield* sizeOfAll(candidate))
          const held = (yield* sessions.onTasks).filter((session) => session.taskId === candidate.taskId)
          if (held.some((session) => session.turnRunning || session.background))
            return why === 'hand' ? new TaskRefused({ taskId: candidate.taskId, why: 'folder_in_use' }) : null
          for (const session of held) yield* sessions.stop(session.threadId).pipe(Effect.ignore)
          const go = withFolder(
            candidate.taskId,
            Effect.gen(function* () {
              // As it is now: it may have gone back to work, come back, been opened, changed or started running meanwhile.
              const now = (yield* candidates).find((one) => one.taskId === candidate.taskId)
              if (now === undefined) return null
              const lost = yield* lostWith(now)
              if (why === 'hand') {
                if (yield* runningFrom(now)) return new TaskRefused({ taskId: now.taskId, why: 'folder_in_use' })
                if (lost !== null && (lost.why !== seen?.why || lost.count !== seen.count))
                  return new ChangedSinceSeen({ taskId: now.taskId, what: 'folder' })
              } else if ((yield* runningFrom(now)) || holdOf(false, lost, openedLately(now)) !== null || (yield* unshippedOf(now)))
                return null
              yield* removeFolders(now, why === 'hand' && lost?.why === 'unreadable', why, bytes, actorId)
              facts.delete(now.taskId)
              const thread = yield* taskThreadOf(now.taskId)
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

      /**
       * Removes what it is given, one by one, by what the disk says it freed;
       * how many couldn't go, as a folder that stays. A refusal, by hand, is
       * said instead.
       */
      const removeAll = (chosen: ReadonlyArray<Chosen>, actorId: ActorId, enough?: () => Effect.Effect<boolean>) =>
        Effect.gen(function* () {
          const before = yield* diskAt(config.worktreeRoot)
          let failed = 0
          for (const one of chosen) {
            if (enough !== undefined && (yield* enough())) break
            const went = yield* removeTask(one, actorId).pipe(
              Effect.catch((error) =>
                Effect.as(Effect.logWarning('A finished task’s folder couldn’t be removed', error), 'failed' as const),
              ),
              contained('Folders.remove', () => 'failed' as const),
            )
            if (went === 'failed') failed += 1
            else if (went instanceof TaskRefused || went instanceof ChangedSinceSeen) return yield* went
          }
          const after = yield* diskAt(config.worktreeRoot)
          const freed = before === null || after === null ? 0 : Math.max(0, after.free - before.free)
          return { freed, failed } satisfies FoldersFreed
        })

      const sweep = one.withPermits(1)(
        Effect.gen(function* () {
          const chosen = yield* wait
          if (chosen === 'never') return
          const now = Date.now()
          const oldest = (yield* candidates).toSorted((a, b) => a.clock - b.clock)
          const up = oldest.filter((candidate) => candidate.clock + waitDays(chosen, candidate.kind) * DAY <= now)
          yield* removeAll(yield* free(up, 'wait', chosen), instance.systemId)
          if (chosen !== 'smart') return
          // Smart makes room when the disk runs low: the oldest finished folders first, whatever their wait, until there is enough.
          const disk = yield* diskAt(config.worktreeRoot)
          if (disk === null || disk.free / disk.total >= LOW) return
          const tried = new Set(up.map((candidate) => candidate.taskId))
          const rest = yield* free(
            oldest.filter((candidate) => !tried.has(candidate.taskId)),
            'low',
            chosen,
          )
          yield* removeAll(rest, instance.systemId, () =>
            diskAt(config.worktreeRoot).pipe(Effect.map((now) => now === null || now.free / now.total >= ROOMY)),
          )
        }),
      )

      const cleanUp = (actorId: ActorId) =>
        one.withPermits(1)(
          Effect.gen(function* () {
            return yield* removeAll(yield* free(yield* candidates, 'clean', yield* wait), actorId)
          }),
        )

      const remove = (taskId: string, seen: FolderHeld | null, actorId: ActorId) =>
        one.withPermits(1)(
          Effect.gen(function* () {
            const candidate = (yield* candidates).find((one) => one.taskId === taskId)
            if (candidate === undefined) return { freed: 0, failed: 0 } satisfies FoldersFreed
            const chosen = yield* wait
            return yield* removeAll([{ candidate, why: 'hand', days: waitDays(chosen, candidate.kind), seen }], actorId)
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
        remove: (taskId, seen, actorId) => provide(remove(taskId, seen, actorId)),
        sweep: provide(sweep),
      })
    }),
  )
}
