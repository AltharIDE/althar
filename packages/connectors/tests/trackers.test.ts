import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { AdapterOptions } from '../src/credential'
import { makeGitHub } from '../src/github'
import { makeGitLab } from '../src/gitlab'
import { makeJiraCloud, makeJiraDataCenter } from '../src/jira'
import { makeLinear } from '../src/linear'
import { IssueField, IssueFilter, type Product, type TrackerCapabilities } from '../src/model'
import { changeTable, findTable, trackerCapabilities, TRACKERS } from '../src/trackers'
import { makeTrello } from '../src/trello'

/* What each tracker finds and changes, read without a connection, is what its adapter says of itself. */

/** Options no call is made with. */
const options: AdapterOptions = {
  fetch: () => Promise.reject(new Error('No call is made')),
  apiUrl: 'https://api.example.com',
  webUrl: 'https://example.com',
  credential: Effect.succeed({ kind: 'bearer', token: 't' }),
}

const adapters: ReadonlyArray<readonly [Product, { readonly capabilities: TrackerCapabilities }]> = [
  ['linear', makeLinear(options)],
  ['jira_cloud', makeJiraCloud(options)],
  ['jira_dc', makeJiraDataCenter(options)],
  ['trello', makeTrello(options)],
  ['github', makeGitHub(options)],
  ['gitlab', makeGitLab(options)],
]

/** A Markdown table's rows, each as its cells. */
const cellsOf = (table: string) =>
  table.split('\n').map((line) =>
    line
      .replace(/^\| | \|$/g, '')
      .split(' | ')
      .map((cell) => cell.trim()),
  )

describe('trackerCapabilities', () => {
  it('is, for each tracker, what its adapter says of itself', () => {
    for (const [product, adapter] of adapters) {
      const table = trackerCapabilities(product)
      assert.isDefined(table, product)
      // A code host's capabilities are its host's and its tracker's together: each of its tracker's is the table's own.
      for (const key of Object.keys(table ?? {}) as ReadonlyArray<keyof TrackerCapabilities>)
        assert.strictEqual(adapter.capabilities[key], table?.[key], `${product} ${key}`)
    }
    for (const product of ['linear', 'jira_cloud', 'jira_dc', 'trello'] as const)
      assert.strictEqual(adapters.find(([one]) => one === product)?.[1].capabilities, trackerCapabilities(product))
  })

  it('is Jira’s for both its editions, and none for a code host without issues', () => {
    assert.strictEqual(trackerCapabilities('jira_dc'), trackerCapabilities('jira_cloud'))
    assert.isUndefined(trackerCapabilities('bitbucket_cloud'))
    assert.isUndefined(trackerCapabilities('bitbucket_dc'))
  })
})

describe('findTable', () => {
  const rows = cellsOf(findTable())

  it('has a column per tracker and a row per filter', () => {
    assert.deepStrictEqual(rows[0], ['Find by', 'Linear', 'Jira', 'Trello', 'GitHub', 'GitLab'])
    assert.deepStrictEqual(rows[1], ['---', '---', '---', '---', '---', '---'])
    assert.lengthOf(rows, 2 + IssueFilter.literals.length)
    for (const row of rows) assert.lengthOf(row, 1 + TRACKERS.length)
  })

  it('says how each narrows by each: yes by its search, Althar after it, or no', () => {
    IssueFilter.literals.forEach((filter, index) => {
      const row = rows[2 + index] ?? []
      TRACKERS.forEach((tracker, column) => {
        const by = tracker.capabilities.finds[filter]
        assert.strictEqual(row[1 + column], by === 'search' ? 'yes' : by === 'after' ? 'Althar' : 'no', `${tracker.name} ${filter}`)
      })
    })
    const trello = (name: string) => rows.find((row) => row[0] === name)?.[3]
    assert.deepStrictEqual([trello('words (text)'), trello('status, by name or category'), trello('priority')], ['yes', 'Althar', 'no'])
  })
})

describe('changeTable', () => {
  const rows = cellsOf(changeTable())

  it('has a column per tracker, a row per field, and one for linking a pull request', () => {
    assert.deepStrictEqual(rows[0], ['Change', 'Linear', 'Jira', 'Trello', 'GitHub', 'GitLab'])
    assert.lengthOf(rows, 2 + IssueField.literals.length + 1)
    for (const row of rows) assert.lengthOf(row, 1 + TRACKERS.length)
    assert.strictEqual(rows.at(-1)?.[0], 'link a pull request')
  })

  it('says whether each changes each, and of assignees, one or several', () => {
    IssueField.literals.forEach((field, index) => {
      const row = rows[2 + index] ?? []
      TRACKERS.forEach((tracker, column) => {
        const { changes, assignees } = tracker.capabilities
        const expected = !changes.includes(field) ? 'no' : field === 'assignee' ? (assignees === 'one' ? 'one' : 'several') : 'yes'
        assert.strictEqual(row[1 + column], expected, `${tracker.name} ${field}`)
      })
    })
    const assignees = rows.find((row) => row[0] === 'assignees')
    assert.deepStrictEqual(assignees?.slice(1), ['one', 'one', 'several', 'several', 'several'])
    assert.deepStrictEqual(
      rows.at(-1)?.slice(1),
      TRACKERS.map((tracker) => (tracker.capabilities.links ? 'yes' : 'by its name')),
    )
  })
})
