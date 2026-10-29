import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import type { UsageWindow } from '@althar/provider-adapters'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits, lowWords, NEARLY_OUT, roomWords, whenWords, windowWords } from '../src/Limits'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import type { PlanStep } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { usableModels } from '../src/usableModels'
import { items, repository, runtime, until } from './support'

/*
 * Steering new work by the plans' windows as last read (Limits): a new step
 * on an agent nearly out goes elsewhere, waits for the reset, or asks the
 * person, as the project's rule for usage limits says; work starts on the
 * account with the most room; and a step that can't go elsewhere starts on
 * what is left.
 */

const HOUR = 60 * 60 * 1000

const withAgents = (each: Readonly<Record<string, FakeAgentOptions>> = {}, database = ':memory:') =>
  Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { each })))

const planned = (steps: ReadonlyArray<PlanStep>, title = 'Retry the checkout [lead:finish]') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps,
      reason: null,
      actorId: instance.personId,
      startsIn: Duration.minutes(5),
      end: null,
    })
    return { projectId: project.projectId, task, start: plans.start(planId, instance.personId) }
  })

const cardOf = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const said = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [(item.content as { title: string }).title] : [])))

const rule = (policy: 'wait' | 'ask') => (projectId: string) =>
  Effect.gen(function* () {
    const policies = yield* Policies
    const instance = yield* Instance
    yield* policies.setUsageLimit(projectId, policy, instance.personId)
  })

const first = (agentId: string) =>
  Effect.gen(function* () {
    const [account] = yield* (yield* Accounts).of(agentId)
    return account?.id ?? ''
  })

/** What PlanUsage would have kept for an account: its windows, as last read. */
const reading = (accountId: string, agentId: string, windows: ReadonlyArray<UsageWindow>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO plan_usage_readings ${sql.insert({ accountId, agentId, source: 'agent', plan: null, windows: JSON.stringify(windows), observedAt: new Date().toISOString() })}
      ON CONFLICT (account_id) DO UPDATE SET windows = excluded.windows`
  })

/** A plan with this much of its five hours left, until then, and plenty of its week. */
const left = (percent: number, resetsAt: string): ReadonlyArray<UsageWindow> => [
  { kind: 'five_hour', usedPercent: 100 - percent, resetsAt },
  { kind: 'weekly', usedPercent: 20, resetsAt: new Date(Date.now() + 100 * HOUR).toISOString() },
]

const second = (at: number) => new Date(Math.ceil(at / 1000) * 1000).toISOString()

const lead = (agentId: string, model: string | null = null): PlanStep => ({ key: 'implement', agentId, model, skipped: false })

describe('a new step on an agent nearly out', () => {
  it.live('goes to an agent with room where the project moves on, and the thread says why', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* reading(yield* first('claude-code'), 'claude-code', left(3, resetsAt))
      yield* start
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'codex')
      assert.deepStrictEqual(
        (yield* said(task.threadId))[0],
        `Fake claude-code has 3% of its five-hour limit left, until ${whenWords(resetsAt)}, so Fake codex takes the work instead.`,
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('starts on what is left where no other agent has room, and says nothing of it', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      for (const agentId of ['claude-code', 'codex', 'opencode']) yield* reading(yield* first(agentId), agentId, left(2, resetsAt))
      yield* start
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'claude-code')
      assert.isFalse((yield* said(task.threadId)).some((title) => title.includes('left')))
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('waits for the reset before it starts where the project waits, and starts then, on the same agent', () => {
    const back = Date.now() + 2500
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* rule('wait')(projectId)
      yield* reading(yield* first('claude-code'), 'claude-code', left(3, new Date(back).toISOString()))
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual(
        [held?.step, held?.waits?.agentId, held?.waits?.left, held?.waits?.why],
        ['implement', 'claude-code', 3, 'waits'],
      )
      assert.match(
        (yield* said(task.threadId))[0] ?? '',
        /^Fake claude-code has 3% of its five-hour limit left, so the work waits until .+\. To carry on now, pick another model on the task\.$/,
      )
      // Nothing started on it meanwhile.
      assert.deepStrictEqual(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`, [])
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual([ready?.lead, ready?.waits], ['claude-code', null])
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('asks the person before it starts where the project asks, with the agent itself among the ways on', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, start } = yield* planned([lead('claude-code')])
      yield* rule('ask')(projectId)
      const claude = yield* first('claude-code')
      yield* reading(claude, 'claude-code', left(4, resetsAt))
      yield* start
      const [call] = yield* until(
        sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const payload = JSON.parse(call?.payload ?? '{}') as {
        why: string
        limit: { accountId: string; resetsAt: string; left: number; choices: ReadonlyArray<{ agentId: string; accountId: string }> }
      }
      assert.strictEqual(payload.why, 'usage_limit')
      assert.deepStrictEqual([payload.limit.accountId, payload.limit.resetsAt, payload.limit.left], [claude, resetsAt, 4])
      assert.includeDeepMembers(
        payload.limit.choices.map((choice) => [choice.agentId, choice.accountId]),
        [['claude-code', claude]],
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('runs a review planned on an agent nearly out on one with room, other than the lead’s', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { task, start } = yield* planned([lead('claude-code'), { key: 'review', agentId: 'codex', model: null, skipped: false }])
      yield* reading(yield* first('codex'), 'codex', left(1, resetsAt))
      yield* start
      yield* until(said(task.threadId), (titles) => titles.some((title) => title.includes('takes the review instead')))
      assert.include(
        yield* said(task.threadId),
        `Fake codex has 1% of its five-hour limit left, until ${whenWords(resetsAt)}, so Fake opencode takes the review instead.`,
      )
    }).pipe(Effect.provide(withAgents()))
  })
})

