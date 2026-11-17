import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { accessClickUp, categoryOf, issueOf, makeClickUp } from '../src/clickup'
import { ConnectorFailed } from '../src/errors'
import { type Route, stubFetch } from './stub'

/*
 * ClickUp against answers shaped as its API reference (v2) gives them, since
 * nothing here reaches ClickUp: a workspace with a space, a folder and a
 * folderless list, and tasks on them. Ids are as ClickUp makes them: a task's
 * letters and digits, a person's a number.
 */

const API = 'https://api.clickup.com/api/v2'
const TOKEN = 'pk_1234_ABCDEF'

const clickup = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    tracker: makeClickUp({
      fetch,
      apiUrl: `${API}/`,
      webUrl: 'https://app.clickup.com',
      credential: Effect.succeed({ kind: 'key', token: TOKEN }),
    }),
    sent,
  }
}

const ada = { id: 183, username: 'Ada Lovelace', email: 'ada@meridian.dev', color: '#827718', initials: 'AL', profilePicture: null }
const grace = { id: 184, username: 'Grace Hopper', email: 'grace@meridian.dev', color: '#7b68ee', initials: 'GH', profilePicture: null }

/** GET /task/86a1b2c3d, as ClickUp gives one with its Markdown description. */
const task = (overrides: Record<string, unknown> = {}) => ({
  id: '86a1b2c3d',
  custom_id: 'DEV-12',
  name: 'Refunds fail for partial captures',
  text_content: 'Refunds fail',
  description: 'Refunds fail',
  markdown_description: '**Refunds** fail for partial captures',
  status: { status: 'to do', color: '#d3d3d3', type: 'open', orderindex: 0 },
  orderindex: '1.00000000000000000000000000000000',
  date_created: '1762000000000',
  date_updated: '1763300000000',
  date_closed: null,
  archived: false,
  creator: ada,
  assignees: [ada],
  tags: [{ name: 'payments', tag_fg: '#fff', tag_bg: '#000' }],
  parent: null,
  priority: { id: '2', priority: 'high', color: '#ffcc00', orderindex: '2' },
  due_date: '1764590400000',
  url: 'https://app.clickup.com/t/86a1b2c3d',
  list: { id: '901', name: 'Sprint backlog', access: true },
  folder: { id: '801', name: 'Payments', hidden: false, access: true },
  space: { id: '701' },
  team_id: '9011223344',
  ...overrides,
})

/** GET /list/901: its statuses in their order, and its space. */
const list = {
  id: '901',
  name: 'Sprint backlog',
  statuses: [
    { status: 'to do', type: 'open', orderindex: 0, color: '#d3d3d3' },
    { status: 'in review', type: 'custom', orderindex: 1, color: '#ffcc00' },
    { status: 'in progress', type: 'custom', orderindex: 2, color: '#4194f6' },
    { status: 'complete', type: 'done', orderindex: 3, color: '#6bc950' },
    { status: 'closed', type: 'closed', orderindex: 4, color: '#6bc950' },
  ],
  space: { id: '701', name: 'Engineering', access: true },
}

const teams = { teams: [{ id: '9011223344', name: 'Meridian', color: '#000', avatar: null, members: [] }] }

const taskOn = (id = '86a1b2c3d') => ['GET', `${API}/task/${id}`, { json: { list: { id: '901' } } }] as const

describe('categoryOf', () => {
  it('reads a status by its type, then its name', () => {
    assert.strictEqual(categoryOf({ status: 'to do', type: 'open' }), 'todo')
    assert.strictEqual(categoryOf({ status: 'Backlog', type: 'open' }), 'backlog')
    assert.strictEqual(categoryOf({ status: 'complete', type: 'done' }), 'done')
    assert.strictEqual(categoryOf({ status: 'closed', type: 'closed' }), 'done')
    assert.strictEqual(categoryOf({ status: 'in progress', type: 'custom' }), 'started')
    assert.strictEqual(categoryOf({ status: 'in review', type: 'custom' }), 'started')
    assert.strictEqual(categoryOf({ status: 'ready', type: 'custom' }), 'todo')
    assert.strictEqual(categoryOf({ status: 'icebox', type: 'custom' }), 'backlog')
    assert.strictEqual(categoryOf({ status: 'triage', type: 'custom' }), 'triage')
    // ClickUp has no type for a cancelled task: its name says it, whatever its type.
    assert.strictEqual(categoryOf({ status: "Won't do", type: 'closed' }), 'cancelled')
    assert.strictEqual(categoryOf({ status: 'Cancelled', type: 'done' }), 'cancelled')
    assert.strictEqual(categoryOf({ status: 'Something', type: null }), 'started')
  })
})

