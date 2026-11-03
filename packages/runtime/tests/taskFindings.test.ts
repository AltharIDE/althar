import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from '../src/errors'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { reviewCopyOf } from '../src/reviewCopy'
import { titleOf } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { carriedLine, hunksOf, placeIn } from '../src/taskFindings'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * What a task's reviews found, placed in its change as it is now: each
 * finding's line carried past what changed since its review read the code,
 * a file the change left alone readable whole, and the reviewer's title kept
 * to a line.
 */

describe('a line carried through the hunks since a review', () => {
  const hunks = hunksOf(
    [
      'diff --git a/a.ts b/a.ts',
      '@@ -3,0 +4,2 @@ two lines put in after line 3',
      '@@ -10,2 +12 @@ lines 10 and 11 made one',
      '@@ -20 +21,0 @@ line 20 taken out',
    ].join('\n'),
  )

  it('reads the hunks, a count left out as one', () => {
    assert.deepStrictEqual(hunks, [
      { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2 },
      { oldStart: 10, oldCount: 2, newStart: 12, newCount: 1 },
      { oldStart: 20, oldCount: 1, newStart: 21, newCount: 0 },
    ])
  })

  it('stays above what was put in, and moves below it', () => {
    assert.deepStrictEqual(carriedLine(hunks, 3), { line: 3, changed: false })
    assert.deepStrictEqual(carriedLine(hunks, 4), { line: 6, changed: false })
  })

  it('lands on what replaced it, as changed', () => {
    assert.deepStrictEqual(carriedLine(hunks, 10), { line: 12, changed: true })
    assert.deepStrictEqual(carriedLine(hunks, 11), { line: 12, changed: true })
    assert.deepStrictEqual(carriedLine(hunks, 15), { line: 16, changed: false })
  })

  it('lands on the line before, where it was only taken out', () => {
    assert.deepStrictEqual(carriedLine(hunks, 20), { line: 21, changed: true })
    assert.deepStrictEqual(carriedLine(hunks, 25), { line: 25, changed: false })
  })

  it('stays where it was with nothing changed', () => {
    assert.deepStrictEqual(carriedLine([], 7), { line: 7, changed: false })
  })
})

describe('a reviewer’s path', () => {
  const worktrees = [
    { slug: 'web', path: '/w/task/web' },
    { slug: 'api', path: '/w/task/api' },
  ]

  it('is in the repository its slug names, for a task of several', () => {
    assert.deepStrictEqual(placeIn(worktrees, 'api/src/a.ts'), { index: 1, inside: 'src/a.ts' })
    assert.deepStrictEqual(placeIn(worktrees, './web/b.ts'), { index: 0, inside: 'b.ts' })
  })

  it('is inside the review’s copy or the worktree, written whole', () => {
    assert.deepStrictEqual(placeIn(worktrees, `${reviewCopyOf('/w/task/api')}/src/a.ts`), { index: 1, inside: 'src/a.ts' })
    assert.deepStrictEqual(placeIn(worktrees, '/w/task/web/b.ts'), { index: 0, inside: 'b.ts' })
  })

  it('is nowhere when it climbs out, or is elsewhere', () => {
    assert.isNull(placeIn(worktrees, '../secrets'))
    assert.isNull(placeIn(worktrees, '/etc/passwd'))
  })
})

describe('a finding’s title', () => {
  it('is one trimmed line, none when empty, and cut at a word when a claim was written there', () => {
    assert.strictEqual(titleOf('  The usage column\n has no header  '), 'The usage column has no header')
    assert.isNull(titleOf('   '))
    assert.isNull(titleOf(undefined))
    const cut = titleOf(`${'word '.repeat(40)}end`) ?? ''
    assert.isAtMost(cut.length, 120)
    assert.match(cut, /word…$/)
  })
})

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

