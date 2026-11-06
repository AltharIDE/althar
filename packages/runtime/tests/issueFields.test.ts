import {
  type Choice,
  type ChosenField,
  ConnectorFailed,
  type Issue,
  type IssueField,
  IssueField as IssueFields,
  Product,
  type Tracker,
} from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { anything, choiceNamed, gapOf, listed, priorityOf, readFields, type Wanted, wantedFields } from '../src/issueFields'

/*
 * An issue's fields as agents name them, read against its tracker
 * (issueFields.ts): each field on its own, so a name the tracker hasn't, or
 * a field it can't set, leaves that field off and says why; what is so
 * already is said and left off; the rest goes ahead.
 */

const ALL: ReadonlyArray<IssueField> = IssueFields.literals

const failed = (message: string) => new ConnectorFailed({ product: 'linear', reason: 'unreachable', message })

/** The issue as its tracker has it now. */
const ISSUE: Issue = {
  id: 'i1',
  ref: 'MER-1',
  key: 'MER-1',
  title: 'Retry the upload',
  body: 'It fails on a slow network.\n',
  url: 'https://linear.app/meridian/issue/MER-1',
  status: { name: 'Todo', category: 'todo' },
  priority: { level: 'high', name: 'High' },
  assignees: [{ id: 'u2', login: 'grace', name: 'Grace', bot: false }],
  labels: ['bug'],
  container: 'Meridian',
  updatedAt: '2026-11-01T10:00:00Z',
  project: { id: 'p1', name: 'Uploads' },
  milestone: null,
  cycle: 'Cycle 4',
  parent: { key: 'MER-0', title: 'Reliability' },
  type: 'Bug',
  due: '2026-11-30',
  estimate: 3,
  components: ['api', 'web'],
}

const ADA: Choice = { id: 'u1', name: 'Ada', also: ['ada', 'ada@meridian.test'] }
const GRACE: Choice = { id: 'u2', name: 'Grace', also: ['grace'] }
const BUG: Choice = { id: 'l1', name: 'bug' }
const UI: Choice = { id: 'l2', name: 'ui' }

const CHOICES: Readonly<Record<ChosenField, ReadonlyArray<Choice>>> = {
  status: [
    { id: 's1', name: 'Todo' },
    { id: 's2', name: 'In Progress' },
    { id: 's3', name: 'In Review' },
  ],
  labels: [BUG, UI],
  assignee: [ADA, GRACE],
  project: [
    { id: 'p1', name: 'Uploads' },
    { id: 'p2', name: 'Search' },
  ],
  milestone: [
    { id: 'm1', name: 'Beta', in: 'p1' },
    { id: 'm2', name: 'Launch', in: 'p2' },
  ],
  cycle: [{ id: 'c4', name: 'Cycle 4', also: ['current'] }],
  type: [
    { id: 't1', name: 'Bug' },
    { id: 't2', name: 'Task' },
  ],
  components: [
    { id: 'k1', name: 'api' },
    { id: 'k2', name: 'web' },
    { id: 'k3', name: 'docs' },
  ],
}

/** Issues the tracker can read, by ref. */
const ISSUES: Readonly<Record<string, Issue>> = {
  'MER-0': { ...ISSUE, id: 'i0', ref: 'MER-0', key: 'MER-0' },
  'MER-7': { ...ISSUE, id: 'i7', ref: 'MER-7', key: 'MER-7' },
  'MER-1': ISSUE,
  'acme/web#12': { ...ISSUE, id: 'g12', ref: 'acme/web#12', key: '#12' },
}

const trackerOf = (
  options: {
    readonly changes?: ReadonlyArray<IssueField>
    readonly assignees?: 'one' | 'many'
    readonly login?: string
  } = {},
): Tracker =>
  ({
    product: 'linear',
    capabilities: { links: true, starts: true, changes: options.changes ?? ALL, creates: [], assignees: options.assignees ?? 'one' },
    account: Effect.succeed({ id: options.login === undefined ? 'u1' : 'u9', login: options.login ?? 'ada', name: 'Ada' }),
    issue: (ref: string) => {
      const found = ISSUES[ref]
      return found === undefined ? Effect.fail(failed(`no issue ${ref}`)) : Effect.succeed(found)
    },
  }) as unknown as Tracker