describe('issueOf', () => {
  it('reads a task as an issue: its custom id its key, its description Markdown, its due day in UTC', () => {
    assert.deepStrictEqual(issueOf(task()), {
      id: '86a1b2c3d',
      ref: '86a1b2c3d',
      key: 'DEV-12',
      title: 'Refunds fail for partial captures',
      body: '**Refunds** fail for partial captures',
      url: 'https://app.clickup.com/t/86a1b2c3d',
      status: { name: 'to do', category: 'todo' },
      priority: { level: 'high', name: 'High' },
      assignees: [{ id: '183', login: 'Ada Lovelace', name: 'Ada Lovelace', bot: false }],
      labels: ['payments'],
      container: 'Sprint backlog',
      updatedAt: '2025-11-16T13:33:20.000Z',
      due: '2025-12-01',
    })
  })

  it('keeps its own id as its key without a custom one, and reads what it lacks as nothing', () => {
    const issue = issueOf(
      task({
        custom_id: null,
        markdown_description: null,
        text_content: null,
        priority: null,
        tags: null,
        assignees: null,
        due_date: null,
        date_updated: null,
        list: { id: '901' },
      }),
    )
    assert.strictEqual(issue.key, '86a1b2c3d')
    assert.strictEqual(issue.body, '')
    assert.isNull(issue.priority)
    assert.deepStrictEqual(issue.labels, [])
    assert.deepStrictEqual(issue.assignees, [])
    assert.isNull(issue.due)
    assert.isNull(issue.container)
    assert.strictEqual(issue.updatedAt, '2025-11-01T12:26:40.000Z')
    // Normal is ClickUp's word for medium; a person with no name goes by their email.
    assert.deepStrictEqual(issueOf(task({ priority: { priority: 'normal' } })).priority, { level: 'medium', name: 'Normal' })
    assert.isNull(issueOf(task({ priority: { priority: 'odd' } })).priority)
    assert.strictEqual(issueOf(task({ assignees: [{ id: 7, email: 'x@y.z' }] })).assignees[0]?.login, 'x@y.z')
    assert.strictEqual(issueOf(task({ assignees: [{ id: 7 }] })).assignees[0]?.login, '7')
    assert.strictEqual(issueOf(task({ date_updated: null, date_created: null })).updatedAt, '1970-01-01T00:00:00.000Z')
  })
})

