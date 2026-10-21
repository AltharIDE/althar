import type { ProjectId } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, notices, task, turns, until, runtime } from './support'

/*
 * A task's thread reads in rounds: each starts with an ask (what the person
 * said, what the coordinator passed on, a review's verdict, Althar asking the
 * lead to settle something), then the lead's work on it. So the thread shows
 * what the lead is given where the lead reads it, not where it was sent, and
 * a page of it starts at the start of a round.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

const done = (row: { readonly state: string }) => !['pending', 'delivered'].includes(row.state)

/** Starts a lead on the thread, and waits for the turn that delivers its brief to end. */
const begin = (threadId: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const sessionId = yield* sessions.start({ threadId, agentId })
    yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every(done))
    return sessionId
  })

/** Waits until the turn that carries `body` is under way: the agent has it. */
const underWay = (threadId: string, body: string) =>
  until(turns(threadId), (rows) => rows.some((row) => row.state === 'delivered' && row.prompt?.endsWith(body) === true))

/** The thread's items, as their kind and text or title, leaving out the fake agent's echo of a new session's brief. */
const said = (threadId: string) =>
  Effect.map(items(threadId), (rows) =>
    rows
      .map((item) => [item.kind, String(item.content.text ?? item.content.title)] as const)
      .filter(([, text]) => !text.startsWith('echo: You are working on a task')),
  )

/** The coordinator's tools, on the project's coordinator thread. */
const asCoordinator = (projectId: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    return { role: 'coordinator', projectId, threadId: yield* coordinator.thread(projectId), sessionId: 'none', taskId: null } as ToolAccess
  })

