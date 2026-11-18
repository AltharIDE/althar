import { Delivery } from '@althar/ui'
import { expect, it } from 'vitest'

import { holdsItem, stopOf } from '../src/renderer/shared/virtual'

it('finds an undrawn message or report inside a task round, without matching unrelated text', () => {
  const block = { id: 'round', steps: [{ parts: [null, 'report', { result: { id: 'report' } }] }] }
  expect(holdsItem(block, 'round')).toBe(true)
  expect(holdsItem(block, 'report')).toBe(true)
  expect(holdsItem(block, 'missing')).toBe(false)
  expect(holdsItem({ text: 'report', count: 1 }, 'report')).toBe(false)
})

it('bounds searching a damaged or cyclic block and still finds normally nested work', () => {
  let block: unknown = { id: 'message' }
  for (let depth = 0; depth < 8; depth++) block = { result: block }
  expect(holdsItem(block, 'message')).toBe(true)
  expect(holdsItem({ result: block }, 'message')).toBe(false)
  const cycle: { result?: unknown } = {}
  cycle.result = cycle
  expect(holdsItem(cycle, 'absent')).toBe(false)
  for (const invalid of [undefined, null, 1, 'message', true]) expect(holdsItem(invalid, 'message')).toBe(false)
})

it('only offers delivered messages as navigator stops, including the final message with no answer yet', () => {
  const blocks = [{ kind: 'you', text: 'Waiting', delivery: Delivery.Queued }, { kind: 'turn' }, { kind: 'you', text: '  Ship\n this  ' }]
  expect(stopOf(blocks, 0)).toBeNull()
  expect(stopOf(blocks, 1)).toBeNull()
  expect(stopOf(blocks, 99)).toBeNull()
  expect(stopOf(blocks, 2)).toEqual({ prompt: 'Ship this', reply: '' })
  expect(stopOf([{ kind: 'you' }], 0)).toEqual({ prompt: '', reply: '' })
})

it('previews the answer’s words, leaving tool calls and missing text out of the navigator', () => {
  const blocks = [
    { kind: 'you', text: 'Review the work' },
    {
      kind: 'turn',
      said: [
        { kind: 'tool_call', text: 'private tool details' },
        { kind: 'message', text: '  Reviewed\n the' },
        { kind: 'message' },
        { kind: 'message', text: 'work. ' },
      ],
    },
  ]
  expect(stopOf(blocks, 0)).toEqual({ prompt: 'Review the work', reply: 'Reviewed the work.' })
  expect(stopOf([{ kind: 'you' }, { kind: 'turn' }], 0)?.reply).toBe('')
})

it.each([
  [{ kind: 'round', result: { text: 'Done' }, ack: { text: 'Starting' }, writing: { text: 'Working' } }, 'Done'],
  [{ kind: 'round', result: null, ack: { text: 'Starting' }, writing: { text: 'Working' } }, 'Starting'],
  [{ kind: 'round', ack: null, writing: { text: ' Working\nnow ' } }, 'Working now'],
  [{ kind: 'round' }, ''],
  [{ kind: 'notice', text: 'A notice is not an answer' }, ''],
])('previews the latest available round answer (%s)', (answer, words) => {
  expect(stopOf([{ kind: 'you', text: 'Build it' }, answer], 0)?.reply).toBe(words)
})

it('bounds both previews so a large remote transcript does not fill the navigation panel', () => {
  const long = 'x'.repeat(1000)
  const blocks = [
    { kind: 'you', text: long },
    { kind: 'round', result: { text: long } },
  ]
  expect(stopOf(blocks, 0)).toEqual({
    prompt: 'x'.repeat(280),
    reply: 'x'.repeat(280),
  })
})
