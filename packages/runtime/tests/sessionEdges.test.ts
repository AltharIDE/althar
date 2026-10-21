import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, notices, repository, runtime, task, until } from './support'

/*
 * Sessions at their edges, where handover.test.ts, leadHandover.test.ts and
 * sessions.test.ts don't go: a coordinator handed over with one open task, a
 * lead handed over in a task of several repositories, and an agent that says
 * nothing of itself as it starts.
 */

/** How long a wait for a fake agent's turn may take: a handover starts a fresh session, slow on a loaded runner. */
const ROOM = Duration.seconds(40)

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** The thread's turns, oldest first: what each was prompted with, the session it went to, and where it stands. */
const prompts = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string; providerSessionId: string; state: string }>`
      SELECT prompt, provider_session_id, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** Waits until the thread has had this many turns, each over, and its session waits for the next. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      prompts(threadId),
      (rows) => rows.length === count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
      ROOM,
    )
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) && !running.value.turnRunning ? [true] : [])),
      (rows) => rows.length === 1,
      ROOM,
    )
  })

/** The thread's sessions, oldest first. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; state: string }>`
      SELECT id, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

describe('a coordinator handed to a fresh session', () => {
  it.live('says it picked up the one open task', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const say = (body: string) =>
        Effect.flatMap(Runtime.envelope('thread.send', { body }), (envelope) =>
          coordinator.say({ envelope, threadId, body, disposition: 'after_current' }),
        )
      yield* say('hello')
      yield* answered(threadId, 1)
      yield* callTool(access, 'draft_task', { title: 'Tidy the README' })
      yield* say('Where are we? [context:85]')
      yield* until(sessionsOn(threadId), (rows) => rows.length === 2 && rows[1]?.state === 'active', ROOM)
      assert.deepInclude(yield* notices(threadId), {
        source: 'runtime',
        severity: 'info',
        title: 'Started a fresh session; picked up 1 open task.',
      })
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a lead handed to a fresh session', () => {
  it.live(
    'in a task of several repositories, says it carries on in the same worktrees',
    () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const plans = yield* Plans
        const sessions = yield* Sessions
        const instance = yield* Instance
        const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
        for (const name of ['api', 'web']) {
          const path = join(folder, name)
          mkdirSync(path)
          git(path, 'init', '-q', '-b', 'main')
          writeFileSync(join(path, 'README.md'), `# ${name}\n`)
          git(path, 'add', '.')
          git(path, 'commit', '-q', '-m', 'Start')
        }
        const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: opened.projectId,
          title: 'Share the retry',
          description: 'Do it. [lead:finish]',
          draft: true,
          repositories: ['api', 'web'],
        })
        const planId = yield* plans.propose({
          projectId: opened.projectId as ProjectId,
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
          end: null,
          held: true,
        })
        yield* plans.start(planId, instance.personId)
        yield* answered(created.threadId, 1)
        const say = (body: string) =>
          Effect.flatMap(Runtime.envelope('thread.send', { body }), (envelope) =>
            sessions.send({ envelope, threadId: created.threadId, body, disposition: 'after_current' }),
          )
        // Past its mark: its next turn starts in a fresh session, briefed from the task.
        yield* say('Look again. [context:25/1000000]')
        yield* answered(created.threadId, 2)
        yield* say('And now?')
        const [, , first] = yield* until(prompts(created.threadId), (all) => all.length === 3 && all[2]?.state === 'completed', ROOM)
        assert.match(first?.prompt ?? '', /^You are carrying on a task an earlier session of yours worked on, in the same worktrees:/)
        assert.lengthOf(yield* sessionsOn(created.threadId), 2)
      }).pipe(Effect.provide(runtime())),
    60_000,
  )
})

describe('an agent that says nothing of itself as it starts', () => {
  it.live('starts all the same, and takes its turns', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* until(prompts(created.threadId), (rows) => rows[0]?.state === 'completed')
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: created.threadId, body: 'hello' })
      const said = yield* until(
        Effect.map(items(created.threadId), (all) => all.filter((item) => item.kind === 'agent_message')),
        (messages) => messages.length > 0,
      )
      assert.isNotEmpty(String(said[0]?.content.text))
    }).pipe(Effect.provide(runtime(':memory:', { bare: true }))),
  )
})
