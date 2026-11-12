import type { AutomationDefinition } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from '../src/Automations'
import { Busy } from '../src/Busy'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, until } from './support'

/*
 * A sanity pass over places among the agents at work, usage limits and the
 * models work runs on: each test shows a defect found by reading the code
 * against docs/decisions, and is marked to fail until the defect is fixed.
 */

const GB = 1024 ** 3
const HOUR = 60 * 60 * 1000

/** The runtime on a machine that runs `n` agents at once, with the queries the screens read. */
const atOnce = (n: number, more: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(':memory:', {}, { ...more, busy: { machine: { cores: Math.ceil(n * 2.5), memory: (4 + 3 * n) * GB }, ...more.busy } }),
    ),
  )

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId as ProjectId, threadId: yield* coordinator.thread(project.projectId) }
})

/** A task whose one-step plan, its lead on `agentId`, the person starts now: whether its lead is on it, or it waits. */
const started = (projectId: ProjectId, title: string, description: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const actor = yield* person
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId, model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    return { ...created, outcome: yield* plans.start(planId, actor) }
  })

/** The task's step attempts, oldest first. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string; holdReason: string | null }>`
      SELECT n.node_key AS step, a.state, a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** Waits until the task's latest step is held for this reason. */
const heldFor = (taskId: string, reason: 'machine_busy' | 'usage_limit') =>
  until(attempts(taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === reason)

/** Waits until the task's latest step is under way on its agent. */
const working = (taskId: string) => until(attempts(taskId), (rows) => rows.at(-1)?.state === 'running')

/** Waits until the thread's agent is on, between turns. */
const idle = (threadId: string) =>
  Effect.flatMap(Sessions, (sessions) =>
    until(
      Effect.map(sessions.running(threadId), (live) => (Option.isSome(live) && !live.value.turnRunning ? [true] : [])),
      (rows) => rows.length === 1,
    ),
  )

/** What the person says to the thread's agent, after its turn. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

/** Althar tells the thread's agent something, quietly, as it does a check that failed: a task's work under way, not the person's. */
const tell = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const envelope = yield* Runtime.envelope('thread.send', { threadId, body }, undefined, (yield* Instance).systemId)
    yield* sessions.send({ envelope, threadId, body, disposition: 'after_current', quiet: true })
  })

/** Where something said in the thread stands, with the error of each turn it went in. */
const inputOf = (threadId: string, body: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ state: string; errorClass: string | null }>`
      SELECT u.state, d.error_class FROM user_inputs u
      LEFT JOIN turn_delivery_inputs i ON i.user_input_id = u.id LEFT JOIN turn_deliveries d ON d.id = i.delivery_id
      WHERE u.thread_id = ${threadId} AND u.body = ${body}`,
  )

/** The titles of the notices in a thread, oldest first. */
const noticesOn = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** Everything that waits for a place, in the order places are given, by the titles given. */
const orderOf = (titles: ReadonlyMap<string, string>) =>
  Effect.map(
    Effect.flatMap(Busy, (busy) => busy.order),
    (all) => all.map((one) => titles.get(one.taskId) ?? one.taskId),
  )

/** A report every weekday at 9:00, on Codex, which finishes at once. */
const NOTES: AutomationDefinition = {
  name: 'Release notes',
  prompt: 'Write release notes from what merged this week. [lead:finish] [lead:terse]',
  schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
  zone: 'Europe/London',
  lead: { agentId: 'codex', model: null },
  work: { kind: 'task', review: null, end: null },
  allowEverything: true,
  minutes: 45,
  late: 'once',
}

/** An automation the person made, run now: its run's task, once it has one. */
const ranNow = (projectId: ProjectId, definition: AutomationDefinition) =>
  Effect.gen(function* () {
    const automations = yield* Automations
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const automationId = yield* automations.make({ projectId, definition, on: true, actorId: instance.personId })
    yield* automations.runNow(automationId, instance.personId)
    const [occurrence] = yield* until(
      sql<{ taskId: string | null }>`SELECT task_id FROM automation_occurrences WHERE automation_id = ${automationId}`,
      (rows) => rows[0]?.taskId != null,
    )
    return occurrence?.taskId ?? ''
  })

