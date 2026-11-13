import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { afterMergeFor, afterMergeNow, bringsBack } from '../src/afterMergeReview'
import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { FastLane } from '../src/fastLane'
import { Instance } from '../src/Instance'
import { MergeReviews } from '../src/MergeReviews'
import { Policies } from '../src/Policies'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, turns, until } from './support'

/*
 * What a small change's review after it merges brings back (docs/decisions/reviews.md, "A small change is reviewed after it
 * merges"), by the project's rule: Major only, where a review whose findings are all minor or nits ends as a quiet line in
 * the thread; Everything, as before; Don't review, where no review is owed. And one small change's own word over the rule,
 * read when the merge is heard.
 */

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const BRANCH = 'althar/add-a-retry'

/** A small change whose pull request opened, in a project whose rule is `rule` where one is given (else as made). */
const smallChange = (working: string, markers: string, rule?: 'major' | 'all' | 'none') =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const coordinator = yield* Coordinator
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (rule !== undefined) yield* (yield* Policies).set(project.projectId, { afterMergeReview: rule }, instance.personId)
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [coordinator:plan-small] [coordinator:plan-no-review] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.change != null && all[0].change.state === 'open')
    const card = ready ?? assert.fail('no card')
    // This fixture deliberately requests after-merge timing; size alone now keeps the normal before-Ship review.
    yield* (yield* Runs).reshape({
      taskId: card.taskId,
      afterMerge: { key: 'review', agentId: 'codex', model: null, skipped: true },
      actorId: instance.personId,
    })
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, url: card.change?.url ?? '' }
  })

const mergeIt = (bare: string, github: FakeService, taskId: string) =>
  Effect.gen(function* () {
    squashMerge(bare, BRANCH)
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(taskId)
  })

const reviewOf = (url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; findings: string; reviewer: string | null }>`
      SELECT state, findings, reviewer FROM merge_reviews WHERE url = ${url}`
    return row
  })

/** The small change's card, as its thread shows it. */
const smallCardOf = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).thread(threadId))
    const card = snapshot.items.find((item) => item.kind === 'small_change')
    return card?.kind === 'small_change' ? card.content : assert.fail('no small change card')
  })

