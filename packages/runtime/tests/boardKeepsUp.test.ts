import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BoardSnapshot, ThreadSnapshot } from '@althar/contracts'
import { AggregateType } from '@althar/domain'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import { Changes } from '../src/Changes'
import { Coordinator } from '../src/Coordinator'
import { Queries } from '../src/Queries'
import { Questions } from '../src/Questions'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Instance } from '../src/Instance'
import { Sessions } from '../src/Sessions'
import { TASK_OF } from '../src/taskOf'
import * as Runtime from '../src/Runtime'
import { retitleTask } from '../src/taskTitle'
import { scenarios } from '@althar/provider-adapters/testing'
import { callTool, HOST, hosted, turns, until } from './support'
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
    const window = {
      board: yield* Effect.orDie(queries.board(projectId)),
      reads: 1,
      // Each read, and the kinds of change of the board's project that came before it.
      log: [] as Array<{ readonly at: number; readonly after: ReadonlyArray<string>; readonly board: BoardSnapshot }>,
    }
    let cursor = window.board.cursor
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const batch = yield* Effect.orDie(queries.changesSince(cursor, 500))
          if (batch.length === 0) return yield* Effect.sleep(Duration.millis(20))
          cursor = batch.at(-1)?.cursor ?? cursor
          const ours = batch.filter((change) => change.projectId === projectId)
          if (!ours.some((change) => rule.has(change.aggregateType))) return
          yield* Effect.sleep(GATHER)
          window.board = yield* Effect.orDie(queries.board(projectId))
          window.reads += 1
          window.log.push({ at: Date.now(), after: [...new Set(ours.map((change) => change.aggregateType))], board: window.board })
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

