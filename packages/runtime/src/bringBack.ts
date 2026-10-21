import { existsSync, realpathSync } from 'node:fs'

import type { ActorId, ProjectId } from '@althar/domain'
import { Effect, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { TaskRefused } from './errors'
import { makeScratch } from './firstWrite'
import { branchExists, commitOf, git, restoreDetachedWorktree, restoreWorktree } from './git'
import { Instance } from './Instance'
import { change, fact } from './records'
import { copyReviewed, reviewOf } from './reviewing'
import { addItem } from './threads'

/*
 * A finished task's folder, removed to free the disk (FolderCleanup.ts),
 * comes back by itself when the task needs it (ADR-055): before an agent
 * starts on it, before it opens in an editor or runs, and as it is reopened.
 * It comes back at the same path: a change's on its branch, else detached
 * at the commit it was removed at, kept under `refs/althar/kept/<workspace>`;
 * a quick task's detached where it was; a review's copy of the pull request
 * again. Each is set up again, as a new one is, and the thread says the
 * folder is back, as a line across it. This is a module, not a service, so
 * a session can bring its task's folder back before its agent starts in it.
 */

/** Where a removed folder's last commit is kept, by its workspace: what its changes are read from while it is gone, and what it comes back from. */
export const KEPT = 'refs/althar/kept/'

/** What the thread says as a task's folder comes back. */
export const backWords = 'Folder back from its branch'

/** A task's folders go and come back one at a time: removing them waits for one coming back, and the other way round. */
const locks = new Map<string, Semaphore.Semaphore>()

/** Runs `effect` while nothing else removes or brings back the task's folders. */
export const withFolder = <A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const lock = locks.get(taskId) ?? Semaphore.makeUnsafe(1)
    locks.set(taskId, lock)
    return lock.withPermits(1)(effect)
  })

interface Removed {
  readonly id: string
  readonly projectId: ProjectId
  readonly path: string
  readonly access: string
  readonly branch: string
  readonly branched: number
  readonly baseCommit: string | null
  readonly repository: string
}

/** Whether a folder is a checkout of its own, at its top: one put back by hand, rather than whatever else came to be there. */
const worktreeAt = (path: string) =>
  git(path, 'rev-parse', '--show-toplevel').pipe(
    Effect.map((top) => top === realpathSync(path)),
    Effect.orElseSucceed(() => false),
  )

/** A task's own thread, where what happens to its folder is said. */
export const taskThreadOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ id: string; projectId: ProjectId }>`
      SELECT id, project_id FROM threads WHERE task_id = ${taskId} AND kind = 'task' ORDER BY created_at, rowid LIMIT 1`
    return thread ?? null
  })

const bringingBack = (taskId: string, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const removed = yield* sql<Removed>`
      SELECT w.id, w.project_id, w.path, w.access, w.branch, w.branched_at IS NOT NULL AS branched, w.base_commit, l.path AS repository
      FROM workspaces w
      JOIN repository_bindings b ON b.id = w.binding_id
      JOIN repository_locations l ON l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}
      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'cleaned'
      ORDER BY b.created_at, b.rowid`
    if (removed.length === 0) return false
    for (const one of removed) {
      // Put back by hand already, it is only marked so; anything else where it goes is never taken for it, nor removed.
      if (existsSync(one.path)) {
        if (!(yield* worktreeAt(one.path))) return yield* new TaskRefused({ taskId, why: 'folder_in_way' })
      } else {
        if (one.access === 'read') {
          const review = yield* reviewOf(taskId)
          if (review === null) return yield* new TaskRefused({ taskId, why: 'branch_gone' })
          yield* copyReviewed(one.repository, one.path, review)
        } else {
          const kept = yield* commitOf(one.repository, `${KEPT}${one.id}`).pipe(Effect.orElseSucceed(() => null))
          if (one.branched === 1 && (yield* branchExists(one.repository, one.branch)))
            yield* restoreWorktree(one.repository, one.path, one.branch)
          else if (kept !== null || one.baseCommit !== null) {
            yield* restoreDetachedWorktree(one.repository, one.path, kept ?? one.baseCommit ?? '')
            if (one.branched === 0) yield* makeScratch(one.path)
          } else return yield* new TaskRefused({ taskId, why: 'branch_gone' })
        }
      }
      // A write worktree is set up again, as a new one is: until it is, its task is said to be bringing its folder back. A
      // review's copy has nothing to set up.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change(
            'workspaces',
            one.id,
            one.access === 'write' ? { state: 'ready', setup: null } : { state: 'ready', cleanedAt: null },
          )
          yield* fact({
            projectId: one.projectId,
            aggregateType: 'workspace',
            aggregateId: one.id,
            revision,
            type: 'workspace.restored',
            payload: { removed: true },
            actorId,
          })
        }),
      )
    }
    const thread = yield* taskThreadOf(taskId)
    if (thread !== null)
      yield* addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: backWords,
        description: null,
        role: 'folder',
      })
    return true
  })

/**
 * Brings back a task's removed folders on this device, and says so in its
 * thread: whether any came back. Refused where nothing is left to bring one
 * back from. The caller begins their setup, which a new lead's first turn
 * waits for.
 */
export const bringBack = (taskId: string, actorId: ActorId) => withFolder(taskId, bringingBack(taskId, actorId))

/**
 * As `bringBack`, then `then`, before anything can remove the folders
 * again: for what opens them or runs from them to say so first, as the
 * removal asks again under the same lock (`FolderCleanup.ts`).
 */
export const bringBackThen = <A, E, R>(taskId: string, actorId: ActorId, then: Effect.Effect<A, E, R>) =>
  withFolder(
    taskId,
    Effect.flatMap(bringingBack(taskId, actorId), (back) => Effect.as(then, back)),
  )

/** Brings back the folders of the task a thread is on, if any were removed: the task's id where they came back, else null. */
export const bringBackFor = (threadId: string, actorId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
    if (thread?.taskId == null) return null
    return (yield* bringBack(thread.taskId, actorId)) ? thread.taskId : null
  })

/**
 * Where a task's folder is, for its view: removed, while every one of its
 * worktrees here is; coming back, while one put back isn't set up again
 * yet; absent while it is here.
 */
export const folderOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [standing] = yield* sql<{ total: number; removed: number; comingBack: number }>`
      SELECT count(*) AS total, coalesce(sum(state = 'cleaned'), 0) AS removed,
        coalesce(sum(state = 'ready' AND access = 'write' AND cleaned_at IS NOT NULL AND setup IS NULL), 0) AS coming_back
      FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId}`
    if (standing === undefined || standing.total === 0) return undefined
    if (standing.removed === standing.total) return 'removed' as const
    return standing.comingBack > 0 ? ('returning' as const) : undefined
  })
