import { assert, describe, it } from '@effect/vitest'

import { graphOf, type RunRows, type StepRow, type TryRow } from '../src/graph'

/*
 * A task's rounds of work, for its Graph face: each run with its steps as
 * they ran, a step's last try saying where it stands and who made it, and
 * what the plan still has to come, never what a review might lead to.
 */

const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, '0')}:00.000Z`

const tried = (state: string, extra: Partial<TryRow> = {}): TryRow => ({
  state,
  hold: null,
  agentId: 'claude-code',
  model: 'opus',
  startedAt: at(1),
  endedAt: state === 'succeeded' ? at(9) : null,
  ...extra,
})

const step = (key: StepRow['key'], iteration: number, tries: ReadonlyArray<TryRow>, state = 'succeeded'): StepRow => ({
  id: `node_${key}_${iteration}`,
  key,
  iteration,
  state,
  tries,
})

const run = (extra: Partial<RunRows> = {}): RunRows => ({
  id: 'run_1',
  planId: 'plan_1',
  createdAt: at(0),
  endedAt: null,
  planned: [
    { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
    { key: 'review', agentId: 'codex', model: 'gpt-5.2', skipped: false },
  ],
  publishes: true,
  began: ['implement', 'review'],
  changedAt: null,
  said: null,
  steps: [],
  ...extra,
})

const keys = (rows: ReadonlyArray<RunRows>) =>
  graphOf(rows).map((round) => round.steps.map((one) => `${one.key}${one.iteration}:${one.state}`))

describe('a task’s graph', () => {
  it('puts what the plan still has after what ran: its work, its first review and its pull request', () => {
    assert.deepStrictEqual(keys([run()]), [['implement0:next', 'review0:next', 'publish0:next']])
    assert.deepStrictEqual(keys([run({ steps: [step('implement', 0, [tried('running')], 'running')] })]), [
      ['implement0:running', 'review0:next', 'publish0:next'],
    ])
    // A step to come is for whom the plan names: the reviewer for its review, nobody for the pull request, which is Althar's.
    const [round] = graphOf([run()])
    assert.deepStrictEqual(
      round?.steps.map((one) => [one.agentId, one.model]),
      [
        ['claude-code', 'opus'],
        ['codex', 'gpt-5.2'],
        [null, null],
      ],
    )
    assert.strictEqual(round?.steps[1]?.id, 'run_1:review:0')
  })

  it('never guesses at a review’s settling or the review after it: they show as they start', () => {
    const looping = run({
      steps: [
        step('implement', 0, [tried('succeeded')]),
        step('review', 0, [tried('succeeded', { agentId: 'codex', model: 'gpt-5.2' })]),
        step('settle', 0, [tried('succeeded')]),
        step('review', 1, [tried('running', { agentId: 'codex', model: 'gpt-5.2' })], 'running'),
      ],
    })
    assert.deepStrictEqual(keys([looping]), [['implement0:done', 'review0:done', 'settle0:done', 'review1:running', 'publish0:next']])
  })

  it('leaves out a review the plan skips, and a pull request where the run publishes nothing', () => {
    const quick = run({
      planned: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: 'gpt-5.2', skipped: true },
      ],
      publishes: false,
    })
    assert.deepStrictEqual(keys([quick]), [['implement0:next']])
  })

  it('has nothing to come once its run ended, whatever it never reached', () => {
    const stopped = run({ endedAt: at(30), steps: [step('implement', 0, [tried('cancelled')], 'cancelled')] })
    assert.deepStrictEqual(keys([stopped]), [['implement0:cancelled']])
  })

  it('says where a step stands by its last try, and who made that one', () => {
    const tries = [tried('failed', { agentId: 'codex', model: 'gpt-5.2' }), tried('running', { agentId: 'claude-code', model: 'sonnet' })]
    const [round] = graphOf([run({ steps: [step('review', 0, tries, 'running')] })])
    const shown = round?.steps[0]
    assert.strictEqual(shown?.state, 'running')
    assert.deepStrictEqual([shown?.agentId, shown?.model], ['claude-code', 'sonnet'])
    // Started when its first try did; not ended while it runs.
    assert.deepStrictEqual([shown?.startedAt, shown?.endedAt], [at(1), null])
  })

  it('reads every state a try can be in as one of the graph’s', () => {
    const states = [
      ['succeeded', 'done'],
      ['waiting_attention', 'waiting'],
      ['held', 'held'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
      ['cancelling', 'cancelled'],
      ['superseded', 'cancelled'],
      ['ready', 'running'],
      ['admitted', 'running'],
      ['running', 'running'],
      ['verifying', 'running'],
      ['reconciling', 'running'],
      ['uncertain', 'running'],
    ] as const
    for (const [tryState, shown] of states) {
      const [round] = graphOf([run({ endedAt: at(30), steps: [step('implement', 0, [tried(tryState)], 'running')] })])
      assert.strictEqual(round?.steps[0]?.state, shown, tryState)
    }
    // A node no try reached: to come, or cut short where it was skipped or cancelled.
    for (const [nodeState, shown] of [
      ['pending', 'next'],
      ['skipped', 'cancelled'],
      ['cancelled', 'cancelled'],
    ] as const) {
      const [round] = graphOf([run({ endedAt: at(30), steps: [step('review', 0, [], nodeState)] })])
      assert.strictEqual(round?.steps[0]?.state, shown, nodeState)
    }
  })

  it('says what holds a held step, and who its plan names while no agent has it', () => {
    const held = tried('held', { hold: 'machine_busy', agentId: null, model: null, startedAt: null })
    const [round] = graphOf([run({ steps: [step('implement', 0, [tried('succeeded')]), step('review', 0, [held], 'running')] })])
    const review = round?.steps[1]
    assert.deepStrictEqual([review?.state, review?.hold, review?.agentId, review?.model], ['held', 'machine_busy', 'codex', 'gpt-5.2'])
    // A hold the store names that the graph doesn't know is no hold it says; one not held has none.
    const [odd] = graphOf([run({ steps: [step('implement', 0, [tried('held', { hold: 'mystery' })], 'running')] })])
    assert.strictEqual(odd?.steps[0]?.hold, null)
    assert.strictEqual(round?.steps[0]?.hold, null)
  })

  it('marks what a change to the steps put in, and only that', () => {
    // A quick task made a change: it began with its work alone; the change added its review, its settling and its pull request.
    const changed = run({
      began: ['implement'],
      changedAt: at(20),
      steps: [
        step('implement', 0, [tried('succeeded')]),
        step('review', 0, [tried('succeeded')]),
        step('settle', 0, [tried('running')], 'running'),
      ],
    })
    const [round] = graphOf([changed])
    assert.deepStrictEqual(
      round?.steps.map((one) => [one.key, one.added]),
      [
        ['implement', false],
        ['review', true],
        ['settle', true],
        ['publish', true],
      ],
    )
    assert.strictEqual(round?.changedAt, at(20))
    // Without a change, nothing was added; one that came where the review was planned added only its pull request.
    assert.isFalse(graphOf([run()])[0]?.steps.some((one) => one.added))
    assert.deepStrictEqual(
      graphOf([run({ changedAt: at(20) })])[0]?.steps.map((one) => one.added),
      [false, false, true],
    )
  })

  it('tells a follow-up from the plan’s run, with what started it', () => {
    const said = { itemId: 'item_1', text: 'One more thing', relayed: false }
    const rounds = graphOf([run({ endedAt: at(30) }), run({ id: 'run_2', planId: null, createdAt: at(40), said, publishes: false })])
    assert.deepStrictEqual(
      rounds.map((round) => [round.id, round.followUp, round.said?.text ?? null]),
      [
        ['run_1', false, null],
        ['run_2', true, 'One more thing'],
      ],
    )
  })
})
