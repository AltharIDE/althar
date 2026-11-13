import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { FastLane } from '../src/fastLane'
import { Ids, newId } from '@althar/domain'
import { Instance } from '../src/Instance'
import { AutoModels, lighterOf, MOVE_AT, planName, usedPercent, windowWords } from '../src/modelMoves'
import { Models } from '../src/Models'
import { PlanUsage } from '../src/PlanUsage'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { changedWords, smallChangeOf, smallChangeSkips, smallChangeSteps } from '../src/smallChange'
import { addItem } from '../src/threads'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/** The fast lane (README section 6): a change of a few lines, its plan and the card its thread shows. */
describe('a small change', () => {
  it('plans one step, names who reviews it, and skips that review until it merges', () => {
    const steps = smallChangeSteps({
      lead: { agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'low' },
      review: { agentId: 'codex', model: 'gpt-6-sol' },
    })
    assert.deepStrictEqual(steps, [
      { key: 'implement', agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'low', skipped: false },
      { key: 'review', agentId: 'codex', model: 'gpt-6-sol', skipped: true },
    ])
    // As the project's rule says: Major only by default, Everything, or no review after the merge.
    assert.deepStrictEqual(smallChangeSkips(steps[1] ?? null), ['no plan', 'reviewed after it merges, major findings only'])
    assert.deepStrictEqual(smallChangeSkips(steps[1] ?? null, 'all'), ['no plan', 'reviewed after it merges'])
    assert.deepStrictEqual(smallChangeSkips(steps[1] ?? null, 'none'), ['no plan', 'no review'])
    assert.deepStrictEqual(smallChangeSkips(null, 'major'), ['no plan'])
  })

  it('reads a small change from its plan, and nothing else as one', () => {
    const small = JSON.stringify({
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'claude-sonnet-5', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: true },
      ],
      reviewAfterMerge: true,
    })
    assert.deepStrictEqual(smallChangeOf(small)?.implement.model, 'claude-sonnet-5')
    assert.strictEqual(smallChangeOf(small)?.review?.agentId, 'codex')
    // A plan without the review after the merge is an ordinary one, however few its steps.
    assert.isUndefined(smallChangeOf(JSON.stringify({ steps: [{ key: 'implement', agentId: 'codex', skipped: false }] })))
    assert.isUndefined(smallChangeOf('not json'))
    assert.isUndefined(smallChangeOf(null))
  })

  it('says what changed in a line: one file by its line count, several by their count', () => {
    assert.strictEqual(
      changedWords({
        files: [{ path: 'RunMenu.tsx', add: 1, del: 0 }],
        additions: 1,
        deletions: 0,
        changedFiles: 1,
      }),
      '1 line in RunMenu.tsx',
    )
    assert.strictEqual(changedWords({ files: [], additions: 12, deletions: 4, changedFiles: 3 }), '3 files')
    assert.strictEqual(changedWords({ files: [], additions: 2, deletions: 1, changedFiles: 1 }), '3 lines')
  })

  it.effect('opens its thread with a card saying what it skipped, its lead, and its steps with their times', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'The Run menu says Strat',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: smallChangeSteps({
          lead: { agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'low' },
          review: { agentId: 'codex', model: 'gpt-6-sol' },
        }),
        reason: null,
        actorId: instance.personId,
        reviewAfterMerge: true,
        startsIn: Duration.zero,
      })
      const thread = yield* (yield* Queries).thread(created.threadId, { limit: 50 })
      const card = thread.items.find((item) => item.kind === 'small_change')
      assert.isDefined(card)
      if (card?.kind !== 'small_change') return
      assert.strictEqual(card.content.title, 'The Run menu says Strat')
      assert.deepStrictEqual(card.content.skips, ['no plan', 'reviewed after it merges, major findings only'])
      assert.deepStrictEqual(card.content.lead, { agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'low' })
      assert.deepStrictEqual(
        card.content.steps.map((step) => [step.key, step.done]),
        [
          ['started', true],
          ['changed', false],
          ['checks', false],
          ['merged', false],
        ],
      )
      assert.isNotNull(card.content.steps[0]?.at)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.effect('reads its steps from what happened: the report, the checks, the merge and the review it started', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'The Run menu says Strat',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: smallChangeSteps({
          lead: { agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'low' },
          review: { agentId: 'codex', model: 'gpt-6-sol' },
        }),
        reason: null,
        actorId: instance.personId,
        reviewAfterMerge: true,
        startsIn: Duration.zero,
      })
      const at = '2026-11-06T14:03:00.000Z'
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'step_result', {
        step: 'implement',
        round: 0,
        summary: 'The menu says Start.',
      })
      const url = 'https://github.test/meridian/api/pull/641'
      const snapshot = {
        number: 641,
        title: 'The Run menu says Strat',
        url,
        state: 'merged',
        draft: false,
        headSha: 'abcdef',
        additions: 1,
        deletions: 1,
        changedFiles: 1,
        repository: ['meridian', 'api'],
        words: { noun: 'pull request', short: 'PR', prefix: '#' },
        checks: { sha: 'abcdef', outcome: 'passed', passed: 1, failed: 0, running: 0, total: 1, failing: [] },
      }
      const linkId = yield* newId(Ids.externalLink)
      yield* sql`
        INSERT INTO external_links ${sql.insert({
          id: linkId,
          projectId: project.projectId,
          taskId: created.taskId,
          product: 'github',
          kind: 'change',
          externalId: '641',
          ref: 'PR #641',
          key: '641',
          url,
          snapshot: JSON.stringify(snapshot),
          listening: 0,
          createdAt: at,
          updatedAt: at,
        })}`
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'arrival', {
        source: 'github',
        kind: 'checks',
        from: null,
        where: 'PR #641',
        url,
        passed: 1,
        failed: 0,
      })
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'arrival', {
        source: 'github',
        kind: 'merged',
        from: null,
        where: 'PR #641',
        url,
      })
      const thread = yield* (yield* Queries).thread(created.threadId, { limit: 50 })
      const card = thread.items.find((item) => item.kind === 'small_change')
      if (card?.kind !== 'small_change') return assert.fail('no card')
      assert.strictEqual(card.content.change?.number, 641)
      assert.deepStrictEqual(
        card.content.steps.map((step) => [step.key, step.what, step.done]),
        [
          ['started', 'Started', true],
          ['changed', 'Changed 2 lines', true],
          ['checks', 'Checks pass', true],
          ['merged', 'Merged', true],
        ],
      )
      assert.isString(card.content.steps[1]?.at)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})

