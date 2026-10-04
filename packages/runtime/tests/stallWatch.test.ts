import type { SessionEvent } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import type { LiveEvent } from '../src/Live'
import { cpuTimeOf, treeCpuOf, treeCpus } from '../src/processTree'
import { type Finished, makeStallWatch, repeated, spanOf, type StallAction, type StallLimits } from '../src/stallWatch'
import { Effect } from 'effect'

const LIMITS: StallLimits = {
  quiet: 600,
  quietInTool: 1_200,
  cancelGrace: 60,
  asleepAfter: 90,
  work: 6_000,
  turns: 5,
  busyShare: 0.05,
}

const T = 't1'
const started = (turnId: string, byPerson = false): LiveEvent => ({ _tag: 'TurnStarted', threadId: T, turnId, byPerson })
const ended = (turnId: string, state = 'completed'): LiveEvent => ({ _tag: 'TurnEnded', threadId: T, turnId, state })
const agent = (event: SessionEvent): LiveEvent => ({ _tag: 'Agent', threadId: T, event })
const said: LiveEvent = agent({ _tag: 'AgentMessage', text: 'Working' })
const command = (id: string, line: string): LiveEvent =>
  agent({ _tag: 'ToolCall', toolCallId: id, title: line, kind: 'execute', status: 'in_progress', rawInput: { command: line } })
const done = (id: string, status: 'completed' | 'failed', output: unknown): LiveEvent =>
  agent({ _tag: 'ToolCallUpdate', toolCallId: id, status, rawOutput: output })

/** A watch, looked at every 30 milliseconds from 0 as `at` says, with no CPU to tell by unless given. */
const watching = (limits: StallLimits = LIMITS) => {
  const watch = makeStallWatch(limits)
  const looks = (from: number, to: number, cpu: (now: number) => number | null = () => null) => {
    const actions: Array<StallAction> = []
    for (let now = from; now <= to; now += 30) actions.push(...watch.look(now, () => cpu(now)))
    return actions
  }
  return { watch, looks }
}

const tags = (actions: ReadonlyArray<StallAction>) => actions.map((action) => action._tag)

