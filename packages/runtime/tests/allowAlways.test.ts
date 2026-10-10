import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { AlwaysNotOffered, AttentionClosed } from '../src/errors'
import { Instance } from '../src/Instance'
import { Permissions, rememberedOf } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * Allow always and Deny always (ADR-017), with the fake agent running real
 * commands under "Ask me": an answer keeps a rule in the project's rules,
 * the next request it covers is answered by it and says so in the thread,
 * and taking the rule away makes it ask again. What always asks still asks.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

const finished = (row: { readonly state: string }) => !['pending', 'delivered'].includes(row.state)

/** Waits until `count` turns that carried input have ended. */
const ended = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.filter((row) => row.inputs > 0 && finished(row)).length >= count)

/** A task under "Ask me", with Codex working on it. */
const asking = Effect.gen(function* () {
  const policies = yield* Policies
  const instance = yield* Instance
  const sessions = yield* Sessions
  const made = yield* task()
  yield* policies.set(made.project.projectId, { permissions: 'ask' }, instance.personId)
  yield* sessions.start({ threadId: made.task.threadId, agentId: 'codex' })
  yield* until(turns(made.task.threadId), (rows) => rows.length >= 1 && rows.every(finished))
  return made
})

/** The calls open on a thread, as its screen reads them. */
const calls = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* queries.thread(threadId)).attention
  })

/** Waits for a call to open on a thread, and returns it. */
const waitingCall = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{
        id: string
      }>`SELECT a.id FROM attention_requests a JOIN threads t ON t.task_id = a.task_id WHERE t.id = ${threadId} AND a.state = 'open'`,
      (rows) => rows.length > 0,
    )
    const [call] = yield* calls(threadId)
    if (call === undefined) return yield* Effect.die(new Error('no call'))
    return call
  })

/** What the agent said, in order, leaving out the fake agent's echo of its brief. */
const said = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* queries.thread(threadId)).items.flatMap((item) =>
      item.kind === 'agent_message' && !item.content.text.startsWith('echo: ') ? [item.content.text] : [],
    )
  })

/** The thread's tool calls, as its screen reads them: the command each ran, and the rule that let it through. */
const tools = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* queries.thread(threadId)).items.flatMap((item) =>
      item.kind === 'tool_call' ? [{ command: item.content.command, allowedBy: item.content.allowedBy ?? null }] : [],
    )
  })

const answer = (attentionId: string, decision: 'allow' | 'reject', always?: 'exact' | 'prefix' | 'kind') =>
  Effect.gen(function* () {
    const permissions = yield* Permissions
    return yield* permissions.answer({
      envelope: yield* Runtime.envelope('attention.answer', { attentionId, decision, always }),
      attentionId,
      decision,
      ...(always === undefined ? {} : { always }),
    })
  })

