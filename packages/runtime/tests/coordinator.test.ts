import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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
import { repository, runtime, until } from './support'

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
      assert.strictEqual(head(workspace?.path ?? ''), workspace?.baseCommit)
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

  it.live('stops reviewing after three rounds, and takes a settling that changes nothing as the last word', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId } = yield* opened
      yield* say(threadId, 'Tighten the types. [coordinator:plan] [lead:finish] [review:always]')
      const [first] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'ready', Duration.seconds(60))
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
      yield* Effect.flip(plans.start(planId, actor))
      const [card] = yield* until(cardsOf(projectId), (cards) => cards[0]?.phase === 'stopped')
      assert.strictEqual(card?.plan?.steps[0]?.agentId, 'missing')
      const [run] = yield* sql<{ state: string }>`SELECT state FROM runs`
      assert.strictEqual(run?.state, 'failed')
      // Started again, a plan runs once.
      const runs = yield* Runs
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
          { key: 'implement', agentId: 'claude-code', model: 'large', skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      // The review is under way, and the lead has stopped.
      yield* until(
        sql<{
          id: string
        }>`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' AND a.state = 'running'`,
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
      const leads = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE thread_id = ${task.threadId}`
      assert.deepStrictEqual(
        leads.map((lead) => lead.model),
        ['large', 'large'],
      )
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
      assert.deepStrictEqual({ ...suggested }, { agentId: 'claude-code', agentName: 'Fake claude-code', model: null, available: false })
      const refused = yield* Effect.flip(say(threadId, 'Hello'))
      assert.instanceOf(refused, CoordinatorUnavailable)
    }).pipe(Effect.provide(withQueries(undefined, undefined, { signedOut: ['claude-code'] }))),
  )
})

/** Calls one of Charrette's tools as a session with this access would. */
const callTool = (access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const toolServer = yield* ToolServer
    const granted = yield* toolServer.grant(access)
    const server = granted.server
    if (server.type !== 'http') return ''
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        const result = await client.callTool(args === undefined ? { name } : { name, arguments: args })
        const content = Array.isArray(result.content) ? result.content : []
        return content.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '')).join('')
      } finally {
        await client.close()
      }
    })
  })

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
