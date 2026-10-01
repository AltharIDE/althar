import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { scenarios } from '@charrette/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from '../src/Config'
import { Coordinator, CoordinatorUnavailable } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * The coordinator loop (docs/plans/mvp.md): the person asks the coordinator,
 * it drafts and plans a task, the plan starts when its time comes, the lead
 * implements, another agent reviews, the lead settles, the review looks
 * again, and the task is ready. The fake agent plays each role from markers
 * in what it is told.
 */

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId, threadId: yield* coordinator.thread(project.projectId) }
})

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
  })

const cardsOf = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const pick = (record: Record<string, unknown>, keys: ReadonlyArray<string>) => Object.fromEntries(keys.map((key) => [key, record[key]]))

/** The runtime with the queries screens read, as the API has it. */
const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const results = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence`
    return rows.map((row) => JSON.parse(row.content) as { step: string; verdict?: string; summary: string })
  })

describe('the coordinator loop', () => {
  it.live('plans a task that runs Implement, then Review, settling and reviewing again until it passes', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId } = yield* opened
      yield* say(threadId, 'Add a retry. [coordinator:plan] [lead:finish] [review:findings]')

      // The plan shows as a card, then starts on its own when its time comes.
      const [planned] = yield* until(cardsOf(projectId), (cards) => cards.length === 1)
      assert.strictEqual(planned?.title, 'Add a retry')
      assert.deepStrictEqual(
        planned?.plan?.steps.map((step) => [step.key, step.agentId]),
        [
          ['implement', 'claude-code'],
          ['review', 'codex'],
        ],
      )
      assert.strictEqual(planned?.plan?.reason, 'It knows the code.')
      const [ready] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready', Duration.seconds(30))
      assert.deepStrictEqual([ready?.summary, ready?.lead, ready?.startedAt !== null], ['Fixed the heading.', 'claude-code', true])

      // A turn of the lead's starts and ends the card's work under way, and says so both times: a step reports mid-turn.
      const touches = Effect.map(
        sql<{ revision: number }>`SELECT revision FROM thread_items WHERE kind = 'task' AND thread_id = ${threadId}`,
        (rows) => rows[0]?.revision ?? 0,
      )
      const before = yield* touches
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { body: 'hello' }),
        threadId: ready?.threadId ?? '',
        body: 'hello',
        disposition: 'after_current',
      })
      yield* until(
        Effect.map(touches, (revision) => (revision >= before + 2 ? [revision] : [])),
        (rows) => rows.length === 1,
      )
      assert.strictEqual((yield* cardsOf(projectId))[0]?.phase, 'ready')

      // Implement, a review with a finding, the lead settling it, and a second review that passes.
      const steps = yield* results(ready?.threadId ?? '')
      assert.deepStrictEqual(
        steps.map((step) => [step.step, step.verdict ?? null, step.summary]),
        [
          ['implement', null, 'Did the task.'],
          ['review', 'changes_requested', 'The heading needs fixing.'],
          ['settle', null, 'Fixed the heading.'],
          ['review', 'pass', 'The change holds.'],
        ],
      )
      const nodes = yield* sql<{ nodeKey: string; iteration: number; state: string }>`
        SELECT node_key, iteration, state FROM nodes ORDER BY created_at, iteration`
      assert.deepStrictEqual(
        nodes.map((node) => [node.nodeKey, node.iteration, node.state]),
        [
          ['implement', 0, 'succeeded'],
          ['review', 0, 'succeeded'],
          ['settle', 0, 'succeeded'],
          ['review', 1, 'succeeded'],
        ],
      )
      // The lead said what became of the finding, and the record keeps it with the settling that did it.
      const [finding] = yield* sql<{ severity: string; claim: string; state: string; settled: number }>`
        SELECT severity, claim, state, settled_in_attempt_id IS NOT NULL AS settled FROM findings`
      assert.deepStrictEqual({ ...finding }, { severity: 'major', claim: 'The heading is wrong.', state: 'fixed', settled: 1 })
      const [run] = yield* sql<{ state: string }>`SELECT state FROM runs`
      assert.strictEqual(run?.state, 'succeeded')
      // Each round read a copy of the work as it stood, and the record keeps which code that was; the lead's branch is untouched.
      const snapshots = yield* sql<{ commitSha: string; nodeKey: string }>`
        SELECT s.commit_sha, n.node_key FROM workspace_snapshots s JOIN node_attempts a ON a.id = s.node_attempt_id
        JOIN nodes n ON n.id = a.node_id ORDER BY s.taken_at`
      assert.deepStrictEqual(
        snapshots.map((snapshot) => snapshot.nodeKey),
        ['review', 'review'],
      )
      const [workspace] = yield* sql<{ path: string; baseCommit: string }>`SELECT path, base_commit FROM workspaces`
      const copy = join(dirname(workspace?.path ?? ''), '.review', basename(workspace?.path ?? ''))
      const head = (cwd: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim()
      assert.strictEqual(head(copy), snapshots.at(-1)?.commitSha)
      // Charrette commits nothing on the lead's branch: what is there, the lead committed.
      assert.deepStrictEqual(
        execFileSync('git', ['log', '--format=%an %s', `${workspace?.baseCommit}..HEAD`], { cwd: workspace?.path })
          .toString()
          .trim()
          .split('\n'),
        ['Fake Settle the review'],
      )
      assert.isTrue(existsSync(join(copy, 'settled.txt')))
      // The task was drafted by the coordinator, as the record says.
      const [author] = yield* sql<{ kind: string; agentId: string }>`
        SELECT a.kind, a.agent_id FROM tasks k JOIN actors a ON a.id = k.created_by_actor_id`
      assert.deepStrictEqual({ ...author }, { kind: 'agent', agentId: 'coordinator' })

      // The coordinator reads what came of it.
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.strictEqual(yield* callTool(access, 'list_tasks', {}), '- add-a-retry: Add a retry (ready, led by Fake claude-code)')
      const task = yield* callTool(access, 'read_task', { task: 'add-a-retry' })
      assert.match(task, /Branch \S+, in \S+\./)
      assert.match(task, /review \(changes_requested\): The heading needs fixing\.\n\nsettle: Fixed the heading\./)
      assert.match(yield* callTool(access, 'read_thread', { task: 'add-a-retry' }), /\[review, pass\] The change holds\./)
      assert.match(yield* callTool(access, 'propose_plan', { task: 'add-a-retry', lead: { agent: 'codex' } }), /has started already/)
      assert.match(yield* callTool(access, 'message_lead', { task: 'add-a-retry', message: 'Stop.', now: true }), /^Passed on/)
      // With no step waiting, a lead's summary isn't kept.
      const lead: ToolAccess = {
        role: 'lead',
        projectId,
        threadId: ready?.threadId ?? '',
        sessionId: 'none',
        taskId: ready?.taskId ?? null,
      }
      assert.strictEqual(
        yield* callTool(lead, 'finish_step', { summary: 'Again.' }),
        'No step is waiting on you, so Charrette keeps no summary now.',
      )
      // What the person says to a task goes to its lead, not the coordinator.
      assert.instanceOf(yield* Effect.flip(say(ready?.threadId ?? '', 'Hello')), NotFound)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stops after three rounds for the person, and takes a settling that changes nothing as the last word', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const { projectId, threadId } = yield* opened
      yield* say(threadId, 'Tighten the types. [coordinator:plan] [lead:finish] [review:always]')
      // Out of rounds, with settled changes no review has seen: it needs the person, with the findings still open.
      const [waiting] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'waiting', Duration.seconds(60))
      const [call] = yield* sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE kind = 'stuck'`
      assert.deepStrictEqual(pick(JSON.parse(call?.payload ?? '{}') as Record<string, unknown>, ['step', 'why', 'round', 'open']), {
        step: 'review',
        why: 'round_limit',
        round: 3,
        open: 0,
      })
      // Accepted as it is, it's ready.
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'abandon' },
      })
      const [first] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready', Duration.seconds(10))
      assert.strictEqual(first?.taskId, waiting?.taskId)
      assert.deepStrictEqual(
        (yield* results(first?.threadId ?? '')).map((step) => [step.step, step.verdict ?? null]),
        [
          ['implement', null],
          ['review', 'changes_requested'],
          ['settle', null],
          ['review', 'changes_requested'],
          ['settle', null],
          ['review', 'changes_requested'],
          ['settle', null],
        ],
      )
      // The lead sets the findings aside: nothing changed, so there's nothing new to review.
      yield* say(threadId, 'Rename a file. [coordinator:plan] [lead:finish] [review:findings] [lead:set-aside]')
      const [second] = yield* until(
        cardsOf(projectId),
        (cards) => cards.length === 2 && cards.every((card) => card.phase === 'ready'),
        Duration.seconds(60),
      )
      const later = (yield* cardsOf(projectId)).find((card) => card.taskId !== first?.taskId) ?? second
      assert.deepStrictEqual(
        (yield* results(later?.threadId ?? '')).map((step) => step.step),
        ['implement', 'review', 'settle'],
      )
      const aside = yield* sql<{ state: string; response: string | null }>`
        SELECT f.state, f.response FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
        JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${later?.taskId ?? ''}`
      assert.deepStrictEqual(
        aside.map((row) => [row.state, row.response]),
        [['set_aside', 'It reads as intended.']],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.millis(50) }))),
  )

  it.live("stops the run when its lead can't start, and replaces a plan proposed again", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const { projectId } = yield* opened
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      // A task opened by hand can be planned too.
      const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Nobody to do it' })
      const propose = (agentId: string, model: string | null) =>
        plans.propose({
          projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: task.taskId,
          steps: [{ key: 'implement', agentId, model, skipped: false }],
          reason: null,
          actorId: actor,
        })
      const replaced = yield* propose('codex', 'large')
      const planId = yield* propose('missing', null)
      const states = yield* sql<{ id: string; state: string }>`SELECT id, state FROM task_plans ORDER BY proposed_at`
      assert.deepStrictEqual(
        states.map((plan) => [plan.id, plan.state]),
        [
          [replaced, 'replaced'],
          [planId, 'proposed'],
        ],
      )
      // A plan no longer proposed is past changing, holding or starting.
      yield* plans.change(replaced, [], actor)
      yield* plans.hold(replaced, actor)
      yield* plans.start(replaced, actor)
      assert.strictEqual((yield* cardsOf(projectId)).length, 1)
      // The lead can't start: Implement needs the person, who can hand it to another agent.
      yield* plans.start(planId, actor)
      const [card] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'waiting')
      assert.strictEqual(card?.plan?.steps[0]?.agentId, 'missing')
      const [call] = yield* sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE kind = 'stuck'`
      assert.deepStrictEqual(pick(JSON.parse(call?.payload ?? '{}') as Record<string, unknown>, ['step', 'why', 'agentId']), {
        step: 'implement',
        why: 'failed_to_start',
        agentId: 'missing',
      })
      // Handed to Codex, Implement carries on there.
      const runs = yield* Runs
      const answer = {
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'codex' },
      } as const
      yield* runs.answerStuck(answer)
      const [lead] = yield* until(
        sql<{ agentId: string; state: string }>`
          SELECT s.agent_id, a.state FROM provider_sessions s JOIN node_attempts a ON a.provider_session_id = s.id WHERE s.agent_id = 'codex'`,
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual({ ...lead }, { agentId: 'codex', state: 'running' })
      // Answered once: a second answer finds it closed.
      const closed = yield* Effect.flip(runs.answerStuck(answer))
      assert.strictEqual((closed as { readonly _tag?: string })._tag, 'AttentionClosed')
      // Started again, a plan runs once.
      yield* plans.start(planId, actor)
      yield* runs.run(planId)
      yield* runs.run('pln_missing')
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 1)
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(yield* callTool(coordinator, 'list_tasks'), /nobody-to-do-it: Nobody to do it \(open/)
      assert.instanceOf(yield* Effect.flip(plans.start('pln_missing', actor)), NotFound)
      // A plan with nothing to implement has nothing to run.
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Empty',
        draft: true,
      })
      const empty = yield* plans.propose({
        projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: other.taskId,
        steps: [],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(empty, actor)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 1)
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.minutes(5) }))),
  )

  it.live('starts the lead again to settle, when it had stopped', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const sessions = yield* Sessions
      const { projectId } = yield* opened
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Settle later [lead:finish]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
        taskId: task.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: 'large', effort: 'high', skipped: false },
          { key: 'review', agentId: 'codex', model: null, effort: 'low', skipped: false },
        ],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      // The review is under way (or, as this reviewer never reports on its own, waiting on the person), and the lead has stopped.
      yield* until(
        sql<{ id: string }>`
          SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
          WHERE n.node_key = 'review' AND a.state IN ('running', 'waiting_attention')`,
        (rows) => rows.length === 1,
      )
      yield* sessions.stop(task.threadId)
      yield* until(
        Effect.map(sessions.running(task.threadId), (running) => (running._tag === 'None' ? [running] : [])),
        (rows) => rows.length === 1,
      )
      const reviewer: ToolAccess = { role: 'reviewer', projectId, threadId: 'none', sessionId: 'none', taskId: task.taskId }
      assert.match(
        yield* callTool(reviewer, 'report_review', {
          verdict: 'changes_requested',
          summary: 'One thing.',
          findings: [{ severity: 'minor', claim: 'Say why.' }],
        }),
        /^Charrette has your review\. The lead settles/,
      )
      const [card] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready', Duration.seconds(30))
      assert.deepStrictEqual(
        (yield* results(card?.threadId ?? '')).map((step) => step.step),
        ['implement', 'review', 'settle', 'review'],
      )
      const leads = yield* sql<{ model: string | null; effort: string | null }>`
        SELECT model, effort FROM provider_sessions WHERE thread_id = ${task.threadId}`
      assert.deepStrictEqual(
        leads.map((lead) => [lead.model, lead.effort]),
        [
          ['large', 'high'],
          ['large', 'high'],
        ],
      )
      // Each review ran at the effort the plan gave it.
      const reviewers = yield* sql<{ effort: string | null }>`
        SELECT effort FROM provider_sessions WHERE agent_id = 'codex' AND project_id = ${projectId}`
      assert.isNotEmpty(reviewers)
      assert.isTrue(reviewers.every((reviewer) => reviewer.effort === 'low'))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('holds, changes and starts a plan when the person says', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const { projectId, threadId } = yield* opened
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      yield* say(threadId, 'Something small. [coordinator:plan-no-review] [lead:finish]')
      const [card] = yield* until(cardsOf(projectId), (cards) => cards.length === 1)
      const planId = card?.plan?.id ?? ''
      assert.deepStrictEqual(
        card?.plan?.steps.map((step) => step.key),
        ['implement'],
      )
      yield* plans.hold(planId, actor)
      yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'held')
      yield* plans.change(planId, [{ key: 'implement', agentId: 'codex', model: 'large', skipped: false }], actor)
      const [changed] = yield* cardsOf(projectId)
      assert.strictEqual(changed?.plan?.steps[0]?.agentId, 'codex')
      // Held, it doesn't start on its own.
      yield* Effect.sleep('600 millis')
      assert.strictEqual((yield* cardsOf(projectId))[0]?.phase, 'held')
      // Started twice at once, as when the person presses Start as the countdown ends, it runs once.
      yield* Effect.all([plans.start(planId, actor), plans.start(planId, actor)], { concurrency: 'unbounded' })
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM runs`)[0]?.n, 1)
      const [lead] = yield* until(
        sql<{ agentId: string }>`SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.kind = 'task'`,
        (rows) => rows.length === 1,
      )
      assert.strictEqual(lead?.agentId, 'codex')
      // With no review, the lead's summary makes it ready.
      const [ready] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.summary, 'Did the task.')
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.seconds(30) }))),
  )

  it.live('holds what came due while Charrette was closed', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'charrette-plans-')), 'charrette.sqlite')
      const projectId = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { projectId: id, threadId } = yield* opened
        yield* say(threadId, 'Later. [coordinator:plan]')
        yield* until(cardsOf(id), (cards) => cards.length === 1)
        // As if Charrette had closed before its time came.
        yield* sql`UPDATE task_plans SET starts_at = '2020-01-01T00:00:00.000Z'`
        return id
      }).pipe(Effect.provide(withQueries(file, undefined, { countdown: Duration.minutes(5) })))
      const card = yield* Effect.gen(function* () {
        return yield* cardsOf(projectId)
      }).pipe(Effect.provide(withQueries(file)))
      assert.strictEqual(card[0]?.phase, 'held')
    }),
  )

  it.live("says when the coordinator's agent isn't signed in", () =>
    Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const { projectId, threadId } = yield* opened
      const suggested = yield* coordinator.suggested(projectId)
      assert.deepStrictEqual(
        { ...suggested },
        { agentId: 'claude-code', agentName: 'Fake claude-code', model: null, effort: null, available: false },
      )
      const refused = yield* Effect.flip(say(threadId, 'Hello'))
      assert.instanceOf(refused, CoordinatorUnavailable)
    }).pipe(Effect.provide(withQueries(undefined, undefined, { signedOut: ['claude-code'] }))),
  )
})