/** Auto's move as the person answers it: the model they keep, which Auto keeps to, and Undo. */
describe('keeping the model Auto moved from', () => {
  it.effect('records the keep for the task, and Undo takes it back', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'The Run menu says Strat',
        draft: true,
      })
      const itemId = yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'model_move', {
        taskId: created.taskId,
        from: { agentId: 'claude-code', model: 'large' },
        to: { agentId: 'claude-code', model: 'small' },
        why: { percent: 92, plan: 'Claude', window: 'the week', resetsAt: '2026-11-12T09:00:00.000Z' },
        kept: false,
      })
      // Its lead is on the lighter model Auto moved it to, in a turn of its own.
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code', model: 'small' })
      const fastLane = yield* FastLane
      yield* fastLane.keepTheModel(itemId)
      const [kept] = yield* sql<{ agentId: string; model: string }>`
        SELECT agent_id AS agentId, model FROM task_model_keeps WHERE task_id = ${created.taskId}`
      assert.deepStrictEqual(kept, { agentId: 'claude-code', model: 'large' })
      // Keep puts the lead that is running back too, not only the steps after it.
      const [now] = yield* sql<{ model: string | null }>`
        SELECT model FROM provider_sessions WHERE thread_id = ${created.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(now?.model, 'large')
      const afterKeep = yield* (yield* Queries).item(created.threadId, itemId)
      assert.strictEqual(afterKeep.kind === 'model_move' && afterKeep.content.kept, true)
      yield* fastLane.undoTheModelMove(itemId)
      const [gone] = yield* sql<{ one: number }>`SELECT 1 AS one FROM task_model_keeps WHERE task_id = ${created.taskId}`
      assert.isUndefined(gone)
      const afterUndo = yield* (yield* Queries).item(created.threadId, itemId)
      assert.strictEqual(afterUndo.kind === 'model_move' && afterUndo.content.kept, false)
    }).pipe(Effect.provide(FastLane.layer.pipe(Layer.provideMerge(Queries.layer.pipe(Layer.provideMerge(runtime())))))),
  )
})

/** Auto's move to a lighter model (README section 7): the choice, and the words the line says it in. */
describe('Auto’s lighter model', () => {
  const models = [
    { id: 'claude-opus-5', name: 'Opus 5.5', intelligence: 60, blocked: false },
    { id: 'claude-sonnet-5', name: 'Sonnet 5.5', intelligence: 50, blocked: false },
    { id: 'claude-haiku-4', name: 'Haiku 4', intelligence: 35, blocked: false },
    { id: 'claude-nano', name: 'Nano', intelligence: 20, blocked: true },
  ]

  it('takes the best model that scores below the one it planned, never a switched-off one', () => {
    assert.strictEqual(lighterOf({ intelligence: 60 }, models)?.id, 'claude-sonnet-5')
    // Sonnet is the best there is: what is left scores below it, so it is the one to take.
    assert.strictEqual(
      lighterOf(
        { intelligence: 50 },
        models.filter((model) => model.id !== 'claude-sonnet-5'),
      )?.id,
      'claude-haiku-4',
    )
    // Nothing to compare, or the lightest already: no move.
    assert.isUndefined(lighterOf({ intelligence: null }, models))
    assert.isUndefined(lighterOf({ intelligence: 20 }, models))
    assert.isUndefined(
      lighterOf(
        { intelligence: 35 },
        models.filter((model) => model.id !== 'claude-sonnet-5'),
      ),
    )
  })

  it('moves only when the plan is nearly out, and says the share, the window and the reset', () => {
    assert.strictEqual(MOVE_AT, 90)
    assert.strictEqual(usedPercent(8), 92)
    assert.strictEqual(usedPercent(-1), 100)
    assert.strictEqual(windowWords('weekly'), 'the week')
    assert.strictEqual(windowWords('five_hour'), 'five hours')
    assert.strictEqual(windowWords('monthly'), 'the month')
    assert.strictEqual(windowWords('other'), 'the plan')
    assert.strictEqual(planName('claude-code'), 'Claude')
    assert.strictEqual(planName('codex'), 'ChatGPT')
    assert.strictEqual(planName('aider'), 'aider')
  })

  it.live('moves a lead whose session is still running when its plan crosses the mark, and says why once', () => {
    // A day from now, whenever it runs: a reset already past is a plan with its week back, and nothing moves.
    const resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const cache = join(mkdtempSync(join(tmpdir(), 'althar-facts-')), 'models.json')
    writeFileSync(
      cache,
      JSON.stringify({
        data: [
          { id: 'fake/large', benchmarks: { artificial_analysis: { intelligence_index: 60 } } },
          { id: 'fake/small', benchmarks: { artificial_analysis: { intelligence_index: 40 } } },
        ],
      }),
    )
    return Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const when = '2026-11-06T14:03:00.000Z'
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'The Run menu says Strat',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: 'large', skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        reason: null,
        actorId: instance.personId,
        reviewAfterMerge: false,
        // Held long enough that the countdown can't start it before the test does.
        startsIn: Duration.hours(1),
      })
      // Its lead is already on it, on the plan's model, as a step under way leaves it.
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code', model: 'large' })
      // What it is on is known, and the plan is read as 92% used, before the step begins on the session already there.
      const catalog = yield* Models
      yield* until(
        Effect.map(catalog.catalog, (all) => all.find((one) => one.agentId === 'claude-code')),
        (one) => one !== undefined && one.probing === false,
      )
      yield* (yield* PlanUsage).now(true)
      yield* plans.start(planId, instance.personId)
      const [moved] = yield* until(
        Effect.map((yield* Queries).thread(created.threadId, { limit: 50 }), (thread) =>
          thread.items.filter((item) => item.kind === 'model_move'),
        ),
        (rows) => rows.length === 1,
      )
      assert.deepInclude(moved?.content, {
        from: { agentId: 'claude-code', model: 'large' },
        to: { agentId: 'claude-code', model: 'small' },
        why: { percent: 92, plan: 'Claude', window: 'the week', resetsAt },
        kept: false,
      })
      const [now] = yield* sql<{ model: string | null }>`
        SELECT model FROM provider_sessions WHERE thread_id = ${created.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(now?.model, 'small')
      // A step after it on the same two models says nothing new.
      const again = yield* (yield* Queries).thread(created.threadId, { limit: 50 })
      assert.lengthOf(
        again.items.filter((item) => item.kind === 'model_move'),
        1,
      )
      const auto = yield* AutoModels
      const where = {
        taskId: created.taskId,
        projectId: project.projectId as ProjectId,
        threadId: created.threadId,
        agentId: 'claude-code',
      }
      // Nothing to move from or to, and no lighter model there is: it stays.
      assert.isUndefined(yield* auto.lighter({ ...where, model: null }))
      assert.isUndefined(yield* auto.lighter({ ...where, agentId: 'nowhere', model: 'large' }))
      assert.isUndefined(yield* auto.lighter({ ...where, model: 'huge' }))
      assert.isUndefined(yield* auto.lighter({ ...where, model: 'small' }))
      // The person kept the model: no move, even with the plan nearly out.
      yield* sql`
        INSERT INTO task_model_keeps ${sql.insert({ taskId: created.taskId, agentId: 'claude-code', model: 'large', keptAt: when })}`
      assert.isUndefined(yield* auto.lighter({ ...where, model: 'large' }))
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              {
                modelFacts: { url: 'https://openrouter.test/models', cache, fetch: async () => Response.json({ data: [] }) },
                usage: {
                  every: Duration.zero,
                  kept: Duration.zero,
                  readEndpoint: async (sourceId) =>
                    sourceId === 'claude-oauth'
                      ? {
                          kind: 'usage',
                          stale: false,
                          usage: {
                            windows: [{ kind: 'weekly', usedPercent: 92, resetsAt }],
                            source: 'endpoint',
                            observedAt: new Date().toISOString(),
                          },
                        }
                      : { kind: 'none' },
                },
              },
            ),
          ),
        ),
      ),
    )
  })
})