/** Choices as the tracker lists them; a label it makes as it is asked for one, as GitHub's. */
const choices = (field: ChosenField, wanted?: string) =>
  field === 'labels' && wanted !== undefined && wanted.startsWith('new-')
    ? Effect.succeed([{ id: wanted, name: wanted }])
    : Effect.succeed(CHOICES[field])

const read = (wanted: Wanted, options: Parameters<typeof trackerOf>[0] & { readonly issue?: Issue | null } = {}) =>
  readFields(
    {
      tracker: trackerOf(options),
      product: 'linear',
      name: 'Linear',
      ...(options.issue === null ? {} : { issue: options.issue ?? ISSUE }),
      repository: 'acme/web',
      choices,
    },
    wanted,
  )

describe("a tracker's gaps", () => {
  it('says each field a product has not in its own words', () => {
    for (const product of Product.literals) for (const field of ALL) assert.isNotEmpty(gapOf(product, field))
    assert.strictEqual(gapOf('github', 'priority'), "GitHub's issues have no priority")
    assert.strictEqual(gapOf('trello', 'project'), 'a Trello card’s project is its board')
    assert.strictEqual(gapOf('jira_dc', 'project'), 'Jira moves an issue to another project only by its own Move')
    assert.include(gapOf('gitlab', 'project'), 'GitLab’s own Move')
    assert.include(gapOf('bitbucket_cloud', 'project'), 'has no project for an issue')
    assert.strictEqual(gapOf('trello', 'milestone'), 'a Trello card has no milestone')
    assert.include(gapOf('jira_cloud', 'cycle'), 'sprints')
    assert.include(gapOf('gitlab', 'cycle'), 'iterations')
    assert.strictEqual(gapOf('github', 'cycle'), 'only Linear has cycles')
    assert.include(gapOf('gitlab', 'parent'), 'epics')
    assert.strictEqual(gapOf('trello', 'parent'), 'a Trello card has no parent')
    assert.include(gapOf('jira_cloud', 'estimate'), 'story points')
    assert.strictEqual(gapOf('trello', 'estimate'), 'a Trello card has no estimate')
    assert.include(gapOf('linear', 'type'), 'a label says what kind it is')
    assert.strictEqual(gapOf('trello', 'type'), 'a Trello card has no type')
    assert.strictEqual(gapOf('jira_cloud', 'components'), 'only Jira has components')
    assert.strictEqual(gapOf('github', 'due'), 'GitHub’s issues have no due date')
    assert.include(gapOf('linear', 'title'), 'can’t change that on Linear yet')
  })
})