describe('the board keeps up with several tasks moving at once', () => {
  it.live(
    'says what each task’s view says, never behind it by more than a moment, while they wait, are reviewed, held, checked and merged',
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
        const projectId = yield* ask(working, 'Hello.')
        const plans = yield* Plans
        const actor = (yield* Instance).personId
        /** A task, its plan proposed: started at once, or held until the person starts it. */
        const planned = (title: string, description: string, review: boolean) =>
          Effect.gen(function* () {
            const made = yield* (yield* Projects).createTask({
              envelope: yield* Runtime.envelope('task.create', {}),
              projectId: projectId as never,
              title,
              description,
              draft: true,
            })
            const planId = yield* plans.propose({
              projectId: projectId as never,
              taskId: made.taskId,
              steps: [
                { key: 'implement', agentId: 'codex', model: null, skipped: false },
                { key: 'review', agentId: 'claude-code', model: null, skipped: !review },
              ],
              reason: null,
              actorId: actor,
              end: 'draft',
            })
            const [row] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${made.taskId}`
            return { taskId: made.taskId, threadId: made.threadId, slug: row?.slug ?? '', planId }
          })
        const tasks = [
          yield* planned('Add a retry', 'Add it. [lead:wait-for-person] [lead:finish] [lead:edit] [review:pass]', true),
          yield* planned('Cache the config', 'Cache it. [lead:finish] [lead:edit]', false),
          // A third waits on a plan the person held, and starts when they start it.
          yield* planned('Tidy the docs', 'Do it. [lead:wait]', false),
        ]
        const planOf = (slug: string) => tasks.find((one) => one.slug === slug)?.planId ?? ''
        yield* plans.hold(planOf('tidy-the-docs'), actor)

        // A window's board, and beside it a sampler: each moment every task's view, and whether its card says the same.
        const window = yield* windowOf(projectId, NOW)
        const apart = new Set<string>()
        const stood = new Map<string, Array<string>>()
        let samples = 0
        const started = Date.now()
        // Each time a task's view came to something new, and when the sampler first saw it there.
        const episodes: Array<{ slug: string; taskId: string; view: ReturnType<typeof ofView>; at: number }> = []
        const lastView = new Map<string, string>()
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              for (const one of tasks) {
                const view = ofView(yield* Effect.orDie(queries.thread(one.threadId)))
                // The window's board as it stands as the view is read, not as it stood when the pass began.
                const card = ofCard(window.board, one.taskId)
                const went = stood.get(one.slug) ?? []
                const now = `${view.phase}${view.step === null ? '' : ` (${view.step})`}${view.change?.checks == null ? '' : ` checks ${view.change.checks}`}`
                if (went.at(-1) !== now) stood.set(one.slug, [...went, now])
                if (lastView.get(one.slug) !== JSON.stringify(view)) {
                  lastView.set(one.slug, JSON.stringify(view))
                  episodes.push({ slug: one.slug, taskId: one.taskId, view, at: Date.now() })
                }
                if (JSON.stringify(view) === JSON.stringify(card)) apart.delete(one.slug)
                else apart.add(one.slug)
              }
              samples += 1
              yield* Effect.sleep(Duration.millis(25))
            }),
          ),
        )
        const viewOf = (slug: string) =>
          Effect.map(Effect.orDie(queries.thread(tasks.find((one) => one.slug === slug)?.threadId ?? '')), ofView)
        const numberOf = (slug: string) =>
          Effect.map(Effect.orDie(queries.thread(tasks.find((one) => one.slug === slug)?.threadId ?? '')), (view) =>
            Number(view.task.changes?.at(-1)?.url.split('/').at(-1)),
          )
        // Every card says what its view says, on passes of the sampler made after the views came to where they are.
        const settledTogether = () =>
          Effect.gen(function* () {
            const from = samples
            yield* until(
              Effect.sync(() => [samples - from, apart.size]),
              ([passes, size]) => (passes ?? 0) >= 2 && size === 0,
              'every card to say what its view says',
            )
          })

        yield* plans.start(planOf('add-a-retry'), actor)
        yield* plans.start(planOf('cache-the-config'), actor)
        // The retry waits on the person while the config's pull request opens.
        yield* until(viewOf('add-a-retry'), (view) => view.phase === 'waiting', 'the retry waiting on the person')
        yield* until(viewOf('cache-the-config'), (view) => view.phase === 'ready' && view.change !== null, 'the config ready')
        const retry = tasks.find((one) => one.slug === 'add-a-retry')
        yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', { threadId: retry?.threadId ?? '' }),
          threadId: retry?.threadId ?? '',
          body: 'Keep the ADRs that still decide something.',
        })
        // The held one starts while the config's checks run, and the retry goes through its review.
        yield* plans.start(planOf('tidy-the-docs'), actor)
        const config = yield* numberOf('cache-the-config')
        github.setChecks(config, [{ name: 'test', state: 'running' }])
        yield* (yield* Changes).refresh(tasks.find((one) => one.slug === 'cache-the-config')?.taskId ?? '')
        yield* until(viewOf('cache-the-config'), (view) => view.change?.checks === 'running', 'the config checks running')
        yield* until(
          viewOf('add-a-retry'),
          (view) => view.change !== null && view.phase !== 'waiting',
          'the retry reviewed, its pull request open',
        )
        yield* until(viewOf('tidy-the-docs'), (view) => view.phase === 'running', 'the docs running')
        github.setChecks(config, [{ name: 'test', state: 'passed' }])
        github.mergeByHand(config)
        for (const one of tasks) yield* (yield* Changes).refresh(one.taskId)
        yield* until(viewOf('cache-the-config'), (view) => view.phase === 'settled', 'the config merged and settled')
        yield* settledTogether()

        // For each time a task's view came to something, how long after the view said it the window's board did, in a read
        // made while it stood: the board may say it first (negative), after the view's state before, as the view was read in
        // its turn. A state may come again (running, then waiting, then running): each time is its own. One the board never
        // said was over before a read, unless it stood more than a moment.
        const ended = Date.now()
        const lags = episodes.map(({ slug, taskId, view, at }, index) => {
          const ofTask = episodes.filter((one) => one.slug === slug)
          const mine = ofTask.findIndex((one) => episodes.indexOf(one) === index)
          const after = ofTask[mine - 1]?.at ?? 0
          const until = ofTask[mine + 1]?.at ?? ended
          const shown = window.log.find(
            (read) => read.at > after && read.at <= until + 1000 && JSON.stringify(ofCard(read.board, taskId)) === JSON.stringify(view),
          )
          return {
            slug,
            state: `${view.phase}${view.step === null ? '' : ` (${view.step})`}`,
            lagMs: shown !== undefined ? shown.at - at : until - at > 1000 ? until - at : null,
          }
        })
        const [counted] = yield* sql<{ changes: number }>`SELECT count(*) AS changes FROM change_log WHERE project_id = ${projectId}`
        const trace = {
          lags,
          samples,
          changes: counted?.changes,
          boardReads: window.reads,
          stood: Object.fromEntries(stood),
          reads: window.log.map(({ at, after }) => ({ at: at - started, after })),
          cards: (yield* Effect.orDie(queries.changesSince(0, 5000)))
            .filter((change) => change.aggregateType === 'card')
            .map((change) => [tasks.find((one) => one.taskId === change.aggregateId)?.slug ?? change.aggregateId, change.cursor]),
        }
        if (process.env.BOARD_TRACE !== undefined) writeFileSync(process.env.BOARD_TRACE, JSON.stringify(trace, null, 1))
        // Each card caught up with its view within a moment: the runtime's gather, the window's, and a board read, which on a
        // machine busy with other work (as CI's runners and agents' computers are) takes up to a second or two by itself.
        for (const { slug, state, lagMs } of lags)
          assert.isBelow(lagMs ?? 0, 2000, `${slug}'s card said ${state} ${lagMs}ms after its view`)
        assert.isBelow(window.reads, (counted?.changes ?? 0) / 4)
        assert.includeMembers(stood.get('tidy-the-docs') ?? [], ['held', 'running (implement)'])
        // Its review, which the fake reviewer passes at once, may come and go between two looks of the sampler: that the card
        // said it in time, where the sampler saw it, is what the lags above hold.
        assert.include(stood.get('add-a-retry') ?? [], 'waiting')
        assert.strictEqual(stood.get('cache-the-config')?.at(-1), 'settled checks passed')
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

describe('a card a read gave out that the runtime never worked out', () => {
  it.live('is said changed as its task comes back to the card the runtime last saw, as an abandoned merge does', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:wait]')
      const [running] = yield* until(cards(projectId), (all) => all[0]?.phase === 'running' && all[0].step === 'implement')
      const taskId = running?.taskId ?? ''
      const titled = running?.title ?? ''
      const titleOf = (board: BoardSnapshot) => board.tasks.find((card) => card.taskId === taskId)?.title
      // The runtime has worked its card out as its task started, and a window has it.
      const window = yield* windowOf(projectId, NOW)
      yield* Effect.sleep(Duration.millis(300))
      // Its card moves with nothing recorded, as a commit made by hand in its worktree moves it, and a window opened now reads it.
      yield* sql`UPDATE tasks SET title = 'Retry, as moved by hand' WHERE id = ${taskId}`
      const opened = yield* windowOf(projectId, NOW)
      assert.strictEqual(titleOf(opened.board), 'Retry, as moved by hand')
      // A change brings its card back to what the runtime last saw: said all the same, so that window reads it again.
      const from = yield* queries.cursor
      yield* retitleTask({ envelope: yield* Runtime.envelope('task.retitle', {}), taskId, title: titled })
      yield* until(
        Effect.sync(() => [titleOf(opened.board)]),
        ([title]) => title === titled,
        'the opened window to read the card back',
      )
      const since = yield* Effect.orDie(queries.changesSince(from, 500))
      assert.isTrue(since.some((change) => change.aggregateType === 'card' && change.aggregateId === taskId))
      assert.strictEqual(titleOf(window.board), titled)
    }).pipe(Effect.scoped, Effect.provide(runtimeWith({})))
  })
})

describe("a call on the board that is no task's", () => {
  it.live("moves the board as the coordinator asks the person, and as they answer, though no task's card does", () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const queries = yield* Queries
      const coordinator = yield* Coordinator
      const projectId = yield* ask(working, 'hello')
      const threadId = yield* coordinator.thread(projectId)
      // Its first turn is its brief with what was said; the question comes in the next.
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      const window = yield* windowOf(projectId, NOW)
      const from = yield* queries.cursor
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: scenarios.question }),
        threadId,
        body: scenarios.question,
        disposition: 'after_current',
      })
      // Asked, it waits in the board's Needs you, as its conversation shows it.
      const [asked] = yield* until(
        Effect.sync(() => window.board.calls),
        (calls) => calls.length === 1,
      )
      assert.strictEqual(asked?.taskId, null)
      const questions = yield* Questions
      yield* questions.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: asked?.id ?? '',
        answers: { database: { values: ['postgres'] } },
      })
      // Answered, it leaves the board.
      yield* until(
        Effect.sync(() => window.board.calls),
        (calls) => calls.length === 0,
      )
      // No task's card moved: the feed said the project's own did.
      const since = yield* Effect.orDie(queries.changesSince(from, 500))
      const said = since.filter((change) => change.aggregateType === 'card').map((change) => change.aggregateId)
      assert.isAbove(said.length, 0)
      assert.isTrue(said.every((id) => id === projectId))
    }).pipe(Effect.scoped, Effect.provide(runtimeWith({})))
  })
})

