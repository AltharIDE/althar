import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { IssueQuery } from '../src/model'
import { makeFakeService } from '../src/testing'
import { trackerCapabilities } from '../src/trackers'

/* The fake finds issues by every filter as the model means it, a page at a time, and only by those its product's adapter does. */

const sam = { id: 'user-sam', login: 'sam', name: 'Sam Rivera', bot: false }

/** A Linear fake, which finds by every filter, with three issues, oldest first: MER-1, MER-2, MER-3. */
const meridian = () => {
  const fake = makeFakeService({ product: 'linear' })
  fake.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
  fake.addContainer({ id: 'team-2', key: 'PAY', name: 'Payments' })
  fake.addIssue({
    ref: 'MER-1',
    title: 'Refunds skip the rate limit',
    body: 'Charges have one.',
    status: { name: 'In Review', category: 'started' },
    with: {
      labels: ['bug', 'payments'],
      priority: { level: 'urgent', name: 'Urgent' },
      project: { id: 'p-1', name: 'Q4 launch' },
      milestone: { id: 'm-1', name: 'Beta' },
      cycle: 'Cycle 12',
      parent: { key: 'MER-9', title: 'Payments' },
    },
  })
  const second = fake.addIssue({
    ref: 'MER-2',
    title: 'Checkout gives up',
    with: { labels: ['docs'], priority: null, project: null, milestone: null, cycle: null, parent: null, assignees: [sam] },
  })
  fake.addIssue({
    ref: 'MER-3',
    title: 'Old refunds',
    status: { name: 'Done', category: 'done' },
    assigned: false,
    with: {
      labels: ['bug'],
      priority: { level: 'low', name: 'Low' },
      project: { id: 'p-2', name: 'Payments v2' },
      milestone: null,
      cycle: 'Cycle 13',
      parent: null,
    },
  })
  const refs = (query: Partial<IssueQuery>) =>
    Effect.map(fake.find({ state: 'all', limit: 50, ...query }), (page) => page.issues.map((issue) => issue.ref))
  return { fake, refs, second }
}

describe('The fake, finding issues', () => {
  it.effect('by every filter, as the model means each, newest first', () =>
    Effect.gen(function* () {
      const { refs, second } = meridian()
      assert.deepStrictEqual(yield* refs({}), ['MER-3', 'MER-2', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ state: 'open' }), ['MER-2', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ state: 'closed' }), ['MER-3'])
      assert.deepStrictEqual(yield* refs({ container: 'team-1' }), ['MER-3', 'MER-2', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ container: 'team-2' }), [])
      assert.deepStrictEqual(yield* refs({ mine: true }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ text: 'REFUNDS rate' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ text: 'refunds' }), ['MER-3', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ labels: ['BUG'] }), ['MER-3', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ labels: ['bug', 'payments'] }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ status: { names: ['in review'], categories: [] } }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ status: { names: [], categories: ['done'] } }), ['MER-3'])
      assert.deepStrictEqual(yield* refs({ status: { names: ['Todo'], categories: ['done'] } }), ['MER-3', 'MER-2'])
      assert.deepStrictEqual(yield* refs({ project: 'q4 launch' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ milestone: 'Beta' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ cycle: '13' }), ['MER-3'])
      assert.deepStrictEqual(yield* refs({ cycle: 'cycle 12' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ assignee: 'you' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ assignee: '@Sam' }), ['MER-2'])
      assert.deepStrictEqual(yield* refs({ assignee: 'rivera' }), ['MER-2'])
      assert.deepStrictEqual(yield* refs({ assignee: null }), ['MER-3'])
      assert.deepStrictEqual(yield* refs({ priority: ['urgent'] }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ priority: ['none'] }), ['MER-2'])
      assert.deepStrictEqual(yield* refs({ priority: ['low', 'urgent'] }), ['MER-3', 'MER-1'])
      assert.deepStrictEqual(yield* refs({ parent: 'mer-9' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ updatedSince: second.updatedAt }), ['MER-3', 'MER-2'])
      assert.deepStrictEqual(yield* refs({ keys: ['mer-1', 'MER-3', 'MER-7'] }), ['MER-3', 'MER-1'])
      // Every filter given narrows further.
      assert.deepStrictEqual(yield* refs({ text: 'refunds', labels: ['bug'], state: 'open' }), ['MER-1'])
      assert.deepStrictEqual(yield* refs({ labels: ['bug'], priority: ['none'] }), [])
    }),
  )

  it.effect('the account’s own: those it is on, whatever the issue was added with', () =>
    Effect.gen(function* () {
      const { fake } = meridian()
      assert.deepStrictEqual(
        (yield* fake.mine()).map((issue) => issue.ref),
        ['MER-1'],
      )
    }),
  )

  it.effect('pages through two hundred, fifty at a time: each once, newest first, and no next after the last', () =>
    Effect.gen(function* () {
      const fake = makeFakeService({ product: 'linear' })
      for (let number = 1; number <= 200; number += 1) fake.addIssue({ ref: `MER-${number}`, title: `Issue ${number}` })
      const pages: Array<ReadonlyArray<string>> = []
      const nexts: Array<string | null> = []
      let cursor: string | undefined
      do {
        const page = yield* fake.find({ state: 'open', limit: 50, ...(cursor === undefined ? {} : { cursor }) })
        pages.push(page.issues.map((issue) => issue.ref))
        nexts.push(page.next)
        cursor = page.next ?? undefined
      } while (cursor !== undefined && pages.length < 10)
      assert.deepStrictEqual(
        pages.map((page) => page.length),
        [50, 50, 50, 50],
      )
      assert.deepStrictEqual(nexts, ['50', '100', '150', null])
      const all = pages.flat()
      assert.strictEqual(new Set(all).size, 200)
      assert.deepStrictEqual([all[0], all[49], all[50], all[199]], ['MER-200', 'MER-151', 'MER-150', 'MER-1'])
    }),
  )

  it.effect('refuses a filter its product can’t narrow by, as its adapter is never asked it', () =>
    Effect.gen(function* () {
      const trello = makeFakeService({ product: 'trello' })
      trello.addIssue({ ref: 'list-1#1', title: 'A card', with: { labels: ['Mobile'], priority: null } })
      assert.strictEqual(trello.capabilities.finds, trackerCapabilities('trello')?.finds)
      const refused = yield* Effect.flip(trello.find({ priority: ['high'], state: 'all', limit: 10 }))
      assert.deepStrictEqual([refused.product, refused.reason], ['trello', 'rejected'])
      assert.match(refused.message, /priority/)
      // What Trello finds by, the fake does.
      assert.lengthOf((yield* trello.find({ labels: ['mobile'], state: 'all', limit: 10 })).issues, 1)

      // A test can say what it finds by.
      const narrow = makeFakeService({ product: 'linear', finds: { text: 'search' } })
      assert.strictEqual((yield* Effect.flip(narrow.find({ labels: ['bug'], state: 'all', limit: 10 }))).reason, 'rejected')
      assert.deepStrictEqual((yield* narrow.find({ text: 'x', state: 'all', limit: 10 })).issues, [])
    }),
  )
})