/* The lead's plan reviewed slowly, so a reading can fall while the review runs, between the lead's steps or the review's rounds. */
const reviewed = <E, R>(lowered: (projectId: string) => Effect.Effect<void, E, R>, policy?: 'wait' | 'ask') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const steps = [lead('claude-code'), { key: 'review', agentId: 'codex', model: null, skipped: false } as const]
    const { projectId, task, start } = yield* planned(
      steps,
      'Retry the checkout [lead:finish] [lead:edit] [review:findings] [review:slowly]',
    )
    // A run goes by the rule it started under.
    if (policy !== undefined) yield* rule(policy)(projectId)
    yield* start
    yield* until(
      sql<{ state: string }>`
        SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review' AND a.state = 'running'`,
      (rows) => rows.length === 1,
    )
    yield* lowered(projectId)
    return { projectId, task }
  })

const sessionsOn = (threadId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ agentId: string; accountId: string }>`
    SELECT agent_id, account_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`,
  )

describe('a settle step on a lead that fell nearly out since it worked', () => {
  it.live('goes to an agent with room where the project moves on, and the thread says why', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { projectId, task } = yield* reviewed(() =>
        Effect.flatMap(first('claude-code'), (claude) => reading(claude, 'claude-code', left(3, resetsAt))),
      )
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'opencode')
      assert.include(
        yield* said(task.threadId),
        `Fake claude-code has 3% of its five-hour limit left, until ${whenWords(resetsAt)}, so Fake opencode takes the fixes instead.`,
      )
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => session.agentId),
        ['claude-code', 'opencode'],
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('waits for the reset where the project waits, starting nothing meanwhile, and settles then on the same lead', () =>
    Effect.gen(function* () {
      let back = 0
      const { projectId, task } = yield* reviewed(
        () =>
          Effect.gen(function* () {
            back = Date.now() + 8000
            yield* reading(yield* first('claude-code'), 'claude-code', left(3, new Date(back).toISOString()))
          }),
        'wait',
      )
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual([held?.step, held?.waits?.agentId, held?.waits?.left, held?.waits?.why], ['settle', 'claude-code', 3, 'waits'])
      assert.isTrue(
        (yield* said(task.threadId)).some((title) =>
          title.startsWith('Fake claude-code has 3% of its five-hour limit left, so the fixes wait until '),
        ),
      )
      assert.isBelow(Date.now(), back)
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => session.agentId),
        ['claude-code'],
      )
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual([ready?.lead, ready?.waits], ['claude-code', null])
    }).pipe(Effect.provide(withAgents())),
  )

  it.live('asks the person where the project asks, with the lead itself among the ways on', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task } = yield* reviewed(
        () => Effect.flatMap(first('claude-code'), (claude) => reading(claude, 'claude-code', left(4, resetsAt))),
        'ask',
      )
      const [call] = yield* until(
        sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const payload = JSON.parse(call?.payload ?? '{}') as {
        step: string
        why: string
        limit: { left: number; resetsAt: string; choices: ReadonlyArray<{ agentId: string }> }
      }
      assert.deepStrictEqual(
        [payload.step, payload.why, payload.limit.left, payload.limit.resetsAt],
        ['settle', 'usage_limit', 4, resetsAt],
      )
      assert.include(
        payload.limit.choices.map((choice) => choice.agentId),
        'claude-code',
      )
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => session.agentId),
        ['claude-code'],
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('goes on on the lead’s account with room where the project rotates, and says so', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const policies = yield* Policies
      const instance = yield* Instance
      const usual = yield* first('claude-code')
      const work = yield* accounts.add({ agentId: 'claude-code', name: 'work', folder: mkdtempSync(join(tmpdir(), 'althar-settle-')) })
      yield* reading(usual, 'claude-code', left(80, resetsAt))
      const { projectId, task } = yield* reviewed((projectId) =>
        Effect.gen(function* () {
          yield* policies.setAccounts(projectId, { rotate: true }, instance.personId)
          yield* reading(usual, 'claude-code', left(3, resetsAt))
        }),
      )
      yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => [session.agentId, session.accountId]),
        [
          ['claude-code', usual],
          ['claude-code', work.id],
        ],
      )
      assert.isTrue(
        (yield* said(task.threadId)).some((title) =>
          /^Fake claude-code \(.+\) has 3% of its five-hour limit left, until .+, so Fake claude-code \(work\) takes the fixes instead\.$/.test(
            title,
          ),
        ),
      )
    }).pipe(Effect.provide(withAgents()))
  })

  /* The lead on the first of its two accounts, both nearly out once its work is in review, where the project rotates. */
  const bothLow = (resetsAt: string, policy?: 'wait' | 'ask') =>
    Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const usual = yield* first('claude-code')
      const work = yield* (yield* Accounts).add({
        agentId: 'claude-code',
        name: 'work',
        folder: mkdtempSync(join(tmpdir(), 'althar-settle-')),
      })
      yield* reading(usual, 'claude-code', left(80, resetsAt))
      const reviewing = yield* reviewed(
        (projectId) =>
          Effect.gen(function* () {
            yield* policies.setAccounts(projectId, { rotate: true }, instance.personId)
            yield* reading(usual, 'claude-code', left(1, resetsAt))
            yield* reading(work.id, 'claude-code', left(3, resetsAt))
          }),
        policy,
      )
      return { ...reviewing, usual }
    })

  it.live('goes by the project’s rule where it rotates but every account is nearly out: to an agent with room, where it moves on', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { projectId, task, usual } = yield* bothLow(resetsAt)
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'opencode')
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => [session.agentId, session.agentId === 'claude-code' ? session.accountId : '']),
        [
          ['claude-code', usual],
          ['opencode', ''],
        ],
      )
      assert.isTrue(
        (yield* said(task.threadId)).some((title) =>
          title.endsWith(`has 3% of its five-hour limit left, until ${whenWords(resetsAt)}, so Fake opencode takes the fixes instead.`),
        ),
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('waits for the reset where it rotates but every account is nearly out and the project waits, starting nothing meanwhile', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const { projectId, task, usual } = yield* bothLow(resetsAt, 'wait')
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual([held?.step, held?.waits?.agentId, held?.waits?.left], ['settle', 'claude-code', 3])
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => [session.agentId, session.accountId]),
        [['claude-code', usual]],
      )
    }).pipe(Effect.provide(withAgents()))
  })

  it.live('asks the person where it rotates but every account is nearly out and the project asks, starting nothing meanwhile', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task, usual } = yield* bothLow(resetsAt, 'ask')
      const [call] = yield* until(
        sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const payload = JSON.parse(call?.payload ?? '{}') as { step: string; why: string; limit: { left: number } }
      assert.deepStrictEqual([payload.step, payload.why, payload.limit.left], ['settle', 'usage_limit', 3])
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => [session.agentId, session.accountId]),
        [['claude-code', usual]],
      )
    }).pipe(Effect.provide(withAgents()))
  })
})