describe('a place held by an agent out of usage', () => {
  // Finding (sanity pass): a lead out of usage, with the person's message waiting for its reset, is counted as an agent at
  // work (Busy's `told`) and holds a place until the reset, so other tasks wait behind it. Flips to passing when fixed.
  it.live.fails('takes no place while the person’s message to it waits for its reset', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const policies = yield* Policies
      const instance = yield* Instance
      const { projectId } = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      // Its lead runs out of usage on its first turn: the step is held for the reset, and holds no place.
      const out = yield* started(projectId, 'Out', 'Do it. [lead:finish]', 'claude-code')
      yield* heldFor(out.taskId, 'usage_limit')
      yield* idle(out.threadId)
      assert.deepStrictEqual((yield* busy.now).holders, [])
      // The person writes to the lead meanwhile: what they said waits for the reset, as its turn reached the limit too.
      const body = 'When you are back, add a test as well.'
      yield* say(out.threadId, body)
      yield* until(inputOf(out.threadId, body), (rows) => rows.some((row) => row.errorClass === 'usage_limit'))
      yield* until(inputOf(out.threadId, body), (rows) => rows.every((row) => row.state === 'queued'))
      yield* idle(out.threadId)
      // Still nothing is at work on this machine: the next task takes the one place.
      assert.deepStrictEqual(
        (yield* busy.now).holders.map((holder) => holder.taskId),
        [],
      )
      const next = yield* started(projectId, 'Next', 'Do it. [lead:finish]')
      assert.strictEqual(next.outcome, 'running')
    }).pipe(Effect.provide(atOnce(1, { each: { 'claude-code': { outOfUsage: { until: Date.now() + HOUR } } } }))),
  )
})

describe('what Althar tells a lead that runs out of usage', () => {
  // Finding (sanity pass): what Althar tells an idle lead (a failed check, a nudge) in a turn that reaches a usage limit is
  // dropped: it isn't kept for the agent's next turn, nothing gives it again at the reset, and the thread says "Your message
  // waits" though the person said nothing. Flips to passing when fixed.
  it.live.fails('keeps it for the lead’s next turn, as what the person says is kept', () => {
    // Claude Code has usage until the test says it ran out.
    const limit: { until: number } = { until: 0 }
    return Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const { projectId } = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Done', 'Do it. [lead:finish]', 'claude-code')
      yield* until(attempts(task.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(task.threadId)
      limit.until = Date.now() + HOUR
      const body = 'The checks failed on the pull request.'
      yield* tell(task.threadId, body)
      yield* until(inputOf(task.threadId, body), (rows) => rows.some((row) => row.errorClass === 'usage_limit'))
      const said = yield* until(noticesOn(task.threadId), (all) => all.some((title) => title.includes('ran out of usage')))
      // What Althar said waits for the lead, as the person's words do; and nobody is told their message waits.
      assert.include(['queued', 'noted'], (yield* inputOf(task.threadId, body))[0]?.state)
      assert.notInclude(said.find((title) => title.includes('ran out of usage')) ?? '', 'Your message')
    }).pipe(Effect.provide(atOnce(4, { each: { 'claude-code': { outOfUsage: limit } } })))
  })
})

