import { assert, describe, it } from '@effect/vitest'

import { changeLinesWords, changeWords, linesOf } from '../src/issueChangeWords'

/*
 * Changes to issues in words (issueChangeWords.ts): what an agent hears of
 * a card, and what a thread's transcript says of it, each field set or
 * taken off.
 */

const choice = (name: string) => ({ id: name.toLowerCase(), name })

describe('a change to an issue in words', () => {
  it('says every field it sets', () => {
    assert.strictEqual(
      changeWords([
        {
          key: 'DEV-67',
          change: {
            status: choice('Done'),
            close: true,
            priority: 'low',
            assignee: { add: [choice('Ada')], remove: [choice('Grace')] },
            labels: { add: [choice('bug')], remove: [choice('docs')] },
            project: choice('Uploads'),
            milestone: choice('Beta'),
            cycle: choice('Cycle 4'),
            parent: { id: 'i0', ref: 'DEV-1', key: 'DEV-1' },
            estimate: 3,
            type: choice('Bug'),
            components: [choice('api'), choice('web')],
            due: '2026-11-30',
            title: 'Retry uploads',
            description: 'Back off.',
          },
          comment: 'Done in #12',
          link: { url: 'https://github.com/acme/web/pull/12', title: '#12' },
        },
        { key: 'DEV-142', change: { priority: 'none' }, assignees: 'one' },
      ]),
      'DEV-67: status to Done, closed, priority to Low, assignees +Ada −Grace, labels +bug −docs, project to Uploads, milestone to Beta, cycle to Cycle 4, part of DEV-1, estimate to 3, type to Bug, components to api, web, due 2026-11-30, title to Retry uploads, its description rewritten, a comment, a link to https://github.com/acme/web/pull/12; DEV-142: priority to No priority',
    )
  })

  it('says what it takes off, and who one assignee is', () => {
    assert.strictEqual(
      changeWords([
        {
          key: 'DEV-9',
          change: { assignee: null, project: null, milestone: null, cycle: null, parent: null, estimate: null, due: null },
        },
      ]),
      'DEV-9: unassigned, out of its project, out of its milestone, out of its cycle, out of its parent, no estimate, no due date',
    )
    assert.deepStrictEqual(linesOf({ change: { assignee: { add: [choice('Ada')], remove: [] } }, assignees: 'one' }), [
      { field: 'assignee', to: 'Ada' },
    ])
    assert.deepStrictEqual(linesOf({ change: { assignee: { add: [], remove: [choice('Ada')] } }, assignees: 'one' }), [
      { field: 'assignee', to: null },
    ])
    assert.deepStrictEqual(linesOf({ change: {} }), [])
  })

  it('reads a card’s kept lines in words, and nothing of what isn’t lines', () => {
    assert.strictEqual(
      changeLinesWords([
        { field: 'assignee', to: 'Ada' },
        { field: 'link', to: null },
      ]),
      'assigned to Ada, a link to ',
    )
    assert.strictEqual(changeLinesWords('not lines'), '')
  })
})
