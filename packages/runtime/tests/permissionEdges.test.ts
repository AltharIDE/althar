import { Ids } from '@althar/domain'
import type { PermissionRequest } from '@althar/provider-adapters'
import { codexLikeMeanings, fakeAgent, fakeAgentMain } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Permissions, type RequestContext } from '../src/Permissions'
import { PermissionJudge } from '../src/PermissionJudge'
import { Policies, ruleSetOf } from '../src/Policies'
import { setModelBlocked } from '../src/preferences'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { definition, repository, runtime, task, turns, until } from './support'

/*
 * Permission requests at their edges, where permissionJudge.test.ts and
 * allowAlways.test.ts don't go: one from a session Althar has no record of,
 * a coordinator judging on its agent's own model where the one it was on is
 * switched off, one whose account is out of usage, and judges that answer
 * with no usage or whose process fails.
 */

/** A task whose lead runs on Codex, with the coordinator on Claude Code's large model, and how a request of the lead's is made. */
const setup = Effect.gen(function* () {
  const { project, task: created } = yield* task('Run the checkout tests')
  const policies = yield* Policies
  const instance = yield* Instance
  const sessions = yield* Sessions
  const sql = yield* SqlClient.SqlClient
  yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
  yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'claude-code', model: 'large' })
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
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
  return { context, policies, sql, worktree: workspace?.path ?? '' }
})

const request = (command: string): PermissionRequest => ({
  sessionId: 'provider-session',
  toolCallId: 'call-1',
  title: command,
  kind: 'execute',
  paths: [],
  rawInput: { command },
  options: [
    { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
  ],
})

describe('a permission request', () => {
  it.live('from a session Althar has no record of is refused, as Althar couldn’t decide it', () =>
    Effect.gen(function* () {
      const { context, policies } = yield* setup
      const instance = yield* Instance
      // The person decides every request here: the request would wait on them, for a session that isn't there.
      yield* policies.set(context.projectId, { permissions: 'ask', alwaysAsk: [] }, instance.personId)
      const permissions = yield* Permissions
      const decision = yield* permissions.decide({ ...context, sessionId: 'sess_00000000000000000000000000000000' }, request('npm test'))
      assert.deepStrictEqual(decision, { decision: 'reject', reason: 'Althar could not decide.' })
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the coordinator judging a request', () => {
  it.live('judges on its agent’s own model where the model it was on is switched off', () =>
    Effect.gen(function* () {
      const { context, policies, worktree } = yield* setup
      yield* setModelBlocked('claude-code', 'large', true)
      const judge = yield* PermissionJudge
      const judged = yield* judge.judge({
        ...context,
        request: request('npm test'),
        rules: ruleSetOf((yield* policies.current(context.projectId)).rules),
        workspace: { worktree, defaultBranch: 'main' },
      })
      assert.strictEqual(judged.decision, 'allow')
      assert.deepStrictEqual([judged.agentId, judged.model], ['claude-code', 'small'])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a coordinator out of usage, where its project waits for resets', () => {
  it.live('leaves a request it would judge to the person, as its account is unavailable', () => {
    const back = Date.now() + 60 * 60 * 1000
    return Effect.gen(function* () {
      const policies = yield* Policies
      const instance = yield* Instance
      const limits = yield* Limits
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task('Run the checkout tests')
      yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
      yield* policies.setUsageLimit(project.projectId, 'wait', instance.personId)
      const coordinator = yield* Coordinator
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: project.coordinatorThreadId,
        body: 'Is the checkout slow?',
        disposition: 'after_current',
      })
      yield* until(
        Effect.map(limits.out('claude-code', project.projectId), (out) => (Option.isSome(out) ? [out] : [])),
        (outs) => outs.length === 1,
        Duration.seconds(15),
      )
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      const projectId = Schema.decodeUnknownSync(Ids.project.schema)(project.projectId)
      const judged = yield* (yield* PermissionJudge).judge({
        projectId,
        threadId: created.threadId,
        taskId: created.taskId,
        request: request('npm test'),
        rules: ruleSetOf((yield* policies.current(projectId)).rules),
        workspace: { worktree: workspace?.path ?? '', defaultBranch: 'main' },
      })
      assert.deepStrictEqual(
        [judged.decision, judged.reason, judged.agentId],
        ['ask', 'The coordinator’s account is unavailable. Please decide this request.', 'claude-code'],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { 'claude-code': { outOfUsage: { until: back } } } })))
  })
})

/** A task whose description says how its judge answers, with the coordinator started, and what judging one of its lead's requests asks. */
const judging = (description: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const policies = yield* Policies
    const instance = yield* Instance
    const sessions = yield* Sessions
    const sql = yield* SqlClient.SqlClient
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Run the checkout tests',
      description,
    })
    yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
    yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'claude-code' })
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
    const projectId = Schema.decodeUnknownSync(Ids.project.schema)(project.projectId)
    return {
      projectId,
      threadId: created.threadId,
      taskId: created.taskId,
      request: request('npm test'),
      rules: ruleSetOf((yield* policies.current(projectId)).rules),
      workspace: { worktree: workspace?.path ?? '', defaultBranch: 'main' },
    }
  })

describe('a coordinator’s judgment that doesn’t come', () => {
  it.live('is left to the person where its judge says something else, and no usage', () =>
    Effect.gen(function* () {
      // The task's description reaches the judge, which answers it as a slow model would, in words.
      const input = yield* judging('Run them. [answers-after:0s]')
      const judged = yield* (yield* PermissionJudge).judge(input)
      assert.deepStrictEqual(
        [judged.decision, judged.reason, judged.usage],
        ['ask', 'The coordinator returned an invalid answer. Please decide this request.', null],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is left to the person where the judge’s process fails, which is kept as ending unknown', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Its prompt fails as Claude Code's does when Anthropic's API gives up.
      const input = yield* judging('Run them. [fails-after:0s]')
      const judged = yield* (yield* PermissionJudge).judge(input)
      assert.deepStrictEqual(
        [judged.decision, judged.reason],
        ['ask', 'The coordinator could not decide because its agent failed. Please decide this request.'],
      )
      const [process] = yield* sql<{ state: string }>`
        SELECT state FROM processes WHERE purpose = 'agent' AND provider_session_id IS NULL`
      assert.strictEqual(process?.state, 'unknown')
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
})
