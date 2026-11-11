import type { BoardSnapshot, ThreadSnapshot } from '@althar/contracts'
import { AggregateType } from '@althar/domain'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import { Changes } from '../src/Changes'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { TASK_OF } from '../src/taskOf'
import * as Runtime from '../src/Runtime'
import { retitleTask } from '../src/taskTitle'
import { callTool, HOST, hosted, until } from './support'
import { ask, cards, connect, git, runtimeWith, tipOf } from './changesSupport'

/*
 * The board keeps up with tasks as the task view does: a window reads its
 * board again on what the feed says moved it (feed.ts), and a task's view
 * reads its head on every change of its thread. Here a window is played
 * beside the runtime, reading its board again as the window's rule says, and
 * through a task's life its card says what the task's head says, every time.
 * The rule the window had before, a list of the kinds of change a board
 * read, is played beside it, to show where it fell behind.
 */

/** What the window read its board again on before: a list of kinds, which missed whatever moved a card through another. */
const LISTED = new Set([
  'task',
  'task_plan',
  'run',
  'node_attempt',
  'provider_session',
  'turn_delivery',
  'attention_request',
  'external_link',
  'workspace',
  'conflict_resolution',
])

/** What it reads its board again on now (feed.ts `BOARD`). */
const NOW = new Set(['card', 'project'])

/** How long the window gathers changes before it reads (feed.ts `GATHER`). */
const GATHER = Duration.millis(60)

type Card = BoardSnapshot['tasks'][number]
type Shown = { readonly state: string; readonly draft: boolean; readonly checks: string | null } | null

/** Where a task stands, as both its card and its view say it: what the person reads of it on either. */
const standing = (from: {
  readonly title: string
  readonly phase: string | null
  readonly step: string | null
  readonly queued: unknown
  readonly change: Shown
  readonly calls: number
}) => ({
  title: from.title,
  phase: from.phase,
  step: from.step,
  queued: from.queued !== null,
  change: from.change,
  calls: from.calls,
})

const shownOf = (
  change: { readonly state: string; readonly draft: boolean; readonly checks?: { readonly outcome: string } | null } | null | undefined,
): Shown => (change == null ? null : { state: change.state, draft: change.draft, checks: change.checks?.outcome ?? null })

const ofCard = (board: BoardSnapshot, taskId: string) => {
  const card: Card | undefined = board.tasks.find((one) => one.taskId === taskId)
  return card === undefined
    ? undefined
    : standing({
        title: card.title,
        phase: card.phase,
        step: card.step,
        queued: card.queued,
        change: shownOf(card.change),
        calls: board.calls.filter((call) => call.taskId === taskId).length,
      })
}

const ofView = (view: ThreadSnapshot) => {
  // The pull request its card shows: the first still open, else its latest.
  const changes = view.task.changes ?? []
  const shown = changes.find((one) => one.state === 'open') ?? changes.at(-1) ?? null
  return standing({
    title: view.task.title,
    phase: view.task.phase,
    step: view.task.step,
    queued: view.task.queued,
    change: shownOf(shown),
    calls: view.attention.length,
  })
}

/** A window's board, read again, gathered, on each change its rule names, from where it first read it. */
const windowOf = (projectId: string, rule: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const window = { board: yield* Effect.orDie(queries.board(projectId)), reads: 1 }
    let cursor = window.board.cursor
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const batch = yield* Effect.orDie(queries.changesSince(cursor, 500))
          if (batch.length === 0) return yield* Effect.sleep(Duration.millis(20))
          cursor = batch.at(-1)?.cursor ?? cursor
          if (!batch.some((change) => change.projectId === projectId && rule.has(change.aggregateType))) return
          yield* Effect.sleep(GATHER)
          window.board = yield* Effect.orDie(queries.board(projectId))
          window.reads += 1
        }),
      ),
    )
    return window
  })