describe('the tracker', () => {
  it.effect('signs in with the personal token as it is', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([['GET', `${API}/user`, { json: { user: ada } }]])
      assert.deepStrictEqual(yield* tracker.account, { id: '183', login: 'Ada Lovelace', name: 'Ada Lovelace' })
      assert.strictEqual(sent[0]?.headers['authorization'], TOKEN)
    }),
  )

  it.effect('reads a task by its id, a custom id with its workspace, or a custom id asked of each workspace', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['GET', `${API}/task/86a1b2c3d?include_markdown_description=true`, { json: task() }],
        ['GET', `${API}/team`, { json: { teams: [{ id: '1', name: 'Other' }, ...teams.teams] } }],
        [
          'GET',
          `${API}/task/DEV-12?include_markdown_description=true&custom_task_ids=true&team_id=1`,
          { status: 404, json: { err: 'Task not found', ECODE: 'ITEM_015' } },
        ],
        ['GET', `${API}/task/DEV-12?include_markdown_description=true&custom_task_ids=true&team_id=9011223344`, { json: task() }],
      ])
      assert.strictEqual((yield* tracker.issue('86a1b2c3d')).key, 'DEV-12')
      assert.strictEqual((yield* tracker.issue('9011223344/DEV-12')).id, '86a1b2c3d')
      assert.strictEqual((yield* tracker.issue('DEV-12')).id, '86a1b2c3d')
      assert.include(
        sent.map((one) => one.url),
        `${API}/task/DEV-12?include_markdown_description=true&custom_task_ids=true&team_id=1`,
      )
    }),
  )

  it.effect('refuses what isn’t a task’s id before asking, and says when no workspace has a custom id', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['GET', `${API}/team`, { json: teams }],
        ['GET', /custom_task_ids=true/, { status: 404, json: { err: 'Task not found', ECODE: 'ITEM_015' } }],
      ])
      for (const ref of ['../user', 'nope/DEV-12', '9011223344/not-a-key', 'DEV-99'])
        assert.strictEqual((yield* Effect.flip(tracker.issue(ref))).reason, 'not_found', ref)
      assert.isFalse(sent.some((one) => one.url.includes('..')))
    }),
  )

  it.effect('says ClickUp’s own words when it refuses', () =>
    Effect.gen(function* () {
      const { tracker } = clickup([['GET', `${API}/user`, { status: 401, json: { err: 'Token invalid', ECODE: 'OAUTH_025' } }]])
      const error = yield* Effect.flip(tracker.account)
      assert.instanceOf(error, ConnectorFailed)
      assert.strictEqual(error.reason, 'unauthorized')
      assert.strictEqual(error.message, 'Token invalid')
    }),
  )

  it.effect('finds a list’s tasks a page at a time, asking ClickUp for tags, the account’s own and a moment since', () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 100 }, (_, n) =>
        task({
          id: `t${n}`,
          custom_id: null,
          date_updated: String(1763300000000 - n),
          name: n === 3 ? 'Refunds again' : `Task ${n}`,
          markdown_description: 'Something else',
        }),
      )
      const { tracker, sent } = clickup([
        ['GET', `${API}/user`, { json: { user: ada } }],
        ['GET', /\/list\/901\/task\?page=0&/, { json: { tasks: many, last_page: false } }],
        [
          'GET',
          /\/list\/901\/task\?page=1&/,
          {
            json: {
              tasks: [
                task({ id: 'last', custom_id: null, name: 'Refunds, last', date_updated: '1763200000000' }),
                task({ id: 'old', custom_id: null, name: 'Refunds, old', date_updated: '1' }),
              ],
              last_page: true,
            },
          },
        ],
      ])
      const page = yield* tracker.find({
        container: '901',
        state: 'all',
        mine: true,
        labels: ['payments'],
        text: 'refunds',
        updatedSince: '2025-11-01',
        limit: 10,
      })
      assert.deepStrictEqual(
        page.issues.map((issue) => issue.id),
        ['t3', 'last'],
      )
      assert.isNull(page.next)
      const asked = sent.filter((one) => one.url.includes('/list/901/task'))
      assert.lengthOf(asked, 2)
      assert.strictEqual(
        asked[0]?.url,
        `${API}/list/901/task?page=0&order_by=updated&subtasks=true&include_markdown_description=true&include_closed=true&assignees[]=183&tags[]=payments&date_updated_gt=${Date.parse('2025-11-01') - 1}`,
      )
    }),
  )

  it.effect('finds every workspace’s open tasks where no list is asked, leaving closed ones out', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['GET', `${API}/team`, { json: teams }],
        [
          'GET',
          /\/team\/9011223344\/task\?page=0&/,
          {
            json: {
              tasks: [
                task(),
                task({ id: 'done1', custom_id: 'DEV-13', status: { status: 'complete', type: 'done' } }),
                task({ id: 'p1', custom_id: 'DEV-14', priority: { priority: 'urgent' }, date_updated: '1763400000000' }),
              ],
              last_page: true,
            },
          },
        ],
      ])
      const page = yield* tracker.find({ state: 'open', priority: ['urgent', 'high'], limit: 1 })
      assert.deepStrictEqual(
        page.issues.map((issue) => issue.key),
        ['DEV-14'],
      )
      assert.strictEqual(page.next, '1')
      assert.include(sent.find((one) => one.url.includes('/team/9011223344/task'))?.url, 'include_closed=false')
    }),
  )

  it.effect('reads ten pages at most, and logs that the rest was left unread', () =>
    Effect.gen(function* () {
      const full = Array.from({ length: 100 }, (_, n) => task({ id: `t${n}` }))
      const { tracker, sent } = clickup([
        ['GET', `${API}/team`, { json: teams }],
        ['GET', /\/team\/9011223344\/task\?page=/, { json: { tasks: full } }],
      ])
      yield* tracker.find({ state: 'all', limit: 5 })
      assert.lengthOf(
        sent.filter((one) => one.url.includes('/team/9011223344/task')),
        10,
      )
    }),
  )

  it.effect('finds tasks by key, on a list where one is asked, leaving out a key no task has', () =>
    Effect.gen(function* () {
      const { tracker } = clickup([
        ['GET', `${API}/task/86a1b2c3d?include_markdown_description=true`, { json: task() }],
        [
          'GET',
          `${API}/task/elsewhere?include_markdown_description=true`,
          { json: task({ id: 'elsewhere', custom_id: null, list: { id: '902', name: 'Other' } }) },
        ],
        ['GET', `${API}/task/gone?include_markdown_description=true`, { status: 404, json: { err: 'Task not found', ECODE: 'ITEM_015' } }],
      ])
      const page = yield* tracker.find({ state: 'all', keys: ['86a1b2c3d', 'elsewhere', 'gone', ' '], container: '901', limit: 10 })
      assert.deepStrictEqual(
        page.issues.map((issue) => issue.id),
        ['86a1b2c3d'],
      )
      const all = yield* tracker.find({ state: 'all', keys: ['86a1b2c3d', 'elsewhere'], limit: 10 })
      assert.lengthOf(all.issues, 2)
    }),
  )

  it.effect('refuses a search by what a task has no field for, before asking', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([])
      const error = yield* Effect.flip(tracker.find({ state: 'open', milestone: 'Q4', limit: 5 }))
      assert.strictEqual(error.reason, 'rejected')
      assert.include(error.message, 'milestone')
      assert.lengthOf(sent, 0)
    }),
  )

  it.effect('lists the account’s own open tasks, on a list by name where one is given', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['GET', `${API}/user`, { json: { user: ada } }],
        ['GET', `${API}/team`, { json: teams }],
        [
          'GET',
          /\/team\/9011223344\/task\?page=0&/,
          {
            json: {
              tasks: [
                task(),
                task({ id: 'x', list: { id: '902', name: 'Other' } }),
                task({ id: 'c', status: { status: 'closed', type: 'closed' } }),
              ],
            },
          },
        ],
      ])
      assert.deepStrictEqual(
        (yield* tracker.mine({ container: 'Sprint backlog' })).map((issue) => issue.id),
        ['86a1b2c3d'],
      )
      assert.lengthOf(yield* tracker.mine(), 2)
      assert.include(sent.find((one) => one.url.includes('/team/'))?.url, 'assignees[]=183')
    }),
  )

  it.effect('reads comments oldest first, page after page from the oldest of the one before', () =>
    Effect.gen(function* () {
      const comment = (n: number) => ({
        id: `c${n}`,
        comment_text: `Comment ${n}`,
        user: grace,
        date: String(1763300000000 - n * 1000),
      })
      const first = Array.from({ length: 25 }, (_, n) => comment(n))
      const { tracker, sent } = clickup([
        ['GET', `${API}/task/86a1b2c3d/comment`, { json: { comments: first } }],
        ['GET', /\/comment\?start=/, { json: { comments: [comment(25), { id: 'c26', date: 'not a moment', user: null }] } }],
      ])
      const issue = issueOf(task())
      assert.deepStrictEqual(yield* tracker.comments(issue, 0), [])
      const three = yield* tracker.comments(issue, 3)
      assert.deepStrictEqual(
        three.map((one) => one.body),
        ['Comment 2', 'Comment 1', 'Comment 0'],
      )
      assert.strictEqual(three[2]?.author?.login, 'Grace Hopper')
      const all = yield* tracker.comments(issue, 100)
      assert.lengthOf(all, 27)
      assert.deepStrictEqual(all[0], { author: null, body: '', at: 'not a moment' })
      assert.strictEqual(sent.at(-1)?.url, `${API}/task/86a1b2c3d/comment?start=${String(1763300000000 - 24_000)}&start_id=c24`)
    }),
  )

  it.effect('comments, without notifying everyone', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([['POST', `${API}/task/86a1b2c3d/comment`, { json: { id: '1', hist_id: 'h', date: 1 } }]])
      yield* tracker.comment(issueOf(task()), 'Looked into it.')
      assert.deepStrictEqual(sent[0]?.body, { comment_text: 'Looked into it.', notify_all: false })
    }),
  )

  it.effect('links a pull request by a comment, once', () =>
    Effect.gen(function* () {
      const url = 'https://github.com/meridian/api/pull/42'
      let posted = 0
      const comments: Array<Record<string, unknown>> = []
      const { tracker, sent } = clickup([
        ['GET', `${API}/task/86a1b2c3d/comment`, () => ({ json: { comments } })],
        [
          'POST',
          `${API}/task/86a1b2c3d/comment`,
          (request) => {
            posted++
            comments.unshift({ id: 'c1', comment_text: (request.body as { comment_text: string }).comment_text, date: '1' })
            return { json: { id: 'c1' } }
          },
        ],
      ])
      const issue = issueOf(task())
      yield* tracker.link(issue, { url, title: 'DEV-12: Refunds' })
      yield* tracker.link(issue, { url, title: 'DEV-12: Refunds' })
      assert.strictEqual(posted, 1)
      assert.deepStrictEqual(sent.find((one) => one.method === 'POST')?.body, {
        comment_text: `DEV-12: Refunds\n${url}`,
        notify_all: false,
      })
      yield* tracker.link(issue, { url: 'https://github.com/meridian/api/pull/43', title: '' })
      assert.strictEqual(
        (sent.at(-1)?.body as { comment_text?: string } | undefined)?.comment_text,
        'https://github.com/meridian/api/pull/43',
      )
    }),
  )

  it.effect('starts a task in its list’s status for work under way, not its first custom one', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        taskOn(),
        ['GET', `${API}/list/901`, { json: list }],
        ['PUT', `${API}/task/86a1b2c3d`, { json: task() }],
      ])
      assert.deepStrictEqual(yield* tracker.start(issueOf(task())), { moved: true, status: { name: 'in progress', category: 'started' } })
      assert.deepStrictEqual(sent.at(-1)?.body, { status: 'in progress' })
    }),
  )

  it.effect('starts in a list’s first custom status where none is named for it, and fails where it has none', () =>
    Effect.gen(function* () {
      const other = { ...list, statuses: [list.statuses[0], { status: 'review', type: 'custom' }, list.statuses[3]] }
      const { tracker, sent } = clickup([
        taskOn(),
        ['GET', `${API}/list/901`, { json: other }],
        ['PUT', `${API}/task/86a1b2c3d`, { json: task() }],
      ])
      assert.deepStrictEqual(yield* tracker.start(issueOf(task())), { moved: true, status: { name: 'review', category: 'started' } })
      assert.deepStrictEqual(sent.at(-1)?.body, { status: 'review' })
      const none = clickup([taskOn(), ['GET', `${API}/list/901`, { json: { ...list, statuses: [list.statuses[0], list.statuses[3]] } }]])
      const error = yield* Effect.flip(none.tracker.start(issueOf(task())))
      assert.strictEqual(error.reason, 'rejected')
    }),
  )

  it.effect('leaves a task already under way, done or cancelled as it is, asking nothing', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([])
      const started = issueOf(task({ status: { status: 'in progress', type: 'custom' } }))
      assert.deepStrictEqual(yield* tracker.start(started), { moved: false, status: started.status })
      assert.lengthOf(sent, 0)
    }),
  )

  it.effect('lists every list it can file on, by space and folder, a hidden folder’s and archived ones left as they are', () =>
    Effect.gen(function* () {
      const answers = (two: boolean) =>
        clickup([
          ['GET', `${API}/team`, { json: two ? { teams: [...teams.teams, { id: '55', name: 'Side' }] } : teams }],
          ['GET', `${API}/team/9011223344/space?archived=false`, { json: { spaces: [{ id: '701', name: 'Engineering' }] } }],
          ['GET', `${API}/team/55/space?archived=false`, { json: { spaces: [] } }],
          [
            'GET',
            `${API}/space/701/folder?archived=false`,
            {
              json: {
                folders: [
                  {
                    id: '801',
                    name: 'Payments',
                    hidden: false,
                    lists: [
                      { id: '901', name: 'Sprint backlog' },
                      { id: '903', name: 'Old', archived: true },
                    ],
                  },
                  { id: '802', name: 'hidden', hidden: true, lists: [{ id: '904', name: 'Inbox' }] },
                  { id: '805', name: 'Empty', lists: null },
                ],
              },
            },
          ],
          ['GET', `${API}/space/701/list?archived=false`, { json: { lists: [{ id: '902', name: 'Roadmap' }] } }],
        ])
      assert.deepStrictEqual(yield* answers(false).tracker.containers(), [
        { id: '902', key: null, name: 'Engineering / Roadmap' },
        { id: '901', key: null, name: 'Engineering / Payments / Sprint backlog' },
        { id: '904', key: null, name: 'Engineering / Inbox' },
      ])
      // With more than one workspace, each list says which it is in.
      assert.strictEqual((yield* answers(true).tracker.containers())[0]?.name, 'Meridian / Engineering / Roadmap')
    }),
  )

  it.effect('files a task with its Markdown, the tags its space has, its priority, people, due day and status', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['GET', `${API}/list/901`, { json: list }],
        ['GET', `${API}/space/701/tag`, { json: { tags: [{ name: 'payments' }, { name: 'Bug' }] } }],
        ['POST', `${API}/list/901/task`, { json: task({ id: 'new1', custom_id: 'DEV-20' }) }],
        ['GET', `${API}/task/new1?include_markdown_description=true`, { json: task({ id: 'new1', custom_id: 'DEV-20' }) }],
      ])
      const issue = yield* tracker.create('901', {
        title: 'Refunds fail',
        body: '**Refunds** fail',
        labels: ['bug', 'nowhere', ' '],
        priority: 'urgent',
        fields: {
          assignee: { add: [{ id: '183', name: 'Ada' }], remove: [] },
          due: '2026-11-30',
          status: { id: 'in progress', name: 'in progress' },
        },
      })
      assert.strictEqual(issue.key, 'DEV-20')
      assert.deepStrictEqual(sent.find((one) => one.method === 'POST')?.body, {
        name: 'Refunds fail',
        markdown_content: '**Refunds** fail',
        tags: ['Bug'],
        priority: 1,
        assignees: [183],
        due_date: Date.parse('2026-11-30T12:00:00.000Z'),
        due_date_time: false,
        status: 'in progress',
      })
    }),
  )

  it.effect('files a task as ClickUp answered where reading it back fails, and asks for no tags where none are wanted', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        [
          'POST',
          `${API}/list/901/task`,
          { json: task({ id: 'new2', markdown_description: null, text_content: null, date_updated: null }) },
        ],
        ['GET', `${API}/task/new2?include_markdown_description=true`, { status: 500, json: { err: 'Oops' } }],
      ])
      const issue = yield* tracker.create('901', { title: 'T', body: 'Body', labels: [], priority: 'none' })
      assert.strictEqual(issue.id, 'new2')
      assert.strictEqual(issue.body, 'Body')
      assert.isFalse(sent.some((one) => one.url.includes('/tag')))
      assert.deepStrictEqual(sent[0]?.body, { name: 'T', markdown_content: 'Body' })
    }),
  )

  it.effect('refuses to file with what it can’t set, or a day that isn’t one, before asking', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([])
      const milestone = yield* Effect.flip(
        tracker.create('901', { title: 'T', body: '', labels: [], fields: { milestone: { id: '1', name: 'Q4' } } }),
      )
      assert.include(milestone.message, 'milestone')
      const title = yield* Effect.flip(tracker.create('901', { title: 'T', body: '', labels: [], fields: { title: 'Other' } }))
      assert.include(title.message, 'set after')
      const day = yield* Effect.flip(tracker.create('901', { title: 'T', body: '', labels: [], fields: { due: '2026-02-30' } }))
      assert.include(day.message, 'Not a day')
      const person = yield* Effect.flip(
        tracker.create('901', {
          title: 'T',
          body: '',
          labels: [],
          fields: { assignee: { add: [{ id: 'ada', name: 'Ada' }], remove: [] } },
        }),
      )
      assert.strictEqual(person.reason, 'not_found')
      assert.lengthOf(sent, 0)
    }),
  )

  it.effect('changes a task in one edit, its tags one by one, and reads it after', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([
        ['PUT', `${API}/task/86a1b2c3d`, { json: task() }],
        ['POST', /\/task\/86a1b2c3d\/tag\//, { json: {} }],
        ['DELETE', /\/task\/86a1b2c3d\/tag\//, { json: {} }],
        ['GET', `${API}/task/86a1b2c3d?include_markdown_description=true`, { json: task() }],
      ])
      yield* tracker.update(issueOf(task()), {
        title: 'New title',
        description: 'New *body*',
        status: { id: 'in review', name: 'in review' },
        priority: 'low',
        due: '2026-12-24',
        assignee: { add: [{ id: '184', name: 'Grace' }], remove: [{ id: '183', name: 'Ada' }] },
        labels: {
          add: [
            { id: 'Needs QA', name: 'Needs QA' },
            { id: 'payments', name: 'payments' },
          ],
          remove: [
            { id: 'payments', name: 'payments' },
            { id: 'gone', name: 'gone' },
          ],
        },
      })
      assert.deepStrictEqual(sent[0]?.body, {
        name: 'New title',
        markdown_content: 'New *body*',
        status: 'in review',
        priority: 4,
        due_date: Date.parse('2026-12-24T12:00:00.000Z'),
        due_date_time: false,
        assignees: { add: [184], rem: [183] },
      })
      assert.deepStrictEqual(
        sent.slice(1, -1).map((one) => `${one.method} ${one.url}`),
        [`POST ${API}/task/86a1b2c3d/tag/Needs%20QA`, `DELETE ${API}/task/86a1b2c3d/tag/payments`],
      )
    }),
  )

  it.effect('closes a task into its list’s closed status, else its last done one; takes everyone off; clears a priority and due day', () =>
    Effect.gen(function* () {
      const routes = (statuses: ReadonlyArray<unknown>): ReadonlyArray<Route> => [
        taskOn(),
        ['GET', `${API}/list/901`, { json: { ...list, statuses } }],
        ['PUT', `${API}/task/86a1b2c3d`, { json: task() }],
        ['GET', `${API}/task/86a1b2c3d?include_markdown_description=true`, { json: task() }],
      ]
      const closed = clickup(routes(list.statuses))
      yield* closed.tracker.update(issueOf(task()), { close: true, assignee: null, priority: 'none', due: null })
      assert.deepStrictEqual(closed.sent.find((one) => one.method === 'PUT')?.body, {
        status: 'closed',
        priority: null,
        due_date: null,
        due_date_time: false,
        assignees: { add: [], rem: [183] },
      })
      const done = clickup(routes([list.statuses[0], list.statuses[3], { status: 'shipped', type: 'done' }]))
      yield* done.tracker.update(issueOf(task()), { close: true })
      assert.deepStrictEqual(done.sent.find((one) => one.method === 'PUT')?.body, { status: 'shipped' })
      const none = clickup(routes([list.statuses[0]]))
      assert.strictEqual((yield* Effect.flip(none.tracker.update(issueOf(task()), { close: true }))).reason, 'rejected')
    }),
  )

  it.effect('refuses a change to what a task hasn’t here, and asks nothing for an empty one but to read it', () =>
    Effect.gen(function* () {
      const { tracker, sent } = clickup([['GET', `${API}/task/86a1b2c3d?include_markdown_description=true`, { json: task() }]])
      const error = yield* Effect.flip(tracker.update(issueOf(task()), { estimate: 3 }))
      assert.include(error.message, 'estimate')
      yield* tracker.update(issueOf(task()), {})
      assert.deepStrictEqual(
        sent.map((one) => one.method),
        ['GET'],
      )
    }),
  )

  it.effect('lists a task’s choices: its list’s statuses and people, its space’s tags', () =>
    Effect.gen(function* () {
      const { tracker } = clickup([
        taskOn(),
        ['GET', `${API}/list/901`, { json: list }],
        ['GET', `${API}/list/901/member`, { json: { members: [ada, { id: 9, email: 'bot@meridian.dev' }] } }],
        ['GET', `${API}/space/701/tag`, { json: { tags: [{ name: 'payments' }] } }],
      ])
      const issue = issueOf(task())
      assert.deepStrictEqual(
        (yield* tracker.choices(issue, 'status')).map((choice) => choice.id),
        ['to do', 'in review', 'in progress', 'complete', 'closed'],
      )
      assert.deepStrictEqual(yield* tracker.choices(issue, 'assignee'), [
        { id: '183', name: 'Ada Lovelace', also: ['Ada Lovelace', 'ada@meridian.dev'] },
        { id: '9', name: 'bot@meridian.dev', also: ['bot@meridian.dev'] },
      ])
      assert.deepStrictEqual(yield* tracker.choicesIn('901', 'labels'), [{ id: 'payments', name: 'payments' }])
      assert.include((yield* Effect.flip(tracker.choices(issue, 'milestone'))).message, 'milestone')
      assert.include((yield* Effect.flip(tracker.choicesIn('901', 'cycle'))).message, 'sprints')
    }),
  )

  it.effect('has no tags to offer on a list with no space', () =>
    Effect.gen(function* () {
      const { tracker } = clickup([['GET', `${API}/list/901`, { json: { ...list, space: null, statuses: null } }]])
      assert.deepStrictEqual(yield* tracker.choicesIn('901', 'labels'), [])
      assert.deepStrictEqual(yield* tracker.choicesIn('901', 'status'), [])
    }),
  )
})

