import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../../src/Coordinator'
import { Projects } from '../../src/Projects'
import * as Runtime from '../../src/Runtime'
import { Sessions } from '../../src/Sessions'
import { addItem } from '../../src/threads'
import { repository } from '../support'

/** Opt-in live recipient check. Synthetic prior evidence; real Codex receives and interprets it through ACP. */
describe('project memory on a real provider', () => {
  it.live(
    'Codex reads prior work without promoting its hypothesis into a proven cause',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'althar-live-memory-'))
      return Effect.gen(function* () {
        const projects = yield* Projects
        const sessions = yield* Sessions
        const coordinator = yield* Coordinator
        const sql = yield* SqlClient.SqlClient
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Checkout cache experiment',
        })
        const place = { projectId: project.projectId as ProjectId, threadId: task.threadId }
        const source = yield* addItem(place, 'agent_message', {
          text: 'Serializing checkout writes still hangs. Lock inversion is unconfirmed. Next inspect acquire ordering.',
        })
        yield* addItem(
          place,
          'tool_call',
          {
            title: 'Run checkout isolation regression',
            kind: 'execute',
            status: 'failed',
            rawInput: { command: 'bun test checkout-isolation' },
            diagnostic: {
              text: 'AssertionError: expected account B, received account A',
              source: 'tool-output',
              truncated: false,
              redacted: false,
            },
          },
          { toolCallId: 'isolation' },
        )
        for (let n = 0; n < 5; n++) yield* addItem(place, 'notice', { title: 'Inspecting reproduction fixture' })
        yield* addItem(place, 'agent_message', {
          text: 'Correction: the reproduction fixture reused an account. Earlier causal attribution to lock inversion was wrong. Production behavior remains unresolved; isolate the fixture identities before drawing conclusions.',
        })
        const threadId = yield* coordinator.thread(project.projectId)
        yield* sessions.start({ threadId, agentId: 'codex' })
        const body =
          'The purchase flow freezes under concurrent requests. Based on earlier project work, what was tried, what did the diagnostics show, and what remains uncertain or needs checking next? Do not change files or create tasks.'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        let completed = false
        for (let tries = 0; tries < 90; tries++) {
          const [turn] = yield* sql<{
            state: string
          }>`SELECT state FROM turn_deliveries WHERE thread_id=${threadId} ORDER BY requested_at DESC LIMIT 1`
          if (
            turn?.state === 'completed' &&
            (yield* sql`SELECT id FROM user_inputs WHERE thread_id=${threadId} AND state='queued'`).length === 0
          ) {
            completed = true
            break
          }
          if (turn !== undefined && !['pending', 'delivered'].includes(turn.state)) assert.fail(`Live turn ended ${turn.state}`)
          yield* Effect.sleep('2 seconds')
        }
        assert.isTrue(completed, 'live turn did not finish')
        const messages = yield* sql<{
          text: string
        }>`SELECT json_extract(content,'$.text') AS text FROM thread_items WHERE thread_id=${threadId} AND kind='agent_message' ORDER BY sequence`
        const answer = messages.map((row) => row.text).join('\n')
        process.stdout.write(`Live Codex memory answer:\n${answer}\n`)
        assert.match(answer.toLowerCase(), /unconfirmed|unverified|unresolved|not (?:yet )?(?:proven|established)|hypothesis/)
        assert.include(answer.toLowerCase(), 'fixture')
        assert.match(answer.toLowerCase(), /account.?b/)
        assert.match(answer.toLowerCase(), /account.?a/)
        assert.include(answer.toLowerCase(), 'account')
        const deliveries = yield* sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id=${threadId}`
        assert.isTrue(
          deliveries.some((row) => row.prompt.includes(source)),
          'prior evidence was not automatically delivered',
        )
        assert.notInclude(body, source)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Runtime.layer({
            database: join(home, 'state.db'),
            memoryModelCache: process.env.ALTHAR_MEMORY_MODEL_CACHE ?? join(tmpdir(), 'althar-memory-model-cache'),
            worktreeRoot: join(home, 'worktrees'),
            appVersion: '0.0.0-test',
            deviceName: 'Live memory check',
          }),
        ),
      )
    },
    240_000,
  )
})
