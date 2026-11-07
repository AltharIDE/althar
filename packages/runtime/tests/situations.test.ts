import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { overlapLine } from '../src/Overlaps'
import { Permissions, refusedWords, setAsideWords } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { endedLine, endedNews, reportLine, Situations } from '../src/Situations'
import { Tasks } from '../src/Tasks'
import { runtime, task, turns, until } from './support'

/*
 * The thread situations (ADR-097): a command the person's Never rule refused,
 * said as Althar's line and as the lead's result; a call that waits while
 * the person is away, which doesn't hold its lead's turn; a task a lead
 * started that ended without reaching it; and two tasks changing the same
 * files.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const finished = (row: { readonly state: string }) => !['pending', 'delivered'].includes(row.state)

/** A task under "Ask me" with its lead's session started, and a way to ask its permissions as that lead. */
const lead = Effect.gen(function* () {
  const sessions = yield* Sessions
  const instance = yield* Instance
  const policies = yield* Policies
  const permissions = yield* Permissions
  const sql = yield* SqlClient.SqlClient
  const { project, task: created } = yield* task()
  const projectId = project.projectId as ProjectId
  yield* policies.set(projectId, { permissions: 'ask' }, instance.personId)
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows.every(finished))
  const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
  let calls = 0
  return {
    projectId,
    created,
    sessionId,
    ask: (command: string) =>
      permissions.decide(
        {
          projectId,
          threadId: created.threadId,
          taskId: created.taskId,
          sessionId,
          meanings: { rejectAndContinue: ['decline'], rejectAndStop: ['cancel'], allowScopes: { allow_once: 'once' } },
          rules: { role: 'task', context: { worktree: workspace?.path ?? '', defaultBranch: 'main' } },
        },
        {
          sessionId: 'fake',
          toolCallId: `situation-${(calls += 1)}`,
          title: `Run ${command}`,
          kind: 'execute',
          rawInput: { command },
          paths: [],
          options: [
            { optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
            { optionId: 'decline', name: 'No', kind: 'reject_once' },
          ],
        },
      ),
  }
})

/** The open call on a thread, as its screen reads it, once it waits. */
const waiting = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const [call] = yield* until(
      Effect.map(queries.thread(threadId), (thread) => thread.attention),
      (calls) => calls.length > 0,
    )
    if (call === undefined) return yield* Effect.die(new Error('no call'))
    return call
  })

const answer = (attentionId: string, decision: 'allow' | 'reject') =>
  Effect.gen(function* () {
    const permissions = yield* Permissions
    return yield* permissions.answer({
      envelope: yield* Runtime.envelope('attention.answer', { attentionId, decision }),
      attentionId,
      decision,
    })
  })

describe('the words of a situation', () => {
  it('says a Never rule’s refusal as the rule’s own, and leaves other refusals alone', () => {
    assert.strictEqual(refusedWords("The project's rules never allow `rm -rf ~/Library`."), 'Refused by your rule `rm -rf ~/Library`.')
    assert.strictEqual(refusedWords("The project's rules never allow force pushes."), 'Refused by your rule against force pushes.')
    assert.strictEqual(refusedWords('This role may not write.'), 'This role may not write.')
  })

  it('takes a child’s report as one short line', () => {
    assert.strictEqual(
      reportLine('Codex’s sandbox has no network switch. I tried two other ways.'),
      'Codex’s sandbox has no network switch.',
    )
    assert.strictEqual(reportLine(undefined), undefined)
    assert.strictEqual(reportLine('x'.repeat(200))?.length, 158)
  })

  it('says how a child ended, to the person and to the lead', () => {
    assert.strictEqual(endedLine('Reach the network', 'unchanged', 'No switch.'), 'Reach the network stopped without a change: No switch.')
    assert.strictEqual(endedLine('Reach the network', 'stopped', 'ignored'), 'Reach the network stopped by you.')
    assert.strictEqual(endedLine('Reach the network', 'failed'), 'Reach the network failed.')
    const news = endedNews({ title: 'Reach the network', slug: 'reach-the-network' }, 'stopped')
    assert.include(news, 'was stopped by the person')
    assert.include(news, 'reach-the-network')
  })

  it('names the files two tasks both change by their file names', () => {
    assert.strictEqual(
      overlapLine('Runs show in the pill', ['apps/desktop/src/TaskView.tsx']),
      'Runs show in the pill changes `TaskView.tsx` too. Both leads were told.',
    )
    assert.strictEqual(
      overlapLine('Other', ['a/One.ts', 'b/Two.ts', 'c/Three.ts']),
      'Other changes `One.ts`, `Two.ts` and 1 more too. Both leads were told.',
    )
  })
})

