import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { FastLane } from '../src/fastLane'
import { Ids, newId } from '@althar/domain'
import { Instance } from '../src/Instance'
import { lighterOf, MOVE_AT, planName, usedPercent, windowWords } from '../src/modelMoves'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { changedWords, smallChangeOf, smallChangeSkips, smallChangeSteps } from '../src/smallChange'
import { addItem } from '../src/threads'
import * as Runtime from '../src/Runtime'
import { repository, runtime } from './support'

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
    assert.deepStrictEqual(smallChangeSkips(steps[1] ?? null), ['no plan', 'reviewed after it merges'])
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
      assert.deepStrictEqual(card.content.skips, ['no plan', 'reviewed after it merges'])
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
        from: { agentId: 'claude-code', model: 'claude-opus-5' },
        to: { agentId: 'claude-code', model: 'claude-sonnet-5' },
        why: { percent: 92, plan: 'Claude', window: 'the week', resetsAt: '2026-11-12T09:00:00.000Z' },
        kept: false,
      })
      const fastLane = yield* FastLane
      yield* fastLane.keepTheModel(itemId)
      const [kept] = yield* sql<{ agentId: string; model: string }>`
        SELECT agent_id AS agentId, model FROM task_model_keeps WHERE task_id = ${created.taskId}`
      assert.deepStrictEqual(kept, { agentId: 'claude-code', model: 'claude-opus-5' })
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
    assert.strictEqual(planName('claude-code'), 'Claude')
    assert.strictEqual(planName('codex'), 'ChatGPT')
  })
})
