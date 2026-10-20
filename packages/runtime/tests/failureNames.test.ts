import { assert, describe, it } from '@effect/vitest'
import { Cause } from 'effect'

import { failureOf } from '../src/Failures'
import { listingOf } from '../src/machine'

/*
 * What a crash report says of an error that says little of itself, and what
 * a process listing leaves out: the edges of what the runtime reads and
 * tells, where the words it is given are missing or odd.
 */

describe('a failure that says little of itself', () => {
  it('is named an Error, says its name for a message, and has no stack where it kept none', () => {
    const bare = new Error('')
    bare.name = ''
    delete bare.stack
    assert.deepStrictEqual(failureOf(Cause.die(bare), 'Status'), {
      where: 'Status',
      agent: null,
      name: 'Error',
      message: 'Error',
      stack: '',
    })
    // A named one without a message says its name.
    const named = new RangeError('')
    assert.deepInclude(failureOf(Cause.die(named), 'Status', 'codex'), { agent: 'codex', name: 'RangeError', message: 'RangeError' })
  })
})

describe('a process listing', () => {
  it('leaves out a line whose process, parent or memory isn’t a number, or that stops short', () => {
    const listing = listingOf(
      [
        '  ab     1   0:00.01   4',
        '   5     x   0:00.01   4',
        '   6     1   0:00.01',
        '   7     1   0:00.01  lots',
        '   8     1   0:00.01  16',
      ].join('\n'),
    )
    assert.deepStrictEqual([...listing.keys()], [8])
    assert.deepStrictEqual(listing.get(8), { parent: 1, cpu: 10, memory: 16 * 1024 })
  })
})