describe('a later round of review on a reviewer that fell nearly out since the last', () => {
  it.live('starts afresh on another of its agent’s accounts with room where the project rotates, and says so', () => {
    const resetsAt = second(Date.now() + HOUR)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const policies = yield* Policies
      const instance = yield* Instance
      const usual = yield* first('codex')
      const work = yield* (yield* Accounts).add({ agentId: 'codex', name: 'work', folder: mkdtempSync(join(tmpdir(), 'althar-review-')) })
      yield* reading(usual, 'codex', left(80, resetsAt))
      yield* reading(work.id, 'codex', left(60, resetsAt))
      // The first round reviews on the usual account; meanwhile it falls to 1%, while the other has 60%.
      const { projectId, task } = yield* reviewed((projectId) =>
        Effect.gen(function* () {
          yield* policies.setAccounts(projectId, { rotate: true }, instance.personId)
          yield* reading(usual, 'codex', left(1, resetsAt))
        }),
      )
      yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      const reviewers = yield* sql<{ agentId: string; accountId: string }>`
        SELECT s.agent_id, s.account_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND t.node_key = 'review' ORDER BY s.started_at, s.rowid`
      assert.deepStrictEqual(
        reviewers.map((session) => [session.agentId, session.accountId]),
        [
          ['codex', usual],
          ['codex', work.id],
        ],
      )
      assert.isTrue(
        (yield* said(task.threadId)).some((title) =>
          /^Fake codex \(.+\) has 1% of its five-hour limit left, until .+, so Fake codex \(work\) takes the review instead\.$/.test(title),
        ),
      )
    }).pipe(Effect.provide(withAgents()))
  })
})

