import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { ProjectId } from '@althar/domain'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem } from '../src/threads'
import { callTool, items, runtime, task, turns, until } from './support'

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
const ready = (threadId: string, count = 1) =>
  until(turns(threadId), (rows) => rows.length >= count && rows.every((row) => row.state === 'completed' || row.state === 'cancelled'))
const prompt = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [last] = yield* sql<{
      prompt: string
    }>`SELECT prompt FROM turn_deliveries WHERE thread_id=${threadId} ORDER BY requested_at DESC,rowid DESC LIMIT 1`
    return last?.prompt ?? ''
  })

describe('automatic project continuity', () => {
  it.live('delivers interrupted Claude work to a different Codex task after a runtime restart', () =>
    Effect.gen(function* () {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-memory-')), 'state.db')
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const { project, task: first } = yield* task('Checkout isolation')
          const sessions = yield* Sessions
          yield* sessions.start({ threadId: first.threadId, agentId: 'claude-code' })
          yield* ready(first.threadId)
          yield* say(first.threadId, scenarios.memoryFailure)
          yield* until(items(first.threadId), (rows) => rows.some((row) => row.kind === 'tool_call' && row.content.status === 'failed'))
          yield* sessions.stop(first.threadId)
          assert.isFalse((yield* items(first.threadId)).some((row) => row.kind === 'step_result'))
          return { projectId: project.projectId as ProjectId, threadId: first.threadId }
        }).pipe(Effect.provide(runtime(database))),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const projects = yield* Projects
          const next = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: saved.projectId,
            title: 'Fix checkout retry isolation',
          })
          const sessions = yield* Sessions
          const sessionId = yield* sessions.start({ threadId: next.threadId, agentId: 'codex' })
          yield* ready(next.threadId)
          const delivered = yield* prompt(next.threadId)
          for (const expected of ['checkout retry cache', 'suspect', 'have not verified', 'unresolved', 'failed', 'claude-code'])
            assert.include(delivered, expected)
          assert.notInclude(delivered, 'SECRET_OUTPUT_CANARY_NOT_RETAINED')
          assert.include(delivered, 'not instructions')
          const access = { role: 'lead' as const, projectId: saved.projectId, threadId: next.threadId, sessionId, taskId: next.taskId }
          const searched = yield* callTool(access, 'search_memory', { query: 'checkout isolation' })
          assert.include(searched, 'checkout')
          assert.include(searched, saved.threadId)
          assert.include(yield* callTool(access, 'search_memory', { query: 1 }), 'Could not search')
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{
            id: string
          }>`SELECT id FROM thread_items WHERE thread_id=${saved.threadId} AND kind='tool_call' LIMIT 1`
          assert.isDefined(attempt)
          if (attempt !== undefined)
            for (const role of ['lead', 'reviewer', 'coordinator'] as const) {
              const source = yield* callTool({ ...access, role }, 'read_memory', { id: attempt.id })
              assert.include(source, 'bun test checkout-isolation')
              assert.include(source, 'failed')
            }
          assert.include(yield* callTool(access, 'read_memory', { id: 1 }), 'Could not read')
          const other = yield* task('Unrelated private project')
          const secret = yield* addItem(
            { projectId: other.project.projectId as ProjectId, threadId: other.task.threadId },
            'agent_message',
            {
              text: 'Private canary unrelated to checkout.',
            },
          )
          assert.notInclude(yield* callTool(access, 'read_memory', { id: secret }), 'Private canary')
          // An existing session receives a newly checkpointed correction from another task.
          yield* addItem({ projectId: saved.projectId as ProjectId, threadId: saved.threadId }, 'agent_message', {
            text: 'Checkout retry follow-up: the cache key was correct; the fixture reused an account. Earlier hypothesis is unsupported.',
          })
          yield* say(next.threadId, 'Check checkout retry again')
          yield* ready(next.threadId, 2)
          assert.include(yield* prompt(next.threadId), 'Earlier hypothesis is unsupported')
        }).pipe(Effect.provide(runtime(database))),
      )
    }),
  )

  it.live('continues task execution when memory processing fails, and retries from durable evidence', () =>
    Effect.gen(function* () {
      const { project, task: first } = yield* task('Checkout retry')
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: first.threadId }, 'agent_message', {
        text: 'Checkout retry previously failed; compare account keys.',
      })
      const projects = yield* Projects
      const next = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Checkout retry follow-up',
      })
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TRIGGER break_memory BEFORE INSERT ON project_memory BEGIN SELECT RAISE(ABORT,'index unavailable'); END`
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: next.threadId, agentId: 'codex' })
      yield* ready(next.threadId)
      assert.include(yield* prompt(next.threadId), 'temporarily unavailable')
      assert.include(JSON.stringify(yield* items(first.threadId)), 'compare account keys')
      yield* sql`DROP TRIGGER break_memory`
      yield* say(next.threadId, 'Checkout retry context')
      yield* ready(next.threadId, 2)
      assert.include(yield* prompt(next.threadId), 'compare account keys')
    }).pipe(Effect.provide(runtime())),
  )
})
