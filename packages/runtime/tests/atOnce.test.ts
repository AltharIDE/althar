import { assert, describe, it } from '@effect/vitest'

import { atOnceFor, clamp, isAtOnce, MOST } from '../src/atOnce'

/*
 * How many tasks may be at work at once by default (atOnce.ts): the lower of
 * what the machine's cores and its memory allow, one at least and sixteen at
 * most, with a smaller machine never getting more.
 */

const GB = 1024 ** 3

describe('Agents at once by default', () => {
  it('gives an 8 GB Mac with 8 cores one at a time: memory is the tighter', () => {
    assert.deepStrictEqual(atOnceFor({ cores: 8, memory: 8 * GB }), { count: 1, cores: 8, memory: 8, byCores: 3, byMemory: 1 })
  })

  it('gives a 16 GB Mac with 10 cores four', () => {
    assert.deepStrictEqual(atOnceFor({ cores: 10, memory: 16 * GB }), { count: 4, cores: 10, memory: 16, byCores: 4, byMemory: 4 })
  })

  it('gives a 64 GB machine with 16 cores six: there, cores are the tighter', () => {
    assert.deepStrictEqual(atOnceFor({ cores: 16, memory: 64 * GB }), { count: 6, cores: 16, memory: 64, byCores: 6, byMemory: 20 })
  })

  it('gives fewer to a machine with fewer cores, or less memory, and never more', () => {
    const shapes = [
      { cores: 4, memory: 8 },
      { cores: 8, memory: 8 },
      { cores: 8, memory: 16 },
      { cores: 10, memory: 16 },
      { cores: 12, memory: 18 },
      { cores: 12, memory: 36 },
      { cores: 16, memory: 64 },
      { cores: 24, memory: 192 },
    ]
    for (const a of shapes)
      for (const b of shapes)
        if (a.cores <= b.cores && a.memory <= b.memory)
          assert.isAtMost(
            atOnceFor({ cores: a.cores, memory: a.memory * GB }).count,
            atOnceFor({ cores: b.cores, memory: b.memory * GB }).count,
            `${a.cores} cores and ${a.memory} GB against ${b.cores} cores and ${b.memory} GB`,
          )
    assert.isBelow(atOnceFor({ cores: 8, memory: 16 * GB }).count, atOnceFor({ cores: 12, memory: 36 * GB }).count)
    assert.isBelow(atOnceFor({ cores: 16, memory: 8 * GB }).count, atOnceFor({ cores: 16, memory: 64 * GB }).count)
  })

  it('reads memory in whole GB, as the machine is sold: a 16 GB Linux box is 16, less what its kernel keeps back', () => {
    const linux = atOnceFor({ cores: 8, memory: 16_318_252 * 1024 })
    assert.strictEqual(linux.memory, 16)
    assert.strictEqual(atOnceFor({ cores: 8, memory: 15.4 * GB }).memory, 15)
  })

  it('runs one at least, however small the machine, and sixteen at most, however large', () => {
    assert.strictEqual(atOnceFor({ cores: 2, memory: 4 * GB }).count, 1)
    assert.strictEqual(atOnceFor({ cores: 1, memory: 2 * GB }).count, 1)
    assert.strictEqual(atOnceFor({ cores: 0, memory: 0 }).count, 1)
    assert.strictEqual(atOnceFor({ cores: 128, memory: 1024 * GB }).count, MOST)
  })

  it('takes from the person a whole number from one to sixteen, and nothing else', () => {
    assert.isTrue(isAtOnce(1))
    assert.isTrue(isAtOnce(MOST))
    for (const wrong of [0, -1, 17, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.isFalse(isAtOnce(wrong), String(wrong))
    assert.strictEqual(clamp(0), 1)
    assert.strictEqual(clamp(40), MOST)
    assert.strictEqual(clamp(3.7), 3)
  })
})
