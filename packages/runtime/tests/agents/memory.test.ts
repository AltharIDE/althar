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
        const source = yield* addItem({ projectId: project.projectId as ProjectId, threadId: task.threadId }, 'agent_message', {
          text: 'Tried a shared checkout retry cache. The isolation experiment failed. Missing account in cache keys is only a hypothesis; the cause is unverified. Next: compare keys for two accounts. No fix was completed.',
        })
        const threadId = yield* coordinator.thread(project.projectId)
        yield* sessions.start({ threadId, agentId: 'codex' })
        const body = `What did earlier checkout cache work try, what happened, is the cause established, and what should be checked next? Use read_memory for source ${source}. Do not change files or create tasks. In your final answer include the exact phrase "cause unverified" if that is what the evidence says.`
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        let completed = false
        for (let tries = 0; tries < 90; tries++) {
          const [turn] = yield* sql<{
            state: string
          }>`SELECT state FROM turn_deliveries WHERE thread_id=${threadId} ORDER BY requested_at DESC LIMIT 1`
          if (turn?.state === 'completed') {
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
        assert.include(answer.toLowerCase(), 'cause unverified')
        assert.include(answer.toLowerCase(), 'account')
        const tools = yield* sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id=${threadId} AND kind='tool_call'`
        assert.isTrue(
          tools.some((row) => row.content.includes('read_memory')),
          'live agent did not inspect source',
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Runtime.layer({
            database: join(home, 'state.db'),
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