describe('names read against choices', () => {
  it('lists names, none, or the first few dozen and how many more', () => {
    assert.strictEqual(listed([]), 'none')
    assert.strictEqual(listed(['a', 'b']), 'a, b')
    const many = Array.from({ length: 30 }, (_, index) => `n${index}`)
    assert.match(listed(many), /^n0, .*, n24 and 5 more$/)
  })

  it('finds a choice by its id, name or another word, in any case, or the one name it begins', () => {
    const people = CHOICES.assignee
    assert.strictEqual(choiceNamed(people, 'u2')?.name, 'Grace')
    assert.strictEqual(choiceNamed(people, ' ada ')?.name, 'Ada')
    assert.strictEqual(choiceNamed(people, 'ADA@meridian.test')?.name, 'Ada')
    assert.strictEqual(choiceNamed(people, 'gra')?.name, 'Grace')
    assert.isUndefined(choiceNamed(CHOICES.status, 'In'))
    assert.isUndefined(choiceNamed(people, 'Linus'))
  })

  it('reads a priority as an agent says it, and refuses one that is not', () =>
    Effect.gen(function* () {
      assert.strictEqual(priorityOf('Low'), 'low')
      assert.strictEqual(priorityOf('high priority'), 'high')
      assert.strictEqual(priorityOf('No priority'), 'none')
      assert.strictEqual(priorityOf('no'), 'none')
      assert.isUndefined(priorityOf('soon'))
      assert.deepStrictEqual(yield* wantedFields({}), {})
      assert.deepStrictEqual(
        yield* wantedFields({
          status: 'Done',
          priority: 'Urgent',
          assignee: null,
          project: 'Uploads',
          milestone: null,
          cycle: 'current',
          parent: 'MER-0',
          estimate: 2,
          type: 'Bug',
          components: ['api'],
          due: '2026-12-01',
        }),
        {
          status: 'Done',
          priority: 'urgent',
          assignee: null,
          project: 'Uploads',
          milestone: null,
          cycle: 'current',
          parent: 'MER-0',
          estimate: 2,
          type: 'Bug',
          components: ['api'],
          due: '2026-12-01',
        },
      )
      const refused = yield* Effect.flip(wantedFields({ priority: 'soon' }))
      assert.include(refused.message, 'not “soon”')
    }).pipe(Effect.runSync))
})

