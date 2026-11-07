import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { bumpRevision, type Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, type Crypto, Effect, Layer, Result, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

import { taskThreadOf } from './bringBack'
import { RuntimeConfig } from './Config'
import { GitFailed } from './errors'
import { mendingUnder, repairWorktree } from './git'
import { gitLine, gitSummary, homeShortened } from './gitSaid'
import { Instance } from './Instance'
import { fact } from './records'
import { reviewCopyOf } from './reviewCopy'
import { afterOpen } from './startup'
import { addItem } from './threads'
import { type BrokenWhy, type Link, linkOf, type Taken, takenFrom, worktreeAt } from './worktreeLinks'

/*
 * Worktrees whose link to their repository broke, repaired (ADR-102). A
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
 * the log, and the folder stays as it is. Nor does it have git join a folder
 * to a record in the repository that is another worktree's, as a prune
 * freeing a moved one's name for the next leaves it: that is said the same
 * way, and nothing is changed. A folder that isn't there at all
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
  /** The branch its work is on, or will be once it is made. */
  readonly branch: string | null
}

/** A folder Althar repaired, or couldn't: the worktree it belongs to, whether it is the copy reviews read, and what git said. */
export interface Repaired {
  readonly workspaceId: string
  readonly taskId: string
  readonly folder: string
  readonly copy: boolean
  readonly why: BrokenWhy
  readonly repaired: boolean
  /** What git said, or why it wasn't asked: what the record keeps. */
  readonly said: string
  /** What the task's thread says of it, where it wasn't repaired: a fact and a way out, in the person's words. */
  readonly words?: { readonly title: string; readonly description: string }
}

/** The line across a task's thread when its folders' links are repaired: its folder's, the copy its reviews read's, or both, once. */
export const repairedWords = (folder: boolean, copy: boolean) =>
  folder && copy ? 'Folder link repaired, and its review copy’s' : copy ? 'Review copy’s folder link repaired' : 'Folder link repaired'

const stop = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** The way out where a task's own folder can't be joined to its repository again: its work is on its branch, the folder left as it is. */
const wayOut = (folder: string, root: string, branch: string | null) =>
  branch === null
    ? `Its commits are safe in the repository, and the folder is left as it is, uncommitted changes and all. To work in it again, move the folder aside and add it back with git worktree add ${homeShortened(folder)} in ${homeShortened(root)}.`
    : `Its commits are safe on its branch, ${branch}, and the folder is left as it is, uncommitted changes and all. To work in it again, move the folder aside and add it back with git worktree add ${homeShortened(folder)} ${branch} in ${homeShortened(root)}.`

/** The way out for the copy a task's reviews read: nothing of the work is in it, and the next review makes it again. */
const copyWayOut = (folder: string) =>
  `Nothing of the task’s work is in it: remove the folder, ${homeShortened(folder)}, and Althar makes it again at the next review.`

/** What the thread says where git couldn't repair a folder's link: the fact, the way out, then what git said. */
export const unrepairedWords = (folder: string, copy: boolean, root: string, branch: string | null, said: string) => ({
  title: copy
    ? 'The copy this task’s reviews read lost its link to the repository, and Althar couldn’t restore it.'
    : 'This task’s folder lost its link to the repository, and Althar couldn’t restore it.',
  description: `${copy ? copyWayOut(folder) : wayOut(folder, root, branch)} Git said: ${stop(said)}`,
})

/** What it says where the repair would take another's record, so nothing was changed. */
export const takenWords = (folder: string, copy: boolean, root: string, branch: string | null, taken: Taken) => {
  const which = copy ? 'The copy this task’s reviews read' : 'This task’s folder'
  return 'folder' in taken
    ? {
        title: `${which} is linked to another copy, at ${homeShortened(taken.folder)}, so Althar left both as they are.`,
        description: 'If that copy is from an old profile, remove it and restart Althar.',
      }
    : {
        title: `${which} is linked to another branch in the repository, ${taken.branch}, so Althar left it as it is.`,
        description: copy ? copyWayOut(folder) : wayOut(folder, root, branch),
      }
}