describe('a turn that stalls', () => {
  it('is told to carry on, then started afresh, then the person is asked, each once', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(looks(0, 570), [])
    assert.deepStrictEqual(looks(600, 600), [{ _tag: 'CarryOn', threadId: T, quietFor: 600, tool: null }])
    // Stopped as asked, it is told to carry on in a turn of its own.
    watch.observe(ended('u1', 'interrupted'), 610)
    watch.observe(started('u2'), 620)
    assert.deepStrictEqual(looks(630, 1_200), [])
    assert.deepStrictEqual(looks(1_230, 1_230), [{ _tag: 'Restart', threadId: T, why: 'stalled' }])
    watch.observe({ _tag: 'SessionStarted', threadId: T, sessionId: 's2', agentId: 'codex' }, 1_300)
    watch.observe(started('u3'), 1_300)
    assert.deepStrictEqual(tags(looks(1_320, 1_920)), ['GiveUp'])
    assert.deepStrictEqual(looks(1_950, 1_950), [])
  })

  it('gives up with what it tried', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    looks(0, 600)
    watch.observe(started('u2'), 610)
    looks(630, 1_230)
    watch.observe(started('u3'), 1_300)
    assert.deepStrictEqual(looks(1_320, 1_920), [
      { _tag: 'GiveUp', threadId: T, why: 'stalled', detail: null, tried: ['carried_on', 'restarted'] },
    ])
  })

  it('starts from the beginning after a turn that ended as turns do', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(tags(looks(0, 600)), ['CarryOn'])
    watch.observe(ended('u1', 'interrupted'), 610)
    watch.observe(started('u2'), 620)
    watch.observe(ended('u2'), 700)
    watch.observe(started('u3'), 800)
    assert.deepStrictEqual(tags(looks(810, 1_410)), ['CarryOn'])
  })

  it('shows life by what its agent says, and by the CPU its processes use, but not by a trickle of it', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    watch.observe(said, 500)
    watch.observe({ _tag: 'Streaming', threadId: T, itemId: 'i', kind: 'agent_message', agentId: 'codex', text: 'W' }, 1_100)
    assert.deepStrictEqual(looks(0, 1_590), [])
    // A build: a tenth of a CPU at every look, while the command runs.
    watch.observe(command('build', 'npm run build'), 1_600)
    assert.deepStrictEqual(
      looks(1_620, 4_000, (now) => now * 0.1),
      [],
    )
    // Idle, a hundredth of one: it stalls.
    assert.deepStrictEqual(tags(looks(4_020, 5_220, (now) => 400 + (now - 4_000) * 0.01)), ['CarryOn'])
  })

  it("doesn't take CPU for life while no tool runs: that's what the agent left running, such as a dev server", () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(tags(looks(0, 600, (now) => now)), ['CarryOn'])
  })

  it('waits longer while a tool runs, and says which', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    watch.observe(command('dev', 'npm run dev'), 0)
    assert.deepStrictEqual(looks(0, 1_170), [])
    assert.deepStrictEqual(looks(1_200, 1_200), [
      { _tag: 'CarryOn', threadId: T, quietFor: 1_200, tool: { title: 'npm run dev', command: 'npm run dev' } },
    ])
    // One that finished doesn't hold the turn up.
    const other = watching()
    other.watch.observe(started('u1'), 0)
    other.watch.observe(command('dev', 'npm test'), 0)
    other.watch.observe(done('dev', 'completed', { exitCode: 0 }), 0)
    assert.deepStrictEqual(other.looks(0, 600), [{ _tag: 'CarryOn', threadId: T, quietFor: 600, tool: null }])
  })

  it('is not stalled, and not at work, while it waits on the person', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    watch.observe({ _tag: 'AttentionNeeded', threadId: T, attentionId: 'a1', title: 'Run make deploy', reason: 'Deploying asks.' }, 0)
    assert.deepStrictEqual(looks(0, 9_000), [])
    watch.observe({ _tag: 'AttentionClosed', threadId: T, attentionId: 'a1', outcome: 'answered' }, 9_010)
    assert.deepStrictEqual(tags(looks(9_030, 9_630)), ['CarryOn'])
  })

  it("doesn't count the machine's sleep as silence", () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(looks(0, 300), [])
    // The next look comes an hour late.
    assert.deepStrictEqual(looks(3_600_000, 3_600_000), [])
    assert.deepStrictEqual(looks(3_600_030, 3_600_570), [])
    assert.deepStrictEqual(tags(looks(3_600_600, 3_600_600)), ['CarryOn'])
  })

  it("starts afresh one that doesn't stop when asked, and asks the person if it stalls again", () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    assert.deepStrictEqual(tags(looks(0, 600)), ['CarryOn'])
    assert.deepStrictEqual(looks(630, 630), [])
    assert.deepStrictEqual(looks(660, 660), [{ _tag: 'Restart', threadId: T, why: 'ignored_stop' }])
    watch.observe(started('u2'), 700)
    assert.deepStrictEqual(tags(looks(720, 1_320)), ['GiveUp'])
  })

  it('looks only at turns running', () => {
    const { watch, looks } = watching()
    watch.observe(started('u1'), 0)
    watch.observe(ended('u1'), 10)
    watch.observe({ _tag: 'SessionEnded', threadId: T, sessionId: 's1', state: 'completed' }, 20)
    assert.deepStrictEqual(watch.turning(), [])
    assert.deepStrictEqual(looks(0, 3_000), [])
  })
})