describe('accessClickUp', () => {
  const check = (routes: ReadonlyArray<Route>) => {
    const { fetch } = stubFetch(routes)
    return accessClickUp({
      fetch,
      apiUrl: API,
      webUrl: 'https://app.clickup.com',
      hosted: true,
      credential: { kind: 'key', token: TOKEN },
      auth: 'token',
      repositories: [],
    })
  }

  it.effect('says who it signs in as and how many workspaces it reads; what it may write is unsaid', () =>
    Effect.gen(function* () {
      const report = yield* check([
        ['GET', `${API}/user`, { json: { user: ada } }],
        ['GET', `${API}/team`, { json: teams }],
      ])
      assert.deepStrictEqual(report.account, { id: '183', login: 'Ada Lovelace', name: 'Ada Lovelace' })
      assert.deepStrictEqual(
        report.lines.map((one) => [one.need, one.state]),
        [
          ['account', 'ok'],
          ['read', 'ok'],
          ['comment', 'unknown'],
          ['move', 'unknown'],
        ],
      )
    }),
  )

  it.effect('stops at a token ClickUp refuses, and says why else', () =>
    Effect.gen(function* () {
      const refused = yield* check([['GET', `${API}/user`, { status: 401, json: { err: 'Token invalid', ECODE: 'OAUTH_025' } }]])
      assert.isNull(refused.account)
      assert.deepStrictEqual(refused.lines[0]?.reason, { kind: 'refused' })
      const odd = yield* check([['GET', `${API}/user`, { status: 400, json: { err: 'Bad', ECODE: 'OAUTH_019' } }]])
      assert.deepStrictEqual(odd.lines[0]?.reason, { kind: 'refused' })
      const down = yield* check([['GET', `${API}/user`, { status: 503, json: { err: 'Down' } }]])
      assert.strictEqual(down.lines[0]?.reason?.kind, 'failed')
      const unreadable = yield* check([['GET', `${API}/user`, { json: { nobody: true } }]])
      assert.strictEqual(unreadable.lines[0]?.state, 'no')
    }),
  )

  it.effect('says when it can’t read the workspaces', () =>
    Effect.gen(function* () {
      const refused = yield* check([
        ['GET', `${API}/user`, { json: { user: ada } }],
        ['GET', `${API}/team`, { status: 401, json: { err: 'Not authorized' } }],
      ])
      assert.deepStrictEqual(refused.lines[1], { ...refused.lines[1], need: 'read', state: 'no' })
      const odd = yield* check([
        ['GET', `${API}/user`, { json: { user: ada } }],
        ['GET', `${API}/team`, { json: { nothing: [] } }],
      ])
      assert.strictEqual(odd.lines[1]?.state, 'no')
    }),
  )
})
