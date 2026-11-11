import { POINTED_PROPOSAL, POINTED_QUESTIONS } from '@althar/provider-adapters/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import {
  LAST_MESSAGE_COORDINATOR,
  LAST_MESSAGE_LEAD,
  LAST_MESSAGE_REVIEWER,
  LAST_MESSAGE_REVIEWING,
  pointsBack,
  RESTATE_START,
  type RoundItem,
  toRestate,
} from '../src/lastMessage'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { reviewBrief } from '../src/reviewing'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * A turn's last message carries everything the person needs (ADR-099): what
 * an agent says on the way folds under "Worked for…", and only its last
 * message, or a lead's report where nothing follows it, stands open. Each
 * role is told so in its brief; and a lead whose last message only points
 * back at what folded ("the proposal is above") is told once to say it again.
 */

const said = (text: string, thisTurn = true): RoundItem => ({ kind: 'message', text, thisTurn })
const reported = (text: string, thisTurn = true): RoundItem => ({ kind: 'report', text, thisTurn })

/** The compaction lead's turn: progress lines, its whole proposal, finish_step, then a short pointer to it. */
const compaction: ReadonlyArray<RoundItem> = [
  said('Reading the ADRs first.'),
  said('Grouping them by what each decides now.'),
  said(`${POINTED_PROPOSAL}\n\n${POINTED_QUESTIONS}`),
  reported('Proposed a dozen current-state decisions; waiting on the answers.'),
  said('The proposal is above: answer the questions and I’ll compact the ADRs.'),
]

describe('what stands open of a round', () => {
  it('points back where it ends on a short "the proposal is above", after the proposal and finish_step', () => {
    assert.strictEqual(toRestate(compaction), 'The proposal is above')
  })

  it('reads the words that point back at what was said earlier, and not a place on a page', () => {
    for (const pointing of [
      'See above for the 17 questions.',
      'The questions above are what I need answered.',
      'Answer the questions I posted above.',
      'All twelve are laid out earlier in the thread.',
      'The proposal I posted in the thread holds the rest.',
      'As I said earlier, the old ADRs stay in git.',
      'Everything is in my previous message.',
      'Scroll up for the diagram.',
    ])
      assert.isDefined(pointsBack(pointing), pointing)
    for (const standing of [
      'The strip sits above the composer now.',
      'Coverage is above 90% again.',
      'The `above` check is in `lastMessage.ts`.',
      'It reads "see above" as pointing back.',
      `${POINTED_PROPOSAL}\n\n${POINTED_QUESTIONS}`,
    ])
      assert.isUndefined(pointsBack(standing), standing)
  })

  it('reads the report where nothing follows it, as the thread shows it then', () => {
    assert.isDefined(toRestate([said(POINTED_PROPOSAL), reported('See the proposal above.')]))
    assert.isUndefined(toRestate([said('See the proposal above.'), reported(POINTED_PROPOSAL)]))
  })

  it('asks nothing where it stands alone, nothing was said before it, or it came in an earlier turn', () => {
    assert.isUndefined(toRestate([...compaction.slice(0, 4), said(`${POINTED_PROPOSAL}\n\n${POINTED_QUESTIONS}`)]))
    assert.isUndefined(toRestate([said('The proposal is above.')]))
    assert.isUndefined(toRestate([said(POINTED_PROPOSAL, false), said('The proposal is above.', false)]))
  })

  it('asks nothing where the last message is longer than anything said before it, whatever words it uses', () => {
    // Such as a brief quoted back whole, with its "never point at anything said earlier in the turn".
    const full = `${POINTED_PROPOSAL}\n\n${POINTED_QUESTIONS}\n\nAs noted above, the old ADRs stay in git; nothing said earlier in the turn is left out here.`
    assert.isDefined(pointsBack(full))
    assert.isUndefined(toRestate([said('Reading the ADRs first.'), said(POINTED_PROPOSAL), said(full)]))
  })
})

describe('each role’s brief', () => {
  it('tells a review task’s lead its last message stands open', () => {
    const brief = reviewBrief({
      cwd: '/tmp/review',
      review: {
        repository: ['meridian', 'api'],
        number: 12,
        url: 'https://github.test/meridian/api/pull/12',
        title: 'Retry the checkout',
        author: 'ana',
        member: true,
        fork: null,
        outside: false,
        head: 'a'.repeat(40),
        base: 'main',
        baseCommit: 'b'.repeat(40),
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        words: { noun: 'pull request', short: 'PR', prefix: '#' },
      },
    })
    assert.include(brief, LAST_MESSAGE_REVIEWING)
  })

  it.live('tells the coordinator its last message is what the person reads', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'hello' }),
        threadId,
        body: 'hello',
        disposition: 'after_current',
      })
      const [first] = yield* until(
        sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at`,
        (rows) => rows.length === 1,
      )
      assert.include(first?.prompt, LAST_MESSAGE_COORDINATOR)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a lead whose last message points back at its proposal', () => {
  it.live('is told once to say it again, and its last message then holds the whole proposal', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Compact the ADRs into a dozen current-state decisions',
        description: 'Propose it first. [lead:points-back] [review:pass]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: opened.projectId as ProjectId,
        taskId: created.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: instance.personId,
        end: null,
      })
      yield* plans.start(planId, instance.personId)
      const messages = sql<{ text: string }>`
        SELECT json_extract(content, '$.text') AS text FROM thread_items
        WHERE thread_id = ${created.threadId} AND kind = 'agent_message' ORDER BY sequence`
      // Its last message holds the whole proposal again, after the short one that pointed at it.
      const all = yield* until(messages, (rows) => rows.length >= 5)
      assert.include(
        all.map((row) => row.text),
        'The proposal is above: answer the questions and I’ll compact the ADRs.',
      )
      assert.strictEqual(all.at(-1)?.text, `${POINTED_PROPOSAL}\n\n${POINTED_QUESTIONS}`)
      // Told once, quietly: nothing of it is a message in the thread, and the turn that answered it isn't told again.
      const told = sql<{ body: string }>`
        SELECT body FROM user_inputs WHERE thread_id = ${created.threadId}
          AND substr(body, 1, ${RESTATE_START.length}) = ${RESTATE_START}`
      const turns = sql<{ ended: string | null }>`
        SELECT ended_at AS ended FROM turn_deliveries WHERE thread_id = ${created.threadId} ORDER BY requested_at`
      yield* until(turns, (rows) => rows.length === 2 && rows.every((row) => row.ended !== null))
      yield* Effect.sleep('300 millis')
      const nudges = yield* told
      assert.lengthOf(nudges, 1)
      assert.include(nudges[0]?.body, '("The proposal is above")')
      assert.lengthOf(yield* turns, 2)
      // Its brief, and its reviewer's, said where the person reads.
      const [lead] = yield* sql<{ prompt: string }>`
        SELECT prompt FROM turn_deliveries WHERE thread_id = ${created.threadId} ORDER BY requested_at LIMIT 1`
      assert.include(lead?.prompt, LAST_MESSAGE_LEAD)
      const [reviewer] = yield* until(
        sql<{ prompt: string }>`
          SELECT d.prompt FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
          WHERE t.task_id = ${created.taskId} AND t.kind = 'step' ORDER BY d.requested_at LIMIT 1`,
        (rows) => rows.length === 1,
      )
      assert.include(reviewer?.prompt, LAST_MESSAGE_REVIEWER)
    }).pipe(Effect.provide(runtime())),
  )
})
