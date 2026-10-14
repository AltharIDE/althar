import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { evidencePaths } from './evidence'
import { branchExists, commitsAhead, git, uncommittedFiles } from './git'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { indexTask } from './Search'
import { addItem } from './threads'

/*
 * A plain task's worktree (DEV-96, ADR-035). What the coordinator starts
 * with `start_task`, a question, a quick look, a prototype or a release run
 * from this Mac, starts in a worktree with no branch: detached at the commit
 * it starts from, set up as any task's is, its branch's name planned as any
 * task's is. What its lead throws away (prototypes, notes, screenshots) goes
 * in its scratch folder, which git ignores. Where its lead first changes the
 * repository itself, with new commits or changes not committed that aren't
 * evidence it handed, Althar makes the task's branch right there, with that
 * work on it: as the lead's turn ends, or as it calls finish_step. The lead
 * keeps its session and its folder; the task is a change from then, and its
 * thread and the coordinator are told.
 */

/** Where a worktree keeps what its lead throws away: prototypes, notes, screenshots. */
export const scratchOf = (worktree: string) => join(worktree, '.althar', 'scratch')

/**
 * Makes a worktree's scratch folder, which git ignores: a `.gitignore` in it
 * ignores everything there, itself too, so no tracked file changes and
 * neither do the repository's own settings. Nothing, where it can't be made:
 * what the lead writes there then counts as anywhere else does.
 */
export const makeScratch = (worktree: string) =>
  Effect.ignore(
    Effect.try(() => {
      mkdirSync(scratchOf(worktree), { recursive: true })
      writeFileSync(join(scratchOf(worktree), '.gitignore'), '*\n')
    }),
  )

/** A task's worktree here with no branch yet. */
interface Unbranched {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly path: string
  readonly branch: string
  readonly baseCommit: string | null
  readonly state: string
}

/** The task's worktrees here that have no branch yet, the project's first first. */
const unbranchedOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    return yield* sql<Unbranched>`
      SELECT w.id, w.project_id, t.id AS thread_id, w.path, w.branch, w.base_commit, w.state
      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
      JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.branched_at IS NULL
      ORDER BY b.created_at, b.rowid`
  })

/** Whether a task has no branch yet: a plain task whose lead hasn't changed the repository. */
export const unbranched = (taskId: string) => Effect.map(unbranchedOf(taskId), (rows) => rows.length > 0)

/** Whether a worktree with no branch has work of its own: commits after where it started, or changes not committed that aren't evidence. */
const wroteIn = (worktree: Unbranched, evidence: (worktree: string, file: string) => boolean) =>
  Effect.gen(function* () {
    if (worktree.baseCommit !== null && (yield* commitsAhead(worktree.path, worktree.baseCommit)) > 0) return true
    return (yield* uncommittedFiles(worktree.path)).some((file) => !evidence(worktree.path, file))
  }).pipe(Effect.orElseSucceed(() => false))

/** What a plain task's thread says as it becomes a change: the branch it is on now, or each, where its repositories' differ. */
export const branchedWords = (names: ReadonlyArray<string>) => {
  const distinct = [...new Set(names)]
  return distinct.length === 1 ? `on its branch ${distinct[0] ?? ''}` : `on its branches ${distinct.join(', ')}`
}

/**
 * Makes a plain task's branch where its lead first changed the repository:
 * in each of its worktrees with none yet, the first free of its planned name,
 * `-2`, `-3`…, switched to where the worktree is, so commits made on the
 * detached head and changes not committed are on it. Recorded, said in its
 * thread, found by it, and its card read again. Nothing where it has a
 * branch already or wrote nothing; `handed` are pictures its lead hands as
 * evidence now, which aren't work. The branches made. The caller holds the
 * task's lock, so this never runs beside publishing it.
 */
export const branchOnFirstWrite = (taskId: string, handed: ReadonlyArray<{ readonly worktree: string; readonly file: string }> = []) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const open = (yield* unbranchedOf(taskId)).filter((worktree) => worktree.state === 'ready' && existsSync(worktree.path))
    if (open.length === 0) return []
    const before = yield* evidencePaths(taskId)
    const evidence = (worktree: string, file: string) =>
      before(worktree, file) || handed.some((picture) => picture.worktree === worktree && picture.file === file)
    const wrote = yield* Effect.forEach(open, (worktree) => wroteIn(worktree, evidence))
    if (!wrote.includes(true)) return []
    // Each one now, so the task is all a change; one git can't switch stays as it is, to be tried again at the next turn's end.
    const made: Array<Unbranched & { readonly name: string }> = []
    for (const worktree of open) {
      let name = worktree.branch
      for (let n = 2; yield* branchExists(worktree.path, name); n += 1) name = `${worktree.branch}-${n}`
      const switched = yield* Effect.exit(git(worktree.path, 'switch', '--quiet', '--create', name))
      if (switched._tag === 'Success') made.push({ ...worktree, name })
      else yield* Effect.logWarning('Could not make a plain task’s branch', switched.cause)
    }
    const [first] = made
    if (first === undefined) return []
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const at = yield* timestamp
        for (const worktree of made) {
          const revision = yield* change('workspaces', worktree.id, { branchedAt: at, branch: worktree.name })
          yield* fact({
            projectId: worktree.projectId,
            aggregateType: 'workspace',
            aggregateId: worktree.id,
            revision,
            type: 'workspace.branched',
            payload: { from: null, to: worktree.name },
            actorId: instance.systemId,
          })
        }
        yield* addItem({ projectId: first.projectId, threadId: first.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `This task changes files now, ${branchedWords(made.map((worktree) => worktree.name))}.`,
        })
        yield* indexTask(taskId)
      }),
    )
    yield* touchCard(taskId)
    return made.map((worktree) => worktree.name)
  })
