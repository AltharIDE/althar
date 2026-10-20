import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, turns, until } from './support'

/*
 * The coordinator's list of tasks naming each one's lead by its agent: one
 * whose agent Althar doesn't list, as one gone from the registry since, by
 * its id.
 */

describe('the coordinator’s list_tasks', () => {
  it.live('names a lead whose agent Althar doesn’t list by its id', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout',
      })
      // An agent the registry no longer lists, run as a process of its own.
      yield* sessions.start({ threadId: task.threadId, agentId: 'process' })
      yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(yield* callTool(coordinator, 'list_tasks', {}), 'led by process')
    }).pipe(Effect.provide(runtime())),
  )
})