/** The fast lane's refusals, and what a line or a plan that says nothing does. */
describe('the fast lane at its edges', () => {
  const layer = FastLane.layer.pipe(Layer.provideMerge(Queries.layer.pipe(Layer.provideMerge(runtime()))))
  const reasonOf = (error: unknown) =>
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : ''

  it.effect('refuses a line that isn’t there or names no model, and Undo on a line of no task', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const fastLane = yield* FastLane
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'The Run menu says Strat',
        draft: true,
      })
      const place = { projectId: project.projectId as ProjectId, threadId: created.threadId }
      const why = { percent: 92, plan: 'Claude', window: 'the week', resetsAt: null }
      assert.include(reasonOf(yield* Effect.flip(fastLane.keepTheModel('item_missing'))), 'isn’t here any more')
      // A line whose content Althar can't read as an object is no line either.
      const odd = yield* addItem(place, 'model_move', 'x')
      assert.include(reasonOf(yield* Effect.flip(fastLane.keepTheModel(odd))), 'isn’t here any more')
      // A line that names no model to keep.
      const bare = yield* addItem(place, 'model_move', { taskId: created.taskId, from: {}, to: {}, why, kept: false })
      assert.include(reasonOf(yield* Effect.flip(fastLane.keepTheModel(bare))), 'names no model to keep')
      // Undo on a line of no task puts the line back and leaves the keeps alone.
      const noTask = yield* addItem(place, 'model_move', { from: {}, to: {}, why, kept: true })
      yield* fastLane.undoTheModelMove(noTask)
      const [after] = yield* sql<{ kept: number }>`
        SELECT json_extract(content, '$.kept') AS kept FROM thread_items WHERE id = ${noTask}`
      assert.strictEqual(after?.kept, 0)
      assert.include(reasonOf(yield* Effect.flip(fastLane.undoTheModelMove('item_missing'))), 'isn’t here any more')
    }).pipe(Effect.provide(layer)),
  )

  it.effect('refuses a review its plan can’t name, and one with no change to read; a reviewed change starts nothing', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const fastLane = yield* FastLane
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const make = (title: string) =>
        Effect.gen(function* () {
          return yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title,
            draft: true,
          })
        })
      const planned = (taskId: string, review: boolean) =>
        plans.propose({
          projectId: project.projectId as ProjectId,
          taskId,
          steps: smallChangeSteps({
            lead: { agentId: 'claude-code', model: null },
            review: review ? { agentId: 'codex', model: null } : null,
          }),
          reason: null,
          actorId: instance.personId,
          reviewAfterMerge: true,
          startsIn: Duration.hours(1),
        })
      // No plan at all, and a plan with no review step.
      const bare = yield* make('No plan')
      assert.include(reasonOf(yield* Effect.flip(fastLane.makeFullTask(bare.taskId))), 'names no reviewer')
      const noReviewer = yield* make('No reviewer')
      yield* planned(noReviewer.taskId, false)
      assert.include(reasonOf(yield* Effect.flip(fastLane.makeFullTask(noReviewer.taskId))), 'names no reviewer')
      // A reviewer, but no pull request to read.
      const noChange = yield* make('No change')
      yield* planned(noChange.taskId, true)
      assert.include(reasonOf(yield* Effect.flip(fastLane.makeFullTask(noChange.taskId))), 'no pull request to review yet')
      // A change already reviewed: nothing starts again.
      const reviewed = yield* make('Reviewed')
      yield* planned(reviewed.taskId, true)
      const url = 'https://github.test/meridian/api/pull/641'
      const when = '2026-11-06T14:03:00.000Z'
      const link = (kind: 'change' | 'review', state: string) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO external_links ${sql.insert({
              id: yield* newId(Ids.externalLink),
              projectId: project.projectId,
              taskId: reviewed.taskId,
              product: 'github',
              kind,
              externalId: '641',
              ref: 'PR #641',
              key: '641',
              url,
              snapshot: JSON.stringify({ state }),
              listening: 0,
              createdAt: when,
              updatedAt: when,
            })}`
        })
      yield* link('change', 'open')
      yield* link('review', 'open')
      yield* fastLane.makeFullTask(reviewed.taskId)
      const [made] = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM external_links WHERE kind = 'review' AND url = ${url}`
      assert.strictEqual(made?.n, 1)
      // As the host keeps it, for the card to read.
      const kept = (state: string) => JSON.stringify({ state, number: 641, url, title: 'Reviewed' })
      yield* sql`UPDATE external_links SET snapshot = ${kept('open')} WHERE kind = 'change' AND url = ${url}`

      // Its card reads the full task's review: reading, then what its draft says, kept once the change merges.
      const cardOf = Effect.gen(function* () {
        const thread = yield* (yield* Queries).thread(reviewed.threadId, { limit: 50 })
        const card = thread.items.find((item) => item.kind === 'small_change')
        return card?.kind === 'small_change' ? card.content : assert.fail('no small change card')
      })
      assert.strictEqual((yield* cardOf).fullTask?.taskId, reviewed.taskId)
      assert.deepInclude((yield* cardOf).reviewBefore, { state: 'running', findings: 0 })
      const drafted = (suggested: string, comments: number, sequence: number) =>
        sql`
          INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, content, created_at)
          VALUES (${`item_${String(sequence).padStart(32, '0')}`}, ${project.projectId}, ${reviewed.threadId}, ${sequence}, 'review_draft',
            ${JSON.stringify({ suggested, comments: Array.from({ length: comments }, (_, i) => ({ id: `c${i}` })) })}, ${when})`
      yield* drafted('changes_requested', 2, 900)
      assert.deepInclude((yield* cardOf).reviewBefore, { state: 'found', findings: 2 })
      yield* drafted('approved', 0, 901)
      assert.deepInclude((yield* cardOf).reviewBefore, { state: 'clear', findings: 0 })
      yield* sql`UPDATE external_links SET snapshot = ${kept('merged')} WHERE kind = 'change' AND url = ${url}`
      const merged = yield* cardOf
      assert.strictEqual(merged.fullTask?.taskId, reviewed.taskId)
      assert.deepInclude(merged.reviewBefore, { state: 'clear' })
    }).pipe(Effect.provide(layer)),
  )

  it.effect('owes nothing for a task with no reviewer or no change, and a merged one with a reviewer its review', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const fastLane = yield* FastLane
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const make = (title: string, review: boolean) =>
        Effect.gen(function* () {
          const created = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title,
            draft: true,
          })
          yield* plans.propose({
            projectId: project.projectId as ProjectId,
            taskId: created.taskId,
            steps: smallChangeSteps({
              lead: { agentId: 'claude-code', model: null },
              review: review ? { agentId: 'codex', model: null } : null,
            }),
            reason: null,
            actorId: instance.personId,
            reviewAfterMerge: true,
            startsIn: Duration.hours(1),
          })
          return created
        })
      const when = '2026-11-06T14:03:00.000Z'
      const change = (taskId: string, url: string) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO external_links ${sql.insert({
              id: yield* newId(Ids.externalLink),
              projectId: project.projectId,
              taskId,
              product: 'github',
              kind: 'change',
              externalId: '641',
              ref: 'PR #641',
              key: '641',
              url,
              snapshot: JSON.stringify({ state: 'merged' }),
              listening: 0,
              createdAt: when,
              updatedAt: when,
            })}`
        })
      const owed = (taskId: string) =>
        Effect.map(sql<{ n: number }>`SELECT count(*) AS n FROM merge_reviews WHERE task_id = ${taskId}`, ([row]) => row?.n)
      // No reviewer to start one.
      const noReviewer = yield* make('No reviewer', false)
      yield* change(noReviewer.taskId, 'https://github.test/meridian/api/pull/1')
      yield* fastLane.reviewMerged(noReviewer.taskId, 'https://github.test/meridian/api/pull/1')
      assert.strictEqual(yield* owed(noReviewer.taskId), 0)
      // A reviewer, but no change to read.
      const noChange = yield* make('No change', true)
      yield* fastLane.reviewMerged(noChange.taskId, 'https://github.test/meridian/api/pull/3')
      assert.strictEqual(yield* owed(noChange.taskId), 0)
      // Already reviewed: nothing is owed.
      const reviewed = yield* make('Reviewed', true)
      const url = 'https://github.test/meridian/api/pull/2'
      yield* change(reviewed.taskId, url)
      yield* sql`
        INSERT INTO external_links ${sql.insert({
          id: yield* newId(Ids.externalLink),
          projectId: project.projectId,
          taskId: reviewed.taskId,
          product: 'github',
          kind: 'review',
          externalId: '2',
          ref: 'PR #2',
          key: '2',
          url,
          snapshot: JSON.stringify({ state: 'open' }),
          listening: 0,
          createdAt: when,
          updatedAt: when,
        })}`
      yield* fastLane.reviewMerged(reviewed.taskId, url)
      assert.strictEqual(yield* owed(reviewed.taskId), 0)
      // A merged small change with a reviewer and no review yet: owed, in the task itself, not a review task of its own.
      const merged = yield* make('Merged', true)
      const mergedUrl = 'https://github.test/meridian/api/pull/4'
      yield* change(merged.taskId, mergedUrl)
      yield* fastLane.reviewMerged(merged.taskId, mergedUrl)
      assert.strictEqual(yield* owed(merged.taskId), 1)
    }).pipe(Effect.provide(layer)),
  )

  it('reads only a plan that implements something, and leaves a review out where none names one', () => {
    const lead = { key: 'implement', agentId: 'claude-code', model: null, skipped: false }
    const noReview = JSON.stringify({ steps: [lead], reviewAfterMerge: true })
    assert.deepStrictEqual(smallChangeOf(noReview)?.review, null)
    // A skipped implement has nothing to run.
    assert.isUndefined(smallChangeOf(JSON.stringify({ steps: [{ ...lead, skipped: true }], reviewAfterMerge: true })))
    // No reviewer: one step, and no line about a review after the merge.
    assert.deepStrictEqual(
      smallChangeSteps({ lead: { agentId: 'claude-code', model: null }, review: null }).map((step) => step.key),
      ['implement'],
    )
    assert.deepStrictEqual(smallChangeSkips(null), ['no plan'])
  })

  it('says what changed from the pull request’s numbers where the lead left none', () => {
    assert.strictEqual(
      changedWords({ files: [{ path: 'a.ts', add: 1, del: 0 }], additions: null, deletions: null, changedFiles: 1 }),
      'A file in a.ts',
    )
    assert.strictEqual(changedWords({ files: [], additions: null, deletions: null, changedFiles: null }), 'the code')
    assert.strictEqual(changedWords({ files: [], additions: 2, deletions: null, changedFiles: 1 }), '2 lines')
  })
})
