import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { openTasks, projectOverview } from '../src/handover'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import { repository, runtime, until } from './support'

/*
 * What a fresh coordinator session is told of the project and its open
 * tasks, where handover.test.ts doesn't go: a project that is a folder of a
 * larger repository, a step that needs the person, and calls of every shape.
 */

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

const modelOf = (step: { readonly agentId: string; readonly model: string | null }) => step.model ?? step.agentId

describe('the project, as a handover brief gives it', () => {
  it.live('says the folder of its repository the project is about', () =>
    Effect.gen(function* () {
      const root = repository()
      mkdirSync(join(root, 'apps', 'web'), { recursive: true })
      writeFileSync(join(root, 'apps', 'web', 'index.html'), '<h1>Meridian</h1>\n')
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'add', '.'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'commit', '-q', '-m', 'Web'], { cwd: root })
      const { projectId } = yield* open(join(root, 'apps', 'web'))
      const overview = yield* projectOverview(projectId)
      assert.match(overview, /\(main\), on this computer at .*; the project is its folder apps\/web$/m)
      assert.include(overview, 'Tasks: 0 open, 0 planned and not yet started.')
    }).pipe(Effect.provide(runtime())),
  )
})

describe("a handover brief's open tasks, at their edges", () => {
  it.live('says a step that needs the person is under way, and every call that waits, in its own words', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const { projectId } = yield* open(repository())
      const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
      const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
      // Its lead refuses: the step can't go on without the person, saying nothing more.
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Refused',
        description: 'Do it. [lead:refuse]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: 'small', skipped: false }],
        reason: null,
        actorId: actor,
      })
      yield* plans.start(planId, actor)
      yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      yield* sql`UPDATE attention_requests SET payload = json_remove(payload, '$.detail') WHERE task_id = ${task.taskId}`
      // More calls: questions in their fields, and a review step that says a lot.
      const call = (n: number, kind: string, payload: unknown) =>
        sql`INSERT INTO attention_requests ${sql.insert({
          id: `attn_${String(n).repeat(32)}`,
          projectId,
          taskId: task.taskId,
          kind,
          payload: JSON.stringify(payload),
          state: 'open',
          createdAt: `2099-10-11T00:00:0${n}.000Z`,
        })}`
      yield* call(2, 'question', { fields: [{ question: '' }, { question: 'Postgres or SQLite?' }, { question: 'Which port?' }] })
      yield* call(3, 'question', { fields: [{ question: '' }], message: 42 })
      yield* call(4, 'stuck', { step: 'review', detail: 'x'.repeat(250) })
      // What its lead last reported, at length.
      yield* addItem({ projectId: projectId as ProjectId, threadId: task.threadId }, 'step_result', {
        step: 'implement',
        summary: `${'Changed the checkout.\n'.repeat(40)}`,
      })

      const { text } = yield* openTasks(projectId, modelOf, () => false)
      const [line, waiting, reported] = text.split('\n').slice(1)
      assert.strictEqual(
        line,
        `- refused: Refused. Under way. Plan: small leads, no review; it ends on its branch, with nothing sent to the host.`,
      )
      assert.strictEqual(
        waiting,
        `  Waiting on the person: its implement step can't go on without them; a question from its lead: Postgres or SQLite? / Which port?; a question from its lead: ; its review step can't go on without them: ${'x'.repeat(200)}….`,
      )
      assert.isTrue(reported?.startsWith('  Its lead last reported: Changed the checkout. Changed the checkout.'))
      assert.isTrue(reported?.endsWith('…'))
      assert.strictEqual(reported?.length, '  Its lead last reported: '.length + 601)
    }).pipe(Effect.provide(runtime())),
  )
})