const settled = (taskId: string) =>
  until(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`),
    ([row]) => row?.state === 'done',
  )

describe('what a small change’s review after its merge brings back', () => {
  it('holds the task’s own word over the project’s rule, and brings back what the rule says', () => {
    assert.strictEqual(afterMergeFor('major', null), 'major')
    assert.strictEqual(afterMergeFor('all', null), 'all')
    assert.strictEqual(afterMergeFor('none', null), 'none')
    assert.strictEqual(afterMergeFor('major', 'none'), 'none')
    assert.strictEqual(afterMergeFor('all', 'review'), 'all')
    assert.strictEqual(afterMergeFor('none', 'review'), 'major')
    const minor = [{ severity: 'minor' as const }, { severity: 'nit' as const }]
    assert.isFalse(bringsBack('major', minor))
    assert.isTrue(bringsBack('major', [...minor, { severity: 'major' }]))
    assert.isTrue(bringsBack('major', [{ severity: 'blocking' }]))
    assert.isTrue(bringsBack('all', minor))
    assert.isFalse(bringsBack('all', []))
  })

  it.live('Major only, for a project made before the rule: minor findings end as a quiet line, and the reviewer is told so', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      // As made, with no rule kept: Major only.
      const task = yield* smallChange(working, '[review:always]')
      const before = yield* smallCardOf(task.threadId)
      assert.deepStrictEqual(before.afterMerge, { project: 'major', task: null, holds: 'major' })
      assert.include(before.skips, 'reviewed after it merges, major findings only')
      yield* mergeIt(bare, github, task.taskId)

      // A minor and a nit: the review ends clear, its findings kept, and nothing waits on the person.
      const row = yield* until(reviewOf(task.url), (one) => one?.state === 'clear')
      assert.lengthOf(JSON.parse(row?.findings ?? '[]') as Array<unknown>, 2)
      assert.include(row?.reviewer ?? '', '"bringsBack":"major"')
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      assert.isUndefined(card?.afterMerge)
      // In the thread: its report, findings and all, marked as kept there.
      const result = (yield* items(task.threadId)).filter((item) => item.kind === 'step_result').at(-1)?.content as
        | { verdict?: unknown; findings?: ReadonlyArray<unknown>; afterMerge?: unknown }
        | undefined
      assert.strictEqual(result?.verdict, 'changes_requested')
      assert.lengthOf(result?.findings ?? [], 2)
      assert.deepStrictEqual(result?.afterMerge, { url: task.url, words: '#1', kept: true })
      const after = yield* smallCardOf(task.threadId)
      assert.strictEqual(after.steps.at(-1)?.what, 'Reviewed, nothing major')
      // Its card: kept quiet, with its report's item in the thread, where See findings goes.
      const [report] = yield* Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ id: string }>`
          SELECT id FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result' ORDER BY sequence DESC LIMIT 1`,
      )
      assert.deepInclude(after.reviewAfter, { state: 'quiet', findings: 2, item: report?.id ?? assert.fail('no report') })
      assert.isNotNull(after.reviewer)
      // Its reviewer was told only blocking and major findings come back.
      const reviewer = yield* Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step' AND node_key = 'merge_review'`,
      )
      const [first] = yield* turns(reviewer[0]?.id ?? assert.fail('no reviewer thread'))
      assert.include(first?.prompt ?? '', 'Only blocking and major findings come back to the person')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Everything: a minor finding brings the task back to Needs you, as before', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* smallChange(working, '[review:always]', 'all')
      assert.include((yield* smallCardOf(task.threadId)).skips, 'reviewed after it merges')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (one) => one?.state === 'found')
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.afterMerge?.state === 'found')
      assert.strictEqual(card?.afterMerge?.findings, 2)
      assert.deepInclude((yield* smallCardOf(task.threadId)).reviewAfter, { state: 'found', findings: 2 })
      const reviewer = yield* Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step' AND node_key = 'merge_review'`,
      )
      const [first] = yield* turns(reviewer[0]?.id ?? assert.fail('no reviewer thread'))
      assert.notInclude(first?.prompt ?? '', 'Only blocking and major findings come back')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Don’t review: no review is owed after the merge, and its card says so', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* smallChange(working, '[review:findings]', 'none')
      const card = yield* smallCardOf(task.threadId)
      assert.deepStrictEqual(card.skips, ['no plan', 'no review'])
      assert.strictEqual(card.afterMerge?.holds, 'none')
      yield* mergeIt(bare, github, task.taskId)
      yield* settled(task.taskId)
      // Nothing is owed, not even after the retry that recovers a merge whose review went missing.
      yield* (yield* FastLane).retryPendingReviews()
      assert.isUndefined(yield* reviewOf(task.url))
      const after = yield* smallCardOf(task.threadId)
      assert.isUndefined(after.steps.find((step) => step.key === 'review'))
      assert.isUndefined(after.reviewAfter)
      assert.isUndefined((yield* cards(task.projectId))[0]?.afterMerge)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('a review owed before the merge reads the rule as the merge is heard: Major only now keeps minor findings quiet', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* smallChange(working, '[review:always]', 'all')
      // Merge now owes it under Everything, and the merge waits in a queue while the person changes the rule.
      yield* (yield* MergeReviews).owe(task.taskId, task.url, {})
      assert.include((yield* reviewOf(task.url))?.reviewer ?? '', '"bringsBack":"all"')
      yield* (yield* Policies).set(task.projectId, { afterMergeReview: 'major' }, instance.personId)
      yield* mergeIt(bare, github, task.taskId)
      // A minor and a nit: clear, as the rule says now.
      const row = yield* until(reviewOf(task.url), (one) => one?.state === 'clear')
      assert.include(row?.reviewer ?? '', '"bringsBack":"major"')
      assert.lengthOf(JSON.parse(row?.findings ?? '[]') as Array<unknown>, 2)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('a review owed before the merge is no longer owed where the rule says none by the time the merge is heard', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const task = yield* smallChange(working, '[review:always]', 'all')
      yield* (yield* MergeReviews).owe(task.taskId, task.url, {})
      assert.strictEqual((yield* reviewOf(task.url))?.state, 'owed')
      yield* (yield* Policies).set(task.projectId, { afterMergeReview: 'none' }, instance.personId)
      yield* mergeIt(bare, github, task.taskId)
      yield* settled(task.taskId)
      yield* (yield* FastLane).retryPendingReviews()
      assert.isUndefined(yield* reviewOf(task.url))
      assert.isUndefined((yield* cards(task.projectId))[0]?.afterMerge)
      // Dropping saved pre-merge debt is a settled decision too: later policy changes must not recreate it.
      yield* (yield* Policies).set(task.projectId, { afterMergeReview: 'major' }, instance.personId)
      yield* (yield* FastLane).retryPendingReviews()
      assert.isUndefined(yield* reviewOf(task.url))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('one small change keeps a review where the rule has none, by its lead’s tool, and can’t change once merged', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:findings]', 'none')
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const lead: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      const said = yield* callTool(lead, 'review_after_merge', { review: 'review', why: 'the person asked' })
      assert.include(said, 'it is reviewed after it merges, and only blocking and major findings come back')
      assert.deepStrictEqual((yield* smallCardOf(task.threadId)).afterMerge, { project: 'none', task: 'review', holds: 'major' })
      yield* mergeIt(bare, github, task.taskId)
      // Its major finding comes back to the person, though the project's rule has no review.
      yield* until(reviewOf(task.url), (one) => one?.state === 'found')
      // Merged, its word is settled.
      const late = yield* callTool(lead, 'review_after_merge', { review: 'none' })
      assert.include(late, 'merged already')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('lets an open follow-up choose its review without changing the review saved for an earlier merge', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const mergeReviews = yield* MergeReviews
      const runs = yield* Runs
      const task = yield* smallChange(working, '[review:pass]')
      yield* mergeIt(bare, github, task.taskId)
      yield* until(reviewOf(task.url), (row) => row?.state === 'clear')
      const saved = yield* sql`SELECT * FROM merge_reviews WHERE url = ${task.url}`
      // A choice cannot rewrite the completed current change.
      assert.include(String(yield* Effect.flip(mergeReviews.choose(task.taskId, 'none', instance.personId))), 'merged already')

      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      const path = workspace?.path ?? assert.fail('no worktree')
      writeFileSync(join(path, 'follow-up.txt'), 'The next change.\n')
      git(path, 'add', 'follow-up.txt')
      git(path, 'commit', '-q', '-m', 'The next change')
      yield* until(cards(task.projectId), (all) => all[0]?.unshipped != null)
      yield* runs.publish(task.taskId)
      yield* until(
        Effect.sync(() => github.changes),
        (all) => all.length === 2,
      )
      const next = github.changes[1] ?? assert.fail('no follow-up')
      assert.strictEqual(next.state, 'open')
      assert.deepStrictEqual(yield* runs.setReviewAfterMerge({ taskId: task.taskId, review: 'none', actorId: instance.personId }), {
        project: 'major',
        task: 'none',
        holds: 'none',
      })
      assert.deepStrictEqual(yield* sql`SELECT * FROM merge_reviews WHERE url = ${task.url}`, saved)

      squashMerge(bare, next.source)
      github.mergeByHand(next.number)
      yield* until(
        Effect.gen(function* () {
          yield* (yield* Changes).refresh(task.taskId)
          return yield* sql<{
            state: string
          }>`SELECT json_extract(snapshot, '$.state') AS state FROM external_links WHERE url = ${next.url}`
        }),
        (rows) => rows[0]?.state === 'merged',
      )
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepStrictEqual(yield* sql`SELECT * FROM merge_reviews WHERE task_id = ${task.taskId}`, saved)
      assert.include(String(yield* Effect.flip(mergeReviews.choose(task.taskId, 'review', instance.personId))), 'merged already')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  for (const timing of ['choice', 'preset'] as const) {
    it.live(`keeps an earlier no-review merge decided while a real follow-up requests review through ${timing}`, () => {
      const { working, bare, github } = onGitHub()
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const runs = yield* Runs
        const task = yield* smallChange(working, '[review:pass]', 'none')
        yield* mergeIt(bare, github, task.taskId)
        yield* settled(task.taskId)
        assert.isUndefined(yield* reviewOf(task.url))
        // An older launch knew this merge but had not persisted its no-debt decision. A future choice must reconcile it first.
        yield* sql`DELETE FROM record_events WHERE aggregate_type = 'external_link' AND type = 'external_link.merge_review_not_owed'
        AND aggregate_id IN (SELECT id FROM external_links WHERE task_id = ${task.taskId} AND url = ${task.url})`
        const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
        const path = workspace?.path ?? assert.fail('no worktree')
        writeFileSync(join(path, 'follow-up.txt'), 'A separately reviewed change.\n')
        git(path, 'add', 'follow-up.txt')
        git(path, 'commit', '-q', '-m', 'A separately reviewed change')
        yield* until(cards(task.projectId), (all) => all[0]?.unshipped != null)
        yield* runs.publish(task.taskId)
        yield* until(
          Effect.sync(() => github.changes),
          (all) => all.length === 2,
        )
        if (timing === 'choice')
          assert.strictEqual(
            (yield* runs.setReviewAfterMerge({ taskId: task.taskId, review: 'review', actorId: instance.personId })).holds,
            'major',
          )
        else {
          yield* runs.reshape({
            taskId: task.taskId,
            afterMerge: { key: 'review', agentId: 'codex', model: null, skipped: true },
            actorId: instance.personId,
          })
          yield* (yield* Policies).set(task.projectId, { afterMergeReview: 'major' }, instance.personId)
        }
        const decision = yield* sql<{ reason: string }>`SELECT json_extract(e.payload, '$.reason') AS reason
        FROM record_events e JOIN external_links l ON l.id = e.aggregate_id
        WHERE e.aggregate_type = 'external_link' AND e.type = 'external_link.merge_review_not_owed' AND l.url = ${task.url}`
        assert.deepStrictEqual(decision, [{ reason: 'rule_none' }])
        // Recovery rereads old merged links after policy changes and after a restart; the durable decision keeps this one quiet.
        yield* (yield* FastLane).retryPendingReviews()
        assert.isUndefined(yield* reviewOf(task.url))
        const next = github.changes[1] ?? assert.fail('no follow-up')
        squashMerge(bare, next.source)
        github.mergeByHand(next.number)
        yield* until(
          Effect.gen(function* () {
            yield* (yield* Changes).refresh(task.taskId)
            yield* (yield* FastLane).retryPendingReviews()
            return yield* reviewOf(next.url)
          }),
          (row) => row?.state === 'clear',
        )
        assert.isUndefined(yield* reviewOf(task.url))
        assert.strictEqual(
          (yield* sql<{ count: number }>`SELECT count(*) AS count FROM merge_reviews WHERE task_id = ${task.taskId}`)[0]?.count,
          1,
        )
      }).pipe(Effect.provide(runtimeWith(github)))
    })
  }

  it.live('chooses for an open repository beside a newer merged sibling, and freezes a saved current review', () => {
    const api = hosted(['meridian', 'api'])
    const web = hosted(['meridian', 'web'])
    const github = makeFakeService({ pushUrl: (path) => (path[1] === 'web' ? web.bare : api.bare) })
    for (const [name, place] of [
      ['api', api],
      ['web', web],
    ] as const) {
      github.addRepository(['meridian', name])
      git(place.working, 'checkout', '-q', '-b', 'fix-it')
      writeFileSync(join(place.working, 'fix.txt'), 'The change.\n')
      git(place.working, 'add', 'fix.txt')
      git(place.working, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'The change')
      git(place.working, 'push', '-q', place.bare, 'fix-it')
      github.addPullRequest({
        path: ['meridian', name],
        title: 'Fix it',
        author: 'you',
        source: 'fix-it',
        headSha: git(place.working, 'rev-parse', 'HEAD'),
      })
      git(place.working, 'checkout', '-q', 'main')
    }
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const projects = yield* Projects
      const changes = yield* Changes
      const mergeReviews = yield* MergeReviews
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* projects.open({
        envelope: yield* Runtime.envelope('project.open', {}),
        path: api.working,
        repositories: [api.working, web.working],
      })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Fix both',
        repositories: (yield* projects.repositories(project.projectId)).map((one) => one.name),
      })
      yield* (yield* Plans).propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [
          { key: 'implement', agentId: 'codex', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        reviewAfterMerge: true,
        reason: null,
        actorId: instance.personId,
        held: true,
      })
      for (const pull of github.changes)
        yield* changes.attach({
          taskId: task.taskId,
          pullRequest: pull.url.replace('https://github.com', HOST),
          start: true,
          actorId: instance.personId,
        })
      // The most recently attached repository merged; api still has an open current change.
      github.mergeByHand(2)
      const mergedSibling = github.changes[1] ?? assert.fail('no web pull request')
      yield* until(
        Effect.gen(function* () {
          yield* changes.refresh(task.taskId)
          return yield* sql<{ state: string }>`SELECT json_extract(snapshot, '$.state') AS state
            FROM external_links WHERE task_id = ${task.taskId} AND url = ${mergedSibling.url}`
        }),
        (rows) => rows[0]?.state === 'merged',
      )
      yield* mergeReviews.merged(task.taskId, mergedSibling.url)
      const oldDebts = yield* sql<{ head: string | null; reviewer: string | null }>`
        SELECT head, reviewer FROM merge_reviews WHERE url = ${mergedSibling.url}`
      const oldDebt = oldDebts[0] ?? assert.fail('no saved sibling review')
      assert.isNotNull(oldDebt.head)
      // The older owed review already saved its merged head and rule; a future choice cannot rewrite it.
      assert.strictEqual((yield* mergeReviews.choose(task.taskId, 'none', instance.personId)).holds, 'none')
      assert.deepStrictEqual(yield* sql`SELECT head, reviewer FROM merge_reviews WHERE url = ${mergedSibling.url}`, [oldDebt])
      // A new open web sibling is mutable, but changing the task-wide rule must not alter api's pre-merge debt.
      git(web.working, 'checkout', '-q', '-b', 'fix-more')
      writeFileSync(join(web.working, 'more.txt'), 'Another change.\n')
      git(web.working, 'add', 'more.txt')
      git(web.working, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'commit', '-q', '-m', 'Another change')
      git(web.working, 'push', '-q', web.bare, 'fix-more')
      const next = github.addPullRequest({
        path: ['meridian', 'web'],
        title: 'Fix more',
        author: 'you',
        source: 'fix-more',
        headSha: git(web.working, 'rev-parse', 'HEAD'),
      })
      yield* changes.attach({
        taskId: task.taskId,
        pullRequest: next.url.replace('https://github.com', HOST),
        start: true,
        actorId: instance.personId,
      })
      assert.strictEqual((yield* mergeReviews.choose(task.taskId, 'review', instance.personId)).holds, 'major')
      const apiPull = github.changes[0] ?? assert.fail('no api pull request')
      // Merge now saves debt even while the host is still processing its merge. That current choice stays fixed.
      yield* mergeReviews.owe(task.taskId, apiPull.url, {})
      const saved = yield* sql`SELECT * FROM merge_reviews WHERE url = ${apiPull.url}`
      assert.strictEqual(saved[0]?.state, 'owed')
      assert.include(String(yield* Effect.flip(mergeReviews.choose(task.taskId, 'none', instance.personId))), 'waiting to merge')
      const beforeTiming = yield* sql`SELECT parameters FROM task_plans WHERE task_id = ${task.taskId}`
      assert.include(
        String(
          yield* Effect.flip(
            (yield* Runs).reshape({
              taskId: task.taskId,
              afterMerge: { key: 'review', agentId: 'codex', model: null, skipped: true },
              actorId: instance.personId,
            }),
          ),
        ),
        'waiting to merge',
      )
      assert.deepStrictEqual(yield* sql`SELECT parameters FROM task_plans WHERE task_id = ${task.taskId}`, beforeTiming)
      assert.deepStrictEqual(yield* sql`SELECT * FROM merge_reviews WHERE url = ${apiPull.url}`, saved)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('by its lead’s tool, a small change drops its review under Everything, then goes back to the rule, saying what holds', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* smallChange(working, '[review:findings]', 'all')
      const [session] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const lead: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: session?.id ?? '',
        taskId: task.taskId,
      }
      const dropped = yield* callTool(lead, 'review_after_merge', { review: 'none' })
      assert.include(dropped, 'it isn’t reviewed after it merges')
      assert.notInclude(dropped, 'as the project’s rule says')
      assert.deepStrictEqual((yield* smallCardOf(task.threadId)).afterMerge, { project: 'all', task: 'none', holds: 'none' })
      const back = yield* callTool(lead, 'review_after_merge', { review: 'project' })
      assert.include(back, 'requested after-merge reviews follow the project’s rule: any finding comes back')
      assert.deepStrictEqual((yield* smallCardOf(task.threadId)).afterMerge, { project: 'all', task: null, holds: 'all' })
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.effect('a task there is no record of goes by the rule new projects start with', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* afterMergeNow('task_nobody'), { project: 'major', task: null, holds: 'major' })
    }).pipe(Effect.provide(runtimeWith(onGitHub().github))),
  )

  it.live('one small change drops its review where the rule has one; project goes back to the rule', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const instance = yield* Instance
      const mergeReviews = yield* MergeReviews
      const task = yield* smallChange(working, '[review:findings]')
      assert.deepStrictEqual(yield* mergeReviews.choose(task.taskId, 'none', instance.personId), {
        project: 'major',
        task: 'none',
        holds: 'none',
      })
      assert.deepStrictEqual((yield* mergeReviews.choose(task.taskId, null, instance.personId)).holds, 'major')
      yield* mergeReviews.choose(task.taskId, 'none', instance.personId)
      assert.deepStrictEqual((yield* smallCardOf(task.threadId)).skips, ['no plan', 'no review'])
      yield* mergeIt(bare, github, task.taskId)
      yield* settled(task.taskId)
      yield* (yield* FastLane).retryPendingReviews()
      assert.isUndefined(yield* reviewOf(task.url))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
