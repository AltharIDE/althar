import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { StallOptions } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { carryingOn } from '../src/Stalls'
import { notices, repository, runtime, task as newTask, turns, until } from './support'

/*
 * What Althar does about a turn that stalls, goes round in circles or runs
 * past its budget, where coordinator.test.ts doesn't go: outside a step, on
 * the coordinator's thread, and when what it tries doesn't work.
 */

/** Stalls told in a moment rather than minutes; a stop is waited for long enough to see it come. */
const FAST: StallOptions = {
  every: Duration.millis(50),
  quiet: Duration.millis(400),
  quietInTool: Duration.millis(400),
  cancelGrace: Duration.seconds(2),
}

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** Says something to the thread's agent, as the person would. */
const tell = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

/** Waits until a notice whose title passes the check is in the thread: it. */
const noticeWhere = (threadId: string, check: (title: string) => boolean, limit?: Duration.Duration) =>
  Effect.map(
    until(
      Effect.map(notices(threadId), (said) => said.filter((notice) => check(notice.title ?? ''))),
      (said) => said.length > 0,
      limit,
    ),
    (said) => said[0] ?? {},
  )

/** Waits until nothing runs on the thread. */
const gone = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (running._tag === 'None' ? [running] : [])),
      (rows) => rows.length === 1,
    )
  })

/** A task planned to have `agentId` implement it as its description says, started at once. */
const planned = (title: string, description: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plans = yield* Plans
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId, model: null, skipped: false }],
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    return task
  })

