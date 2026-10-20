import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Accounts } from '../src/Accounts'
import { Limits, outWords, whenWords } from '../src/Limits'
import { callWords, issuesWords } from '../src/Nudges'
import { runtime, task } from './support'

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
