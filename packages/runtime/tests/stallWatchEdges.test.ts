import type { SessionEvent } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import type { LiveEvent } from '../src/Live'
import { makeStallWatch, type StallAction, type StallLimits } from '../src/stallWatch'

/*
 * The stall watch's reckoning at its edges (stallWatch.test.ts has the main
 * story): what it ignores, and what it does once the person has been asked.
 */

const LIMITS: StallLimits = {
  quiet: 600,
  quietInTool: 1_200,
  cancelGrace: 60,
  asleepAfter: 90,
  work: 60_000,
  turns: 50,
  busyShare: 0.05,
}

const T = 't1'
const started = (turnId: string, byPerson = false): LiveEvent => ({ _tag: 'TurnStarted', threadId: T, turnId, byPerson })
const ended = (turnId: string, state = 'completed'): LiveEvent => ({ _tag: 'TurnEnded', threadId: T, turnId, state })
const agent = (event: SessionEvent): LiveEvent => ({ _tag: 'Agent', threadId: T, event })

/** A watch, looked at every 30 milliseconds from `from` to `to`, with no CPU to tell by. */
const watching = (limits: StallLimits = LIMITS) => {
  const watch = makeStallWatch(limits)
  const looks = (from: number, to: number) => {
    const actions: Array<StallAction> = []
    for (let now = from; now <= to; now += 30) actions.push(...watch.look(now, () => null))
    return actions
  }
  return { watch, looks }
}

const tags = (actions: ReadonlyArray<StallAction>) => actions.map((action) => action._tag)

describe('what the stall watch leaves alone', () => {
  it("takes what Althar runs of a project, and what an agent left running, for no turn's work", () => {
    const { watch, looks } = watching()
    assert.deepStrictEqual(watch.observe({ _tag: 'Launches', projectId: 'prj_1', launches: [] }, 0), [])
    assert.deepStrictEqual(watch.turning(), [])
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(watch.observe({ _tag: 'Background', threadId: T, background: [] }, 500), [])
    // The dev server it left running said nothing of the turn: it stalls as if it weren't there.
    assert.deepStrictEqual(tags(looks(0, 600)), ['CarryOn'])
  })

  it("takes nothing an agent says between turns for a sign of the next one's life", () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    watch.observe(ended('u1'), 10)
    assert.deepStrictEqual(watch.observe(agent({ _tag: 'AgentMessage', text: 'Done.' }), 20), [])
    watch.observe({ _tag: 'Output', threadId: T, itemId: 'i', text: 'ok', dropped: 0 }, 20)
    assert.deepStrictEqual(watch.turning(), [])
    // Only threads with a turn running are looked at, with others idle beside them.
    watch.observe({ _tag: 'TurnStarted', threadId: 't2', turnId: 'v1' }, 30)
    assert.deepStrictEqual(watch.turning(), ['t2'])
    assert.deepStrictEqual(
      looks(30, 630).map((action) => action.threadId),
      ['t2'],
    )
  })
})

describe('a tool call told in pieces', () => {
  it('reads an update for a call it never heard begin, and a call that came already finished', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    // Updates alone, with no title: four alike, however they went, are the agent going round in circles.
    const updates = ['a', 'b', 'c', 'd'].flatMap((id) =>
      watch.observe(agent({ _tag: 'ToolCallUpdate', toolCallId: id, status: 'completed', rawInput: { command: 'ls docs' } }), 10),
    )
    assert.deepStrictEqual(updates, [{ _tag: 'Redirect', threadId: T, repeated: 'ls docs', times: 4 }])
    // A call that arrives finished, with no update after: its result is nothing, the same each time.
    const whole = ['e', 'f', 'g'].flatMap((id) =>
      watch.observe(
        agent({
          _tag: 'ToolCall',
          toolCallId: id,
          title: 'cargo build',
          kind: 'execute',
          status: 'failed',
          rawInput: { command: 'cargo build' },
        }),
        20,
      ),
    )
    assert.deepStrictEqual(whole, [{ _tag: 'GiveUp', threadId: T, why: 'looping', detail: 'cargo build', tried: ['redirected'] }])
  })

  it('tells calls with no input apart by what their diffs change', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    const edit = (id: string, change: string) =>
      watch.observe(
        agent({
          _tag: 'ToolCall',
          toolCallId: id,
          title: 'Edit board.ts',
          kind: 'edit',
          status: 'completed',
          content: [{ _tag: 'Diff', path: 'board.ts', created: false, change }],
        }),
        10,
      )
    assert.deepStrictEqual(
      ['a', 'b', 'c', 'd'].flatMap((change, index) => edit(`e${index}`, change)),
      [],
    )
    assert.deepStrictEqual(tags(['x', 'x', 'x', 'x'].flatMap((change, index) => edit(`f${index}`, change))), ['Redirect'])
  })
})

describe('a turn after the person was asked', () => {
  it('says nothing more of a stall until the person speaks, then starts from the beginning', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(tags(looks(0, 600)), ['CarryOn'])
    watch.observe(started('u2'), 620)
    assert.deepStrictEqual(tags(looks(630, 1_230)), ['Restart'])
    watch.observe(started('u3'), 1_300)
    assert.deepStrictEqual(tags(looks(1_320, 1_920)), ['GiveUp'])
    // The person was asked; an agent that starts another turn by itself and stalls again isn't stopped, or asked about twice.
    watch.observe(started('u4'), 2_000)
    assert.deepStrictEqual(looks(2_010, 5_010), [])
    assert.deepStrictEqual(watch.turning(), [T])
    // A turn that ends as turns do once the person has been asked leaves it so.
    watch.observe(ended('u4'), 5_020)
    watch.observe(started('u5'), 5_030)
    assert.deepStrictEqual(looks(5_040, 8_040), [])
    // The person says something: a stall is told to carry on again.
    watch.observe(started('u6', true), 8_100)
    assert.deepStrictEqual(tags(looks(8_110, 8_710)), ['CarryOn'])
  })
})

describe('a stop asked for as the machine sleeps', () => {
  it('gives a turn asked to stop its whole grace again once the machine wakes', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(tags(looks(0, 600)), ['CarryOn'])
    // The machine sleeps before the grace is over, and wakes an hour on.
    assert.deepStrictEqual(looks(3_600_000, 3_600_000), [])
    assert.deepStrictEqual(looks(3_600_030, 3_600_030), [])
    // Still not stopped a grace after it woke: it is started afresh.
    assert.deepStrictEqual(looks(3_600_060, 3_600_060), [{ _tag: 'Restart', threadId: T, why: 'ignored_stop' }])
  })
})