describe('the account work starts on', () => {
  it.live('has the most room for the model asked for, where the model has a window of its own, and the coordinator is told it', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const limits = yield* Limits
      const policies = yield* Policies
      const instance = yield* Instance
      const projects = yield* Projects
      const usual = yield* first('codex')
      const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: mkdtempSync(join(tmpdir(), 'althar-model-')) })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* policies.setAccounts(project.projectId, { rotate: true }, instance.personId)
      const resetsAt = new Date(Date.now() + HOUR).toISOString()
      const large = (usedPercent: number): UsageWindow => ({ kind: 'weekly', label: 'Large', model: 'large', usedPercent, resetsAt })
      // The usual account has more of its plan left, but its large model's week is all but gone.
      yield* reading(usual, 'codex', [...left(90, resetsAt), large(99)])
      yield* reading(work.id, 'codex', [...left(60, resetsAt), large(40)])
      const pick = (model?: string) =>
        Effect.map(
          limits.pick({ agentId: 'codex', projectId: project.projectId, ...(model === undefined ? {} : { model }) }),
          (account) => account.id,
        )
      assert.deepStrictEqual([yield* pick(), yield* pick('small'), yield* pick('large')], [usual, usual, work.id])
      assert.isTrue(Option.isNone(yield* limits.nearlyOut('codex', project.projectId, 'large')))
      // list_models: each of Codex's models on the account it would start on, with that account's room for it.
      yield* until((yield* Models).catalog, (all) => all.every((agent) => !agent.probing))
      const routes = (yield* usableModels(project.projectId)).flatMap((model) => model.routes).filter((route) => route.agentId === 'codex')
      const each = routes.map((route) => [route.model, route.room?.accountId, route.room?.leftPercent] as const)
      assert.deepStrictEqual(
        each.toSorted((a, b) => a[0].localeCompare(b[0])),
        [
          ['large', work.id, 60],
          ['small', usual, 80],
        ],
      )
    }).pipe(Effect.provide(withAgents())),
  )

  it.live('is the one with the most room where the project rotates, and the first where it doesn’t', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const limits = yield* Limits
      const policies = yield* Policies
      const instance = yield* Instance
      const projects = yield* Projects
      const usual = yield* first('codex')
      const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: mkdtempSync(join(tmpdir(), 'althar-room-')) })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const resetsAt = new Date(Date.now() + HOUR).toISOString()
      yield* reading(usual, 'codex', left(30, resetsAt))
      yield* reading(work.id, 'codex', left(80, resetsAt))
      yield* policies.setAccounts(project.projectId, { rotate: true }, instance.personId)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId })).id, work.id)
      // A window past its reset has started again: all of it is left.
      yield* reading(usual, 'codex', left(30, new Date(Date.now() - 1000).toISOString()))
      assert.strictEqual(Option.getOrThrow(yield* limits.room(usual)).kind, 'weekly')
      yield* policies.setAccounts(project.projectId, { rotate: false }, instance.personId)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId })).id, usual)
    }).pipe(Effect.provide(withAgents())),
  )

  it.live('is an agent with room before one nearly out, which is taken only where nothing else is free', () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const resetsAt = new Date(Date.now() + HOUR).toISOString()
      yield* reading(yield* first('codex'), 'codex', left(2, resetsAt))
      assert.strictEqual(yield* limits.free(['claude-code']), 'opencode')
      yield* reading(yield* first('opencode'), 'opencode', left(4, resetsAt))
      assert.strictEqual(yield* limits.free(['claude-code']), 'codex')
      assert.strictEqual(yield* limits.free(['claude-code'], [], undefined, true), undefined)
      assert.isTrue(Option.isSome(yield* limits.nearlyOut('codex')))
      assert.isTrue(Option.isNone(yield* limits.nearlyOut('claude-code')))
    }).pipe(Effect.provide(withAgents())),
  )
})

describe('the words for an agent nearly out', () => {
  const room = { agentId: 'codex', accountId: 'a', leftPercent: 3.4, resetsAt: null, kind: 'five_hour', label: null } as const

  it('name the window and how little is left', () => {
    assert.strictEqual(windowWords({ kind: 'weekly', label: 'Opus' }), 'weekly Opus limit')
    assert.strictEqual(windowWords({ kind: 'other', label: 'Spend limit' }), 'Spend limit')
    assert.strictEqual(roomWords(room), '3% of its five-hour limit left')
    assert.strictEqual(
      lowWords({ from: 'Codex', room, step: 'review', to: { agent: 'Claude Code', model: 'Claude Sonnet 5.5' } }),
      'Codex has 3% of its five-hour limit left, so Claude Code takes the review instead, on Claude Sonnet 5.5.',
    )
    assert.strictEqual(
      lowWords({ from: 'Codex', room, step: 'settle' }),
      'Codex has 3% of its five-hour limit left, so the fixes wait until Codex has room again. To carry on now, pick another model on the task.',
    )
    assert.isBelow(room.leftPercent, NEARLY_OUT)
  })
})