describe('a task’s findings', () => {
  it.live('are placed in its change as it is now, a file it left alone readable whole', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Placed findings',
        description: 'Do it. [lead:finish] [review:wait]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: task.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      const [reviewer] = yield* until(
        sql<{ threadId: string; sessionId: string }>`
          SELECT t.id AS thread_id, s.id AS session_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND t.node_key = 'review' AND s.state = 'active'`,
        (rows) => rows.length === 1,
      )
      const access: ToolAccess = {
        role: 'reviewer',
        projectId: project.projectId,
        threadId: reviewer?.threadId ?? '',
        sessionId: reviewer?.sessionId ?? '',
        taskId: task.taskId,
      }
      yield* callTool(access, 'report_review', {
        verdict: 'changes_requested',
        summary: 'Two things.',
        findings: [
          { severity: 'major', title: 'The heading names the old project', file: 'README.md', line: 1, claim: 'It still says Meridian.' },
          { severity: 'minor', claim: 'No screenshot of the page.' },
          { severity: 'minor', title: 'The third line says too much', file: 'notes.md', line: 3, claim: 'Cut it.' },
        ],
      })

      // As the review read it: the file the change left alone, at its line.
      const [first, loose] = (yield* queries.findings(task.taskId)).findings
      assert.deepInclude(first, {
        round: 0,
        severity: 'major',
        title: 'The heading names the old project',
        file: 'README.md',
        line: 1,
        at: { path: 'README.md', line: 1, changed: false, untouched: true },
        state: 'open',
        reason: null,
        commit: null,
      })
      assert.deepInclude(loose, { title: null, file: null, at: null })

      // A file the change left alone reads whole, every line unchanged; one outside the worktree never.
      const whole = yield* queries.fileDiff(task.taskId, 'README.md', true)
      assert.deepStrictEqual(whole.lines, [{ kind: 'context', old: 1, new: 1, text: '# Meridian' }])
      assert.instanceOf(yield* Effect.flip(queries.fileDiff(task.taskId, '../README.md', true)), NotFound)

      // Two lines put in above it since: the finding moves with its line, in a file the change now changes.
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId} AND access = 'write'`
      writeFileSync(join(worktree?.path ?? '', 'README.md'), '# Intro\n\n# Meridian\n')
      const [moved] = (yield* queries.findings(task.taskId)).findings
      assert.deepStrictEqual(moved?.at, { path: 'README.md', line: 3, changed: false, untouched: false })

      // A new file nobody has added yet, as the review read it: its finding stays on its line, then moves with it.
      const path = worktree?.path ?? ''
      writeFileSync(join(path, 'notes.md'), 'one\ntwo\nthree\n')
      assert.include(execFileSync('git', ['-C', path, 'status', '--porcelain']).toString(), '?? notes.md')
      const [attempt] = yield* sql<{ id: string }>`SELECT review_attempt_id AS id FROM findings WHERE location LIKE '%notes.md%'`
      const index = join(path, '..', 'snapshot-index')
      const env = {
        ...process.env,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@t',
      }
      execFileSync('git', ['-C', path, 'add', '-A'], { env })
      const tree = execFileSync('git', ['-C', path, 'write-tree'], { env }).toString().trim()
      const snapshot = execFileSync('git', ['-C', path, 'commit-tree', tree, '-p', 'HEAD', '-m', 'read'], { env }).toString().trim()
      yield* sql`UPDATE workspace_snapshots SET commit_sha = ${snapshot} WHERE node_attempt_id = ${attempt?.id ?? ''}`
      const untracked = () =>
        Effect.map(queries.findings(task.taskId), (all) => all.findings.find((one) => one.title === 'The third line says too much')?.at)
      assert.deepStrictEqual(yield* untracked(), { path: 'notes.md', line: 3, changed: false, untouched: false })
      writeFileSync(join(path, 'notes.md'), 'zero\nhalf\none\ntwo\nthree\n')
      assert.deepStrictEqual(yield* untracked(), { path: 'notes.md', line: 5, changed: false, untouched: false })

      // A review's report opens its own run's findings: by the review it names, or, from before reports named it, by when it was said.
      const [report] = yield* sql<{ id: string }>`
        SELECT i.id FROM thread_items i JOIN threads t ON t.id = i.thread_id
        WHERE t.task_id = ${task.taskId} AND i.kind = 'step_result' AND json_extract(i.content, '$.step') = 'review'`
      const byReport = yield* queries.findings(task.taskId, report?.id ?? '')
      assert.strictEqual(byReport.review, attempt?.id)
      assert.lengthOf(byReport.findings, 3)
      yield* sql`UPDATE thread_items SET content = json_remove(content, '$.attemptId') WHERE id = ${report?.id ?? ''}`
      assert.strictEqual((yield* queries.findings(task.taskId, report?.id ?? '')).review, attempt?.id)
      assert.isNull((yield* queries.findings(task.taskId, 'item_elsewhere')).review)
    }).pipe(Effect.provide(withQueries())),
  )
})
