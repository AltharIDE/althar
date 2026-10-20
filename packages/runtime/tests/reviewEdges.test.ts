import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, turns, until } from './support'

/*
 * A task's review and the lead settling it, where coordinator.test.ts and
 * reviews.test.ts don't go: a reviewer whose first turn does nothing, a lead
 * that can't start to settle, and findings that name no place.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** A task planned for Claude Code to implement and Codex to review, as its description says, started at once. */
const reviewed = (title: string, description: string) =>
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
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    return { projectId: project.projectId, ...task }
  })

/** The task's review thread and the reviewer's session on it, once there is one. */
const reviewerOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [found] = yield* until(
      sql<{ threadId: string; sessionId: string }>`
        SELECT t.id AS thread_id, s.id AS session_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
        WHERE t.task_id = ${taskId} AND t.kind = 'step' AND t.node_key = 'review' AND s.state = 'active'`,
      (rows) => rows.length === 1,
      Duration.seconds(20),
    )
    return found ?? { threadId: '', sessionId: '' }
  })

/** The task's open call for a step that needs the person: its id, and its payload. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
      Duration.seconds(20),
    )
    return {
      id: call?.id ?? '',
      ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string; detail: string | null; agentId: string | null; open: number }),
    }
  })

const phaseOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const board = yield* Effect.orDie(queries.board(projectId))
    return board.tasks.find((task) => task.taskId === taskId)?.phase
  })

describe('a reviewer whose turn does nothing', () => {
  it.live('is told to carry on with the review in a moment, and reviews', () =>
    Effect.gen(function* () {
      const task = yield* reviewed('Quiet review', 'Do it. [lead:finish] [review:pass]')
      const reviewer = yield* reviewerOf(task.taskId)
      yield* until(
        Effect.map(phaseOf(task.projectId, task.taskId), (phase) => (phase === 'ready' ? [phase] : [])),
        (rows) => rows.length === 1,
        Duration.seconds(20),
      )
      assert.include(
        (yield* notices(reviewer.threadId)).map((notice) => notice.title),
        'Its turn ended before it could do anything, so Althar tells it to carry on in a minute.',
      )
      const told = (yield* turns(reviewer.threadId)).map((turn) => turn.prompt ?? '')
      assert.include(
        told,
        "Your last turn ended before you could do anything. Carry on with the review; when it's done, call Althar's report_review tool with your verdict, a summary and your findings.",
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { each: { codex: { blank: 1 } }, idle: { blank: Duration.millis(100) } }))),
  )
})

describe('a lead settling a review', () => {
  it.live("needs the person where it can't start to settle, and once answered, settles findings that name no place", () => {
    let made = 0
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const runs = yield* Runs
      const task = yield* reviewed('Settle it', 'Do it. [lead:finish] [review:wait]')
      const reviewer = yield* reviewerOf(task.taskId)
      // The lead's session goes once its step is done; the reviewer reports a finding with no file or line to it.
      yield* sessions.stop(task.threadId)
      const access: ToolAccess = {
        role: 'reviewer',
        projectId: task.projectId,
        threadId: reviewer.threadId,
        sessionId: reviewer.sessionId,
        taskId: task.taskId,
      }
      assert.strictEqual(
        yield* callTool(access, 'report_review', {
          verdict: 'changes_requested',
          summary: 'One thing.',
          findings: [{ severity: 'minor', claim: 'The retry has no test.' }],
        }),
        'Althar has your review. The lead settles your findings; you may be asked to look again.',
      )
      // Its agent can't start again: settling needs the person.
      const call = yield* stuckCall(task.taskId)
      assert.deepInclude(call, { step: 'settle', why: 'failed_to_start', agentId: 'claude-code', open: 1 })
      // Answered, it starts, and is told what to settle, by what the review found, without a place for it.
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call.id,
        answer: { kind: 'retry', agentId: 'claude-code' },
      })
      const [settling] = yield* until(
        Effect.map(turns(task.threadId), (all) => all.filter((turn) => turn.prompt?.includes('The review found:') === true)),
        (rows) => rows.length === 1,
      )
      assert.match(settling?.prompt ?? '', /The review found:\n\n- find_[0-9a-f]+ \[minor\]: The retry has no test\.\n\nSettle each/)
    }).pipe(
      Effect.provide(
        withQueries(undefined, undefined, {
          each: {
            // Its first session starts, then one won't, then they do again.
            'claude-code': {
              beforeNewSession: async () => {
                made += 1
                if (made === 2) throw new Error('No session for you')
              },
            },
          },
        }),
      ),
    )
  })
})