describe('an agent going round in circles', () => {
  const failing = (id: string) => [command(id, 'npm test'), done(id, 'failed', { exitCode: 1, output: '1 failing' })]

  it('is told to try another way, then the person is asked', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    const first = [...failing('a'), ...failing('b'), ...failing('c')].flatMap((event) => watch.observe(event, 10))
    assert.deepStrictEqual(first, [{ _tag: 'Redirect', threadId: T, repeated: 'npm test', times: 3 }])
    watch.observe(ended('u1', 'interrupted'), 20)
    watch.observe(started('u2'), 30)
    const again = [...failing('d'), ...failing('e'), ...failing('f')].flatMap((event) => watch.observe(event, 40))
    assert.deepStrictEqual(again, [{ _tag: 'GiveUp', threadId: T, why: 'looping', detail: 'npm test', tried: ['redirected'] }])
  })

  it('is given its patience back when the person says something', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    ;[...failing('a'), ...failing('b'), ...failing('c')].forEach((event) => watch.observe(event, 10))
    watch.observe(started('u2', true), 30)
    const again = [...failing('d'), ...failing('e'), ...failing('f')].flatMap((event) => watch.observe(event, 40))
    assert.deepStrictEqual(tags(again), ['Redirect'])
  })

  it('is told by the same call to the same end, three times failing or four however it went, or two taking turns', () => {
    const call = (key: string, failed = false, output = 'same'): Finished => ({ key, shown: key, failed, output })
    assert.deepStrictEqual(repeated([call('a', true), call('a', true), call('a', true)]), { shown: 'a', times: 3 })
    assert.isNull(repeated([call('a', true), call('a', true)]))
    assert.isNull(repeated([call('a'), call('a'), call('a')]))
    assert.deepStrictEqual(repeated([call('a'), call('a'), call('a'), call('a')]), { shown: 'a', times: 4 })
    // A different output is a different end: the agent is getting somewhere.
    assert.isNull(repeated([call('a', true, '1'), call('a', true, '2'), call('a', true, '3')]))
    assert.deepStrictEqual(repeated([call('a'), call('b'), call('a'), call('b'), call('a'), call('b')]), {
      shown: 'a` and `b',
      times: 3,
    })
    assert.isNull(repeated([call('a'), call('b'), call('a'), call('b'), call('a'), call('c')]))
    assert.isNull(repeated([]))
  })

  const edit = (id: string, path: string, change: string) => [
    agent({ _tag: 'ToolCall', toolCallId: id, title: `Edit ${path}`, kind: 'edit', status: 'pending' }),
    agent({ _tag: 'ToolCallUpdate', toolCallId: id, rawInput: { file_path: path, old_string: change, new_string: `${change}!` } }),
    done(id, 'completed', `The file ${path} has been updated successfully.`),
  ]

  it('tells edits apart by what they change, not by their title and the same reply, as Claude Code sends them', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    const oneFile = ['a', 'b', 'c', 'd'].flatMap((change) => edit(change, 'src/board.ts', change))
    assert.deepStrictEqual(
      oneFile.flatMap((event) => watch.observe(event, 10)),
      [],
    )
    const byTurns = ['e', 'f', 'g', 'h', 'i', 'j'].flatMap((change, index) =>
      edit(change, index % 2 === 0 ? 'Card.tsx' : 'Card.test.tsx', change),
    )
    assert.deepStrictEqual(
      byTurns.flatMap((event) => watch.observe(event, 20)),
      [],
    )
    // The same change, again and again, is going round in circles.
    const same = ['k', 'l', 'm', 'n'].flatMap((id) => edit(id, 'src/board.ts', 'x'))
    assert.deepStrictEqual(tags(same.flatMap((event) => watch.observe(event, 30))), ['Redirect'])
  })

  it('never takes a call with nothing to tell it by but its title for the same as another', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    const bare = ['a', 'b', 'c', 'd'].flatMap((id) => [
      agent({ _tag: 'ToolCall', toolCallId: id, title: 'Thinking', kind: 'think', status: 'pending' }),
      done(id, 'failed', null),
    ])
    assert.deepStrictEqual(
      bare.flatMap((event) => watch.observe(event, 10)),
      [],
    )
  })

  it('reads a call by its command, with its input sent late as some agents do', () => {
    const { watch } = watching()
    watch.observe(started('u1'), 0)
    const events = ['a', 'b', 'c'].flatMap((id) => [
      agent({ _tag: 'ToolCall', toolCallId: id, title: 'Terminal', kind: 'execute', status: 'pending' }),
      agent({ _tag: 'ToolCallUpdate', toolCallId: id, rawInput: { command: 'cargo build' } }),
      done(id, 'failed', { exitCode: 101 }),
    ])
    assert.deepStrictEqual(
      events.flatMap((event) => watch.observe(event, 10)),
      [{ _tag: 'Redirect', threadId: T, repeated: 'cargo build', times: 3 }],
    )
  })
})

