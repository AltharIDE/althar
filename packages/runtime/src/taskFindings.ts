import { existsSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import type { Finding, TaskFinding } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { gitExactly, treeOf } from './git'
import { reviewCopyOf } from './reviewCopy'

/*
 * What the reviews of a task found, each placed in the task's change as it
 * stands now. A reviewer reads a snapshot of the worktree (reviewCopy.ts),
 * and names a file and a line as it read them; the lead's fixes since move
 * what's above that line, or change the line itself. So each finding's line
 * is carried from the snapshot its review read to the worktree now, through
 * the hunks git gives between the two: the Changes view shows it under the
 * line it means, and says when that line changed since.
 *
 * Read from the store and git when asked for, never kept.
 */

/** One hunk of a `-U0` diff: the old file's lines it replaces, and the new file's it puts there. */
export interface Hunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
}

/** The hunks of a unified diff, as their headers say; a count left out is one, as git leaves it out. */
export const hunksOf = (diff: string): ReadonlyArray<Hunk> =>
  [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  }))

/**
 * Where a line of the old file is in the new, through the hunks between
 * them, in order: moved by what was put in or taken out above it; and where
 * a hunk replaced it, the line of what replaced it (the one before, where it
 * was only taken out), marked as changed.
 */
export const carriedLine = (hunks: ReadonlyArray<Hunk>, line: number): { readonly line: number; readonly changed: boolean } => {
  let moved = 0
  for (const hunk of hunks) {
    // A hunk that takes nothing out puts its lines after `oldStart`: a line at or above it stays put.
    if (hunk.oldCount === 0 ? line <= hunk.oldStart : line < hunk.oldStart) break
    if (hunk.oldCount > 0 && line < hunk.oldStart + hunk.oldCount) {
      const within = hunk.newCount === 0 ? hunk.newStart : hunk.newStart + Math.min(line - hunk.oldStart, hunk.newCount - 1)
      return { line: Math.max(1, within), changed: true }
    }
    moved += hunk.newCount - hunk.oldCount
  }
  return { line: Math.max(1, line + moved), changed: false }
}

/** A worktree of the task's, as the Changes view names its files, with what it changed from its base. */
export interface FindingsWorktree {
  readonly slug: string
  readonly path: string
  readonly workspaceId: string
  /** The paths the task changed there, as the Changes view lists them. */
  readonly changed: ReadonlySet<string>
}

/** The commit a lead named, as a commit's name; anything else names nothing. */
const commitNamed = (named: string | null) => (named !== null && /^[0-9a-f]{7,64}$/.test(named) ? named : null)

/** Where a finding said it was, as the reviewer kept it; anything unreadable as nowhere. */
const locationOf = (location: string): { readonly file: string | null; readonly line: number | null } => {
  try {
    const read = JSON.parse(location) as { file?: unknown; line?: unknown }
    let file = typeof read.file === 'string' && read.file.trim() !== '' ? read.file.trim() : null
    let line = typeof read.line === 'number' && Number.isInteger(read.line) && read.line > 0 ? read.line : null
    // A reviewer that wrote the line into the file's name: `src/a.ts:42`.
    const named = file === null ? null : /^(.*):(\d+)$/.exec(file)
    if (named !== null) {
      file = named[1] ?? file
      line ??= Number(named[2])
    }
    return { file, line }
  } catch {
    return { file: null, line: null }
  }
}

/**
 * Which worktree a reviewer's path is in, and where within it: as named from
 * the repository's root; under its slug, for a task of several; or whole,
 * inside the review's copy of a worktree or the worktree itself.
 */
export const placeIn = (
  worktrees: ReadonlyArray<Pick<FindingsWorktree, 'slug' | 'path'>>,
  file: string,
): { readonly index: number; readonly inside: string } | null => {
  const inside = (root: string) => {
    const within = relative(root, file)
    return within !== '' && !within.startsWith('..') && !isAbsolute(within) ? within.split('\\').join('/') : null
  }
  if (isAbsolute(file)) {
    for (const [index, worktree] of worktrees.entries()) {
      const found = inside(reviewCopyOf(worktree.path)) ?? inside(worktree.path)
      if (found !== null) return { index, inside: found }
    }
    return null
  }
  const path = file.replace(/^\.\//, '')
  if (path === '' || path.split('/').includes('..')) return null
  if (worktrees.length > 1) {
    const slash = path.indexOf('/')
    const named = worktrees.findIndex((worktree) => worktree.slug === path.slice(0, slash))
    if (slash > 0 && named >= 0) return { index: named, inside: path.slice(slash + 1) }
  }
  const index = worktrees.findIndex((worktree) => existsSync(join(worktree.path, path)))
  return index < 0 ? null : { index, inside: path }
}

/**
 * The review a report in the task's thread is of, by its attempt: as the
 * report names it; or, for one from before reports did, the review whose
 * findings were the last kept by the time it was said. Null for no review.
 */
const reviewOf = (taskId: string, itemId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [item] = yield* sql<{ attemptId: string | null; createdAt: string }>`
      SELECT json_extract(i.content, '$.attemptId') AS attempt_id, i.created_at FROM thread_items i JOIN threads t ON t.id = i.thread_id
      WHERE i.id = ${itemId} AND t.task_id = ${taskId} AND i.kind = 'step_result'`
    if (item === undefined) return null
    if (item.attemptId !== null) return item.attemptId
    const [found] = yield* sql<{ attemptId: string }>`
      SELECT f.review_attempt_id AS attempt_id FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id
      JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} AND f.created_at <= ${item.createdAt} ORDER BY f.created_at DESC, f.rowid DESC LIMIT 1`
    return found?.attemptId ?? null
  })

