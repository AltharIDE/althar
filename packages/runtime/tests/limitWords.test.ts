import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Limits, outWords, whenWords } from '../src/Limits'
import { callWords, issuesWords } from '../src/Nudges'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * What is said of an agent out of usage, in the thread and in a nudge, and
 * who could take its work over, where limits.test.ts and nudges.test.ts
 * don't go.
 */

const named = [{ definition: { id: 'codex', name: 'Codex' } }]

describe('the words for an agent out of usage', () => {
  it('say when it is back, and that a step waits for it, without naming the step where none is given', () => {
    const later = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    assert.strictEqual(outWords({ from: 'Codex', resetsAt: later }), `Codex ran out of usage, until ${whenWords(later)}.`)
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, waits: 'step' }),
      'Codex ran out of usage. The step waits until Codex is back. To carry on now, pick another model on the task.',
    )
  })

  it('in a nudge, say who ran out opening a pull request, and how many issues wait to be filed', () => {
    assert.strictEqual(
      callWords({ kind: 'stuck', payload: { step: 'publish', why: 'usage_limit', agentId: 'codex' } }, named),
      'Needs you: Codex ran out of usage',
    )
    assert.strictEqual(issuesWords(1), 'An issue to file')
    assert.strictEqual(issuesWords(3), '3 issues to file')
  })
})

describe('who could take over work a usage limit stopped', () => {
  it.live("lists every other account, each on the model it would run, and names an agent Althar doesn't list by its id", () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const accounts = yield* Accounts
      const { project } = yield* task()
      const [codex] = yield* accounts.of('codex')
      const choices = yield* limits.choices({
        accountId: codex?.id ?? null,
        projectId: project.projectId,
        planned: { agentId: 'opencode', model: 'large' },
      })
      assert.deepStrictEqual(
        choices.map((choice) => [choice.agentId, choice.model]),
        [
          ['claude-code', null],
          ['opencode', 'large'],
        ],
      )
      assert.notInclude(
        choices.map((choice) => choice.accountId),
        codex?.id,
      )
      assert.deepStrictEqual(yield* limits.named('aider', 'large'), { agent: 'aider', model: 'large' })
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a lead outside a step whose agent runs out of usage', () => {
  it.live('hands what it was given to the next free agent, on the model that agent last ran here, naming the one out by its id', () => {
    const back = Date.now() + 60 * 60_000
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { project, task: created } = yield* task('Out of usage')
      // Claude Code ran Large in this project before.
      const earlier = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Earlier',
      })
      yield* sessions.start({ threadId: earlier.threadId, agentId: 'claude-code', model: 'large' })
      yield* sessions.stop(earlier.threadId)
      // An agent Althar doesn't list leads it, and is out as it is given the person's words.
      yield* sessions.start({ threadId: created.threadId, agentId: 'aider' })
      const body = 'Is the checkout slow?'
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: created.threadId, body })
      const [taken] = yield* until(
        Effect.map(turns(created.threadId), (rows) => rows.filter((row) => row.prompt?.includes('aider was working on this') === true)),
        (rows) => rows.length === 1,
      )
      assert.include(taken?.prompt, 'aider was working on this when it reached its usage limit, and may have done some of it already.')
      const running = Option.getOrUndefined(yield* sessions.running(created.threadId))
      assert.strictEqual(running?.agentId, 'claude-code')
      const sql = yield* SqlClient.SqlClient
      const [now] = yield* sql<{ model: string | null }>`
        SELECT model FROM provider_sessions WHERE thread_id = ${created.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(now?.model, 'large')
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { aider: { outOfUsage: { until: back } } } })))
  })
})
