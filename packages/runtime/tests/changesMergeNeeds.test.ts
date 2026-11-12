import type { MergeRules } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Changes } from '../src/Changes'
import { Queries } from '../src/Queries'
import { HOST, hosted, until } from './support'

import { runtimeWith, connect, ask, cards, tipOf } from './changesSupport'

/*
 * What merging a ready pull request needs, as its host says (DEV-204): read
 * as Althar listens to it, kept with what it last saw of it, and on its card
 * as one list with what Althar knows of it itself.
 */

describe('what the host says merging a pull request needs', () => {
  it.live('reaches the board as one list, read again only as something happens on it', () => {
    const { working, bare } = hosted()
    let rules: MergeRules = {
      requiredChecks: [],
      needs: [
        { kind: 'approvals', state: 'unmet', have: 0, need: 1, who: [] },
        { kind: 'up_to_date', state: 'unmet', have: 2 },
      ],
    }
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), conflictsOf: () => false, rulesOf: () => rules })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const queries = yield* Queries
      const needs = Effect.map(Effect.orDie(queries.board(projectId)), (board) => [board.tasks[0]?.change?.needs])
      const [listed] = yield* until(needs, ([one]) => one !== undefined)
      assert.deepStrictEqual(
        listed?.map((one) => [one.kind, one.state]),
        [
          ['checks', 'met'],
          ['approvals', 'unmet'],
          ['up_to_date', 'unmet'],
          ['conflicts', 'met'],
          ['draft', 'unmet'],
          ['pushed', 'met'],
        ],
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      // Asked again with nothing new on it, the host isn't asked what merging needs: what it said stands.
      const count = (method: string) => github.calls.filter((call) => call === method).length
      const asked = count('mergeRules')
      rules = { requiredChecks: [], needs: [{ kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ana'] }] }
      const changes = yield* Changes
      // Two turns heard it since: the first, which would have asked, is over.
      const heard = count('activity')
      yield* changes.refresh(ready?.taskId ?? '')
      yield* until(
        Effect.sync(() => [count('activity')]),
        ([now]) => (now ?? 0) >= heard + 1,
      )
      yield* changes.refresh(ready?.taskId ?? '')
      yield* until(
        Effect.sync(() => [count('activity')]),
        ([now]) => (now ?? 0) >= heard + 2,
      )
      assert.strictEqual(count('mergeRules'), asked)
      // Marked ready, something happened on it: read again, and the card says so.
      github.readyByHand(1)
      yield* changes.refresh(ready?.taskId ?? '')
      const [after] = yield* until(needs, ([one]) => one?.find((need) => need.kind === 'draft')?.state === 'met')
      assert.deepStrictEqual(
        after?.filter((one) => one.state !== 'met').map((one) => one.kind),
        [],
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
