import type { BoardSnapshot } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Instance } from '../src/Instance'
import { IssueDrafts } from '../src/IssueDrafts'
import { Queries } from '../src/Queries'
import { type ToolAccess } from '../src/ToolServer'
import { callTool, HOST, hosted, until } from './support'

import { ask, cards, connect, runtimeWith } from './changesSupport'

/*
 * Issue drafts a settled task left: a task whose pull request merged settles,
 * whatever its lead drafted that the person hasn't filed or discarded. Its
 * drafts hold it nowhere in Needs you; the project lists them, each its card
 * and the task it came from, and filing or discarding one takes it off that
 * list and the task's card at once.
 */

describe('issue drafts a merged task left', () => {
  it.live('settle it, out of Needs you, and wait in the project’s list until filed or discarded', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const linear = makeFakeService({ product: 'linear' })
    linear.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('linear')
      const queries = yield* Queries
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const taskId = ready?.taskId ?? ''
      const threadId = ready?.threadId ?? ''
      const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId} LIMIT 1`
      const lead: ToolAccess = { role: 'lead', projectId, threadId, sessionId: session?.id ?? '', taskId }

      // Its lead drafts two issues the person leaves on their cards: while the task is open, they wait on the person.
      yield* callTool(lead, 'draft_issue', { title: 'CI: Postgres is slow on the runner' })
      yield* callTool(lead, 'draft_issue', { title: 'Browser end-to-end tests' })
      const open = (yield* queries.board(projectId)).tasks.find((one) => one.taskId === taskId)
      assert.strictEqual(open?.phase, 'waiting')
      assert.isUndefined((yield* queries.board(projectId)).drafts)

      // Its pull request merges: it settles, the drafts still unfiled.
      yield* (yield* Changes).merge(taskId, ready?.change?.head ?? '')
      const board = yield* queries.board(projectId)
      const card = board.tasks.find((one) => one.taskId === taskId)
      assert.strictEqual(card?.phase, 'settled')
      assert.strictEqual(card?.change?.state, 'merged')
      assert.isUndefined(card?.issues)
      assert.deepStrictEqual(
        card?.draftsLeft?.map((one) => [one.title, one.state]),
        [
          ['CI: Postgres is slow on the runner', 'pending'],
          ['Browser end-to-end tests', 'pending'],
        ],
      )
      // Nowhere in Needs you: not the home's.
      assert.isFalse((yield* queries.home()).tasks.some((one) => one.taskId === taskId))
      // The project lists them, each its card as its thread shows it, and the task it came from.
      const [first, second, ...more] = board.drafts ?? []
      assert.lengthOf(more, 0)
      assert.strictEqual(first?.draft.title, 'CI: Postgres is slow on the runner')
      assert.strictEqual(second?.draft.title, 'Browser end-to-end tests')
      assert.deepStrictEqual([first?.taskId, first?.threadId, first?.taskTitle], [taskId, threadId, ready?.title])
      const [item] = yield* sql<{ id: string }>`
        SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind = 'issue_draft' ORDER BY sequence LIMIT 1`
      assert.strictEqual(first?.itemId, item?.id)

      // Filed from the list, it leaves it and the task's card; discarded, the other does too.
      // The task's card is worked out again as the change is recorded, as every card is: the board reads it back then.
      const cardOf = (board: BoardSnapshot) => board.tasks.find((one) => one.taskId === taskId)
      yield* drafts.file(first?.draft.draftId ?? '', instance.personId)
      const [filed] = yield* until(
        Effect.map(queries.board(projectId), (read) => [read]),
        ([read]) => read !== undefined && cardOf(read)?.draftsLeft?.length === 1,
      )
      assert.deepStrictEqual(
        filed?.drafts?.map((one) => one.draft.title),
        ['Browser end-to-end tests'],
      )
      assert.deepStrictEqual(
        filed?.tasks.find((one) => one.taskId === taskId)?.draftsLeft?.map((one) => one.title),
        ['Browser end-to-end tests'],
      )
      yield* drafts.discard(second?.draft.draftId ?? '', instance.personId)
      const [cleared] = yield* until(
        Effect.map(queries.board(projectId), (read) => [read]),
        ([read]) => read !== undefined && cardOf(read)?.draftsLeft === undefined,
      )
      assert.isUndefined(cleared?.drafts)
      const after = cleared?.tasks.find((one) => one.taskId === taskId)
      assert.strictEqual(after?.phase, 'settled')
      assert.isUndefined(after?.draftsLeft)
    }).pipe(Effect.provide(runtimeWith({ github, linear })))
  })
})
