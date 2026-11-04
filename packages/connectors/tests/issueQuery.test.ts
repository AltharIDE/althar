import { assert, describe, it } from '@effect/vitest'

import {
  cantFind,
  filtersOf,
  type Issue,
  IssueFilter,
  type IssueQuery,
  issueMatches,
  pageAt,
  type TrackerCapabilities,
  unfindable,
} from '../src/model'

/* A search's filters as every tracker means them: which a query narrows by, what each matches, and paging what was found at once. */

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 'i-1',
  ref: 'MER-1',
  key: 'MER-1',
  title: 'Refunds skip the rate limit',
  body: 'Charges have one.',
  url: 'https://linear.app/meridian/issue/MER-1',
  status: { name: 'In Review', category: 'started' },
  priority: { level: 'high', name: 'High' },
  assignees: [{ id: 'u-1', login: 'ana', name: 'Ana Lima', bot: false }],
  labels: ['Bug', 'payments'],
  container: 'Meridian',
  updatedAt: '2026-10-02T09:00:00.000Z',
  project: { id: 'p-1', name: 'Q4 launch' },
  milestone: { id: 'm-1', name: 'Beta' },
  cycle: 'Cycle 12',
  parent: { key: 'MER-9', title: 'Payments' },
  ...overrides,
})

const matches = (query: Partial<IssueQuery>, on: Issue = issue(), account?: { readonly id: string }) =>
  issueMatches(on, { state: 'all', ...query }, account)

describe('filtersOf', () => {
  it('names the filters a query narrows by, in the model’s order', () => {
    assert.deepStrictEqual(filtersOf({ state: 'open', limit: 10 }), [])
    assert.deepStrictEqual(
      filtersOf({
        keys: ['MER-1'],
        updatedSince: '2026-10-01',
        parent: 'MER-9',
        priority: ['high'],
        assignee: 'ana',
        cycle: '12',
        milestone: 'Beta',
        project: 'Q4 launch',
        status: { names: ['Done'], categories: [] },
        labels: ['bug'],
        text: 'refunds',
        state: 'all',
        limit: 10,
      }),
      IssueFilter.literals,
    )
  })

  it('leaves out one that narrows nothing: blank words, no labels, keys or priorities, a status of neither names nor categories', () => {
    assert.deepStrictEqual(
      filtersOf({ text: '   ', labels: [], keys: [], priority: [], status: { names: [], categories: [] }, state: 'open', limit: 10 }),
      [],
    )
    assert.deepStrictEqual(filtersOf({ status: { names: [], categories: ['done'] }, state: 'open', limit: 10 }), ['status'])
    // No one is a filter: those assigned to no one.
    assert.deepStrictEqual(filtersOf({ assignee: null, state: 'open', limit: 10 }), ['assignee'])
  })
})

describe('issueMatches', () => {
  it('by state: open is neither done nor cancelled', () => {
    assert.isTrue(matches({ state: 'open' }))
    assert.isFalse(matches({ state: 'closed' }))
    assert.isTrue(matches({ state: 'closed' }, issue({ status: { name: 'Canceled', category: 'cancelled' } })))
    assert.isFalse(matches({ state: 'open' }, issue({ status: { name: 'Done', category: 'done' } })))
  })

  it('the account’s, where it knows who the account is', () => {
    assert.isTrue(matches({ mine: true }, issue(), { id: 'u-1' }))
    assert.isFalse(matches({ mine: true }, issue(), { id: 'u-2' }))
    // Without the account, its tracker's search kept to it already.
    assert.isTrue(matches({ mine: true }))
  })

  it('every word in its title or description, in any case', () => {
    assert.isTrue(matches({ text: 'REFUNDS  charges' }))
    assert.isFalse(matches({ text: 'refunds checkout' }))
    assert.isTrue(matches({ text: '' }))
  })

  it('every label, by name in any case', () => {
    assert.isTrue(matches({ labels: ['bug', ' PAYMENTS '] }))
    assert.isFalse(matches({ labels: ['bug', 'docs'] }))
  })

  it('a status by one of its names, or one of its categories', () => {
    assert.isTrue(matches({ status: { names: ['in review'], categories: [] } }))
    assert.isTrue(matches({ status: { names: ['Done'], categories: ['started'] } }))
    assert.isFalse(matches({ status: { names: ['Done'], categories: ['todo'] } }))
    assert.isTrue(matches({ status: { names: [], categories: [] } }))
  })

  it('a project, milestone, cycle or parent by name; neither one the issue hasn’t nor one it wasn’t read with', () => {
    assert.isTrue(matches({ project: 'q4 LAUNCH', milestone: 'beta', cycle: 'Cycle 12', parent: 'mer-9' }))
    assert.isFalse(matches({ project: 'Payments v2' }))
    assert.isFalse(matches({ milestone: 'GA' }))
    assert.isFalse(matches({ cycle: '13' }))
    assert.isFalse(matches({ parent: 'MER-8' }))
    // A cycle by its number, or the one under way, which can't be told here.
    assert.isTrue(matches({ cycle: '12' }))
    assert.isTrue(matches({ cycle: 'current' }))
    // A parent by a ref that ends in its key.
    assert.isTrue(matches({ parent: 'meridian/api#MER-9' }))
    const unread = issue()
    const { project: _project, milestone: _milestone, cycle: _cycle, parent: _parent, ...bare } = unread
    for (const asked of [{ project: 'x' }, { milestone: 'x' }, { cycle: 'x' }, { parent: 'x' }]) assert.isFalse(matches(asked, bare))
    assert.isTrue(matches({ cycle: 'current' }, bare))
    const none = issue({ project: null, milestone: null, cycle: null, parent: null })
    assert.isFalse(matches({ project: 'Q4 launch' }, none))
    assert.isFalse(matches({ milestone: 'Beta' }, none))
    assert.isFalse(matches({ cycle: '12' }, none))
    assert.isFalse(matches({ parent: 'MER-9' }, none))
  })

  it('an assignee by login, id or part of a name, an @ dropped; or no one', () => {
    assert.isTrue(matches({ assignee: '@Ana' }))
    assert.isTrue(matches({ assignee: 'u-1' }))
    assert.isTrue(matches({ assignee: 'lima' }))
    assert.isFalse(matches({ assignee: 'sam' }))
    assert.isFalse(matches({ assignee: null }))
    assert.isTrue(matches({ assignee: null }, issue({ assignees: [] })))
    assert.isFalse(matches({ assignee: 'ana' }, issue({ assignees: [] })))
  })

  it('a priority among those asked; none is those without one', () => {
    assert.isTrue(matches({ priority: ['urgent', 'high'] }))
    assert.isFalse(matches({ priority: ['none'] }))
    assert.isTrue(matches({ priority: ['none'] }, issue({ priority: null })))
    assert.isTrue(matches({ priority: [] }))
  })

  it('changed since a day or a moment; one that isn’t a moment narrows nothing', () => {
    assert.isTrue(matches({ updatedSince: '2026-10-02' }))
    assert.isTrue(matches({ updatedSince: '2026-10-02T09:00:00.000Z' }))
    assert.isFalse(matches({ updatedSince: '2026-10-02T09:00:01.000Z' }))
    assert.isTrue(matches({ updatedSince: 'last week' }))
  })

  it('by key or ref, in any case; `#12` an issue of a repository', () => {
    assert.isTrue(matches({ keys: ['DEV-2', 'mer-1'] }))
    assert.isFalse(matches({ keys: ['MER-2'] }))
    const repo = issue({ ref: 'acme/api#12', key: '#12' })
    assert.isTrue(matches({ keys: ['#12'] }, repo))
    assert.isTrue(matches({ keys: ['ACME/api#12'] }, repo))
    assert.isFalse(matches({ keys: ['#1'] }, repo))
    assert.isTrue(matches({ keys: [] }))
  })

  it('every filter given narrows further', () => {
    assert.isTrue(matches({ text: 'refunds', labels: ['bug'], priority: ['high'], assignee: 'ana', state: 'open' }))
    assert.isFalse(matches({ text: 'refunds', labels: ['bug'], priority: ['low'], assignee: 'ana', state: 'open' }))
  })
})