describe('the board keeps up with a task as its view does', () => {
  it.live(
    'says what its task’s view says through its life: queued, running, waiting on the person, review, checks, merged, settled',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
      github.addRepository(['meridian', 'api'])
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        const queries = yield* Queries
        const sql = yield* SqlClient.SqlClient
        // One place for agents here, held by another task until the test lets it go: this one waits its turn first.
        const busy = yield* Busy
        yield* busy.set(1)
        const projectId = yield* ask(working, 'Hold a place. [coordinator:plan-no-review]')
        yield* callTool({ role: 'coordinator', projectId, threadId: 'none', sessionId: 'none', taskId: null }, 'draft_task', {
          title: 'Blocker',
          description: 'Holds a place.',
        })
        const [blocker] = yield* sql<{ id: string; threadId: string }>`
        SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id WHERE k.slug = 'blocker' AND t.kind = 'task'`
        const release = yield* Deferred.make<void>()
        const entered = yield* Deferred.make<void>()
        yield* Effect.forkScoped(
          busy.turn({ taskId: blocker?.id ?? '', threadId: blocker?.threadId ?? '', sessionId: 'test' }, () =>
            Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
          ),
        )
        yield* Deferred.await(entered)

        const now = yield* windowOf(projectId, NOW)
        const listed = yield* windowOf(projectId, LISTED)
        yield* ask(working, 'Add a retry. [coordinator:plan] [lead:wait-for-person] [lead:finish] [lead:edit] [review:pass]')
        const [made] = yield* until(cards(projectId), (all) => all.some((card) => card.slug === 'add-a-retry'))
        void made
        const [task] = yield* sql<{ id: string; threadId: string }>`
        SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id WHERE k.slug = 'add-a-retry' AND t.kind = 'task'`
        const taskId = task?.id ?? ''
        const threadId = task?.threadId ?? ''

        const behind: Array<string> = []
        const seen: Array<string> = []
        /** Waits until the task's view says what `where` looks for, then until the window's card says the same as the view. */
        const agree = (where: string, looks: (view: ReturnType<typeof ofView>) => boolean) =>
          Effect.gen(function* () {
            const [view] = yield* until(
              Effect.map(Effect.orDie(queries.thread(threadId)), (snapshot) => [ofView(snapshot)]),
              ([one]) => one !== undefined && looks(one),
              `its view at ${where}`,
            )
            yield* until(
              Effect.gen(function* () {
                const fresh = ofView(yield* Effect.orDie(queries.thread(threadId)))
                return [fresh, ofCard(now.board, taskId)] as const
              }),
              ([fresh, card]) => JSON.stringify(fresh) === JSON.stringify(card),
              `the board at ${where}`,
            )
            seen.push(`${where}: ${view?.phase}${view?.step === null ? '' : ` (${view?.step})`}`)
            // The rule before, given the same moment and a little more.
            yield* Effect.sleep(Duration.millis(300))
            const fresh = ofView(yield* Effect.orDie(queries.thread(threadId)))
            const was = ofCard(listed.board, taskId)
            if (JSON.stringify(fresh) !== JSON.stringify(was))
              behind.push(`${where}: its view ${JSON.stringify(fresh)}, its card ${JSON.stringify(was)}`)
          })

        yield* agree('queued', (view) => view.phase === 'running' && view.queued)
        yield* Deferred.succeed(release, undefined)
        yield* agree('waiting on the person', (view) => view.phase === 'waiting' || view.calls > 0 || view.step === 'implement')
        yield* until(
          Effect.map(Effect.orDie(queries.thread(threadId)), (snapshot) => [ofView(snapshot)]),
          ([one]) => one?.phase === 'waiting',
          'its lead waiting on the person',
        )
        yield* agree('its lead waiting on the person', (view) => view.phase === 'waiting')
        yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', { threadId }),
          threadId,
          body: 'Keep the ADRs that still decide something.',
        })
        yield* agree('ready, its pull request opened', (view) => view.phase === 'ready' && view.change !== null)
        github.setChecks(1, [{ name: 'test', state: 'running' }])
        yield* (yield* Changes).refresh(taskId)
        yield* agree('its checks running', (view) => view.change?.checks === 'running')
        github.setChecks(1, [{ name: 'test', state: 'passed' }])
        yield* (yield* Changes).refresh(taskId)
        yield* agree('its checks passed', (view) => view.change?.checks === 'passed')
        github.mergeByHand(1)
        yield* agree('merged, settled', (view) => view.phase === 'settled' && view.change?.state === 'merged')
        // Renamed once settled: what was kept of its card as it settled goes, and the board says its new name.
        yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', { taskId }), taskId, title: 'Add a retry, renamed' })
        yield* agree('settled, renamed', (view) => view.title === 'Add a retry, renamed')

        // What the window read meanwhile: far fewer boards than changes, as only a card that came out different reads one.
        const [counted] = yield* sql<{ changes: number }>`SELECT count(*) AS changes FROM change_log WHERE project_id = ${projectId}`
        assert.isBelow(now.reads, (counted?.changes ?? 0) / 4)
        assert.deepStrictEqual(behind, [], 'the rule before, beside it')
        assert.deepStrictEqual(seen, [
          'queued: running (implement)',
          'waiting on the person: running (implement)',
          'its lead waiting on the person: waiting',
          'ready, its pull request opened: ready',
          'its checks running: running (checks_running)',
          'its checks passed: ready',
          'merged, settled: settled',
          'settled, renamed: settled',
        ])
      }).pipe(Effect.scoped, Effect.provide(runtimeWith({ github })))
    },
  )
})

describe('a card that moves through a kind of change the board read nothing of before', () => {
  it.live('is said changed as its lead drafts an issue for the person, which takes it to Needs you', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const queries = yield* Queries
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:wait]')
      const [running] = yield* until(cards(projectId), (all) => all[0]?.phase === 'running' && all[0].step === 'implement')
      const taskId = running?.taskId ?? ''
      const threadId = running?.threadId ?? ''
      const window = yield* windowOf(projectId, NOW)
      const listed = yield* windowOf(projectId, LISTED)
      yield* until(Effect.succeed([window.board]), ([board]) => board?.tasks.find((card) => card.taskId === taskId)?.phase === 'running')
      const from = yield* queries.cursor
      yield* callTool({ role: 'lead', projectId, threadId, sessionId: 'none', taskId }, 'draft_issue', { title: 'Retry webhooks too' })
      // Its view says it waits on the person, and so does the window's board, read again as the feed said its card changed.
      yield* until(
        Effect.map(Effect.orDie(queries.thread(threadId)), (view) => [view.task.phase]),
        ([phase]) => phase === 'waiting',
      )
      yield* until(
        Effect.sync(() => [window.board.tasks.find((card) => card.taskId === taskId)?.phase]),
        ([phase]) => phase === 'waiting',
      )
      const since = yield* Effect.orDie(queries.changesSince(from, 500))
      assert.isTrue(since.some((change) => change.aggregateType === 'card' && change.aggregateId === taskId))
      // Nothing the rule before named came of it: that window's board still says it runs.
      assert.isFalse(since.some((change) => LISTED.has(change.aggregateType)))
      assert.strictEqual(listed.board.tasks.find((card) => card.taskId === taskId)?.phase, 'running')
    }).pipe(Effect.scoped, Effect.provide(runtimeWith({ github })))
  })
})

describe('the task a change is of', () => {
  it('is said for every kind of change the feed names', () => {
    // A kind added to the feed says the task it is of, or that it is none's: the record is typed so, and this reads it.
    assert.deepStrictEqual(Object.keys(TASK_OF).toSorted(), [...AggregateType.literals].toSorted())
  })
})
