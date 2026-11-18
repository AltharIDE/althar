import { Delivery } from '@althar/ui'
import { expect, it } from 'vitest'

import { holdsItem, stopOf } from '../src/renderer/shared/virtual'

it('finds undrawn messages and reports inside rounds, steps and settling reviews by identity', () => {
  const block = { id: 'round', work: [{ steps: [{ parts: [null, 'text', { id: 'report' }] }] }], settling: { id: 'review' } }
  for (const id of ['round', 'report', 'review']) expect(holdsItem(block, id)).toBe(true)
  expect(holdsItem(block, 'absent')).toBe(false)
  expect(holdsItem({ text: 'report', missing: undefined }, 'report')).toBe(false)
  for (const value of [null, undefined, 'report', 1, false]) expect(holdsItem(value, 'report')).toBe(false)
})

it('bounds traversal of deeply nested or cyclic metadata without losing items at the supported depth', () => {
  const nest = (count: number): unknown => (count === 0 ? { id: 'deep' } : { child: nest(count - 1) })
  expect(holdsItem(nest(8), 'deep')).toBe(true)
  expect(holdsItem(nest(9), 'deep')).toBe(false)
  const cycle: { child?: unknown } = {}
  cycle.child = cycle
  expect(holdsItem(cycle, 'absent')).toBe(false)
})

// The navigator accepts the full thread blocks; only their kind is required by its public signature.
const stop = (blocks: ReadonlyArray<{ kind: string; [key: string]: unknown }>, index = 0) => stopOf(blocks, index)
it('makes navigator stops only for delivered person messages', () => {
  expect(stop([])).toBeNull()
  expect(stop([{ kind: 'turn' }])).toBeNull()
  expect(stop([{ kind: 'you', delivery: Delivery.Queued, text: 'Later' }])).toBeNull()
  expect(stop([{ kind: 'you' }])).toEqual({ prompt: '', reply: '' })
  expect(stop([{ kind: 'you', text: '  Find\n the\tchange  ' }])).toEqual({ prompt: 'Find the change', reply: '' })
})

it('previews only answer messages in a turn, normalizes whitespace and caps both previews', () => {
  expect(
    stop([
      { kind: 'you', text: 'x'.repeat(300) },
      {
        kind: 'turn',
        said: [
          { kind: 'tool', text: 'private' },
          { kind: 'message' },
          { kind: 'message', text: ' First\n answer ' },
          { kind: 'message', text: 'second '.repeat(100) },
        ],
      },
    ]),
  ).toEqual({ prompt: 'x'.repeat(280), reply: ('First answer ' + 'second '.repeat(100)).trim().slice(0, 280) })
  expect(stop([{ kind: 'you' }, { kind: 'turn' }])).toEqual({ prompt: '', reply: '' })
})

it('prefers a round’s final result, then acknowledgement, then live writing', () => {
  const you = { kind: 'you', text: 'Run it' }
  for (const [round, reply] of [
    [{ kind: 'round', result: { text: ' Done ' }, ack: { text: 'Starting' }, writing: { text: 'Working' } }, 'Done'],
    [{ kind: 'round', ack: { text: ' Starting ' }, writing: { text: 'Working' } }, 'Starting'],
    [{ kind: 'round', writing: { text: ' Working ' } }, 'Working'],
    [{ kind: 'round' }, ''],
    [{ kind: 'system', text: 'No answer' }, ''],
  ] as const)
    expect(stop([you, round])).toEqual({ prompt: 'Run it', reply })
})
