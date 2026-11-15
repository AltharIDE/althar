import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { FastLane } from '../src/fastLane'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { savePreset } from '../src/presets'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { PlanParameters, Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { smallChangeSteps } from '../src/smallChange'
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
const BRANCH = 'althar/fix-the-run-menu'
const cards = (projectId: string) =>
  Effect.flatMap(Queries, (queries) =>
    Effect.map(queries.coordinator(projectId), (view) => view.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))),
  )
const planOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [plan] = yield* sql<{
      parameters: string
    }>`SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan?.parameters ?? '')
  })

const onHost = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  const held = holds()
  const layer = Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', { holds: held }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )
  return { working, bare, github, held, layer }
}

const projectAt = (working: string) =>
  Effect.gen(function* () {
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: (yield* Instance).personId, webUrl: HOST })
    return yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
  })
const merged = (bare: string, github: ReturnType<typeof makeFakeService>, taskId: string) =>
  Effect.gen(function* () {
    const clone = mkdtempSync(join(tmpdir(), 'althar-small-merge-'))
    execFileSync('git', ['clone', '-q', bare, clone])
    git(clone, 'merge', '-q', '--squash', `origin/${BRANCH}`)
    git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'commit', '-q', '-m', 'Squashed task')
    git(clone, 'push', '-q', 'origin', 'main')
    github.mergeByHand(1)
    yield* (yield* Changes).refresh(taskId)
  })
const debtOf = (taskId: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ state: string }>`SELECT state FROM merge_reviews WHERE task_id = ${taskId}`)

const proposedSmall = (working: string, small = true) =>
  Effect.gen(function* () {
    const project = yield* projectAt(working)
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const access = { role: 'coordinator' as const, projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
    const drafted = yield* callTool(access, 'draft_task', {
      title: 'Fix the Run menu',
      description: 'Correct the label. [lead:finish] [lead:edit] [review:slowly]',
    })
    assert.include(drafted, 'Drafted', drafted)
    const reply = yield* callTool(access, 'propose_plan', {
      task: 'fix-the-run-menu',
      lead: { agent: 'claude-code' },
      review: { agent: 'codex' },
      small_change: small,
      preset: small ? 'Small change' : 'Change',
    })
    assert.include(reply, 'Planned', reply)
    const [card] = yield* until(cards(project.projectId), (all) => all[0]?.taskId !== undefined)
    return { projectId: project.projectId, taskId: card?.taskId ?? '', threadId: card?.threadId ?? '', reply }
  })

describe('size does not choose after-merge review', () => {
  it.live('runs a Small change’s configured review before its first publication, and creates no review debt after merge', () => {
    const { working, bare, github, held, layer } = onHost()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* proposedSmall(working)
      yield* until(
        sql<{
          state: string
        }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      const plan = yield* planOf(task.taskId)
      assert.isTrue(plan.smallChange)
      assert.isUndefined(plan.reviewAfterMerge)
      assert.isFalse(plan.steps.find((step) => step.key === 'review')?.skipped)
      assert.include(task.reply, 'before it ships')
      assert.notInclude(task.reply, 'review_after_merge')
      assert.lengthOf(github.changes, 0)
      const thread = yield* (yield* Queries).thread(task.threadId)
      const small = thread.items.find((item) => item.kind === 'small_change')
      assert.strictEqual(small?.kind === 'small_change' ? small.content.reviewAfterMerge : undefined, false)
      held.open('[review:slowly]')
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      yield* merged(bare, github, task.taskId)
      yield* (yield* FastLane).retryPendingReviews()
      assert.deepStrictEqual(yield* debtOf(task.taskId), [])
    }).pipe(Effect.provide(layer))
  })

  for (const small of [true, false]) {
    it.live(
      `keeps an explicit after-merge request for a ${small ? 'Small change' : 'normal task'} while its before-Ship review runs`,
      () => {
        const { working, bare, github, layer } = onHost()
        return Effect.gen(function* () {
          const task = yield* proposedSmall(working, small)
          const sql = yield* SqlClient.SqlClient
          yield* until(
            sql<{
              state: string
            }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND n.node_key = 'review'`,
            (rows) => rows[0]?.state === 'running',
          )
          const chosen = yield* (yield* Runs).setReviewAfterMerge({
            taskId: task.taskId,
            review: 'review',
            actorId: (yield* Instance).personId,
          })
          assert.strictEqual(chosen.task, 'review')
          assert.isTrue((yield* planOf(task.taskId)).reviewAfterMerge)
          if (!small) {
            assert.strictEqual((yield* planOf(task.taskId)).smallChange, false)
            assert.isFalse((yield* (yield* Queries).thread(task.threadId)).items.some((item) => item.kind === 'small_change'))
          }
          yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
          yield* merged(bare, github, task.taskId)
          yield* until(debtOf(task.taskId), (rows) => rows[0]?.state === 'running')
        }).pipe(Effect.provide(layer))
      },
    )
  }

  it.live('keeps a custom Quick fix preset’s explicit after-merge timing', () => {
    const { working, bare, github, layer } = onHost()
    return Effect.gen(function* () {
      const project = yield* projectAt(working)
      const instance = yield* Instance
      const task = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Fix the Run menu',
        description: 'Fix it. [lead:finish] [lead:edit] [review:wait]',
        draft: true,
      })
      const plans = yield* Plans
      const planId = yield* plans.propose({
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
        taskId: task.taskId,
        steps: smallChangeSteps({ lead: { agentId: 'claude-code', model: null }, review: { agentId: 'codex', model: null } }),
        reason: null,
        actorId: instance.personId,
        end: 'draft',
        smallChange: true,
        held: true,
      })
      const preset = yield* savePreset({
        name: 'Quick fix',
        parts: { workspace: 'worktree', checked: 'after', end: 'draft', shelf: 'board', lead: null, reviewer: null, brief: '' },
        projectId: null,
        fromTaskId: null,
        actorId: instance.personId,
      })
      yield* plans.applyPreset(planId, preset.name, instance.personId)
      yield* plans.start(planId, instance.personId)
      yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const plan = yield* planOf(task.taskId)
      assert.isTrue(plan.reviewAfterMerge)
      assert.strictEqual(plan.smallChange, false)
      assert.isFalse((yield* (yield* Queries).thread(task.threadId)).items.some((item) => item.kind === 'small_change'))
      yield* merged(bare, github, task.taskId)
      yield* until(debtOf(task.taskId), (rows) => rows[0]?.state === 'running')
    }).pipe(Effect.provide(layer))
  })

  it.live('keeps a skipped Small-change pass visibly skipped after publication and merge', () => {
    const { working, bare, github, layer } = onHost()
    return Effect.gen(function* () {
      const task = yield* proposedSmall(working)
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{
          state: string
        }>`SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      yield* (yield* Runs).skipReview({ taskId: task.taskId, envelope: yield* Runtime.envelope('task.skip_review', {}) })
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      const status = Effect.gen(function* () {
        const thread = yield* (yield* Queries).thread(task.threadId)
        const card = thread.items.find((item) => item.kind === 'small_change')
        return card?.kind === 'small_change' ? card.content.steps.find((step) => step.key === 'review') : undefined
      })
      const skipped = yield* status
      assert.strictEqual(skipped?.what, 'Review skipped')
      assert.strictEqual(skipped?.done, false)
      assert.isNotNull(skipped?.at)
      yield* merged(bare, github, task.taskId)
      assert.deepStrictEqual(yield* status, skipped)
      assert.deepStrictEqual(yield* debtOf(task.taskId), [])
    }).pipe(Effect.provide(layer))
  })
})
