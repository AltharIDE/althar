import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { bumpRevision, type Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Effect, Layer, Result, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

import { taskThreadOf } from './bringBack'
import { RuntimeConfig } from './Config'
import { GitFailed } from './errors'
import { mendingUnder, repairWorktree } from './git'
import { gitSummary, homeShortened } from './gitSaid'
import { Instance } from './Instance'
import { fact } from './records'
import { reviewCopyOf } from './reviewCopy'
import { afterOpen } from './startup'
import { addItem } from './threads'
import { type BrokenWhy, linkOf, worktreeAt } from './worktreeLinks'

/*
 * Worktrees whose link to their repository broke, repaired (ADR-099). A
 * task's worktree, or the copy its reviews read, whose `.git` file names a
 * git directory that isn't there, or whose repository's record of it names
 * another place, as moving a profile from a Flatpak to a native build
 * leaves them, can't be opened by git: every command in it fails with
 * "gitfile does not point to a valid repository". Althar has git repair the
 * link (`git worktree repair`), from the main checkout of the repository the
 * worktree was made from, and runs the command that failed once more. It
 * looks at every worktree it keeps when it starts, and at one the first time
 * a git command in it fails so. What it repaired goes in the record, its
 * task's thread and the log. It never moves, removes, resets or prunes
 * anything: where git can't repair it, what git said goes to the thread and
 * the log, and the folder stays as it is. A folder that isn't there at all
 * is left to what says so ("its folder isn't on this computer").
 */

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | RuntimeConfig

/** A worktree Althar keeps: a task's, with the main checkout of the repository it was made from. */
interface Kept {
  readonly id: string
  readonly taskId: string
  readonly projectId: ProjectId
  readonly path: string
  readonly root: string
}

/** A folder Althar repaired, or couldn't: the worktree it belongs to, whether it is the copy reviews read, and what git said. */
export interface Repaired {
  readonly workspaceId: string
  readonly taskId: string
  readonly folder: string
  readonly copy: boolean
  readonly why: BrokenWhy
  readonly repaired: boolean
  readonly said: string
}

/** The line a task's thread gets when its folder's link is repaired. */
export const repairedWords = 'Althar repaired this task’s folder link to the repository.'

/** The line it gets when git couldn't repair it: what git said. */
export const unrepairedWords = (said: string) =>
  `Althar couldn’t repair this task’s folder link to the repository: ${/[.!?…]$/.test(said) ? said : `${said}.`}`

export class WorktreeRepair extends Context.Service<
  WorktreeRepair,
  {
    /** Looks at every worktree Althar keeps on this computer, and the copies its reviews read, and repairs those whose link broke. */
    readonly sweep: Effect.Effect<ReadonlyArray<Repaired>, SqlError>
    /** Repairs the worktree a folder is in, where its link broke and Althar keeps it: whether it did. */
    readonly mend: (folder: string) => Effect.Effect<boolean>
  }
>()('@althar/runtime/WorktreeRepair') {
  static readonly layer: Layer.Layer<WorktreeRepair, never, Store> = Layer.effect(
    WorktreeRepair,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const config = yield* RuntimeConfig
      /** One repair at a time: git repairs every worktree of a repository whose `.git` file broke at once. */
      const serial = Semaphore.makeUnsafe(1)
      /** Folders repaired since Althar started: a command that failed while another repaired its folder runs again. */
      const repairedHere = new Set<string>()
      /** Folders git couldn't repair since Althar started: not tried again on each command that fails there. */
      const unrepaired = new Set<string>()

      /** The worktrees Althar keeps on this computer, not cleaned, each with its repository's main checkout. */
      const kept = Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<Kept>`
          SELECT w.id, w.task_id, w.project_id, w.path, l.path AS root FROM workspaces w
          JOIN repository_locations l ON l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}
          WHERE w.device_id = ${instance.deviceId} AND w.state <> 'cleaned' AND w.kind IS NULL
          ORDER BY w.created_at, w.rowid`,
      )

      /** The folders of a worktree Althar keeps: the worktree, and the copy its reviews read. */
      const foldersOf = (worktree: Kept) => [
        { folder: resolve(worktree.path), copy: false },
        { folder: resolve(reviewCopyOf(worktree.path)), copy: true },
      ]

      /** Records a repair on its workspace, as a fact, and says so in its task's thread. */
      const record = (worktree: Kept, done: Repaired) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [row] = yield* sql<{ revision: number }>`SELECT revision FROM workspaces WHERE id = ${worktree.id}`
              if (row === undefined) return
              const revision = yield* bumpRevision('workspaces', worktree.id, row.revision)
              yield* fact({
                projectId: worktree.projectId,
                aggregateType: 'workspace',
                aggregateId: worktree.id,
                revision,
                type: done.repaired ? 'workspace.repaired' : 'workspace.repair_failed',
                payload: { folder: done.folder, copy: done.copy, why: done.why, said: done.said },
                actorId: instance.systemId,
              })
            }),
          )
          const thread = yield* taskThreadOf(worktree.taskId)
          if (thread !== null)
            yield* addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
              source: 'runtime',
              severity: done.repaired ? 'info' : 'warning',
              title: done.repaired ? repairedWords : unrepairedWords(done.said),
              description: `${done.copy ? 'The copy its reviews read' : 'Its folder'}, ${homeShortened(done.folder)}.`,
              // Repaired, it is a line across the thread, as its folder going or coming back is; not repaired, a warning that is the person's.
              ...(done.repaired ? { role: 'folder' as const } : {}),
            })
        })

      /** Has git repair one folder's link from the repository's main checkout, and records how it went. */
      const repair = (worktree: Kept, folder: string, copy: boolean, why: BrokenWhy) =>
        Effect.gen(function* () {
          const ran = yield* Effect.result(repairWorktree(worktree.root, folder))
          // Whether it reaches its repository now is what counts: git repairs a worktree by the main checkout's record of it,
          // and still fails where its `.git` named a worktree by another name.
          const fine = linkOf(folder).state === 'fine'
          const failed: GitFailed | null = fine
            ? null
            : Result.isFailure(ran)
              ? ran.failure
              : new GitFailed({
                  args: ['worktree', 'repair', folder],
                  cwd: worktree.root,
                  stderr: ran.success === '' ? 'fatal: the folder still doesn’t reach its repository' : ran.success,
                })
          const done: Repaired = {
            workspaceId: worktree.id,
            taskId: worktree.taskId,
            folder,
            copy,
            why,
            repaired: failed === null,
            said: failed === null ? (Result.isSuccess(ran) ? ran.success : ran.failure.stderr) : gitSummary(failed),
          }
          if (failed === null) {
            repairedHere.add(folder)
            unrepaired.delete(folder)
            yield* Effect.logInfo('Repaired a worktree’s link to its repository').pipe(
              Effect.annotateLogs({ task: worktree.taskId, workspace: worktree.id, folder, copy, why, repository: worktree.root }),
            )
          } else {
            unrepaired.add(folder)
            yield* Effect.logWarning('Could not repair a worktree’s link to its repository', Cause.fail(failed)).pipe(
              Effect.annotateLogs({ task: worktree.taskId, workspace: worktree.id, folder, copy, why }),
            )
          }
          yield* record(worktree, done).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record a worktree’s repair', cause)))
          return done
        })

      /**
       * Repairs the broken ones among the worktrees Althar keeps, and the
       * copies their reviews read, of the repositories `of` picks. Every
       * broken one is found before any is repaired: git repairs all of a
       * repository's broken `.git` files at once, and each is recorded. One
       * git couldn't repair since Althar started is left.
       */
      const repairBroken = (of: (worktree: Kept) => boolean) =>
        Effect.gen(function* () {
          const broken: Array<{ readonly worktree: Kept; readonly folder: string; readonly copy: boolean; readonly why: BrokenWhy }> = []
          for (const worktree of (yield* kept).filter(of))
            for (const { folder, copy } of foldersOf(worktree)) {
              const link = linkOf(folder)
              if (link.state === 'broken' && !unrepaired.has(folder)) broken.push({ worktree, folder, copy, why: link.why })
            }
          const done: Array<Repaired> = []
          for (const { worktree, folder, copy, why } of broken) done.push(yield* repair(worktree, folder, copy, why))
          return done
        })

      const sweep = serial.withPermits(1)(repairBroken(() => true))

      const mend = (cwd: string): Effect.Effect<boolean> =>
        serial
          .withPermits(1)(
            Effect.gen(function* () {
              const folder = worktreeAt(cwd, config.worktreeRoot) ?? (existsSync(cwd) ? resolve(cwd) : null)
              if (folder === null) return false
              const link = linkOf(folder)
              // Repaired meanwhile, as one more command waited for the repair: it runs again.
              if (link.state !== 'broken') return repairedHere.has(folder)
              if (unrepaired.has(folder)) return false
              const worktree = (yield* kept).find((one) => foldersOf(one).some((entry) => entry.folder === folder))
              if (worktree === undefined) return false
              // Its repository's other broken worktrees with it, as git repairs them together.
              const done = yield* repairBroken((other) => resolve(other.root) === resolve(worktree.root))
              return done.some((one) => one.folder === folder && one.repaired)
            }),
          )
          .pipe(
            provide,
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('Could not look at whether a worktree’s link to its repository broke', cause), false),
            ),
          )

      yield* mendingUnder(config.worktreeRoot, mend)
      // When Althar starts, once its first screen shows: the worktrees it keeps that it isn't done with.
      yield* Effect.forkScoped(
        afterOpen(
          provide(sweep).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at whether worktrees’ links broke', cause))),
        ),
      )

      return WorktreeRepair.of({ sweep: provide(sweep), mend })
    }),
  )
}