/** The task's open call for a step that needs the person, as its payload says. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
      Duration.seconds(20),
    )
    return JSON.parse(call?.payload ?? '{}') as { step: string; why: string; detail: string | null; tried?: ReadonlyArray<string> }
  })

describe('what an agent is told when its turn stalls', () => {
  it('names a tool still running by its title where it has no command', () => {
    assert.strictEqual(
      carryingOn({ _tag: 'CarryOn', threadId: 't1', quietFor: 600_000, tool: { title: 'Fetch the docs', command: null } }),
      [
        'Your last turn showed no sign of work for 10 minutes, so Althar stopped it.',
        "Fetch the docs was still running. A command that waits for input or doesn't end on its own, such as a watcher, a server or an interactive prompt, holds the turn up: run it so it ends, or in the background.",
        'Carry on with the task from where it stands.',
      ].join(' '),
    )
  })
})

describe('outside a step', () => {
  it.live('stops the turn of an agent that goes round in circles again after it was told to try another way, and says so', () =>
    Effect.gen(function* () {
      const { task } = yield* newTask('Circles')
      const sessions = yield* Sessions
      // An agent no longer among those Althar lists is named by its id.
      yield* sessions.start({ threadId: task.threadId, agentId: 'aider' })
      yield* tell(task.threadId, 'Run the tests. [lead:loop]')
      const stopped = yield* noticeWhere(task.threadId, (title) => title.startsWith('aider kept repeating'))
      assert.deepStrictEqual(stopped, {
        source: 'runtime',
        severity: 'warning',
        title: 'aider kept repeating `npm test`, so Althar stopped its turn.',
        description: 'Say what to do instead, and it carries on from there.',
        about: 'stall',
      })
      // It was told to try another way first, as Althar's own housekeeping.
      assert.deepInclude(
        (yield* notices(task.threadId)).map((notice) => [notice.title, notice.role]),
        ['aider ran `npm test` 3 times in a row to the same end, so Althar stopped its turn and told it to try another way.', 'aside'],
      )
      // Only its turn stops: the session waits for what the person says.
      const [idle] = yield* until(
        Effect.map(sessions.running(task.threadId), (running) =>
          running._tag === 'Some' && !running.value.turnRunning ? [running.value.agentId] : [],
        ),
        (rows) => rows.length === 1,
      )
      assert.strictEqual(idle, 'aider')
    }).pipe(Effect.provide(withQueries(undefined, undefined, { stalls: FAST }))),
  )

  it.live("holds no budget of turns: the agent's turns go on without a word", () =>
    Effect.gen(function* () {
      const { task } = yield* newTask('Chatty')
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      for (const [index, body] of ['Say hello.', 'And again.', 'Once more.'].entries()) {
        yield* tell(task.threadId, body)
        yield* until(turns(task.threadId), (all) => all.length === index + 1 && all.every((turn) => turn.state === 'completed'))
      }
      assert.deepStrictEqual(
        (yield* notices(task.threadId)).filter((notice) => notice.about === 'stall'),
        [],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { stalls: { ...FAST, turns: 1 } }))),
  )

  it.live('starts an agent that stalls again afresh on the model and effort it had', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task } = yield* newTask('Quiet')
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex', model: 'large', effort: 'high' })
      yield* tell(task.threadId, 'Serve it. [lead:hang]')
      yield* noticeWhere(task.threadId, (title) => title === 'Fake codex showed no sign of work again, so Althar started it afresh.')
      // Each as it took the thread, once it started.
      const started = yield* until(
        sql<{ model: string | null; effort: string | null; state: string }>`
          SELECT model, effort, state FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at`,
        (rows) => rows.length === 2 && rows[1]?.state === 'active',
      )
      assert.deepStrictEqual(
        started.map((row) => [row.model, row.effort]),
        [
          ['large', 'high'],
          ['large', 'high'],
        ],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { stalls: FAST }))),
  )
})

describe("on the coordinator's thread", () => {
  it.live("stops a coordinator that went quiet and can't be started afresh, and says how to start it again", () => {
    let made = 0
    return Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      const body = 'Look into the dev server. [lead:hang]'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      const stopped = yield* noticeWhere(threadId, (title) => title.endsWith('so Althar stopped it.'))
      assert.deepStrictEqual(
        [stopped.title, stopped.description],
        [
          'Fake claude-code showed no sign of work again after Althar started it afresh, so Althar stopped it.',
          'Say something to start the coordinator again; it picks up from the thread.',
        ],
      )
      yield* gone(threadId)
    }).pipe(
      Effect.provide(
        withQueries(undefined, undefined, {
          stalls: FAST,
          // Its first session starts; the one Althar starts afresh never does.
          each: {
            'claude-code': {
              beforeNewSession: async () => {
                made += 1
                if (made > 1) throw new Error('No session for you')
              },
            },
          },
        }),
      ),
    )
  })
})

describe('a step whose agent Althar can’t bring back', () => {
  it.live("needs the person, with only carrying on tried, when its lead can't start afresh", () => {
    let made = 0
    return Effect.gen(function* () {
      const task = yield* planned('Never answers', 'Serve it. [lead:hang]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.tried], ['implement', 'stalled', ['carried_on']])
      assert.isAbove(made, 1)
      yield* gone(task.threadId)
    }).pipe(
      Effect.provide(
        withQueries(undefined, undefined, {
          stalls: FAST,
          each: {
            // Its first session starts; the one Althar starts afresh never does.
            codex: {
              beforeNewSession: async () => {
                made += 1
                if (made > 1) throw new Error('No session for you')
              },
            },
          },
        }),
      ),
    )
  })

  it.live("stops a lead past its budget that doesn't stop its turn when asked, and needs the person", () =>
    Effect.gen(function* () {
      const task = yield* planned('Wedged', 'Work on it. [lead:wedge-once]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.detail], ['implement', 'over_budget', 'a minute'])
      // Its turn wouldn't stop, so its session is stopped.
      yield* gone(task.threadId)
    }).pipe(
      Effect.provide(
        withQueries(undefined, undefined, {
          stalls: {
            every: Duration.millis(50),
            quiet: Duration.seconds(30),
            work: Duration.millis(400),
            cancelGrace: Duration.millis(300),
          },
          stopGrace: Duration.millis(300),
        }),
      ),
    ),
  )
})