describe('a model the person switched off', () => {
  // Finding (sanity pass): a lead named by its agent alone, as start_task takes one (review_pull_request and answer_stuck_step's
  // hand_on resolve theirs the same way, through stepOf), runs on the agent's own default model though the person switched that
  // model off ("A model switched off is never planned", agents.md). Flips to passing when fixed.
  it.live.fails('is never what a lead named by its agent alone runs on', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const models = yield* Models
      const { projectId, threadId } = yield* opened
      // Codex's own default is Small; the person switched it off.
      yield* models.setModelBlocked({ agentId: 'codex', model: 'small', blocked: true })
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const said = yield* callTool(coordinator, 'start_task', {
        title: 'Sketch the retry',
        description: '[lead:finish]',
        lead: { agent: 'codex' },
      })
      assert.match(said, /^Started /)
      const [task] = yield* sql<{ threadId: string }>`
        SELECT t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.title = 'Sketch the retry'`
      const sessions = yield* until(
        sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE thread_id = ${task?.threadId ?? ''}`,
        (rows) => rows.length > 0,
      )
      // None named is the agent's own default, which is Small.
      assert.notStrictEqual(sessions[0]?.model ?? 'small', 'small')
    }).pipe(Effect.provide(atOnce(4))),
  )
})

describe('Up next across projects', () => {
  // Finding (sanity pass): putting one project's Up next in an order of its own lifts its new work ahead of another project's
  // work under way, though the order is kept within a project and doesn't reorder other projects' work (scheduling.md,
  // "Running and Up next"). Flips to passing when fixed.
  it.live.fails('keeps another project’s work under way where it stood when the person reorders one project', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const mine = yield* opened
      const theirs = yield* opened
      // Another project's task, done with its step, its lead idle.
      const first = yield* started(theirs.projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      // The one place taken; two new tasks of this project wait in its line.
      const holder = yield* started(theirs.projectId, 'Holder', 'Work on it. [lead:wait]')
      yield* working(holder.taskId)
      const one = yield* started(mine.projectId, 'One', 'Work on it. [lead:wait]')
      const two = yield* started(mine.projectId, 'Two', 'Work on it. [lead:wait]')
      yield* heldFor(one.taskId, 'machine_busy')
      yield* heldFor(two.taskId, 'machine_busy')
      // Althar tells the other project's idle lead something it must act on: work under way, which goes before new work.
      yield* tell(first.threadId, 'The checks failed.')
      const titles = new Map([
        [first.taskId, 'First'],
        [one.taskId, 'One'],
        [two.taskId, 'Two'],
      ])
      yield* until(orderOf(titles), (order) => order.length === 3)
      assert.deepStrictEqual(yield* orderOf(titles), ['First', 'One', 'Two'])
      // The person puts Two first in this project's Up next. The other project's work keeps its place before this one's.
      assert.isTrue(yield* busy.move(two.taskId, 0))
      assert.deepStrictEqual(yield* orderOf(titles), ['First', 'Two', 'One'])
    }).pipe(Effect.provide(atOnce(1))),
  )
})

describe('one automation’s run at work at a time', () => {
  // Finding (sanity pass): moving any row of a project's Up next puts every row of it where it stands, an automation's waiting
  // run too, which then stands as the person's work does and starts beside another automation's run at work, past the one at
  // a time automations get (scheduling.md, "What goes first"). Flips to passing when fixed.
  it.live.fails('keeps a second automation’s run waiting when the person moves another row of Up next', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const { projectId } = yield* opened
      const holder = yield* started(projectId, 'Holder', 'Work on it. [lead:wait]')
      yield* working(holder.taskId)
      // One automation's run at work, in the other place; a second's waits, for a place and for its turn among automations.
      const first = yield* ranNow(projectId, { ...NOTES, name: 'Nightly', prompt: 'Bump the dependencies. [lead:wait]' })
      yield* working(first)
      const second = yield* ranNow(projectId, { ...NOTES, name: 'Weekly', prompt: 'Write the notes. [lead:wait]' })
      yield* heldFor(second, 'machine_busy')
      // The person's own task waits too, and they move it to the front, where it stands already.
      const mine = yield* started(projectId, 'Mine', 'Work on it. [lead:wait]')
      yield* heldFor(mine.taskId, 'machine_busy')
      assert.isTrue(yield* busy.move(mine.taskId, 0))
      // Room for two more: the person's task starts; the second automation's run still waits for the first's to end.
      yield* busy.set(4)
      yield* working(mine.taskId)
      // Whatever the look that started it decided is done once Up next can be read under its lock again.
      yield* busy.letGo(holder.taskId)
      const atWork = (yield* busy.now).holders.map((one) => one.taskId)
      assert.include(atWork, first)
      assert.notInclude(atWork, second)
    }).pipe(Effect.provide(atOnce(2))),
  )
})

describe('Up next with an automation’s run in it', () => {
  // Finding (sanity pass): an automation's run that waits, which goes after everything else, makes the project's Up next read
  // as the person's own order ("Your order", Back to oldest first) though nobody moved anything; Back to oldest first changes
  // nothing. Flips to passing when fixed.
  it.live.fails('reads as the oldest first while the person hasn’t moved anything', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const { projectId } = yield* opened
      const holder = yield* started(projectId, 'Holder', 'Work on it. [lead:wait]')
      yield* working(holder.taskId)
      // The automation's run comes first, and waits for the place.
      const run = yield* ranNow(projectId, NOTES)
      yield* heldFor(run, 'machine_busy')
      // The person's own task, started after it, waits too, and goes before it.
      const mine = yield* started(projectId, 'Mine', 'Work on it. [lead:wait]')
      yield* heldFor(mine.taskId, 'machine_busy')
      const line = yield* until(busy.line(projectId), (now) => now.order.length === 2)
      assert.deepStrictEqual(line.order, [mine.taskId, run])
      // Nobody put the line in an order of their own.
      assert.isFalse(line.reordered)
    }).pipe(Effect.provide(atOnce(1))),
  )
})