describe('Allow always and Deny always (ADR-017)', () => {
  it.live('Allow always for `git status` by how it starts: the next is let through by the rule, says so, and the rule is kept', () =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* asking
      const threadId = created.threadId

      yield* say(threadId, `${scenarios.run}git status`)
      const call = yield* waitingCall(threadId)
      // What an always would keep: the command, and how it starts, each of which would hold.
      assert.deepStrictEqual(call.always, {
        command: 'git status',
        prefix: 'git status',
        kind: null,
        allow: ['exact', 'prefix'],
        deny: ['exact', 'prefix'],
      })
      yield* answer(call.id, 'allow', 'prefix')
      yield* ended(threadId, 1)

      // The rule is the project's now, as the person's.
      const kept = yield* policies.current(project.projectId as ProjectId)
      assert.deepStrictEqual(kept.rules.commands, [{ pattern: 'git status', decision: 'allow' }])

      // The next `git status …` doesn't ask, and the thread says which rule let it through.
      yield* say(threadId, `${scenarios.run}git status --short`)
      yield* ended(threadId, 2)
      assert.deepStrictEqual(yield* calls(threadId), [])
      assert.deepStrictEqual(yield* said(threadId), ['ran=allow_once', 'ran=allow_once'])
      assert.deepStrictEqual(yield* tools(threadId), [
        { command: 'git status', allowedBy: null },
        { command: 'git status --short', allowedBy: { pattern: 'git status', match: 'prefix' } },
      ])
      const decisions = yield* sql<{ actor: string; reason: string | null; rule: string | null; policyId: string | null }>`
        SELECT a.kind AS actor, d.reason, d.rule, d.policy_id FROM decisions d JOIN actors a ON a.id = d.decided_by_actor_id ORDER BY d.rowid`
      assert.deepStrictEqual(decisions, [
        { actor: 'person', reason: null, rule: null, policyId: null },
        {
          actor: 'system',
          reason: 'Always allowed: commands starting `git status`.',
          rule: JSON.stringify([{ pattern: 'git status', match: 'prefix' }]),
          policyId: kept.id,
        },
      ])
      // The person's answer records the rule it kept.
      const [made] = yield* sql<{
        payload: string
      }>`SELECT payload FROM record_events WHERE type = 'decision.made' ORDER BY sequence LIMIT 1`
      assert.deepStrictEqual(JSON.parse(made?.payload ?? '{}').saved, { decision: 'allow', pattern: 'git status', match: 'prefix' })

      // Taken off the rules, it asks again.
      yield* policies.set(project.projectId, { commands: [] }, (yield* Instance).personId)
      yield* say(threadId, `${scenarios.run}git status -s`)
      const again = yield* waitingCall(threadId)
      assert.strictEqual(again.command, 'git status -s')
      yield* answer(again.id, 'allow')
      yield* ended(threadId, 3)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('A command on the always-ask list still asks, whatever the allow rules say, and Allow always isn’t offered', () =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const { project, task: created } = yield* asking
      yield* policies.set(
        project.projectId,
        {
          commands: [
            { pattern: 'git', decision: 'allow' },
            { pattern: 'git status', decision: 'ask' },
          ],
        },
        instance.personId,
      )
      yield* say(created.threadId, `${scenarios.run}git status`)
      const call = yield* waitingCall(created.threadId)
      assert.strictEqual(call.reason, "The project's rules ask before `git status`.")
      assert.deepStrictEqual([call.always?.allow, call.always?.deny], [[], ['exact', 'prefix']])
      // An always it wasn't offered is refused, and the call still waits.
      const refused = yield* Effect.flip(answer(call.id, 'allow', 'prefix'))
      assert.instanceOf(refused, AlwaysNotOffered)
      assert.lengthOf(yield* calls(created.threadId), 1)
      yield* answer(call.id, 'allow')
      yield* ended(created.threadId, 1)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('Deny always keeps a never rule: the next is refused without asking', () =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const { project, task: created } = yield* asking
      yield* say(created.threadId, `${scenarios.run}rm -rf build`)
      const call = yield* waitingCall(created.threadId)
      assert.strictEqual(call.always?.prefix, 'rm')
      yield* answer(call.id, 'reject', 'exact')
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual((yield* policies.current(project.projectId as ProjectId)).rules.commands, [
        { pattern: 'rm -rf build', decision: 'never', match: 'exact' },
      ])
      yield* say(created.threadId, `${scenarios.run}rm -rf build`)
      yield* ended(created.threadId, 2)
      assert.deepStrictEqual(yield* calls(created.threadId), [])
      assert.deepStrictEqual(yield* said(created.threadId), ['ran=decline', 'ran=decline'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('A rule kept answers the other calls it covers, and changing the rules answers what they no longer keep', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const permissions = yield* Permissions
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* asking
      // A second task in the same project, its lead asking the same at the same time.
      const projects = yield* Projects
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Second' }),
        projectId: project.projectId,
        title: 'Second',
      })
      yield* sessions.start({ threadId: other.threadId, agentId: 'codex' })
      yield* until(turns(other.threadId), (rows) => rows.length >= 1 && rows.every(finished))

      yield* say(created.threadId, `${scenarios.run}bun test src/a.test.ts`)
      yield* say(other.threadId, `${scenarios.run}bun test src/b.test.ts`)
      const first = yield* waitingCall(created.threadId)
      yield* waitingCall(other.threadId)
      yield* answer(first.id, 'allow', 'prefix')
      yield* ended(created.threadId, 1)
      // The other's call is answered by the rule, and its lead carries on.
      yield* ended(other.threadId, 1)
      assert.deepStrictEqual(yield* said(other.threadId), ['ran=allow_once'])
      const [settled] = yield* sql<{ state: string }>`
        SELECT a.state FROM attention_requests a JOIN tasks k ON k.id = a.task_id WHERE k.id = ${other.taskId}`
      assert.strictEqual(settled?.state, 'answered')
      assert.deepStrictEqual((yield* tools(other.threadId)).at(-1)?.allowedBy, { pattern: 'bun test', match: 'prefix' })

      // A call still waiting when the person lets everything through on the rules screen is let through.
      yield* say(created.threadId, `${scenarios.run}cargo build`)
      yield* waitingCall(created.threadId)
      yield* policies.set(project.projectId, { permissions: 'allow' }, instance.personId)
      yield* permissions.reconsider(project.projectId)
      yield* ended(created.threadId, 2)
      assert.deepStrictEqual(yield* calls(created.threadId), [])
      assert.deepStrictEqual((yield* tools(created.threadId)).at(-1), { command: 'cargo build', allowedBy: null })
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('the rule an always answer keeps (ADR-017)', () => {
  const always = {
    command: 'make deploy',
    prefix: 'make deploy',
    kind: 'deploy' as const,
    allow: ['exact', 'prefix'] as const,
    deny: ['exact', 'prefix', 'kind'] as const,
  }

  it('is the one offered by that scope, let through or never allowed, and none that wasn’t offered', () => {
    assert.deepStrictEqual(rememberedOf(always, 'allow', 'exact'), { decision: 'allow', pattern: 'make deploy', match: 'exact' })
    assert.deepStrictEqual(rememberedOf(always, 'allow', 'prefix'), { decision: 'allow', pattern: 'make deploy', match: 'prefix' })
    assert.deepStrictEqual(rememberedOf(always, 'reject', 'kind'), { decision: 'never', kind: 'deploy' })
    assert.isUndefined(rememberedOf(always, 'allow', 'kind'))
    // Nor one whose words it hasn't, whatever it says it offers.
    const bare = { command: null, prefix: null, kind: null, allow: ['exact', 'prefix', 'kind'] as const, deny: [] }
    assert.isUndefined(rememberedOf(bare, 'allow', 'exact'))
    assert.isUndefined(rememberedOf(bare, 'allow', 'prefix'))
    assert.isUndefined(rememberedOf(bare, 'allow', 'kind'))
  })
})

describe('answers that meet each other', () => {
  it.live('refuses an answer to a call the rules answered meanwhile, and leaves a call nobody else answered alone', () =>
    Effect.gen(function* () {
      const permissions = yield* Permissions
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* asking
      yield* say(created.threadId, `${scenarios.run}git status`)
      const call = yield* waitingCall(created.threadId)
      // Another fiber's transaction answered it a moment before: the person's answer is too late, and the rules leave it be.
      yield* sql`UPDATE attention_requests SET state = 'answered' WHERE id = ${call.id}`
      assert.instanceOf(yield* Effect.flip(answer(call.id, 'allow')), AttentionClosed)
      yield* policies.set(project.projectId, { permissions: 'allow' }, instance.personId)
      yield* permissions.reconsider(project.projectId)
      assert.deepStrictEqual(yield* sql`SELECT id FROM decisions`, [])
      // Opened again, the rules answer it.
      yield* sql`UPDATE attention_requests SET state = 'open' WHERE id = ${call.id}`
      yield* permissions.reconsider(project.projectId)
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['ran=allow_once'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('answers a call whose session is already back at work without moving it again', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* asking
      yield* say(created.threadId, `${scenarios.run}git status`)
      const call = yield* waitingCall(created.threadId)
      yield* sql`UPDATE provider_sessions SET state = 'active' WHERE thread_id = ${created.threadId} AND state = 'waiting_approval'`
      yield* answer(call.id, 'allow')
      yield* ended(created.threadId, 1)
      assert.deepStrictEqual(yield* said(created.threadId), ['ran=allow_once'])
    }).pipe(Effect.provide(withQueries())),
  )
})