describe("a call on the board that is no task's, kept over a restart", () => {
  it.live('leaves the board as it is answered, before anything else moved its project since Althar started again', () => {
    const { working } = hosted()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-board-')), 'althar.db')
    const asked = Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const projectId = yield* ask(working, 'hello')
      const threadId = yield* coordinator.thread(projectId)
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: scenarios.question }),
        threadId,
        body: scenarios.question,
        disposition: 'after_current',
      })
      const queries = yield* Queries
      const [call] = yield* until(
        Effect.map(Effect.orDie(queries.board(projectId)), (board) => board.calls),
        (calls) => calls.length === 1,
      )
      return { projectId, attentionId: call?.id ?? '' }
    }).pipe(Effect.scoped, Effect.provide(runtimeWith({}, file)))
    return Effect.gen(function* () {
      const { projectId, attentionId } = yield* asked
      yield* Effect.gen(function* () {
        // Started again, a window reads the question still waiting, and the person answers it at once.
        const window = yield* windowOf(projectId, NOW)
        assert.lengthOf(window.board.calls, 1)
        yield* (yield* Questions).answer({
          envelope: yield* Runtime.envelope('attention.answer_question', {}),
          attentionId,
          answers: { database: { values: ['postgres'] } },
        })
        yield* until(
          Effect.sync(() => window.board.calls),
          (calls) => calls.length === 0,
          'the answered question to leave the board',
        )
      }).pipe(Effect.scoped, Effect.provide(runtimeWith({}, file)))
    })
  })
})

describe('the task a change is of', () => {
  it('is said for every kind of change the feed names', () => {
    // A kind added to the feed says the task it is of, or that it is none's: the record is typed so, and this reads it.
    assert.deepStrictEqual(Object.keys(TASK_OF).toSorted(), [...AggregateType.literals].toSorted())
  })
})