describe('pageAt', () => {
  const at = (n: number) =>
    issue({ id: `i-${n}`, ref: `MER-${n}`, key: `MER-${n}`, updatedAt: `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z` })
  const found = [at(3), at(1), at(5), at(2), at(4)]
  const refs = (page: { readonly issues: ReadonlyArray<Issue> }) => page.issues.map((one) => one.ref)

  it('newest change first, from the cursor’s offset to the limit, with the next page’s offset while there are more', () => {
    const first = pageAt(found, { limit: 2 })
    assert.deepStrictEqual([refs(first), first.next], [['MER-5', 'MER-4'], '2'])
    const second = pageAt(found, { limit: 2, cursor: '2' })
    assert.deepStrictEqual([refs(second), second.next], [['MER-3', 'MER-2'], '4'])
    const last = pageAt(found, { limit: 2, cursor: '4' })
    assert.deepStrictEqual([refs(last), last.next], [['MER-1'], null])
    assert.deepStrictEqual(pageAt(found, { limit: 5 }).next, null)
    assert.deepStrictEqual(pageAt(found, { limit: 2, cursor: '9' }), { issues: [], next: null })
    assert.deepStrictEqual(pageAt([], { limit: 2 }), { issues: [], next: null })
  })

  it('reads a cursor that isn’t an offset as the start, and a limit under one as one', () => {
    assert.deepStrictEqual(refs(pageAt(found, { limit: 1, cursor: 'abc' })), ['MER-5'])
    assert.deepStrictEqual(refs(pageAt(found, { limit: 1, cursor: '-3' })), ['MER-5'])
    assert.deepStrictEqual(refs(pageAt(found, { limit: 0 })), ['MER-5'])
    // Two of the same moment keep their order.
    const same = [at(1), { ...at(1), ref: 'MER-1b' }]
    assert.deepStrictEqual(refs(pageAt(same, { limit: 2 })), ['MER-1', 'MER-1b'])
  })
})

describe('unfindable', () => {
  const capabilities: TrackerCapabilities = {
    links: false,
    starts: false,
    changes: [],
    creates: [],
    assignees: 'many',
    finds: { text: 'search', labels: 'search', status: 'after' },
  }

  it('the filters a query narrows by that a tracker can’t, in the model’s order: none where it can each', () => {
    assert.deepStrictEqual(
      unfindable(capabilities, { text: 'x', labels: ['bug'], status: { names: ['Done'], categories: [] }, state: 'all', limit: 1 }),
      [],
    )
    assert.deepStrictEqual(
      unfindable(capabilities, { text: 'x', priority: ['high'], keys: ['MER-1'], project: 'Q4', assignee: null, state: 'all', limit: 1 }),
      ['project', 'assignee', 'priority', 'keys'],
    )
    // One given that narrows nothing isn't asked of it.
    assert.deepStrictEqual(unfindable(capabilities, { priority: [], keys: [], state: 'all', limit: 1 }), [])
  })

  it('a refusal of one, as rejected, in the words given', () => {
    const refused = cantFind('trello', 'A Trello card has no priority to find it by')
    assert.deepStrictEqual(
      [refused.product, refused.reason, refused.message],
      ['trello', 'rejected', 'A Trello card has no priority to find it by'],
    )
  })
})