describe('the budget of work since the person last spoke', () => {
  it('asks the person after too many turns, once, until they say something', () => {
    const { watch } = watching()
    const actions = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].flatMap((turn, index) => watch.observe(started(turn), index))
    assert.deepStrictEqual(actions, [{ _tag: 'GiveUp', threadId: T, why: 'over_budget', detail: '5 turns', tried: [] }])
    assert.deepStrictEqual(watch.observe(started('u8', true), 10), [])
    const one = makeStallWatch({ ...LIMITS, turns: 1 })
    one.observe(started('u1'), 0)
    assert.deepStrictEqual(one.observe(started('u2'), 1), [
      { _tag: 'GiveUp', threadId: T, why: 'over_budget', detail: 'a turn', tried: [] },
    ])
  })

  it('asks the person after too long at work, not counting waiting on them', () => {
    const { watch, looks } = watching({ ...LIMITS, work: 300 })
    watch.observe(started('u1'), 0)
    watch.observe(command('build', 'npm run build'), 0)
    watch.observe({ _tag: 'AttentionNeeded', threadId: T, attentionId: 'a1', title: 'Push', reason: 'Asks.' }, 0)
    assert.deepStrictEqual(
      looks(0, 3_000, (now) => now),
      [],
    )
    watch.observe({ _tag: 'AttentionClosed', threadId: T, attentionId: 'a1', outcome: 'answered' }, 3_000)
    assert.deepStrictEqual(
      looks(3_030, 3_330, (now) => now),
      [{ _tag: 'GiveUp', threadId: T, why: 'over_budget', detail: 'a minute', tried: [] }],
    )
    assert.deepStrictEqual(
      looks(3_360, 4_000, (now) => now),
      [],
    )
  })

  it('is whole again when a step starts', () => {
    const { watch } = watching()
    ;['u1', 'u2', 'u3', 'u4', 'u5'].forEach((turn, index) => watch.observe(started(turn), index))
    watch.fresh(T, 10)
    assert.deepStrictEqual(watch.observe(started('u6'), 11), [])
  })
})

describe('the words for a stall', () => {
  it('say how long', () => {
    assert.strictEqual(spanOf(6 * 60 * 60_000), '6 hours')
    assert.strictEqual(spanOf(90 * 60_000), '90 minutes')
    assert.strictEqual(spanOf(10 * 60_000), '10 minutes')
    assert.strictEqual(spanOf(40_000), 'a minute')
  })
})

describe('the CPU an agent uses', () => {
  it('reads ps', () => {
    assert.strictEqual(cpuTimeOf('0:01.50'), 1_500)
    assert.strictEqual(cpuTimeOf('1:02:03.45'), 3_723_450)
    assert.strictEqual(cpuTimeOf('2-01:00:00'), 176_400_000)
    assert.strictEqual(cpuTimeOf('00:00:07'), 7_000)
    assert.isNull(cpuTimeOf('soon'))
  })

  it('adds up a process and everything it started', () => {
    const listing = [
      '  1     0  9:00.00',
      ' 10     1  0:01.00',
      ' 11    10  0:02.00',
      ' 12    11  0:00.50',
      ' 13     1  0:09.00',
      'junk',
    ].join('\n')
    assert.strictEqual(treeCpuOf(listing, 10), 3_500)
    assert.strictEqual(treeCpuOf(listing, 12), 500)
    assert.isNull(treeCpuOf(listing, 99))
  })

  it.effect('reads every process asked for from the machine, in one listing', () =>
    Effect.gen(function* () {
      const used = yield* treeCpus([process.pid, 2 ** 22 + 12_345])
      assert.isNotNull(used.get(process.pid))
      assert.isNull(used.get(2 ** 22 + 12_345))
      assert.strictEqual((yield* treeCpus([])).size, 0)
    }),
  )
})
