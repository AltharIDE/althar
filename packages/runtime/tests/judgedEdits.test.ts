import { Ids } from '@althar/domain'
import type { PermissionRequest } from '@althar/provider-adapters'
import { codexLikeMeanings } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Permissions, type RequestContext } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * The coordinator judging a lead's edit outside its worktree (ADR-019): not
 * a command, so no branch is read again before its answer applies; the
 * answer is the coordinator's, and nothing waits on the person.
 */

describe('an edit outside the worktree, where the coordinator decides', () => {
  it.live('is judged as the edit it is, and its answer applies', () => {
    const prompts: Array<string> = []
    return Effect.gen(function* () {
      const { project, task: created } = yield* task('Write the release notes')
      const policies = yield* Policies
      const instance = yield* Instance
      const sessions = yield* Sessions
      const permissions = yield* Permissions
      const sql = yield* SqlClient.SqlClient
      yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
      yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'claude-code', model: 'small' })
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: 'large' })
      yield* until(turns(created.threadId), (rows) => rows.length > 0 && rows.every((row) => row.state === 'completed'))
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      const context: RequestContext = {
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
        threadId: created.threadId,
        taskId: created.taskId,
        sessionId,
        meanings: codexLikeMeanings,
        rules: { role: 'task', context: { worktree: workspace?.path ?? '', defaultBranch: 'main', taskBranch: 'althar/notes' } },
      }
      const edit: PermissionRequest = {
        sessionId: 'provider-session',
        toolCallId: 'edit-outside',
        title: 'Edit /etc/althar-notes.md',
        kind: 'edit',
        paths: ['/etc/althar-notes.md'],
        rawInput: { path: '/etc/althar-notes.md' },
        options: [
          { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
          { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
        ],
      }
      assert.strictEqual((yield* permissions.decide(context, edit)).decision, 'allow')
      assert.lengthOf(prompts, 1)
      assert.include(prompts[0] ?? '', '/etc/althar-notes.md')
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: async ({ prompt }) => {
            prompts.push(prompt)
            return '{"decision":"allow","reason":"The notes are part of the task."}'
          },
        }),
      ),
    )
  })
})