describe("an issue's fields read against its tracker", () => {
  it.effect('leaves off a field the tracker cannot set, saying why in its words, and reads the rest', () =>
    Effect.gen(function* () {
      const result = yield* read({ priority: 'low', components: ['api'] }, { changes: ['priority'] })
      assert.deepStrictEqual(result.change, { priority: 'low' })
      assert.deepStrictEqual(result.left, ['Althar can’t set its components on Linear: only Jira has components'])
      assert.isTrue(anything(result.change))
      assert.isFalse(anything((yield* read({}, {})).change))
    }),
  )

  it.effect('says what is so already and leaves it off', () =>
    Effect.gen(function* () {
      const result = yield* read({
        status: 'todo',
        priority: 'high',
        assignee: 'Grace',
        labels: { add: ['bug'], remove: ['ui'] },
        project: 'Uploads',
        milestone: null,
        cycle: 'current',
        parent: 'MER-0',
        estimate: 3,
        type: 'bug',
        components: ['web', 'API'],
        due: '2026-11-30',
        title: 'Retry the upload ',
        description: 'It fails on a slow network.',
      })
      assert.deepStrictEqual(result.change, {})
      assert.deepStrictEqual(result.left, [])
      assert.deepStrictEqual(result.already, [
        'status Todo',
        'High priority',
        'assigned to Grace',
        'labels as asked',
        'project Uploads',
        'no milestone',
        'cycle Cycle 4',
        'part of MER-0',
        'estimate 3',
        'type Bug',
        'components api, web',
        'due 2026-11-30',
        'its title as asked',
        'its description as asked',
      ])
    }),
  )

  it.effect('reads each field to the tracker’s own ids', () =>
    Effect.gen(function* () {
      const result = yield* read({
        status: 'In Review',
        priority: 'none',
        assignee: 'me',
        unassign: ['grace', 'ada'],
        labels: { add: ['ui', 'new-flaky'], remove: ['bug', 'docs'] },
        project: 'Search',
        milestone: 'Launch',
        cycle: null,
        parent: 'https://github.com/acme/web/issues/12',
        estimate: null,
        type: 'Task',
        components: ['docs'],
        due: null,
        title: ' Retry uploads ',
        description: 'Back off, then retry.',
      })
      assert.deepStrictEqual(result.left, [])
      assert.deepStrictEqual(result.change, {
        status: { id: 's3', name: 'In Review' },
        priority: 'none',
        assignee: { add: [ADA], remove: [GRACE] },
        labels: { add: [UI, { id: 'new-flaky', name: 'new-flaky' }], remove: [BUG] },
        project: { id: 'p2', name: 'Search' },
        milestone: { id: 'm2', name: 'Launch', in: 'p2' },
        cycle: null,
        parent: { id: 'g12', ref: 'acme/web#12', key: '#12' },
        estimate: null,
        type: { id: 't2', name: 'Task' },
        components: [{ id: 'k3', name: 'docs' }],
        due: null,
        title: 'Retry uploads',
        description: 'Back off, then retry.',
      })
    }),
  )

  it.effect('leaves off each name the tracker has not, saying what it has', () =>
    Effect.gen(function* () {
      const result = yield* read({
        status: 'Shipped',
        assignee: 'Linus',
        labels: { add: ['flaky'] },
        milestone: 'Launch',
        parent: 'MER-404',
        estimate: -1,
        components: ['mobile'],
        due: 'next week',
        title: ' ',
      })
      assert.deepStrictEqual(result.change, {})
      assert.deepStrictEqual(result.left, [
        'no status called “Shipped”. It has: Todo, In Progress, In Review',
        'no one to assign called “Linus”. It has: Ada, Grace',
        'no label called “flaky”. It has: bug, ui',
        // Of the issue's own project, Uploads, where no other is asked.
        'no milestone called “Launch” in its project. It has: Beta',
        'Linear hasn’t an issue MER-404 Althar can read: no issue MER-404',
        'an estimate is a number, 0 or more, not -1',
        'no component called “mobile”. It has: api, web, docs',
        'a due date is a day, as 2026-11-30, not “next week”',
        'give it a title, not an empty one',
      ])
      assert.deepStrictEqual((yield* read({ project: 'Billing' })).left, ['no project called “Billing”. It has: Uploads, Search'])
    }),
  )

  it.effect('takes everyone, a project, a milestone and a parent off, or says there is none', () =>
    Effect.gen(function* () {
      const off = yield* read({ assignee: null, project: null, parent: null, milestone: 'Beta' })
      assert.deepStrictEqual(off.change, { assignee: null, project: null, parent: null, milestone: { id: 'm1', name: 'Beta', in: 'p1' } })
      const bare: Issue = { ...ISSUE, assignees: [], cycle: null, parent: null, milestone: { id: 'm1', name: 'Beta' } }
      const none = yield* read({ assignee: null, cycle: null, parent: null, milestone: 'beta' }, { issue: bare })
      assert.deepStrictEqual(none.change, {})
      assert.deepStrictEqual(none.already, ['unassigned', 'milestone Beta', 'no cycle', 'no parent'])
      const unassigned = yield* read({ unassign: ['grace'] }, { issue: { ...ISSUE, assignees: [] } })
      assert.deepStrictEqual(unassigned.already, ['unassigned'])
      const milestoneOff = yield* read({ milestone: null }, { issue: bare })
      assert.deepStrictEqual(milestoneOff.change, { milestone: null })
    }),
  )

  it.effect('reads a milestone of the project asked for, or of any where neither is known', () =>
    Effect.gen(function* () {
      const moved = yield* read({ project: 'Search', milestone: 'Beta' })
      assert.deepStrictEqual(moved.left, ['no milestone called “Beta” in its project. It has: Launch'])
      const anyProject = yield* read({ milestone: 'Launch' }, { issue: null })
      assert.deepStrictEqual(anyProject.change, { milestone: { id: 'm2', name: 'Launch', in: 'p2' } })
    }),
  )

  it.effect('reads a code host’s #12 in its repository, and refuses an issue as its own parent', () =>
    Effect.gen(function* () {
      const hash = yield* read({ parent: '#12' })
      assert.deepStrictEqual(hash.change, { parent: { id: 'g12', ref: 'acme/web#12', key: '#12' } })
      const own = yield* read({ parent: 'MER-1' })
      assert.deepStrictEqual(own.left, ['an issue can’t be its own parent'])
      const other = yield* read({ parent: 'MER-7' })
      assert.deepStrictEqual(other.change, { parent: { id: 'i7', ref: 'MER-7', key: 'MER-7' } })
    }),
  )

  it.effect('assigns the person as the connection signs in, or says it can’t', () =>
    Effect.gen(function* () {
      const nobody = yield* read({ assignee: 'myself' }, { login: 'linus' })
      assert.deepStrictEqual(nobody.left, ['it can’t be assigned to the account Althar signs in as, linus'])
      // One already on, where an issue takes one and has two: put in their place.
      const two: Issue = {
        ...ISSUE,
        assignees: [
          { id: 'u1', login: 'ada', name: null, bot: false },
          { id: 'u2', login: 'grace', name: 'Grace', bot: false },
        ],
      }
      assert.deepStrictEqual((yield* read({ assignee: 'Ada' }, { issue: two })).change, {
        assignee: { add: [ADA], remove: [] },
      })
      assert.deepStrictEqual((yield* read({ assignee: 'Ada' }, { issue: two, assignees: 'many' })).already, ['assigned to ada, Grace'])
    }),
  )

  it.effect('closes an issue not yet ended, says one ended is closed, and a status set closes it its own way', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual((yield* read({ close: true })).change, { close: true })
      const done: Issue = { ...ISSUE, status: { name: 'Done', category: 'done' } }
      assert.deepStrictEqual((yield* read({ close: true }, { issue: done })).already, ['closed (Done)'])
      assert.deepStrictEqual((yield* read({ close: true, status: 'In Review' })).change, { status: { id: 's3', name: 'In Review' } })
      assert.deepStrictEqual((yield* read({ close: false })).change, {})
    }),
  )

  it.effect('says what is so already of an issue with none of them, and labels only added or only taken off', () =>
    Effect.gen(function* () {
      const { priority: _priority, components: _components, ...rest } = ISSUE
      const bare: Issue = { ...rest, priority: null, labels: [], estimate: null, due: null }
      const none = yield* read({ priority: 'none', estimate: null, due: null, components: [] }, { issue: bare })
      assert.deepStrictEqual(none.change, {})
      assert.deepStrictEqual(none.already, ['no priority', 'estimate none', 'components none', 'no due date'])
      // Labels asked only to add, then only to take off: one it hasn't is nothing to take off.
      const adding = yield* read({ labels: { add: ['ui'] } })
      assert.deepStrictEqual(adding.change, { labels: { add: [UI], remove: [] } })
      const removing = yield* read({ labels: { remove: ['bug', 'ui'] } })
      assert.deepStrictEqual(removing.change, { labels: { add: [], remove: [BUG] } })
      assert.deepStrictEqual((yield* read({ labels: {} })).change, {})
    }),
  )

  it.effect('files a new issue with what it is asked, as nothing is so already', () =>
    Effect.gen(function* () {
      const result = yield* read(
        { status: 'Todo', priority: 'high', assignee: null, due: '2026-12-01', title: 'New', description: 'Body', estimate: 1 },
        { issue: null },
      )
      assert.deepStrictEqual(result.change, {
        status: { id: 's1', name: 'Todo' },
        priority: 'high',
        assignee: null,
        estimate: 1,
        due: '2026-12-01',
        title: 'New',
        description: 'Body',
      })
    }),
  )

  it.effect('says a field’s choices the tracker could not give, and reads the rest', () =>
    Effect.gen(function* () {
      const result = yield* readFields(
        {
          tracker: trackerOf(),
          product: 'linear',
          name: 'Linear',
          issue: ISSUE,
          choices: (field) => (field === 'status' ? Effect.fail(failed('timed out')) : choices(field)),
        },
        { status: 'Done', priority: 'low' },
      )
      assert.deepStrictEqual(result.change, { priority: 'low' })
      assert.deepStrictEqual(result.left, ['Linear couldn’t say what its status can be: timed out'])
    }),
  )
})