/** A task planned by hand and started: its lead, and a review when given one. */
const planned = (title: string, description: string, steps: ReadonlyArray<{ key: 'implement' | 'review'; agentId: string }>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plans = yield* Plans
    const projects = yield* Projects
    const { projectId } = yield* opened
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
      taskId: task.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    return { projectId, task }
  })

/** The task's open call for a step that needs the person, as its payload says. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{
        id: string
        payload: string
      }>`SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
    )
    return { id: call?.id ?? '', ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string; agentId: string | null }) }
  })

const answer = (
  attentionId: string,
  reply:
    | { readonly kind: 'tell'; readonly note: string }
    | { readonly kind: 'retry'; readonly agentId: string }
    | { readonly kind: 'abandon' },
) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.answerStuck({ envelope: yield* Runtime.envelope('attention.answer', {}), attentionId, answer: reply })
  })

describe('a step that needs the person', () => {
  it.live('reminds a lead that ends its turn without reporting once, then needs the person, and carries on when told', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task } = yield* planned('Quietly', 'Nothing to say.', [{ key: 'implement', agentId: 'claude-code' }])
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['implement', 'no_report', 'claude-code'])
      const turns = yield* sql<{
        prompt: string
      }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at`
      assert.match(turns[1]?.prompt ?? '', /isn't done until you call Charrette's finish_step tool/)
      assert.strictEqual((yield* cardsOf(projectId))[0]?.phase, 'waiting')
      // Told what to do, the lead reports, and with no review the task is ready.
      yield* answer(call.id, { kind: 'tell', note: 'You are done: report it. [lead:finish]' })
      const [card] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(card?.summary, 'Did the task.')
      const [answered] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${call.id}`
      assert.strictEqual(answered?.state, 'answered')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('needs the person when the lead goes in the middle of its step, and stops when they abandon it', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { projectId, task } = yield* planned('Long one', '[lead:wait]', [{ key: 'implement', agentId: 'codex' }])
      yield* until(
        Effect.map(sessions.running(task.threadId), (running) => (running._tag === 'Some' && running.value.turnRunning ? [running] : [])),
        (rows) => rows.length === 1,
      )
      // Handed to another agent mid-step, the step carries on there: the old one going isn't the lead going.
      yield* sessions.switchAgent({ threadId: task.threadId, agentId: 'claude-code' })
      yield* Effect.sleep('200 millis')
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM attention_requests WHERE kind = 'stuck'`)[0]?.n, 0)
      yield* sessions.stop(task.threadId)
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['implement', 'session_ended'])
      yield* answer(call.id, { kind: 'abandon' })
      const [card] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'stopped')
      assert.strictEqual(card?.title, 'Long one')
      const [run] = yield* sql<{ state: string }>`SELECT state FROM runs`
      assert.strictEqual(run?.state, 'cancelled')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('needs the person for a step a restart stopped', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'charrette-steps-')), 'charrette.sqlite')
      const taskId = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task } = yield* planned('Interrupted', '[lead:wait]', [{ key: 'implement', agentId: 'codex' }])
        yield* until(
          Effect.map(sessions.running(task.threadId), (running) => (running._tag === 'Some' && running.value.turnRunning ? [running] : [])),
          (rows) => rows.length === 1,
        )
        return task.taskId
      }).pipe(Effect.provide(withQueries(file)))
      const call = yield* stuckCall(taskId).pipe(Effect.provide(withQueries(file)))
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['implement', 'restarted', 'codex'])
    }),
  )

  it.live("reminds a reviewer that doesn't report, then needs the person, who tells it to", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task } = yield* planned('Looked at', '[lead:finish]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['review', 'no_report', 'codex'])
      // Told, it looks again in a new round, and reports.
      yield* answer(call.id, { kind: 'tell', note: 'Report what you found. [review:pass]' })
      yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready')
      const attempts = yield* sql<{ state: string }>`
        SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' ORDER BY a.admitted_at`
      assert.deepStrictEqual(
        attempts.map((attempt) => attempt.state),
        ['failed', 'succeeded'],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('hands a review that never reports to another reviewer, whose round starts afresh', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task } = yield* planned('Looked at again', '[lead:finish]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      const call = yield* stuckCall(task.taskId)
      yield* answer(call.id, { kind: 'retry', agentId: 'claude-code' })
      const reviewers = yield* until(
        sql<{ agentId: string; state: string }>`
          SELECT s.agent_id, s.state FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
          WHERE t.kind = 'step' ORDER BY s.started_at`,
        (rows) => rows.length === 2 && rows[0]?.state !== 'active',
      )
      assert.deepStrictEqual(
        reviewers.map((reviewer) => reviewer.agentId),
        ['codex', 'claude-code'],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('hands a settling that never reports to another agent, with the findings still open', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task } = yield* planned('Settled quietly', '[lead:finish] [review:findings] [lead:settle-quietly]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['settle', 'no_report'])
      yield* answer(call.id, { kind: 'retry', agentId: 'codex' })
      const [told] = yield* until(
        sql<{ prompt: string }>`
          SELECT d.prompt FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
          WHERE s.agent_id = 'codex' AND d.thread_id = ${task.threadId} AND d.prompt LIKE '%Settle each%'`,
        (rows) => rows.length === 1,
      )
      assert.match(told?.prompt ?? '', /find_[0-9a-f]{32} \[major\] README\.md:1: The heading is wrong\./)
      // A call that isn't there can't be answered.
      const runs = yield* Runs
      const missing = yield* Effect.flip(
        runs.answerStuck({
          envelope: yield* Runtime.envelope('attention.answer', {}),
          attentionId: 'attn_missing',
          answer: { kind: 'abandon' },
        }),
      )
      assert.instanceOf(missing, NotFound)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("needs the person when the reviewer can't start, and reviews with the agent they pick", () =>
    Effect.gen(function* () {
      const { projectId, task } = yield* planned('Checked', '[lead:finish] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'missing' },
      ])
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['review', 'failed_to_start', 'missing'])
      yield* answer(call.id, { kind: 'retry', agentId: 'codex' })
      yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready')
      const reviews = (yield* results(task.threadId)).filter((step) => step.step === 'review')
      assert.deepStrictEqual(
        reviews.map((step) => step.verdict),
        ['pass'],
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

/** Calls one of Charrette's tools as a session with this access would. */
describe('the coordinator', () => {
  it.live('speaks when spoken to, in its read-only copies, and is refused a write', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { threadId } = yield* opened
      const turns = sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at`
      yield* say(threadId, 'hello')
      // Its first turn is its brief with what the person said; it said nothing before it was asked.
      const [first] = yield* until(turns, (rows) => rows.length === 1)
      assert.match(first?.prompt ?? '', /^You are the coordinator of the project /)
      assert.match(first?.prompt ?? '', /hello$/)
      yield* until(
        Effect.map(sessions.running(threadId), (running) => (running._tag === 'Some' && !running.value.turnRunning ? [running] : [])),
        (rows) => rows.length === 1,
      )
      // It works in its copy of the repository, detached at the default branch.
      const [session] = yield* sql<{ config: string }>`SELECT config FROM provider_sessions WHERE thread_id = ${threadId}`
      assert.strictEqual(JSON.parse(session?.config ?? '{}').mode, 'read-only')
      yield* say(threadId, scenarios.fileEdit)
      const [decision] = yield* until(
        sql<{ outcome: string; reason: string }>`SELECT outcome, reason FROM decisions`,
        (rows) => rows.length === 1,
      )
      assert.deepStrictEqual({ ...decision }, { outcome: 'reject', reason: 'This role only reads: a change is a task.' })
      // Nothing it asked reached the person.
      const [calls] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM attention_requests`
      assert.strictEqual(calls?.n, 0)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("reads the remote's default branch, and throws away what it wrote there each turn", () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const config = yield* RuntimeConfig
      const sql = yield* SqlClient.SqlClient
      const origin = repository()
      const clone = join(mkdtempSync(join(tmpdir(), 'charrette-clone-')), 'meridian')
      execFileSync('git', ['clone', '-q', origin, clone])
      // The remote moves on after the clone.
      writeFileSync(join(origin, 'README.md'), '# Meridian, later\n')
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@charrette.test', 'commit', '-qam', 'Later'], { cwd: origin })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: clone })
      const threadId = yield* coordinator.thread(project.projectId)
      const turns = sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`
      yield* say(threadId, 'hello')
      yield* until(turns, (rows) => rows.length === 1 && rows[0]?.state === 'completed')
      const copy = join(config.worktreeRoot, project.slug, '.coordinator', basename(clone))
      assert.strictEqual(readFileSync(join(copy, 'README.md'), 'utf8'), '# Meridian, later\n')
      assert.strictEqual(readFileSync(join(clone, 'README.md'), 'utf8'), '# Meridian\n')
      writeFileSync(join(copy, 'scratch.md'), 'notes')
      yield* say(threadId, 'again')
      yield* until(turns, (rows) => rows.length === 2 && rows.every((row) => row.state === 'completed'))
      assert.isFalse(existsSync(join(copy, 'scratch.md')))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("serves Charrette's tools only to the session it granted them", () =>
    Effect.gen(function* () {
      const toolServer = yield* ToolServer
      const { projectId, threadId } = yield* opened
      const granted = yield* toolServer.grant({ role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null })
      if (granted.server.type !== 'http') return
      const { url } = granted.server
      const post = (authorization: string) =>
        Effect.promise(() =>
          fetch(url, {
            method: 'POST',
            headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          }).then((response) => response.status),
        )
      assert.strictEqual(yield* post('Bearer made-up'), 401)
      assert.strictEqual(yield* Effect.promise(() => fetch(url, { method: 'POST', body: '{}' }).then((response) => response.status)), 401)
      assert.strictEqual(yield* post(granted.server.headers.Authorization ?? ''), 200)
      yield* granted.revoke
      assert.strictEqual(yield* post(granted.server.headers.Authorization ?? ''), 401)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe("the coordinator's tools", () => {
  it.live('read the project and its tasks, pass messages on, and refuse what they cannot do', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId } = yield* opened
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(yield* callTool(access, 'project_overview', {}), /Tasks: 0 open/)
      assert.strictEqual(yield* callTool(access, 'list_tasks'), 'The project has no tasks yet.')
      assert.match(yield* callTool(access, 'draft_task', { title: 'Tidy the README', description: 'Short.' }), /^Drafted tidy-the-readme\./)
      assert.match(yield* callTool(access, 'list_tasks', {}), /tidy-the-readme: Tidy the README \(planned\)/)
      assert.match(yield* callTool(access, 'read_task', { task: 'tidy-the-readme' }), /Short\./)
      assert.strictEqual(yield* callTool(access, 'read_thread', { task: 'tidy-the-readme' }), 'The thread is empty.')
      assert.match(yield* callTool(access, 'read_task', { task: 'nothing' }), /no task nothing/)
      assert.match(yield* callTool(access, 'propose_plan', { task: 'tidy-the-readme', lead: { agent: 'gemini' } }), /no agent gemini/)
      assert.match(yield* callTool(access, 'propose_plan', { task: 'tidy-the-readme' }), /couldn't read that/)
      // With no lead running yet, it says the message waits for one.
      assert.match(
        yield* callTool(access, 'message_lead', { task: 'tidy-the-readme', message: 'Keep it short.' }),
        /^No lead is running on tidy-the-readme/,
      )
      // A draft needs only a title; a plan needs only its lead.
      assert.match(yield* callTool(access, 'draft_task', { title: 'Bump the version' }), /^Drafted bump-the-version\./)
      // Called again, unsure the first worked, it gets the same task, not a second.
      assert.match(yield* callTool(access, 'draft_task', { title: 'Bump the version ' }), /^Drafted bump-the-version\./)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM tasks WHERE title LIKE 'Bump%'`)[0]?.n, 1)
      assert.match(yield* callTool(access, 'read_task', { task: 'bump-the-version' }), /^bump-the-version: Bump the version\n\nBranch /)
      assert.match(
        yield* callTool(access, 'propose_plan', {
          task: 'bump-the-version',
          lead: { agent: 'codex', model: 'large' },
          review: { agent: 'claude-code', model: 'small' },
        }),
        /^Planned bump-the-version\./,
      )
      const [notice] = yield* sql<{ content: string }>`
        SELECT i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id WHERE t.kind = 'task' AND i.kind = 'notice'`
      assert.deepStrictEqual(JSON.parse(notice?.content ?? '{}'), {
        source: 'runtime',
        severity: 'info',
        title: 'From the coordinator:',
        description: 'Keep it short.',
      })
      // A lead has its own tools, not the coordinator's; with no step waiting, its summary is still kept.
      const lead: ToolAccess = { role: 'lead', projectId, threadId, sessionId: 'none', taskId: null }
      assert.strictEqual(yield* callTool(lead, 'draft_task', { title: 'x' }), 'Charrette has no tool called draft_task.')
      assert.strictEqual(yield* callTool(lead, 'finish_step', { summary: 'Did it.' }), 'Charrette has your summary.')
      const reviewer: ToolAccess = { role: 'reviewer', projectId, threadId, sessionId: 'none', taskId: null }
      assert.strictEqual(yield* callTool(reviewer, 'report_review', { verdict: 'pass', summary: 'Fine.' }), 'No review is waiting on you.')
      // What goes wrong inside Charrette is told as such, not as the agent's mistake.
      const elsewhere: ToolAccess = { role: 'coordinator', projectId: 'prj_missing', threadId, sessionId: 'none', taskId: null }
      assert.strictEqual(
        yield* callTool(elsewhere, 'draft_task', { title: 'x' }),
        'Charrette could not do that. Try again, or tell the person.',
      )
      assert.strictEqual(
        yield* callTool({ ...lead, threadId: 'thr_missing' }, 'finish_step', { summary: 'Did it.' }),
        'Charrette could not record that. Try again.',
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
