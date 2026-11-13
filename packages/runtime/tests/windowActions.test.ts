import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { WINDOW_ACTIONS, type WindowAction } from '../src/windowActions'
import { listTools, repository, runtime } from './support'

/*
 * Leads and the coordinator share one tool set (ADR-097), and with it they
 * can do every task action the window offers the person, but accepting and
 * merging, which stay on the person's own message: each button in
 * WINDOW_ACTIONS names a tool both roles have. The desktop app's test checks
 * that list against the window's own.
 */

/** What a lead has that the coordinator doesn't: its own task and worktree's. */
const OWN = [
  'change_issue',
  'draft_review',
  'fetch_from_remote',
  'finish_step',
  'hand_checks_to_person',
  'link_pull_request',
  'make_it_a_change',
  'push_to_pull_request',
  'read_checks',
  'read_gallery',
  'record_setup',
  'run_it',
  'start_helper',
  'stop_helper',
  'wait_for',
  'wait_for_person',
]

const toolOf = (action: WindowAction) => ('tool' in action ? action.tool : 'word' in action ? action.word : null)

describe('one tool set', () => {
  it.live('gives both roles a tool for each of the window’s buttons, and the coordinator every tool but a lead’s own', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Prototype the browser' }),
        projectId: project.projectId,
        title: 'Prototype the browser',
      })
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: created.threadId,
        sessionId: 'none',
        taskId: created.taskId,
      }
      const theirs = { coordinator: yield* listTools(coordinator), lead: yield* listTools(lead) }

      const missing = Object.entries(WINDOW_ACTIONS).flatMap(([name, action]: [string, WindowAction]) => {
        const tool = toolOf(action)
        if (tool !== null)
          return (['coordinator', 'lead'] as const).flatMap((role) =>
            theirs[role].includes(tool) ? [] : [`${name}: ${role} lacks ${tool}`],
          )
        return 'own' in action && !theirs.lead.includes(action.own) ? [`${name}: the lead lacks ${action.own}`] : []
      })
      assert.deepStrictEqual(missing, [])

      // One set: the coordinator has all a lead has but what is the lead's own task's, and nothing a lead hasn't.
      assert.deepStrictEqual(
        theirs.coordinator.filter((tool) => !theirs.lead.includes(tool)),
        [],
      )
      assert.deepStrictEqual(
        theirs.lead.filter((tool) => !theirs.coordinator.includes(tool) && !OWN.includes(tool)),
        [],
      )
    }).pipe(Effect.provide(runtime())),
  )
})