describe('what the lead is given shows where it reads it', () => {
  it.live('moves what the person said during a turn after that turn, keeping when it was sent', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* begin(created.threadId)
      yield* say(created.threadId, 'Look around. [lead:slowly]')
      yield* underWay(created.threadId, 'Look around. [lead:slowly]')
      // Said while the lead works, it interrupts: the lead says what it had, and reads this after.
      const sent = yield* say(created.threadId, 'Use the retry helper.', 'interrupt_and_continue')
      yield* until(turns(created.threadId), (rows) => rows.length >= 3 && rows.every(done))
      assert.deepStrictEqual(
        (yield* said(created.threadId)).map(([kind, text]) => [kind, text.split('\n')[0]]),
        [
          ['user_message', 'Look around. [lead:slowly]'],
          ['agent_message', 'echo: Look around. [lead:slowly]'],
          ['user_message', 'Use the retry helper.'],
          ['agent_message', 'echo: The person interrupted your last turn to say:'],
        ],
      )
      // It keeps when it was sent, before the reply that now comes before it; windows are told it moved.
      const [moved] = yield* sql<{ id: string; createdAt: string; revision: number }>`
        SELECT id, created_at, revision FROM thread_items WHERE user_input_id = ${sent.inputId}`
      const [reply] = yield* sql<{ createdAt: string }>`
        SELECT created_at FROM thread_items WHERE kind = 'agent_message' AND json_extract(content, '$.text') = 'echo: Look around. [lead:slowly]'`
      assert.isBelow(Date.parse(moved?.createdAt ?? ''), Date.parse(reply?.createdAt ?? '') + 1)
      assert.strictEqual(moved?.revision, 2)
      const told = yield* sql<{ revision: number }>`
        SELECT aggregate_revision AS revision FROM change_log WHERE aggregate_type = 'thread_item' AND aggregate_id = ${moved?.id ?? ''}`
      assert.deepStrictEqual(
        told.map((row) => row.revision),
        [1, 2],
      )
      // A page of the thread has it where it is now.
      const page = yield* (yield* Queries).thread(created.threadId)
      assert.strictEqual(page.items.at(-2)?.id, moved?.id)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves what the person said where it is when nothing came after it, and several in the order the lead read them', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      // Two said before any lead starts: the first turn gives both, as they are.
      const first = yield* say(created.threadId, 'Start with the worker.')
      const second = yield* say(created.threadId, 'Then the queue.')
      yield* begin(created.threadId)
      const revisions = yield* sql<{ revision: number }>`
        SELECT revision FROM thread_items WHERE user_input_id IN (${first.inputId}, ${second.inputId}) ORDER BY sequence`
      assert.deepStrictEqual(
        revisions.map((row) => row.revision),
        [1, 1],
      )
      // Two said during a turn, and one interrupting: the interrupting one first, then the others in the order they were sent.
      yield* say(created.threadId, 'Look around. [lead:slowly]')
      yield* underWay(created.threadId, 'Look around. [lead:slowly]')
      yield* say(created.threadId, 'And the docs.')
      yield* say(created.threadId, 'And the tests.')
      yield* say(created.threadId, 'Stop: the tests first.', 'interrupt_and_continue')
      yield* until(turns(created.threadId), (rows) => rows.length >= 3 && rows.every(done))
      const shown = (yield* said(created.threadId)).map(([kind, text]) => [kind, text.split('\n')[0]])
      assert.deepStrictEqual(shown.slice(-5), [
        ['agent_message', 'echo: Look around. [lead:slowly]'],
        ['user_message', 'Stop: the tests first.'],
        ['user_message', 'And the docs.'],
        ['user_message', 'And the tests.'],
        ['agent_message', 'echo: The person interrupted your last turn to say:'],
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves what an agent cut short by its usage limit was given where it read it, when the next agent takes it', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'claude-code')
      yield* say(created.threadId, scenarios.quota)
      // Out of usage, the work moves to another agent, which is given what the person said again.
      yield* until(turns(created.threadId), (rows) => rows.length >= 3 && rows.every(done))
      const shown = (yield* said(created.threadId)).map(([kind, text]) => [kind, text.split('\n')[0]])
      // What the person said stays before what the first agent made of it, not after the agent that carried on.
      assert.deepStrictEqual(shown.slice(0, 3), [
        ['user_message', scenarios.quota],
        ['notice', 'The Claude account has no available quota. Resets at 2026-09-29T05:00:00Z'],
        ['agent_message', 'Claude AI usage limit reached|1759075200'],
      ])
      assert.deepStrictEqual(shown.slice(3, 5), [
        ['notice', 'Fake claude-code ran out of usage. Fake codex takes over.'],
        ['agent_message', 'echo: You are taking over a task from Fake claude-code, in the same worktree. Its record so far is below.'],
      ])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says what the coordinator passed on once the lead has it: after the turn it was sent during, or the turn it stopped', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task()
      const coordinator = yield* asCoordinator(project.projectId)
      const relayed = Effect.map(notices(created.threadId), (all) => all.filter((notice) => notice.title === 'From the coordinator:'))
      yield* begin(created.threadId)
      yield* say(created.threadId, 'Look around. [lead:slowly]')
      yield* underWay(created.threadId, 'Look around. [lead:slowly]')
      // Passed on while the lead works, it waits for the turn to end, and so does what the thread says of it.
      assert.strictEqual(
        yield* callTool(coordinator, 'message_lead', { task: created.taskId, message: 'Keep it short.' }),
        "Passed on to retry-checkout's lead.",
      )
      assert.isEmpty(yield* relayed)
      // Passed on at once, it stops the turn; the lead reads both after it, that one first, and the thread says them there.
      yield* callTool(coordinator, 'message_lead', { task: created.taskId, message: 'Stop: the docs first.', now: true })
      yield* until(turns(created.threadId), (rows) => rows.length >= 3 && rows.every(done))
      assert.deepStrictEqual(yield* relayed, [
        { source: 'runtime', severity: 'info', title: 'From the coordinator:', description: 'Stop: the docs first.', role: 'relayed' },
        { source: 'runtime', severity: 'info', title: 'From the coordinator:', description: 'Keep it short.', role: 'relayed' },
      ])
      assert.deepStrictEqual(
        (yield* said(created.threadId)).map(([kind, text]) => [kind, text.split('\n')[0]]),
        [
          ['user_message', 'Look around. [lead:slowly]'],
          ['agent_message', 'echo: Look around. [lead:slowly]'],
          ['notice', 'From the coordinator:'],
          ['notice', 'From the coordinator:'],
          ['agent_message', 'echo: The person interrupted your last turn to say:'],
        ],
      )
      // With the turn that gave them to the lead, which was told them as before.
      const placed = yield* sql<{ prompt: string }>`
        SELECT d.prompt FROM thread_items i JOIN turn_deliveries d ON d.id = i.delivery_id WHERE i.kind = 'notice'`
      assert.lengthOf(new Set(placed.map((turn) => turn.prompt)), 1)
      assert.strictEqual(
        placed[0]?.prompt,
        'The person interrupted your last turn to say:\n\nThe coordinator passes this on:\n\nStop: the docs first.\n\nTake it into account, and carry on with the task.\n\nThe coordinator passes this on:\n\nKeep it short.',
      )
      // Windows read them with their role.
      const page = yield* (yield* Queries).thread(created.threadId)
      assert.deepStrictEqual(
        page.items.flatMap((item) => (item.kind === 'notice' ? [item.content.role] : [])),
        ['relayed', 'relayed'],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says what the coordinator passed on to a task with no lead only once a lead starts and has it', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task()
      const coordinator = yield* asCoordinator(project.projectId)
      assert.match(
        yield* callTool(coordinator, 'message_lead', { task: created.taskId, message: 'Keep it short.' }),
        /^No lead is running on retry-checkout/,
      )
      assert.isEmpty(yield* notices(created.threadId))
      yield* begin(created.threadId)
      assert.deepStrictEqual(
        (yield* notices(created.threadId)).map((notice) => [notice.description, notice.role]),
        [['Keep it short.', 'relayed']],
      )
      // Said once, though the lead hears more after.
      yield* say(created.threadId, scenarios.hello)
      yield* until(turns(created.threadId), (rows) => rows.length >= 2 && rows.every(done))
      assert.lengthOf(yield* notices(created.threadId), 1)
    }).pipe(Effect.provide(withQueries())),
  )
})

/** Adds `count` messages of the agent's at the end of a thread at once, as `label 1`, `label 2` and on. */
const fill = (projectId: string, threadId: string, count: number, label = 'work') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [last] = yield* sql<{
      sequence: number
    }>`SELECT coalesce(max(sequence), 0) AS sequence FROM thread_items WHERE thread_id = ${threadId}`
    yield* sql`
      WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < ${count})
      INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, content, created_at)
      SELECT 'item_' || lower(hex(randomblob(16))), ${projectId}, ${threadId}, ${last?.sequence ?? 0} + k, 'agent_message',
        json_object('text', ${label} || ' ' || k), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM n`
  })