describe('A Never rule an agent meets', () => {
  it.live('refuses at once with the rule’s words, and asks nothing', () =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const queries = yield* Queries
      const met = yield* lead
      yield* policies.set(met.projectId, { commands: [{ pattern: 'rm -rf ~/Library', decision: 'never' }] }, instance.personId)
      const decision = yield* met.ask('rm -rf ~/Library')
      assert.deepStrictEqual(decision, {
        decision: 'reject',
        reason: 'Refused by your rule `rm -rf ~/Library`.',
        decidedBy: 'rules',
      })
      assert.deepStrictEqual((yield* queries.thread(met.created.threadId)).attention, [])
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('An ask that waits while the person is away', () => {
  it.live('records where it reached the person, and lets its lead go on without holding the turn', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const sql = yield* SqlClient.SqlClient
      const met = yield* lead
      const asked = yield* Effect.forkChild(met.ask('git status'))
      const call = yield* waiting(met.created.threadId)
      assert.isUndefined(call.reached)
      const at = new Date(Date.now() - 4 * 60_000).toISOString()
      yield* permissions.reached(call.id, 'iPhone', at)
      // Only the first device is kept.
      yield* permissions.reached(call.id, 'iPad', new Date().toISOString())
      const reached = yield* waiting(met.created.threadId)
      assert.deepStrictEqual(reached.reached, { device: 'iPhone', at })
      // The session waits on it until the lead is let go on.
      const state = () =>
        sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${met.sessionId}`.pipe(Effect.map((rows) => rows[0]?.state))
      assert.strictEqual(yield* state(), 'waiting_approval')
      assert.isTrue(yield* permissions.setAside(call.id))
      // The lead is told so as the call's result; the call stays open, set aside, for the person.
      assert.deepStrictEqual(yield* Fiber.join(asked), { decision: 'reject', reason: setAsideWords })
      assert.strictEqual(yield* state(), 'active')
      const kept = yield* waiting(met.created.threadId)
      assert.strictEqual(kept.id, call.id)
      assert.isTrue(kept.setAside)
      // Not twice.
      assert.isFalse(yield* permissions.setAside(call.id))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('keeps the call until answered: allowed, it goes through once the lead makes it again', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const queries = yield* Queries
      const met = yield* lead
      const asked = yield* Effect.forkChild(met.ask('git status'))
      const call = yield* waiting(met.created.threadId)
      yield* permissions.setAside(call.id)
      yield* Fiber.join(asked)
      yield* answer(call.id, 'allow')
      assert.deepStrictEqual((yield* queries.thread(met.created.threadId)).attention, [])
      // Again, it asks no one and is let through, once.
      const again = yield* met.ask('git status')
      assert.strictEqual(again.decision, 'allow')
      assert.deepStrictEqual((yield* queries.thread(met.created.threadId)).attention, [])
      const third = yield* Effect.forkChild(met.ask('git status'))
      const asks = yield* waiting(met.created.threadId)
      assert.notStrictEqual(asks.id, call.id)
      yield* answer(asks.id, 'reject')
      assert.strictEqual((yield* Fiber.join(third)).decision, 'reject')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stays open to answer when its session ends, and the allowed call still goes through once', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const queries = yield* Queries
      const met = yield* lead
      const asked = yield* Effect.forkChild(met.ask('git status'))
      const call = yield* waiting(met.created.threadId)
      yield* permissions.setAside(call.id)
      yield* Fiber.join(asked)
      // The lead's session closes, as when it ends its turn, crashes or is stopped.
      yield* permissions.withdrawAll(met.sessionId)
      const kept = yield* waiting(met.created.threadId)
      assert.strictEqual(kept.id, call.id)
      assert.isTrue(kept.setAside)
      yield* answer(call.id, 'allow')
      assert.deepStrictEqual((yield* queries.thread(met.created.threadId)).attention, [])
      assert.strictEqual((yield* met.ask('git status')).decision, 'allow')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('lets the lead go on once a request that reached a device has waited long enough, and not before', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const situations = yield* Situations
      const met = yield* lead
      const asked = yield* Effect.forkChild(met.ask('git status'))
      const call = yield* waiting(met.created.threadId)
      yield* permissions.reached(call.id, 'iPhone', new Date().toISOString())
      yield* situations.look()
      assert.isUndefined((yield* waiting(met.created.threadId)).setAside)
      const fresh = yield* waiting(met.created.threadId)
      assert.strictEqual(fresh.id, call.id)
      yield* answer(call.id, 'reject')
      yield* Fiber.join(asked)
    }).pipe(Effect.provide(withQueries())),
  )
})

/** A task and a child it started, and the child's thread. */
const parentAndChild = Effect.gen(function* () {
  const projects = yield* Projects
  const sql = yield* SqlClient.SqlClient
  const { project, task: parent } = yield* task('Parent')
  const child = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', { title: 'Reach the network' }),
    projectId: project.projectId,
    title: 'Reach the network',
  })
  yield* sql`UPDATE tasks SET parent_task_id = ${parent.taskId} WHERE id = ${child.taskId}`
  return { project, parent, child }
})

/** What a thread's notices say, with the situation each carries, as the store kept them. */
const notices = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY sequence`
    return rows.flatMap((row) => {
      const content = JSON.parse(row.content) as {
        title: string
        severity: string
        task?: { title: string }
        situation?: unknown
      }
      return content.situation === undefined
        ? []
        : [{ title: content.title, severity: content.severity, task: content.task?.title, situation: content.situation }]
    })
  })

describe('An ask that has waited past its grace', () => {
  it.live('is set aside by the next look, and its lead told the person is away', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const situations = yield* Situations
      const met = yield* lead
      const asked = yield* Effect.forkChild(met.ask('git status'))
      const call = yield* waiting(met.created.threadId)
      yield* permissions.reached(call.id, 'iPhone', new Date(Date.now() - 4 * 60_000).toISOString())
      yield* situations.look()
      assert.deepStrictEqual(yield* Fiber.join(asked), { decision: 'reject', reason: setAsideWords })
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('A lead-started task that stops reaching its parent', () => {
  it.live('settled without a change: a warning line in the parent’s thread, once', () =>
    Effect.gen(function* () {
      const situations = yield* Situations
      const sql = yield* SqlClient.SqlClient
      const { parent, child } = yield* parentAndChild
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${child.taskId}`
      yield* sql`INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, content, created_at)
        SELECT 'item_00000000000000000000000000000001', project_id, ${child.threadId}, 1, 'step_result',
          '{"step":"implement","round":0,"summary":"The sandbox has no network switch. I tried two other ways.","change":null,"verdict":null,"findings":[],"built":null,"evidence":[],"unverified":null}',
          '2026-11-07T10:00:00.000Z' FROM tasks WHERE id = ${child.taskId}`
      yield* situations.look()
      yield* situations.look()
      assert.deepStrictEqual(yield* notices(parent.threadId), [
        {
          title: 'Reach the network stopped without a change: The sandbox has no network switch.',
          severity: 'warning',
          task: 'Reach the network',
          situation: { kind: 'ended', how: 'unchanged', why: 'The sandbox has no network switch.' },
        },
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('stopped by the person: said as such', () =>
    Effect.gen(function* () {
      const situations = yield* Situations
      const tasks = yield* Tasks
      const { parent, child } = yield* parentAndChild
      yield* tasks.abandon({
        envelope: yield* Runtime.envelope('task.abandon', { taskId: child.taskId }),
        taskId: child.taskId,
      })
      yield* situations.look()
      assert.deepStrictEqual(yield* notices(parent.threadId), [
        {
          title: 'Reach the network stopped by you.',
          severity: 'warning',
          task: 'Reach the network',
          situation: { kind: 'ended', how: 'stopped' },
        },
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('a task nobody started, ended, says nothing', () =>
    Effect.gen(function* () {
      const situations = yield* Situations
      const sql = yield* SqlClient.SqlClient
      const { task: parent } = yield* task('Alone')
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${parent.taskId}`
      yield* situations.look()
      assert.deepStrictEqual(yield* notices(parent.threadId), [])
    }).pipe(Effect.provide(withQueries())),
  )
})