/**
 * What the reviews of one of a task's runs found, each where it is in the
 * change now, and what became of it: the run of the review whose report is
 * `review`, a thread item; without it, the latest run that found anything.
 */
export const taskFindingsOf = (taskId: string, worktrees: ReadonlyArray<FindingsWorktree>, review?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const asked = review === undefined ? null : yield* reviewOf(taskId, review)
    // The run asked about, by its review; else the latest that found anything.
    const [ran] =
      asked !== null
        ? yield* sql<{ id: string }>`
            SELECT e.run_id AS id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            WHERE a.id = ${asked}`
        : yield* sql<{ id: string }>`
            SELECT r.id FROM runs r WHERE r.task_id = ${taskId} AND EXISTS (
              SELECT 1 FROM findings g JOIN node_attempts b ON b.id = g.review_attempt_id JOIN nodes m ON m.id = b.node_id
              JOIN workflow_executions x ON x.id = m.execution_id WHERE x.run_id = r.id)
            ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
    if (ran === undefined) return { findings: [], review: null }
    const rows = yield* sql<{
      id: string
      round: number
      attemptId: string
      severity: Finding['severity']
      title: string | null
      claim: string
      location: string
      state: TaskFinding['state']
      response: string | null
      fixedBy: string | null
    }>`
      SELECT f.id, n.iteration AS round, a.id AS attempt_id, f.severity, f.title, f.claim, f.location, f.state, f.response,
        (SELECT json_extract(r.payload, '$.commit') FROM record_events r
          WHERE r.aggregate_type = 'finding' AND r.aggregate_id = f.id AND r.type = 'finding.fixed' ORDER BY r.sequence DESC LIMIT 1) AS fixed_by
      FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id
      WHERE f.state <> 'dismissed' AND e.run_id = ${ran.id}
      ORDER BY n.iteration, f.created_at, f.rowid`
    if (rows.length === 0) return { findings: [], review: asked }

    // What each review read in each repository: the snapshot it was given.
    const snapshots = new Map<string, string | null>()
    const snapshotOf = (attemptId: string, workspaceId: string) =>
      Effect.gen(function* () {
        const key = `${attemptId}\0${workspaceId}`
        if (!snapshots.has(key)) {
          const [row] = yield* sql<{ commitSha: string | null }>`
            SELECT commit_sha FROM workspace_snapshots WHERE node_attempt_id = ${attemptId} AND workspace_id = ${workspaceId}
            ORDER BY taken_at LIMIT 1`
          snapshots.set(key, row?.commitSha ?? null)
        }
        return snapshots.get(key) ?? null
      })

    // Each worktree's files as they are, new ones nobody has added yet among them, as its review's snapshot was taken.
    const trees = new Map<string, string | null>()
    const treeNow = (worktree: FindingsWorktree) =>
      Effect.gen(function* () {
        if (!trees.has(worktree.path)) trees.set(worktree.path, yield* treeOf(worktree.path).pipe(Effect.orElseSucceed(() => null)))
        return trees.get(worktree.path) ?? null
      })

    // What changed in a file since a snapshot, to the files as they are: one diff each, however many findings name it.
    const changes = new Map<string, ReadonlyArray<Hunk> | null>()
    const changedSince = (worktree: FindingsWorktree, snapshot: string, path: string) =>
      Effect.gen(function* () {
        const key = `${worktree.path}\0${snapshot}\0${path}`
        const now = yield* treeNow(worktree)
        if (now === null) return null
        if (!changes.has(key))
          changes.set(
            key,
            yield* gitExactly(
              worktree.path,
              '--literal-pathspecs',
              'diff',
              '--no-color',
              '--no-ext-diff',
              '--no-textconv',
              '-U0',
              snapshot,
              now,
              '--',
              path,
            ).pipe(
              Effect.map(hunksOf),
              // A snapshot git has since let go of: the line as the reviewer read it.
              Effect.orElseSucceed(() => null),
            ),
          )
        return changes.get(key) ?? null
      })

    const findings: Array<TaskFinding> = []
    for (const row of rows) {
      const { file, line } = locationOf(row.location)
      const placed = file === null ? null : placeIn(worktrees, file)
      const worktree = placed === null ? undefined : worktrees[placed.index]
      let at: TaskFinding['at'] = null
      if (placed !== null && worktree !== undefined && existsSync(join(worktree.path, placed.inside))) {
        const snapshot = yield* snapshotOf(row.attemptId, worktree.workspaceId)
        const hunks = snapshot === null ? null : yield* changedSince(worktree, snapshot, placed.inside)
        const carried = line === null || hunks === null ? { line, changed: false } : carriedLine(hunks, line)
        at = {
          path: worktrees.length > 1 ? `${worktree.slug}/${placed.inside}` : placed.inside,
          line: carried.line,
          changed: carried.changed,
          untouched: !worktree.changed.has(placed.inside),
        }
      }
      findings.push({
        id: row.id,
        review: row.attemptId,
        round: row.round,
        severity: row.severity,
        title: row.title,
        claim: row.claim,
        file,
        line,
        at,
        state: row.state,
        reason: row.response,
        commit: row.state === 'fixed' ? commitNamed(row.fixedBy) : null,
      })
    }
    return { findings, review: asked }
  })