/** What the person said, as the lead has it. */
const asked = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const sent = yield* say(threadId, body)
    yield* sql`UPDATE user_inputs SET state = 'delivered' WHERE id = ${sent.inputId}`
  })

/** A page's items, as their text or title. */
const words = (page: { readonly items: ReadonlyArray<{ readonly kind: string; readonly content: unknown }> }) =>
  page.items.map((item) => {
    const content = item.content as { readonly text?: string | null; readonly title?: string; readonly summary?: string }
    return content.text ?? content.title ?? content.summary ?? item.kind
  })

describe('a page of a task’s thread', () => {
  it.live('starts at the start of the round its first item is in, and so does each earlier page', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { project, task: created } = yield* task()
      const place = { projectId: project.projectId as ProjectId, threadId: created.threadId }
      yield* fill(project.projectId, created.threadId, 1, 'before')
      yield* asked(created.threadId, 'First ask.')
      yield* fill(project.projectId, created.threadId, 30, 'a')
      // Althar's housekeeping, and a message still waiting its turn, start no round.
      yield* addItem(place, 'notice', { source: 'runtime', severity: 'info', title: 'A branch of its own.', role: 'aside' })
      yield* say(created.threadId, 'Waiting.')
      yield* fill(project.projectId, created.threadId, 120, 'a')
      yield* addItem(place, 'notice', { source: 'runtime', severity: 'info', title: 'From the coordinator:', role: 'relayed' })
      yield* fill(project.projectId, created.threadId, 200, 'b')

      // The newest hundred are all of the coordinator's round's work: the page reaches back to what it passed on.
      const newest = yield* queries.thread(created.threadId)
      assert.lengthOf(newest.items, 201)
      assert.deepStrictEqual(words(newest).slice(0, 2), ['From the coordinator:', 'b 1'])
      assert.strictEqual(words(newest).at(-1), 'b 200')
      assert.isTrue(newest.earlier)
      // The page before it reaches back past the housekeeping and the waiting message to what the person asked.
      const before = yield* queries.thread(created.threadId, { before: newest.items[0]?.sequence ?? 0 })
      assert.deepStrictEqual(words(before).slice(0, 2), ['First ask.', 'a 1'])
      assert.strictEqual(words(before).at(-1), 'a 120')
      assert.includeMembers(words(before), ['A branch of its own.', 'Waiting.'])
      assert.isTrue(before.earlier)
      // And the one before that is what came before it, as it is.
      const first = yield* queries.thread(created.threadId, { before: before.items[0]?.sequence ?? 0 })
      assert.deepStrictEqual(words(first), ['before 1'])
      assert.isFalse(first.earlier)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('takes a review’s verdict, what publishing found and what arrived as the start of a round, but not the lead’s report', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { project, task: created } = yield* task()
      const place = { projectId: project.projectId as ProjectId, threadId: created.threadId }
      const page = (limit: number) => Effect.map(queries.thread(created.threadId, { limit }), words)
      yield* asked(created.threadId, 'Ask.')
      yield* fill(project.projectId, created.threadId, 2, 'a')
      yield* addItem(place, 'step_result', { step: 'implement', round: 1, summary: 'Did it.' })
      yield* fill(project.projectId, created.threadId, 2, 'b')
      // The lead's own report is part of its round.
      assert.deepStrictEqual(yield* page(2), ['Ask.', 'a 1', 'a 2', 'Did it.', 'b 1', 'b 2'])
      yield* addItem(place, 'step_result', { step: 'review', round: 1, summary: 'Two findings.', verdict: 'changes_requested' })
      yield* fill(project.projectId, created.threadId, 2, 'c')
      assert.deepStrictEqual(yield* page(1), ['Two findings.', 'c 1', 'c 2'])
      yield* addItem(place, 'step_result', { step: 'publish', round: 1, summary: 'Checks failed.' })
      yield* fill(project.projectId, created.threadId, 1, 'd')
      assert.deepStrictEqual(yield* page(1), ['Checks failed.', 'd 1'])
      yield* addItem(place, 'arrival', { source: 'github', kind: 'comment', text: 'Looks off.' })
      yield* fill(project.projectId, created.threadId, 1, 'e')
      assert.deepStrictEqual(yield* page(1), ['Looks off.', 'e 1'])
      // An agent's own notice starts nothing; Althar's news does.
      yield* addItem(place, 'notice', { source: 'agent', severity: 'warning', title: 'Context is filling up' })
      yield* fill(project.projectId, created.threadId, 1, 'f')
      assert.lengthOf(yield* page(1), 4)
      yield* addItem(place, 'notice', { source: 'runtime', severity: 'warning', title: 'A conflict with main.' })
      yield* fill(project.projectId, created.threadId, 1, 'g')
      assert.deepStrictEqual(yield* page(1), ['A conflict with main.', 'g 1'])
      // A page that starts at an ask reaches no further back.
      assert.deepStrictEqual(yield* page(2), ['A conflict with main.', 'g 1'])
      // Nor does one with nothing on it.
      assert.isEmpty(yield* page(0))
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('reaches back to the thread’s start where no ask came first, and no further than a cap in one enormous round', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const { project, task: created } = yield* task()
      yield* fill(project.projectId, created.threadId, 150, 'brief')
      const opening = yield* queries.thread(created.threadId)
      assert.lengthOf(opening.items, 150)
      assert.isFalse(opening.earlier)
      yield* asked(created.threadId, 'Ask.')
      yield* fill(project.projectId, created.threadId, 2_500, 'long')
      const long = yield* queries.thread(created.threadId)
      assert.lengthOf(long.items, 2_100)
      assert.deepStrictEqual(words(long).slice(0, 1), ['long 401'])
      assert.isTrue(long.earlier)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('leaves the coordinator’s thread paged by the newest items', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const coordinator = yield* Coordinator
      const { project } = yield* task()
      const threadId = yield* coordinator.thread(project.projectId)
      yield* asked(threadId, 'Ask.')
      yield* fill(project.projectId, threadId, 150, 'said')
      const page = yield* queries.coordinator(project.projectId)
      assert.lengthOf(page.items, 100)
      assert.isTrue(page.earlier)
    }).pipe(Effect.provide(withQueries())),
  )
})
