import { execFileSync } from 'node:child_process'

import { assert, describe, it } from '@effect/vitest'
import { Ids, newId } from '@althar/domain'
import type { PermissionRequest } from '@althar/provider-adapters'
import { codexLikeMeanings, fakeAgent, fakeAgentMain, scenarios } from '@althar/provider-adapters/testing'
import { Duration, Effect, Fiber, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Agents } from '../src/Config'
import { Permissions, type RequestContext } from '../src/Permissions'
import { PermissionJudge } from '../src/PermissionJudge'
import { Policies, ruleSetOf } from '../src/Policies'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { SignIns } from '../src/SignIns'
import { definition, items, runtime, task, turns, until } from './support'

const setup = Effect.gen(function* () {
  const { project, task: created } = yield* task('Run the checkout tests')
  const policies = yield* Policies
  const instance = yield* Instance
  const sessions = yield* Sessions
  const sql = yield* SqlClient.SqlClient
  yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
  // The coordinator's model is deliberately different from the task's.
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
    rules: { role: 'task', context: { worktree: workspace?.path ?? '', defaultBranch: 'main', taskBranch: 'althar/retry' } },
  }
  return { project, created, context, policies, instance, sessions, sql, permissions: yield* Permissions }
})

const request = (command = 'npm test', toolCallId = 'judged-call'): PermissionRequest => ({
  sessionId: 'provider-session',
  toolCallId,
  title: command,
  kind: 'execute',
  paths: [],
  rawInput: { command },
  options: [
    { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
  ],
})

const answerPerson = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const permissions = yield* Permissions
  const [attention] = yield* until(
    sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE state = 'open'`,
    (rows) => rows.length === 1,
  )
  yield* permissions.answer({
    envelope: yield* Runtime.envelope('attention.answer', {}),
    attentionId: attention?.id ?? '',
    decision: 'reject',
    reason: 'The person said no.',
  })
  return attention?.payload ?? ''
})

describe('coordinator permission judgments', () => {
  it.live('asks the person before launching a judge that cannot disable its tools', () => {
    const { permissionJudge: _, ...unsupported } = definition('claude-code')
    let calls = 0
    return Effect.gen(function* () {
      const { context, permissions } = yield* setup
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      assert.include(yield* answerPerson, 'cannot judge without tools')
      assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
      assert.strictEqual(calls, 0)
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            agents: Layer.succeed(
              Agents,
              Agents.from(
                [unsupported, definition('codex')].map((definition) => ({
                  definition,
                  transport: () => ({
                    _tag: 'InProcess',
                    agent: fakeAgent({
                      judgment: async () => {
                        calls++
                        return '{}'
                      },
                    }),
                  }),
                })),
              ),
            ),
          },
        ),
      ),
    )
  })

  it.live('limits a burst of judgments to two active sessions', () => {
    let active = 0
    let peak = 0
    let calls = 0
    return Effect.gen(function* () {
      const { context, permissions } = yield* setup
      const answers = yield* Effect.all(
        Array.from({ length: 6 }, (_, i) => permissions.decide(context, request('npm test', `call-${i}`))),
        {
          concurrency: 'unbounded',
        },
      )
      assert.strictEqual(calls, 6)
      assert.strictEqual(peak, 2)
      assert.isTrue(answers.every((answer) => answer.decision === 'allow'))
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: async () => {
            calls++
            peak = Math.max(peak, ++active)
            await new Promise((resolve) => setTimeout(resolve, 50))
            active--
            return '{"decision":"allow","reason":"Needed for the task."}'
          },
        }),
      ),
    )
  })

  for (const kind of ['read', 'search', 'edit', 'other'] as const)
    it.live(`handles ${kind} requests without judging routine file work`, () => {
      const prompts: Array<string> = []
      return Effect.gen(function* () {
        const { context, permissions } = yield* setup
        const action: PermissionRequest = {
          ...request(),
          kind,
          title: kind === 'other' ? 'npm test' : `${kind} README.md`,
          rawInput: kind === 'other' ? { command: 'npm test' } : { path: 'README.md' },
          paths: kind === 'other' ? [] : ['README.md'],
        }
        assert.strictEqual((yield* permissions.decide(context, action)).decision, 'allow')
        assert.lengthOf(prompts, kind === 'other' ? 1 : 0)
        if (kind === 'other') assert.include(prompts[0] ?? '', JSON.stringify(action))
      }).pipe(
        Effect.provide(
          runtime(':memory:', {
            judgment: async ({ prompt }) => {
              prompts.push(prompt)
              return '{"decision":"allow","reason":"Needed for the task."}'
            },
          }),
        ),
      )
    })

  for (const response of [
    '```json\n{"decision":"allow","reason":"Needed for the task."}\n```',
    'Allowing.\n{"decision":"allow","reason":"Needed for the task."}',
    '```\n{"decision":"allow","reason":"The script prints {ok}."}\n```\nThat is my decision.',
  ])
    it.live(`accepts a wrapped answer: ${response.slice(0, 18)}`, () =>
      Effect.gen(function* () {
        const { context, permissions, sql } = yield* setup
        assert.strictEqual((yield* permissions.decide(context, request())).decision, 'allow')
        assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
      }).pipe(Effect.provide(runtime(':memory:', { judgment: async () => response }))),
    )

  it.live('asks the person when a policy edit still leaves the action for the coordinator', () => {
    let respond: ((answer: string) => void) | undefined
    return Effect.gen(function* () {
      const { context, permissions, policies, instance, sql } = yield* setup
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      yield* until(
        Effect.sync(() => [respond !== undefined]),
        (rows) => rows[0] === true,
      )
      yield* policies.set(context.projectId, { alwaysAsk: ['deploy'] }, instance.personId)
      respond?.('{"decision":"allow","reason":"Needed for the task."}')
      assert.include(yield* answerPerson, 'rules changed')
      assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
      const [judged] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'permission_request.judged'`
      assert.isFalse(JSON.parse(judged?.payload ?? '{}').applied)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: () =>
            new Promise((resolve) => {
              respond = resolve
            }),
        }),
      ),
    )
  })

  it.live('falls back if the provider silently refuses the coordinator model', () => {
    const staysOn: Array<string> = []
    return Effect.gen(function* () {
      const { context, permissions, sessions, project } = yield* setup
      yield* sessions.stop(project.coordinatorThreadId)
      yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'codex', model: 'large' })
      staysOn.push('large')
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      assert.include(yield* answerPerson, 'could not use its selected model')
      assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
    }).pipe(Effect.provide(runtime(':memory:', { staysOn })))
  })

  for (const missing of ['task', 'project'] as const)
    it.live(`asks the person when the ${missing} context is missing`, () =>
      Effect.gen(function* () {
        const { context, policies } = yield* setup
        const judge = yield* PermissionJudge
        const result = yield* judge.judge({
          ...context,
          ...(missing === 'task'
            ? { taskId: null }
            : { projectId: Schema.decodeUnknownSync(Ids.project.schema)('proj_00000000000000000000000000000000') }),
          request: request(),
          rules: ruleSetOf((yield* policies.current(context.projectId)).rules),
          workspace: { worktree: '', defaultBranch: 'main' },
        })
        assert.strictEqual(result.decision, 'ask')
        assert.strictEqual(result.sessionId, null)
        assert.strictEqual(result.cost, null)
      }).pipe(Effect.provide(runtime())),
    )

  it.live('rechecks a push destination that changes while the coordinator judges', () => {
    let respond: ((answer: string) => void) | undefined
    return Effect.gen(function* () {
      const { context, permissions, policies, instance } = yield* setup
      yield* policies.set(context.projectId, { alwaysAsk: ['default-branch'] }, instance.personId)
      const pending = yield* Effect.forkChild(permissions.decide(context, request('git push origin')))
      yield* until(
        Effect.sync(() => [respond !== undefined]),
        (rows) => rows[0] === true,
      )
      if (context.rules.role !== 'task') return yield* Effect.die('Expected a task')
      // In this disposable test worktree only, emulate another actor switching HEAD to main.
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: context.rules.context.worktree })
      respond?.('{"decision":"allow","reason":"Push the task branch."}')
      assert.include(yield* answerPerson, 'A push to main always asks.')
      assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: () =>
            new Promise((resolve) => {
              respond = resolve
            }),
        }),
      ),
    )
  })
  it.live('owns and closes the process used for a coordinator judgment', () =>
    Effect.gen(function* () {
      const { context, permissions, sql } = yield* setup
      assert.strictEqual((yield* permissions.decide(context, request())).decision, 'allow')
      const [process] = yield* sql<{ state: string; pid: number; processGroupId: number }>`
      SELECT state, pid, process_group_id FROM processes WHERE purpose = 'agent' AND provider_session_id IS NULL`
      assert.strictEqual(process?.state, 'exited')
      assert.isAbove(process?.pid ?? 0, 0)
      assert.strictEqual(process?.pid, process?.processGroupId)
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            agents: Layer.succeed(
              Agents,
              Agents.from(
                ['claude-code', 'codex'].map((id) => ({
                  definition: definition(id),
                  transport: (cwd) =>
                    id === 'claude-code'
                      ? { _tag: 'Process', spec: { command: 'bun', args: [fakeAgentMain] }, cwd }
                      : { _tag: 'InProcess', agent: fakeAgent() },
                })),
              ),
            ),
          },
        ),
      ),
    ),
  )
  it.live('falls back when the coordinator is signed out, without trying another model', () => {
    const signedOut: Array<string> = []
    return Effect.gen(function* () {
      const { context, permissions, sql } = yield* setup
      signedOut.push('claude-code')
      const signIns = yield* SignIns
      yield* signIns.of('claude-code', true)
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      assert.include(yield* answerPerson, 'unavailable')
      yield* Fiber.join(pending)
      const [judged] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'permission_request.judged'`
      assert.strictEqual(JSON.parse(judged?.payload ?? '{}').cost, null)
    }).pipe(Effect.provide(runtime(':memory:', {}, { signedOut })))
  })

  it.live('falls back when the judge provider fails', () =>
    Effect.gen(function* () {
      const { context, permissions } = yield* setup
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      assert.include(yield* answerPerson, 'could not decide')
      yield* Fiber.join(pending)
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { 'claude-code': { outOfUsage: {} } } }))),
  )

  it.live('handles simultaneous task requests while the coordinator chat is busy', () =>
    Effect.gen(function* () {
      const { context, permissions, sessions, project, sql } = yield* setup
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: project.coordinatorThreadId,
        body: 'hello',
        disposition: 'after_current',
      })
      yield* until(turns(project.coordinatorThreadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: project.coordinatorThreadId,
        body: scenarios.slow,
        disposition: 'after_current',
      })
      yield* until(turns(project.coordinatorThreadId), (rows) => rows.some((row) => row.state === 'delivered'))
      const answers = yield* Effect.all(
        [permissions.decide(context, request('npm test', 'test')), permissions.decide(context, request('npm run check', 'check'))],
        { concurrency: 'unbounded' },
      )
      assert.deepStrictEqual(
        answers.map((answer) => answer.decision),
        ['allow', 'allow'],
      )
      assert.lengthOf(yield* sql`SELECT id FROM decisions`, 2)
      assert.lengthOf(yield* sql`SELECT id FROM record_events WHERE type = 'permission_request.judged'`, 2)
      assert.isTrue((yield* turns(project.coordinatorThreadId)).some((row) => row.state === 'delivered'))
    }).pipe(Effect.provide(runtime())),
  )
  it.live(
    'uses the coordinator model in a separate read-only session, records its reason and cost, and shows the receipt and home count',
    () => {
      const prompts: Array<string> = []
      return Effect.gen(function* () {
        const { context, permissions, sql, instance } = yield* setup
        const decision = yield* permissions.decide(context, request())
        assert.deepStrictEqual(decision, { decision: 'allow', reason: 'Needed to verify the checkout.' })
        assert.lengthOf(prompts, 1)
        assert.include(prompts[0] ?? '', 'Run the checkout tests')
        assert.include(prompts[0] ?? '', 'npm test')
        const [stored] = yield* sql<{ actor: string; scope: string }>`SELECT decided_by_actor_id AS actor, scope FROM decisions`
        assert.deepStrictEqual(stored, { actor: instance.coordinatorId, scope: 'once' })
        const [judged] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'permission_request.judged'`
        const metric = JSON.parse(judged?.payload ?? '{}')
        assert.strictEqual(metric.agentId, 'claude-code')
        assert.strictEqual(metric.model, 'small')
        assert.deepStrictEqual(metric.cost, { amount: 0.002, currency: 'USD' })
        assert.strictEqual(metric.usage.totalTokens, 120)
        assert.isAtLeast(metric.durationMs, 0)
        assert.isTrue(metric.applied)
        assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
        assert.isTrue(
          (yield* items(context.threadId)).some(
            (item) =>
              item.content.title === 'Allowed npm test' &&
              item.content.description === 'By the coordinator: Needed to verify the checkout.',
          ),
        )
        const queries = yield* Queries
        // Other kinds of attention answers must never inflate permission counts.
        const attentionId = yield* newId(Ids.attentionRequest)
        yield* sql`INSERT INTO attention_requests ${sql.insert({
          id: attentionId,
          projectId: context.projectId,
          taskId: context.taskId,
          kind: 'stuck',
          state: 'answered',
          addresseeActorId: instance.personId,
          createdAt: new Date().toISOString(),
          answeredAt: new Date().toISOString(),
        })}`
        yield* sql`INSERT INTO decisions ${sql.insert({
          id: yield* newId(Ids.decision),
          attentionRequestId: attentionId,
          projectId: context.projectId,
          outcome: 'allow',
          scope: 'once',
          decidedByActorId: instance.coordinatorId,
          decidedAt: new Date().toISOString(),
        })}`
        const home = yield* queries.home('2000-01-01T00:00:00.000Z')
        assert.strictEqual(home.events.find((event) => event.kind === 'answered')?.count, 1)
        assert.lengthOf(yield* sql`SELECT id FROM provider_sessions`, 2)
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(':memory:', {
                judgment: async ({ prompt, mode, model, mcpServers, meta, askToWrite }) => {
                  prompts.push(prompt)
                  assert.strictEqual(mode, 'read-only')
                  assert.strictEqual(model, 'small')
                  assert.strictEqual(mcpServers, 0)
                  assert.deepStrictEqual(meta, { fake: { tools: [] } })
                  assert.strictEqual(await askToWrite(), 'decline')
                  return '{"decision":"allow","reason":"Needed to verify the checkout."}'
                },
              }),
            ),
          ),
        ),
      )
    },
  )

  it.live('answers a real ACP permission callback and the task continues', () =>
    Effect.gen(function* () {
      const { context, sessions, sql } = yield* setup
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: context.threadId,
        body: scenarios.commandChoices,
        disposition: 'after_current',
      })
      yield* until(turns(context.threadId), (rows) => rows.length === 2 && rows.every((row) => row.state === 'completed'))
      assert.isTrue((yield* items(context.threadId)).some((item) => item.content.text === 'chosen=allow_once'))
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a denial and sends the narrow refusal to the task', () =>
    Effect.gen(function* () {
      const { context, permissions, sql, instance } = yield* setup
      assert.deepStrictEqual(yield* permissions.decide(context, request()), {
        decision: 'reject',
        reason: 'Not needed for this task.',
        decidedBy: 'coordinator',
      })
      const [row] = yield* sql<{
        option: string
        actor: string
      }>`SELECT agent_option_id AS option, decided_by_actor_id AS actor FROM decisions`
      assert.deepStrictEqual(row, { option: 'decline', actor: instance.coordinatorId })
      assert.isTrue(
        (yield* items(context.threadId)).some(
          (item) =>
            item.content.title === 'Denied npm test' && item.content.description === 'By the coordinator: Not needed for this task.',
        ),
      )
    }).pipe(Effect.provide(runtime(':memory:', { judgment: async () => '{"decision":"deny","reason":"Not needed for this task."}' }))),
  )

  it.live('explains a coordinator denial to the lead over ACP', () =>
    Effect.gen(function* () {
      const { context, sessions } = yield* setup
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: context.threadId,
        body: 'run npm test',
        disposition: 'after_current',
      })
      yield* until(turns(context.threadId), (rows) => rows.length === 2 && rows.every((row) => row.state === 'completed'))
      const thread = yield* items(context.threadId)
      assert.isTrue(thread.some((item) => String(item.content.description).includes('not allowed by the coordinator: Outside the task.')))
      assert.isTrue(thread.some((item) => item.content.text === 'carrying on without it'))
    }).pipe(Effect.provide(runtime(':memory:', { judgment: async () => '{"decision":"deny","reason":"Outside the task."}' }))),
  )

  it.live('keeps the receipt short and the full reason in the ledger', () => {
    const reason = 'This request exceeds the scope of the task. '.repeat(15).trim()
    return Effect.gen(function* () {
      const { context, permissions, sql } = yield* setup
      const action = { ...request(), title: 'A long action '.repeat(30) }
      yield* permissions.decide(context, action)
      const [receipt] = (yield* items(context.threadId)).filter((item) => item.content.about === 'permission')
      assert.isAtMost(String(receipt?.content.title).length, 127)
      assert.strictEqual(String(receipt?.content.description).length, 200)
      assert.isTrue(String(receipt?.content.description).endsWith('…'))
      const [stored] = yield* sql<{ reason: string }>`SELECT reason FROM decisions`
      assert.strictEqual(stored?.reason, reason)
      const [judged] = yield* sql<{ payload: string }>`SELECT payload FROM record_events WHERE type = 'permission_request.judged'`
      assert.strictEqual(JSON.parse(judged?.payload ?? '{}').reason, reason)
    }).pipe(Effect.provide(runtime(':memory:', { judgment: async () => JSON.stringify({ decision: 'deny', reason }) })))
  })

  for (const [label, response] of [
    ['uncertainty', '{"decision":"ask","reason":"The destination is unclear."}'],
    ['invalid JSON', 'Sure, go ahead.'],
    ['invalid decision', '{"decision":"yes","reason":"fine"}'],
    ['conflicting objects', '{"decision":"allow","reason":"fine"}\n{"decision":"deny","reason":"unsafe"}'],
    ['missing reason', '{"decision":"allow"}'],
    ['empty reason', '{"decision":"allow","reason":"  "}'],
    ['oversized reason', JSON.stringify({ decision: 'allow', reason: 'x'.repeat(1001) })],
    ['oversized response', 'x'.repeat(8001)],
  ])
    it.live(`falls back to the person on ${label}`, () =>
      Effect.gen(function* () {
        const { context, permissions, sql, instance } = yield* setup
        const pending = yield* Effect.forkChild(permissions.decide(context, request()))
        const payload = yield* answerPerson
        assert.include(payload, 'reason')
        assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
        const [row] = yield* sql<{ actor: string }>`SELECT decided_by_actor_id AS actor FROM decisions`
        assert.strictEqual(row?.actor, instance.personId)
        assert.lengthOf(yield* sql`SELECT id FROM record_events WHERE type = 'permission_request.judged'`, 1)
      }).pipe(Effect.provide(runtime(':memory:', { judgment: async () => response ?? '' }))),
    )

  it.live('falls back when the coordinator times out and closes its fresh session', () => {
    let closed = 0
    return Effect.gen(function* () {
      const { context, permissions } = yield* setup
      const pending = yield* Effect.forkChild(permissions.decide(context, request()))
      assert.include(yield* answerPerson, 'timed out')
      assert.strictEqual((yield* Fiber.join(pending)).decision, 'reject')
      assert.isAtLeast(closed, 1)
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          { judgment: () => new Promise(() => {}), closed: () => closed++ },
          { permissionJudgeTimeout: Duration.millis(150) },
        ),
      ),
    )
  })

  it.live('keeps always-ask and never rules, code-host restrictions and readers ahead of the coordinator', () => {
    let calls = 0
    return Effect.gen(function* () {
      const { context, permissions, policies, instance } = yield* setup
      yield* policies.set(context.projectId, { alwaysAsk: ['deploy'], never: ['force-push'] }, instance.personId)
      assert.strictEqual((yield* permissions.decide(context, request('git push --force origin main'))).decision, 'reject')
      assert.strictEqual((yield* permissions.decide(context, request('gh pr merge 1'))).decision, 'reject')
      assert.strictEqual((yield* permissions.decide({ ...context, rules: { role: 'reader' } }, request('npm install'))).decision, 'reject')
      assert.strictEqual((yield* permissions.decide({ ...context, rules: { role: 'reader' } }, request('git status'))).decision, 'allow')
      const pending = yield* Effect.forkChild(permissions.decide(context, request('npm publish')))
      yield* answerPerson
      yield* Fiber.join(pending)
      assert.strictEqual(calls, 0)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: async () => {
            calls++
            return '{"decision":"allow","reason":"fine"}'
          },
        }),
      ),
    )
  })

  it.live('cancels running and queued judgments without applying an answer or opening an ask', () => {
    let entered = 0
    return Effect.gen(function* () {
      const { context, permissions, sql } = yield* setup
      const pending = yield* Effect.forkChild(
        Effect.all(
          Array.from({ length: 4 }, (_, i) => permissions.decide(context, request('npm test', `cancel-${i}`))),
          { concurrency: 'unbounded' },
        ),
      )
      yield* until(
        Effect.sync(() => [entered]),
        (rows) => rows[0] === 2,
      )
      yield* permissions.withdrawAll(context.sessionId)
      yield* Fiber.await(pending)
      assert.lengthOf(yield* sql`SELECT id FROM decisions`, 0)
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests`, 0)
      const rows = yield* sql<{ state: string }>`SELECT state FROM permission_requests`
      assert.lengthOf(rows, 4)
      assert.isTrue(rows.every((row) => row.state === 'cancelled'))
      assert.strictEqual(entered, 2)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: () => {
            entered++
            return new Promise(() => {})
          },
        }),
      ),
    )
  })

  it.live('never applies an approval after the person changes the rules', () => {
    let respond: ((answer: string) => void) | undefined
    return Effect.gen(function* () {
      const { context, permissions, policies, instance, sql } = yield* setup
      const pending = yield* Effect.forkChild(permissions.decide(context, request('npm publish')))
      yield* until(
        Effect.sync(() => [respond !== undefined]),
        (rows) => rows[0] === true,
      )
      yield* policies.set(context.projectId, { never: ['deploy'] }, instance.personId)
      respond?.('{"decision":"allow","reason":"Publish the changes."}')
      const decision = yield* Fiber.join(pending)
      assert.strictEqual(decision.decision, 'reject')
      assert.include(decision.reason ?? '', 'never allow')
      const [row] = yield* sql<{ actor: string }>`SELECT decided_by_actor_id AS actor FROM decisions`
      assert.strictEqual(row?.actor, instance.systemId)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {
          judgment: () =>
            new Promise((resolve) => {
              respond = resolve
            }),
        }),
      ),
    )
  })

  it.live('does not truncate a large action into an unsafe approval', () =>
    Effect.gen(function* () {
      const { context, policies } = yield* setup
      const judge = yield* PermissionJudge
      const result = yield* judge.judge({
        ...context,
        request: request('x'.repeat(25000)),
        rules: ruleSetOf((yield* policies.current(context.projectId)).rules),
        workspace: context.rules.role === 'task' ? context.rules.context : { worktree: '', defaultBranch: 'main' },
      })
      assert.strictEqual(result.decision, 'ask')
      assert.include(result.reason, 'too large')
      assert.strictEqual(result.cost, null)
    }).pipe(Effect.provide(runtime())),
  )
})
