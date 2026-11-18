import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { conversation, EARLIER_PERSON, EARLIER_REST, FINISHED_SHOWN, recentlyFinished } from '../src/handover'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import { repository, runtime, until } from './support'
import { knownModels } from './knownModels'

/*
 * Every coordinator session starts from Althar's record of the project
 * (ADR-031), not only one handed a full context over: on opening the
 * project, after a relaunch or on another agent, it knows the project, what
 * its repositories tell agents, its open tasks and those finished last, and
 * the conversation, its earlier part in short.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

/** A repository whose AGENTS.md says how its code is laid out, and whose CLAUDE.md only imports it. */
const instructed = () => {
  const root = repository()
  writeFileSync(join(root, 'AGENTS.md'), '# Meridian\n\nMigrations live in db/migrations; name them by date.\n')
  writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
  const git = (...args: Array<string>) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: root })
  git('add', '.')
  git('commit', '-q', '-m', 'Instructions for agents')
  return root
}

/** A task of the project, settled as `state` at `at`, with a merged pull request where one is given. */
const settled = (projectId: string, title: string, state: 'done' | 'abandoned', at: string, merged?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const made = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', { title }), projectId, title })
    yield* sql`UPDATE tasks SET state = ${state}, settled_at = ${at} WHERE id = ${made.taskId}`
    if (merged !== undefined)
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: `xlink_${made.taskId.slice(5)}`,
        projectId,
        taskId: made.taskId,
        product: 'github',
        kind: 'change',
        externalId: '7',
        ref: 'meridian/api#7',
        key: '#7',
        url: merged,
        snapshot: JSON.stringify({ state: 'merged', number: 7, url: merged }),
        createdAt: at,
        updatedAt: at,
      })}`
    return made
  })

describe("a coordinator session's brief", () => {
  it.live("starts every session from the record: the project, its repositories' instructions, and its tasks open and finished", () =>
    Effect.gen(function* () {
      yield* knownModels
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: instructed() })
      yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Add a retry' })
      yield* settled(projectId, 'Fix the login page', 'done', '2026-11-10T09:00:00.000Z', 'https://github.test/meridian/api/pull/7')
      yield* settled(projectId, 'Try a dark theme', 'abandoned', '2026-11-11T09:00:00.000Z')
      const threadId = yield* coordinator.thread(projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'Hello' }),
        threadId,
        body: 'Hello',
        disposition: 'after_current',
      })
      const [first] = yield* until(
        sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`,
        (rows) => rows.length >= 1,
      )
      const brief = first?.prompt ?? ''
      assert.match(brief, /^You are the coordinator of the project /)
      // Not a handover: nothing to take over.
      assert.notInclude(brief, 'You are taking over this conversation')
      assert.include(brief, 'The project, as project_overview gives it:\n\nProject: ')
      assert.include(brief, 'The project has no notes yet.')
      // What its repository tells agents, once, though CLAUDE.md imports it.
      assert.include(brief, "What the project's repositories tell the agents that work in them")
      assert.include(brief, 'Migrations live in db/migrations; name them by date.')
      assert.strictEqual(brief.split('Migrations live in db/migrations').length, 2)
      assert.include(brief, 'Open tasks, newest first:\n- add-a-retry: Add a retry. Open, with nothing running.')
      assert.include(
        brief,
        'The tasks finished last, newest first (find_tasks and read_task have the rest):\n- try-a-dark-theme: Try a dark theme. Discarded, 2026-11-11.\n- fix-the-login-page: Fix the login page. Merged, https://github.test/meridian/api/pull/7, 2026-11-10.',
      )
      assert.include(brief, 'Open errands (only their recorded next steps may act in a news turn):\nNone.')
      // The tasks' cards are all the conversation has so far; what the person said is the turn's own.
      assert.include(brief, 'The last messages of the conversation, oldest first:\n[task] add-a-retry: Add a retry\n')
      assert.match(brief, /\n\nHello$/)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('names only the tasks finished last, and none that is a chat on Scratch', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      assert.strictEqual(yield* recentlyFinished(projectId), 'No task of the project has finished yet.')
      for (let day = 1; day <= FINISHED_SHOWN + 2; day += 1)
        yield* settled(projectId, `Finished ${day}`, 'done', `2026-10-${String(day).padStart(2, '0')}T09:00:00.000Z`)
      const aside = yield* settled(projectId, 'A quick look', 'done', '2026-10-30T09:00:00.000Z')
      yield* sql`UPDATE tasks SET shelf = 'scratch' WHERE id = ${aside.taskId}`
      const said = yield* recentlyFinished(projectId)
      assert.notInclude(said, 'A quick look')
      assert.include(said, `- finished-${FINISHED_SHOWN + 2}: Finished ${FINISHED_SHOWN + 2}. Done, 2026-10-12.`)
      assert.notInclude(said, 'finished-2:')
      assert.strictEqual(said.split('\n').length, FINISHED_SHOWN + 1)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('carries the conversation before its last part in short: the person longer than the rest, and no tool calls', () =>
    Effect.gen(function* () {
      yield* knownModels
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const { projectId } = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(projectId)
      const say = (body: string, turns: number) =>
        Effect.gen(function* () {
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
          yield* until(
            sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
            (rows) => rows.length === turns && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
          )
          yield* until(
            sql<{ n: number }>`SELECT count(*) AS n FROM thread_items WHERE thread_id = ${threadId} AND kind = 'agent_message'`,
            (rows) => rows[0]?.n === turns,
          )
        })
      yield* say(`Let's plan the migration. ${'p'.repeat(EARLIER_PERSON)}`, 1)
      yield* addItem(
        { projectId: projectId as ProjectId, threadId },
        'tool_call',
        { title: 'git log', status: 'completed' },
        { toolCallId: 'call-git-log' },
      )
      yield* say('Ship it on Fridays only.', 2)
      const [earlier, recent] = yield* conversation(threadId, { budget: 2_000, last: 2 })
      assert.match(earlier ?? '', /^Earlier in the conversation, in short, oldest first: /)
      // The person's words up to EARLIER_PERSON, a reply's (here the fake's echo of its whole brief) up to EARLIER_REST.
      assert.include(earlier, `\n[person] Let's plan the migration. ${'p'.repeat(EARLIER_PERSON - 35)}…\n`)
      const reply = /\n(\[you\] echo: You are the coordinator [^\n]*)$/.exec(earlier ?? '')?.[1] ?? ''
      assert.strictEqual(reply.length, EARLIER_REST + '…'.length)
      assert.isTrue(reply.endsWith('…'))
      assert.notInclude(earlier, 'git log')
      // Counted in parts of the budget: the fake's echo of its brief is many.
      assert.match(
        recent ?? '',
        /^The last messages of the conversation, oldest first \(the \d+ before them are in short above\):\n\[person\] Ship it on Fridays only\.\n\[you\] echo: Ship it on Fridays only\.$/,
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
