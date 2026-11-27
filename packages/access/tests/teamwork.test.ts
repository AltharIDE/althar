import { describe, expect, it } from 'vitest'

import { decideWake, defaultWakeLimits, type Delivered, mayOnRequest, type Message, overlaps } from '../src'

describe('overlaps', () => {
  const mine = { task: 'vat', owner: 'ana', touches: [{ repository: 'api', paths: ['src/cart/schema.sql', 'src/vat/'] }] }

  it('finds a shared file, a folder one names, a nearby folder, and only the repository when paths aren’t known', () => {
    const others = [
      { task: 'carts', owner: 'ben', touches: [{ repository: 'api', paths: ['./src/cart/schema.sql'] }] },
      { task: 'rates', owner: 'pam', touches: [{ repository: 'api', paths: ['src/vat/rates.ts'] }] },
      { task: 'cart-ui', owner: 'sofia', touches: [{ repository: 'api', paths: ['src/cart/view.ts'] }] },
      { task: 'docs', owner: 'gus', touches: [{ repository: 'api', paths: ['README.md'] }] },
      { task: 'web', owner: 'ana', touches: [{ repository: 'web', paths: ['src/cart/schema.sql'] }] },
      { task: 'unknown', owner: 'ben', touches: [{ repository: 'api', paths: [] }] },
      { task: 'vat', owner: 'ana', touches: [{ repository: 'api', paths: ['src/vat/'] }] },
    ]
    expect(overlaps(mine, others)).toEqual([
      { task: 'carts', owner: 'ben', repository: 'api', strength: 'same_files', paths: ['src/cart/schema.sql'] },
      { task: 'rates', owner: 'pam', repository: 'api', strength: 'same_files', paths: ['src/vat/', 'src/vat/rates.ts'] },
      { task: 'cart-ui', owner: 'sofia', repository: 'api', strength: 'same_folder', paths: ['src/cart/'] },
      { task: 'unknown', owner: 'ben', repository: 'api', strength: 'same_repository', paths: [] },
    ])
  })

  it('keeps the strongest overlap per task and repository, and reads folder depth from the caller', () => {
    const other = {
      task: 'both',
      owner: 'ben',
      touches: [
        { repository: 'api', paths: ['src/other/file.ts'] },
        { repository: 'api', paths: ['src/cart/schema.sql'] },
      ],
    }
    expect(overlaps(mine, [other]).map((overlap) => overlap.strength)).toEqual(['same_files'])
    const shallow = { task: 's', owner: 'ben', touches: [{ repository: 'api', paths: ['src/other/file.ts'] }] }
    expect(overlaps(mine, [shallow], { folderDepth: 1 })).toEqual([
      { task: 's', owner: 'ben', repository: 'api', strength: 'same_folder', paths: ['src/'] },
    ])
  })
})

describe('wakes', () => {
  const at = Date.parse('2025-11-26T12:00:00.000Z')
  const message = (over: Partial<Message> = {}): Message => ({
    from: { person: 'ana', agent: 'ana-coordinator' },
    to: { person: 'ben', agent: 'ben-coordinator' },
    text: 'When does Saved carts land?',
    hops: 0,
    at,
    ...over,
  })
  const open = { muted: new Set<string>(), capReached: false }
  const sent = (n: number, minutesAgo: number, fromAgent = 'ana-coordinator'): ReadonlyArray<Delivered> =>
    Array.from({ length: n }, (_, i) => ({ fromAgent, toPerson: 'ben', text: `message ${i}`, at: at - minutesAgo * 60_000 }))

  it('wakes within the limits, and always between one person’s own agents', () => {
    expect(decideWake(message(), [], open)).toEqual({ deliver: 'wake' })
    expect(decideWake(message({ to: { person: 'ana', agent: 'ana-lead' } }), sent(50, 1), open)).toEqual({ deliver: 'wake' })
  })

  it('waits past the hourly and daily limits, a mute or a cap, rather than losing the message', () => {
    expect(decideWake(message(), sent(6, 30), open)).toEqual({ deliver: 'wait', reason: 'pair_limit' })
    expect(decideWake(message(), sent(6, 61), open)).toEqual({ deliver: 'wake' })
    expect(decideWake(message(), sent(30, 120, 'pam-lead'), open)).toEqual({ deliver: 'wait', reason: 'daily_limit' })
    expect(decideWake(message(), sent(30, 25 * 60, 'pam-lead'), open)).toEqual({ deliver: 'wake' })
    expect(decideWake(message(), [], { muted: new Set(['ana']), capReached: false })).toEqual({ deliver: 'wait', reason: 'muted' })
    expect(decideWake(message(), [], { ...open, capReached: true })).toEqual({ deliver: 'wait', reason: 'cap_reached' })
  })

  it('refuses a repeat, an empty or over-long message, and a chain past its hops', () => {
    const repeat = [{ fromAgent: 'ana-coordinator', toPerson: 'ben', text: '  when does saved carts   land? ', at: at - 60_000 }]
    expect(decideWake(message(), repeat, open)).toEqual({ deliver: 'refuse', reason: 'duplicate' })
    expect(decideWake(message({ at: at + defaultWakeLimits.duplicateWindowMs }), repeat, open)).toEqual({ deliver: 'wake' })
    expect(decideWake(message({ text: ' ' }), [], open)).toEqual({ deliver: 'refuse', reason: 'empty' })
    expect(decideWake(message({ text: 'x'.repeat(2_001) }), [], open)).toEqual({ deliver: 'refuse', reason: 'too_long' })
    expect(decideWake(message({ hops: 3 }), [], open)).toEqual({ deliver: 'refuse', reason: 'too_many_hops' })
  })

  it('lets a woken agent answer, share and agree on order, but never change its person’s work', () => {
    const agrees = { agentsAgreeOrder: true }
    expect(['answer', 'share', 'agree_order', 'change_work'].map((action) => mayOnRequest(action as never, agrees))).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(mayOnRequest('agree_order', { agentsAgreeOrder: false })).toBe(false)
  })
})