export class WorktreeRepair extends Context.Service<
  WorktreeRepair,
  {
    /** Looks at every worktree Althar keeps on this computer, and the copies its reviews read, and repairs those whose link broke. */
    readonly sweep: Effect.Effect<ReadonlyArray<Repaired>, SqlError>
    /** Repairs the worktree a folder is in, where its link broke and Althar keeps it: whether it did. */
    readonly mend: (folder: string, since?: number) => Effect.Effect<boolean>
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
      /** Folders repaired since Althar started, with when: a command that failed while another repaired its folder runs again. */
      const repairedHere = new Map<string, number>()
      /** Folders git couldn't repair since Althar started: not tried again on each command that fails there. */
      const unrepaired = new Set<string>()

      /** The worktrees Althar keeps on this computer, not cleaned, each with its repository's main checkout. */
      const kept = Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<Kept>`
          SELECT w.id, w.task_id, w.project_id, w.path, l.path AS root, w.branch FROM workspaces w
          JOIN repository_locations l ON l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}
          WHERE w.device_id = ${instance.deviceId} AND w.state <> 'cleaned' AND w.kind IS NULL
          ORDER BY w.created_at, w.rowid`,
      )

      /** The folders of a worktree Althar keeps: the worktree, and the copy its reviews read. */
      const foldersOf = (worktree: Kept) => [
        { folder: resolve(worktree.path), copy: false },
        { folder: resolve(reviewCopyOf(worktree.path)), copy: true },
      ]

      /**
       * Records a repair on its workspace, as a fact: whether it is news. One
       * that failed as the last one for that folder did, as a folder git
       * can't repair fails at each start, isn't recorded again, nor said.
       */
      const record = (worktree: Kept, done: Repaired) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const [last] = yield* sql<{ type: string; payload: string }>`
                SELECT type, payload FROM record_events
                WHERE aggregate_id = ${worktree.id} AND type IN ('workspace.repaired', 'workspace.repair_failed')
                  AND json_extract(payload, '$.folder') = ${done.folder}
                ORDER BY rowid DESC LIMIT 1`
              if (!done.repaired && last?.type === 'workspace.repair_failed') {
                const was = JSON.parse(last.payload) as { why?: string; said?: string }
                if (was.why === done.why && was.said === done.said) return false
              }
              const [row] = yield* sql<{ revision: number }>`SELECT revision FROM workspaces WHERE id = ${worktree.id}`
              if (row === undefined) return false
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
              return true
            }),
          )
        })

      /**
       * Says in a task's thread how its folders' repairs went: one line
       * across it for those repaired, as its folder going or coming back is,
       * and a warning, the person's, for each that wasn't.
       */
      const say = (taskId: string, done: ReadonlyArray<Repaired>) =>
        Effect.gen(function* () {
          const thread = yield* taskThreadOf(taskId)
          if (thread === null) return
          const place = { projectId: thread.projectId, threadId: thread.id }
          const repaired = done.filter((one) => one.repaired)
          if (repaired.length > 0)
            yield* addItem(place, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: repairedWords(
                repaired.some((one) => !one.copy),
                repaired.some((one) => one.copy),
              ),
              description: null,
              role: 'folder',
            })
          for (const one of done)
            if (one.words !== undefined)
              yield* addItem(place, 'notice', {
                source: 'runtime',
                severity: 'warning',
                title: one.words.title,
                description: one.words.description,
              })
        })

      /** Records that a folder wasn't repaired, for the record git would join it to being another worktree's: git isn't run. */
      const refuse = (worktree: Kept, folder: string, copy: boolean, why: BrokenWhy, taken: Taken) =>
        Effect.gen(function* () {
          const done: Repaired = {
            workspaceId: worktree.id,
            taskId: worktree.taskId,
            folder,
            copy,
            why,
            repaired: false,
            said:
              'folder' in taken ? `its record is another folder’s: ${taken.folder}` : `its record is on another branch: ${taken.branch}`,
            words: takenWords(folder, copy, worktree.root, worktree.branch, taken),
          }
          unrepaired.add(folder)
          yield* Effect.logWarning('Did not repair a worktree’s link: the record it names is another worktree’s').pipe(
            Effect.annotateLogs({ task: worktree.taskId, workspace: worktree.id, folder, copy, why, repository: worktree.root, ...taken }),
          )
          return yield* recorded(worktree, done)
        })

      /** Records it, and hands it on to be said where it is news. */
      const recorded = (worktree: Kept, done: Repaired) =>
        record(worktree, done).pipe(
          Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not record a worktree’s repair', cause), true)),
          Effect.map((news) => ({ done, news })),
        )

      /** Has git repair one folder's link from the repository's main checkout, and records how it went; not where it would take another's record. */
      const repair = (worktree: Kept, folder: string, copy: boolean, link: Link & { readonly state: 'broken' }) =>
        Effect.gen(function* () {
          const why = link.why
          const taken = takenFrom(folder, link, worktree.root, copy ? false : worktree.branch)
          if (taken !== null) return yield* refuse(worktree, folder, copy, why, taken)
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
            ...(failed === null ? {} : { words: unrepairedWords(folder, copy, worktree.root, worktree.branch, gitLine(failed.stderr)) }),
          }
          if (failed === null) {
            repairedHere.set(folder, yield* Clock.currentTimeMillis)
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
          return yield* recorded(worktree, done)
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
          const broken: Array<{
            readonly worktree: Kept
            readonly folder: string
            readonly copy: boolean
            readonly link: Link & { readonly state: 'broken' }
          }> = []
          for (const worktree of (yield* kept).filter(of))
            for (const { folder, copy } of foldersOf(worktree)) {
              const link = linkOf(folder)
              if (link.state === 'broken' && !unrepaired.has(folder)) broken.push({ worktree, folder, copy, link })
            }
          const done: Array<Repaired> = []
          const news = new Map<string, Array<Repaired>>()
          for (const { worktree, folder, copy, link } of broken) {
            const one = yield* repair(worktree, folder, copy, link)
            done.push(one.done)
            if (one.news) news.set(worktree.taskId, [...(news.get(worktree.taskId) ?? []), one.done])
          }
          for (const [taskId, said] of news)
            yield* say(taskId, said).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not say how a worktree’s repair went', cause)),
            )
          return done
        })

      const sweep = serial.withPermits(1)(repairBroken(() => true))

      const mend = (cwd: string, since = 0): Effect.Effect<boolean> =>
        serial
          .withPermits(1)(
            Effect.gen(function* () {
              const folder = worktreeAt(cwd, config.worktreeRoot) ?? (existsSync(cwd) ? resolve(cwd) : null)
              if (folder === null) return false
              const link = linkOf(folder)
              // Repaired meanwhile, as one more command waited for the repair: it runs again.
              if (link.state !== 'broken') return (repairedHere.get(folder) ?? -1) >= since
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
