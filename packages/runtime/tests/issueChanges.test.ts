import type { IssueChangesCard } from '@althar/contracts'
import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { migrations } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { Instance } from '../src/Instance'
import { ChangesClosed, IssueChanges } from '../src/IssueChanges'
import { Issues } from '../src/Issues'
import { notesOf } from '../src/notes'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { transcript } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, items, listTools, repository, runtime, turns, until } from './support'

/*
 * Changes to issues on the person's trackers (docs/architecture/06,
 * "Changing issues"): the coordinator's on any issue, several on one card;
 * a lead's on its own task's issue; Althar's as a task's pull request opens
 * and merges. A card the person applies, or at once where the project lets
 * changes through; a comment and a link at once, as a line.
 */

type Services = { readonly github?: FakeService; readonly linear?: FakeService }

const withQueries = (services: Services) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services) })))

const linear = () => {
  const service = makeFakeService({ product: 'linear' })
  service.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges' })
  service.addIssue({ ref: 'MER-232', title: 'Webhooks retry forever', status: { name: 'In Progress', category: 'started' } })
  return service
}

const connect = (product: 'github' | 'linear') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product, token: 't', actorId: instance.personId })
  })

/** A project, and the coordinator as its tools see it. */
const project = () =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const threadId = yield* (yield* Coordinator).thread(opened.projectId)
    const access: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId,
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, threadId, access }
  })

/** The issue change cards in a thread, as the store has them. */
const cardsIn = (threadId: string) =>
  Effect.map(items(threadId), (all) =>
    all.flatMap((item) => (item.kind === 'issue_changes' ? [item.content as unknown as IssueChangesCard] : [])),
  )

/** A task started with a lead at work, from MER-231 where it says, and the lead's tools as it is given them. */
const led = (projectId: ProjectId, access: ToolAccess, title: string, issue?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    assert.match(yield* callTool(access, 'start_task', { title, description: 'Wait.', lead: { agent: 'claude-code' } }), /^Started /)
    const [task] = yield* sql<{ id: string; threadId: string }>`
      SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.title = ${title}`
    if (task === undefined) return assert.fail('no task')
    if (issue !== undefined) yield* (yield* Issues).attach({ projectId, taskId: task.id, issue })
    const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'lead-session', taskId: task.id }
    return { task, lead }
  })

describe('changes to issues', () => {
  it.live('are one card for several issues, which change nothing until the person applies it', () => {
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { threadId, access } = yield* project()
      const changes = yield* IssueChanges
      const instance = yield* Instance

      const said = yield* callTool(access, 'change_issues', {
        changes: [
          { issue: 'mer-231', status: 'done' },
          { issue: 'MER-232', priority: 'Low', add_labels: ['Bug'], assignee: 'sam' },
        ],
        note: 'Shipped in 0.5.0.',
      })
      assert.match(
        said,
        /^Proposed MER-231: status to Done; MER-232: priority to Low, assigned to Sam Rivera, labels \+bug\. Nothing changes until the person applies it/,
      )
      // Nothing reached the tracker.
      assert.lengthOf(tracker.issueChanges, 0)
      const [card] = yield* cardsIn(threadId)
      assert.deepStrictEqual(card && { ...card, changesId: '' }, {
        changesId: '',
        note: 'Shipped in 0.5.0.',
        state: 'pending',
        error: null,
        direct: false,
        issues: [
          {
            product: 'linear',
            tracker: 'Linear',
            key: 'MER-231',
            url: 'https://linear.app/fake/issue/MER-231/rate-limit-refunds-like-charges',
            title: 'Rate-limit refunds like charges',
            from: 'Todo',
            became: null,
            changes: [{ field: 'status', to: 'Done' }],
            applied: null,
            error: null,
          },
          {
            product: 'linear',
            tracker: 'Linear',
            key: 'MER-232',
            url: 'https://linear.app/fake/issue/MER-232/webhooks-retry-forever',
            title: 'Webhooks retry forever',
            from: 'In Progress',
            became: null,
            changes: [
              { field: 'priority', to: 'Low' },
              { field: 'assignee', to: 'Sam Rivera' },
              { field: 'labels', add: ['bug'], remove: [] },
            ],
            applied: null,
            error: null,
          },
        ],
      })

      // Applied, each issue changes on the tracker by its own ids, and the card says so.
      const applied = yield* changes.apply(card?.changesId ?? '', instance.personId)
      assert.strictEqual(applied.state, 'applied')
      assert.deepStrictEqual(
        tracker.issueChanges.map((one) => [one.ref, one.change]),
        [
          ['MER-231', { status: { id: 'done', name: 'Done' } }],
          [
            'MER-232',
            {
              priority: 'low',
              assignee: { add: [{ id: 'user-sam', name: 'Sam Rivera', also: ['sam'] }], remove: [] },
              labels: { add: [{ id: 'label-bug', name: 'bug' }], remove: [] },
            },
          ],
        ],
      )
      assert.deepStrictEqual((yield* tracker.issue('MER-231')).status, { name: 'Done', category: 'done' })
      assert.deepStrictEqual(
        (yield* cardsIn(threadId))[0]?.issues.map((issue) => issue.applied),
        [true, true],
      )
      // Applied once: pressing again changes nothing more.
      assert.instanceOf(yield* Effect.flip(changes.apply(card?.changesId ?? '', instance.personId)), ChangesClosed)
      assert.lengthOf(tracker.issueChanges, 2)
      // Whoever takes the thread over reads what was applied.
      assert.include((yield* transcript(threadId, 10_000)).text, '[issue changes] MER-231: status to Done; MER-232: priority to Low')
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  it.live('read each name against the tracker, change what they can, and say what they couldn’t or was so already', () => {
    const tracker = linear()
    const github = makeFakeService({ product: 'github' })
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Docs are stale' })
    return Effect.gen(function* () {
      yield* connect('linear')
      yield* connect('github')
      const { threadId, access } = yield* project()
      const change = (one: Record<string, unknown>) => callTool(access, 'change_issues', { changes: [one] })
      assert.strictEqual(
        yield* change({ issue: 'MER-231', status: 'Shipped' }),
        'Nothing changed. no status called “Shipped”. It has: Backlog, Todo, In Progress, In Review, Done, Canceled.'.replace(
          'Nothing changed. ',
          'Nothing changed. MER-231: ',
        ),
      )
      // A name it begins is enough, where only one begins so.
      assert.match(yield* change({ issue: 'MER-231', status: 'in rev' }), /^Proposed MER-231: status to In Review\./)
      assert.strictEqual(
        yield* change({ issue: 'MER-231', priority: 'soonish' }),
        'A priority is one of urgent, high, medium, low or none, not “soonish”.',
      )
      // What is so already is left off and said: nothing to change is no card.
      assert.strictEqual(
        yield* change({ issue: 'MER-231', status: 'Todo', priority: 'high' }),
        'Nothing changed. Already so: MER-231: status Todo; MER-231: High priority.',
      )
      assert.strictEqual(
        yield* change({ issue: 'https://github.com/meridian/api/issues/12', priority: 'low' }),
        "Nothing changed. #12: Althar can’t set its priority on GitHub: GitHub's issues have no priority.",
      )
      assert.strictEqual(
        yield* change({ issue: 'NOPE-1', status: 'Done' }),
        'Nothing changed. Althar can’t find NOPE-1 on a connected tracker, or in the project’s repository.',
      )
      assert.strictEqual(
        yield* callTool(access, 'change_issues', {
          changes: [
            { issue: 'MER-231', close: true },
            { issue: 'mer-231', priority: 'low' },
          ],
        }),
        'Name each issue once, with everything that changes on it.',
      )
      // Never all or nothing: a label it hasn't and an issue it can't find leave what reads right to go ahead, and are said.
      assert.strictEqual(
        yield* callTool(access, 'change_issues', {
          changes: [
            { issue: 'MER-231', priority: 'low', add_labels: ['nonesuch'] },
            { issue: 'NOPE-1', status: 'Done' },
          ],
        }),
        "Proposed MER-231: priority to Low. Nothing changes until the person applies it from its card in this thread, or discards it; they see it there, so there's no need to repeat it. You'll hear what they decide. Not changed: MER-231: no label called “nonesuch”. It has: bug, docs, payments. Althar can’t find NOPE-1 on a connected tracker, or in the project’s repository.",
      )
      // Only those that read right are cards.
      assert.lengthOf(yield* cardsIn(threadId), 2)
      assert.lengthOf(tracker.issueChanges, 0)
    }).pipe(Effect.provide(withQueries({ linear: tracker, github })))
  })

  it.live('kept the person’s “Change issues without asking” as a note, once the switch went', () => {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* project()
      const other = yield* project()
      yield* (yield* Policies).current(other.projectId)
      // The switch, on, as a revision before it went kept it.
      yield* (yield* Policies).current(projectId)
      yield* sql`UPDATE policies SET rules = json_set(rules, '$.changeIssues', json('true')) WHERE project_id = ${projectId}`
      // A revision that has the switch still reads: it is nothing now.
      assert.notProperty((yield* (yield* Policies).current(projectId)).rules, 'changeIssues')
      const fields = migrations.find((migration) => migration.key === '0056_issue_fields') ?? assert.fail('no migration')
      for (const statement of fields.statements.filter((each) => each.startsWith('INSERT INTO project_notes'))) yield* sql.unsafe(statement)
      const notes = yield* notesOf(projectId)
      assert.deepStrictEqual(
        notes.map((note) => [note.body, note.keptBy]),
        [['Change issues at once, without a card to apply first.', 'person']],
      )
      assert.lengthOf(yield* notesOf(other.projectId), 0)
    }).pipe(Effect.provide(withQueries({})))
  })

  it.live('add and take off people without replacing the others, and set a milestone and a description', () => {
    const github = makeFakeService({ product: 'github' })
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Docs are stale' })
    return Effect.gen(function* () {
      yield* connect('github')
      const { access } = yield* project()
      const said = yield* callTool(access, 'change_issues', {
        changes: [
          { issue: 'https://github.com/meridian/api/issues/12', assignee: 'sam', milestone: 'Beta', description: 'Now with steps.' },
        ],
        at_once: true,
      })
      assert.strictEqual(
        said,
        'Done: #12: assignees +Sam Rivera, milestone to Beta, its description rewritten. The thread shows it as a line.',
      )
      const issue = yield* github.issue('meridian/api#12')
      // The person had it already: Sam is added beside them, not in their place.
      assert.deepStrictEqual(
        issue.assignees.map((person) => person.login),
        ['you', 'sam'],
      )
      assert.deepStrictEqual([issue.milestone?.name, issue.body], ['Beta', 'Now with steps.'])
      assert.strictEqual(
        yield* callTool(access, 'change_issues', {
          changes: [{ issue: 'https://github.com/meridian/api/issues/12', unassign: ['me'] }],
          at_once: true,
        }),
        'Done: #12: assignees −You. The thread shows it as a line.',
      )
      assert.deepStrictEqual(
        (yield* github.issue('meridian/api#12')).assignees.map((person) => person.login),
        ['sam'],
      )
    }).pipe(Effect.provide(withQueries({ github })))
  })

  it.live('take a Linear milestone only from the project it goes in, never moving it to another', () => {
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { access } = yield* project()
      const said = yield* callTool(access, 'change_issues', {
        changes: [{ issue: 'MER-231', project: 'Payments v2', milestone: 'Beta' }],
        at_once: true,
      })
      assert.include(said, 'MER-231: no milestone called “Beta” in its project. It has: Design')
      assert.deepStrictEqual(
        tracker.issueChanges.map((one) => one.change.milestone),
        [undefined],
      )
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  it.live('apply and discard a card kept before every field: its one assignee is added, a code host’s project is its milestone', () => {
    const github = makeFakeService({ product: 'github' })
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Docs are stale' })
    github.addIssue({ ref: 'meridian/api#13', title: 'Logs are noisy' })
    return Effect.gen(function* () {
      yield* connect('github')
      const { threadId, access } = yield* project()
      const changes = yield* IssueChanges
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const propose = (issue: string) =>
        callTool(access, 'change_issues', { changes: [{ issue: `https://github.com/meridian/api/issues/${issue}`, title: 'Renamed' }] })
      yield* propose('12')
      yield* propose('13')
      // As an earlier version kept them: an assignee in place of the others, a milestone said as project, no assignees kind.
      const rows = yield* sql<{ id: string; changes: string }>`SELECT id, changes FROM issue_changes ORDER BY created_at, id`
      for (const row of rows) {
        const old = (JSON.parse(row.changes) as ReadonlyArray<Record<string, unknown>>).map((entry) => ({
          ...entry,
          assignees: undefined,
          change: { assignee: { id: 'user-sam', name: 'Sam Rivera' }, project: { id: 'milestone-beta', name: 'Beta' } },
        }))
        yield* sql`UPDATE issue_changes SET changes = ${JSON.stringify(old)} WHERE id = ${row.id}`
      }
      const [first, second] = yield* cardsIn(threadId)
      const applied = yield* changes.apply(first?.changesId ?? '', instance.personId)
      assert.strictEqual(applied.state, 'applied')
      assert.deepStrictEqual(applied.issues[0]?.changes, [
        { field: 'assignees', add: ['Sam Rivera'], remove: [] },
        { field: 'milestone', to: 'Beta' },
      ])
      const issue = yield* github.issue('meridian/api#12')
      assert.deepStrictEqual([issue.assignees.map((person) => person.login), issue.milestone?.name], [['you', 'sam'], 'Beta'])
      yield* changes.discard(second?.changesId ?? '', instance.personId)
      const [discarded] = yield* sql<{ state: string }>`SELECT state FROM issue_changes WHERE id = ${second?.changesId ?? ''}`
      assert.strictEqual(discarded?.state, 'discarded')
    }).pipe(Effect.provide(withQueries({ github })))
  })

  it.live('apply at once, as a line, where the agent says so by the person’s note; and a comment always does', () => {
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { threadId, access } = yield* project()
      const instance = yield* Instance
      assert.strictEqual(
        yield* callTool(access, 'change_issues', { changes: [{ issue: 'MER-231', close: true }], at_once: true }),
        'Done: MER-231: closed. The thread shows it as a line.',
      )
      assert.deepStrictEqual((yield* tracker.issue('MER-231')).status.name, 'Done')
      assert.strictEqual(
        yield* callTool(access, 'comment_on_issue', { issue: 'MER-232', body: 'Fixed in #12.' }),
        'Commented on MER-232. The thread shows it as a line.',
      )
      assert.deepStrictEqual(tracker.issueComments('MER-232'), ['Fixed in #12.'])
      assert.deepStrictEqual(
        (yield* cardsIn(threadId)).map((card) => [card.state, card.direct, card.issues[0]?.changes]),
        [
          ['applied', true, [{ field: 'close', to: null }]],
          ['applied', true, [{ field: 'comment', to: 'Fixed in #12.' }]],
        ],
      )
      // A failure says why, and the card can be applied again: a change made twice changes nothing more.
      tracker.failNext('update', 'forbidden')
      assert.match(
        yield* callTool(access, 'change_issues', { changes: [{ issue: 'MER-232', priority: 'urgent' }], at_once: true }),
        /^Tried MER-232: priority to Urgent, and not all of it applied: MER-232: Linear says this account may not change it: The fake update failed/,
      )
      const failed = (yield* cardsIn(threadId))[2]
      assert.strictEqual(failed?.state, 'failed')
      const again = yield* (yield* IssueChanges).apply(failed?.changesId ?? '', instance.personId)
      assert.strictEqual(again.state, 'applied')
      assert.strictEqual((yield* tracker.issue('MER-232')).priority?.level, 'urgent')
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  it.live('never post a comment twice whose answer couldn’t be read: the card says to look on the tracker', () => {
    const tracker = linear()
    let calls = 0
    // Linear takes the comment, then answers with what Althar can't read.
    const unreadable: FakeService = {
      ...tracker,
      comment: (issue, body) =>
        Effect.andThen(tracker.comment(issue, body), () =>
          calls++ === 0
            ? Effect.fail(new ConnectorFailed({ product: 'linear', reason: 'invalid_response', message: 'Unexpected token <' }))
            : Effect.void,
        ),
    }
    return Effect.gen(function* () {
      yield* connect('linear')
      const { threadId, access } = yield* project()
      const instance = yield* Instance
      assert.strictEqual(
        yield* callTool(access, 'comment_on_issue', { issue: 'MER-231', body: 'Fixed in #12.' }),
        "The comment on MER-231 wasn't posted: Its answer was lost, so Althar can’t tell whether Linear took the comment. Look on Linear before you try again.",
      )
      const [card] = yield* cardsIn(threadId)
      assert.strictEqual(card?.state, 'failed')
      // Applied again, Linear isn't asked again: the comment stays one.
      const again = yield* (yield* IssueChanges).apply(card?.changesId ?? '', instance.personId)
      assert.strictEqual(again.state, 'failed')
      assert.match(again.issues[0]?.error ?? '', /Look on Linear before you try again\.$/)
      assert.deepStrictEqual(tracker.issueComments('MER-231'), ['Fixed in #12.'])
      assert.strictEqual(calls, 1)
    }).pipe(Effect.provide(withQueries({ linear: unreadable })))
  })

  it.live('are told to the coordinator as the person decides them', () => {
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, access } = yield* project()
      const changes = yield* IssueChanges
      const instance = yield* Instance
      const coordinator = yield* Coordinator
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'Hello.' }),
        threadId,
        body: 'Hello.',
        disposition: 'after_current',
      })
      yield* until(
        sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
        (rows) => rows.length > 0 && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
      )
      yield* callTool(access, 'change_issues', { changes: [{ issue: 'MER-231', status: 'Done' }] })
      yield* callTool(access, 'change_issues', { changes: [{ issue: 'MER-232', priority: 'low' }] })
      const [done, low] = yield* cardsIn(threadId)
      yield* changes.apply(done?.changesId ?? '', instance.personId)
      yield* changes.discard(low?.changesId ?? '', instance.personId)
      const news = (yield* coordinatorNews(threadId, projectId, yield* modelNamer)) ?? ''
      assert.include(news, '- Your change to issues is applied: MER-231: status to Done.')
      assert.include(news, '- The person discarded your change to issues: MER-232: priority to Low. Nothing changed.')
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  describe('of a task’s lead', () => {
    it.live('comment on its own issue, link its pull request, and propose a move on a card it hears the outcome of', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        const connection = yield* connect('linear')
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const { projectId, access } = yield* project()
        const { task, lead } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        assert.includeMembers(yield* listTools(lead), ['change_issue', 'comment_on_issue', 'link_pull_request', 'draft_issue'])
        const reviewer = yield* listTools({ ...lead, role: 'reviewer' })
        assert.notInclude(reviewer, 'change_issue')
        assert.notInclude(reviewer, 'comment_on_issue')

        assert.strictEqual(
          yield* callTool(lead, 'comment_on_issue', { body: 'The limiter now covers refunds.' }),
          'Commented on MER-231. The thread shows it as a line.',
        )
        assert.deepStrictEqual(tracker.issueComments('MER-231'), ['The limiter now covers refunds.'])
        // Before its pull request opens, there is nothing to link: Althar links it as it opens.
        assert.strictEqual(
          yield* callTool(lead, 'link_pull_request'),
          'This task has no pull request yet. Althar links it to MER-231 itself as it opens it.',
        )
        // Its pull request, as Althar keeps one it opened.
        const at = new Date().toISOString()
        yield* sql`INSERT INTO external_links ${sql.insert({
          id: yield* newId(Ids.externalLink),
          projectId,
          taskId: task.id,
          connectionId: connection.id,
          product: 'linear',
          kind: 'change',
          externalId: 'pr-12',
          ref: 'meridian/api#12',
          key: '#12',
          url: 'https://github.com/meridian/api/pull/12',
          snapshot: JSON.stringify({ title: 'Rate-limit refunds' }),
          createdAt: at,
          updatedAt: at,
        })}`
        assert.strictEqual(yield* callTool(lead, 'link_pull_request'), 'Linked #12 to MER-231.')
        assert.deepStrictEqual(tracker.linksOn('MER-231'), [
          { url: 'https://github.com/meridian/api/pull/12', title: '#12: Rate-limit refunds' },
        ])
        // Linking again links nothing more: the receipt is the one Althar's own link of it as it opened would have.
        yield* callTool(lead, 'link_pull_request')
        assert.lengthOf(tracker.linksOn('MER-231'), 1)

        assert.match(
          yield* callTool(lead, 'change_issue', { status: 'In Review', priority: 'medium' }),
          /^Proposed MER-231: status to In Review, priority to Medium\. Nothing changes until the person applies it/,
        )
        const cards = yield* cardsIn(task.threadId)
        assert.deepStrictEqual(
          cards.map((card) => [card.state, card.issues[0]?.changes.map((line) => line.field)]),
          [
            ['applied', ['comment']],
            ['applied', ['link']],
            ['applied', ['link']],
            ['pending', ['status', 'priority']],
          ],
        )
        // The card waits on the person: the task is in their Needs you.
        assert.strictEqual((yield* (yield* Queries).card(task.id)).phase, 'waiting')
        yield* (yield* IssueChanges).apply(cards[3]?.changesId ?? '', instance.personId)
        assert.deepStrictEqual((yield* tracker.issue('MER-231')).status.name, 'In Review')
        // The task's issue shows as it now stands, and the lead hears the person applied it.
        assert.strictEqual((yield* (yield* Issues).ofTask(task.id))?.status.name, 'In Review')
        const heard = yield* until(turns(task.threadId), (all) => all.some((turn) => turn.prompt?.includes('applied your change') === true))
        assert.include(
          heard.map((turn) => turn.prompt ?? '').join('\n'),
          'The person applied your change to the issue: MER-231: status to In Review, priority to Medium.',
        )
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('change and comment on its own issue, those its task filed, and those the person named to it; no other', () => {
      const tracker = linear()
      tracker.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
      tracker.addIssue({ ref: 'MER-240', title: 'Refund emails' })
      tracker.addIssue({ ref: 'MER-241', title: 'Someone else’s' })
      return Effect.gen(function* () {
        yield* connect('linear')
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        const { projectId, access } = yield* project()
        const { task, lead } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        // One it files, at once as the person's note says: its card is the record, and the issue is the task's to keep up to date.
        assert.match(
          yield* callTool(lead, 'draft_issue', { title: 'Refund receipts', file_now: true }),
          /^Filed the issue “Refund receipts” on Linear, in Meridian, as MER-1: /,
        )
        assert.match(yield* callTool(lead, 'change_issue', { issue: 'MER-1', priority: 'low' }), /^Proposed MER-1: priority to Low\./)
        // One the person named to it, in its thread: past any the lead's brief takes as it starts meanwhile.
        yield* sql`INSERT INTO user_inputs ${sql.insert({
          id: yield* newId(Ids.userInput),
          projectId,
          threadId: task.threadId,
          sequence: 1000,
          commandId: `cmd_${'a'.repeat(32)}`,
          disposition: 'after_current',
          body: 'While you are there, MER-240 needs the same fix.',
          authorActorId: instance.personId,
          state: 'delivered',
          acceptedAt: new Date().toISOString(),
        })}`
        assert.match(
          yield* callTool(lead, 'change_issue', { issue: 'mer-240', status: 'In Progress', at_once: true }),
          /^Done: MER-240: status to In Progress\./,
        )
        assert.strictEqual(
          yield* callTool(lead, 'comment_on_issue', { issue: 'MER-240', body: 'Fixed alongside MER-231.' }),
          'Commented on MER-240. The thread shows it as a line.',
        )
        // Any other is the coordinator's, for the person.
        assert.match(yield* callTool(lead, 'change_issue', { issue: 'MER-241', status: 'Done' }), /^MER-241 isn’t this task’s issue/)
        assert.match(yield* callTool(lead, 'comment_on_issue', { issue: 'MER-241', body: 'Hi.' }), /^MER-241 isn’t this task’s issue/)
        assert.deepStrictEqual(tracker.issueComments('MER-241'), [])
        assert.strictEqual((yield* tracker.issue('MER-241')).status.name, 'Todo')
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('have no issue to change where the task didn’t come from one', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, access } = yield* project()
        const { lead } = yield* led(projectId, access, 'Look around')
        assert.match(yield* callTool(lead, 'change_issue', { status: 'Done' }), /^This task didn’t come from an issue/)
        assert.match(yield* callTool(lead, 'comment_on_issue', { body: 'Hi.' }), /^This task didn’t come from an issue/)
        assert.lengthOf(tracker.issueChanges, 0)
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })
  })

  describe('as a task’s pull request opens and merges', () => {
    const pr = (number: number) => ({ key: `PR #${number}`, url: `https://github.com/meridian/api/pull/${number}` })

    it.live('move its issue at once, to In Review in the task’s thread and to Done in the coordinator’s, without changeIssues', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, threadId, access } = yield* project()
        const changes = yield* IssueChanges
        const { task } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        yield* changes.followPullRequest(task.id, 'opened', pr(12))
        const [review] = yield* cardsIn(task.threadId)
        assert.deepStrictEqual(
          [review?.state, review?.direct, review?.note, review?.noteUrl, review?.task, review?.issues[0]?.from, review?.issues[0]?.changes],
          [
            'applied',
            true,
            'PR #12 opened',
            'https://github.com/meridian/api/pull/12',
            'Rate-limit refunds',
            'Todo',
            [{ field: 'status', to: 'In Review' }],
          ],
        )
        assert.strictEqual((yield* tracker.issue('MER-231')).status.name, 'In Review')

        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        const [done] = yield* cardsIn(threadId)
        assert.deepStrictEqual(
          [done?.state, done?.note, done?.issues[0]?.from, done?.issues[0]?.became, done?.issues[0]?.changes],
          ['applied', 'PR #12 merged', 'In Review', 'Done', [{ field: 'close', to: null }]],
        )
        assert.deepStrictEqual((yield* tracker.issue('MER-231')).status, { name: 'Done', category: 'done' })
        // Done already, it is left alone.
        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        assert.lengthOf(yield* cardsIn(threadId), 1)
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('move nothing where the project doesn’t move issues along with its tasks', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, threadId, access } = yield* project()
        const changes = yield* IssueChanges
        const instance = yield* Instance
        const { task } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        yield* (yield* Policies).set(projectId, { moveIssues: false }, instance.personId)
        yield* changes.followPullRequest(task.id, 'opened', pr(12))
        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        assert.lengthOf(yield* cardsIn(task.threadId), 0)
        assert.lengthOf(yield* cardsIn(threadId), 0)
        assert.strictEqual((yield* tracker.issue('MER-231')).status.name, 'Todo')
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('make a card with the reason where the tracker refuses, and apply it again from there', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, threadId, access } = yield* project()
        const changes = yield* IssueChanges
        const instance = yield* Instance
        const { task } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        tracker.failNext('update', 'forbidden')
        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        const [card] = yield* cardsIn(threadId)
        assert.strictEqual(card?.state, 'failed')
        assert.match(card?.issues[0]?.error ?? '', /may not change it/)
        // Not closed: the task's start may have moved it to In Progress meanwhile, in the background.
        assert.notStrictEqual((yield* tracker.issue('MER-231')).status.category, 'done')
        yield* changes.apply(card?.changesId ?? '', instance.personId)
        assert.strictEqual((yield* tracker.issue('MER-231')).status.category, 'done')
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('comment with what landed, and leave the issue open, where the task did only part of it', () => {
      const tracker = linear()
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, threadId, access } = yield* project()
        const changes = yield* IssueChanges
        const { task } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-231')
        yield* (yield* Issues).setPart(task.id, true)
        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        assert.deepStrictEqual(tracker.issueComments('MER-231'), [
          'Part of this landed in [PR #12](https://github.com/meridian/api/pull/12), merged:\n\nRate-limit refunds',
        ])
        assert.notStrictEqual((yield* tracker.issue('MER-231')).status.category, 'done')
        assert.deepStrictEqual(
          (yield* cardsIn(threadId)).map((card) => [card.state, card.issues[0]?.changes[0]?.field]),
          [['applied', 'comment']],
        )
        // Taken back, its next merge closes it, as one the task did whole.
        yield* (yield* Issues).setPart(task.id, false)
        yield* changes.followPullRequest(task.id, 'merged', pr(13))
        assert.strictEqual((yield* tracker.issue('MER-231')).status.category, 'done')
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })

    it.live('leave an issue done or cancelled as it is', () => {
      const tracker = linear()
      tracker.addIssue({ ref: 'MER-233', title: 'Shipped', status: { name: 'Done', category: 'done' } })
      tracker.addIssue({ ref: 'MER-234', title: 'Dropped', status: { name: 'Canceled', category: 'cancelled' } })
      return Effect.gen(function* () {
        yield* connect('linear')
        const { projectId, threadId, access } = yield* project()
        const changes = yield* IssueChanges
        const { task } = yield* led(projectId, access, 'Rate-limit refunds', 'MER-233')
        yield* changes.followPullRequest(task.id, 'opened', pr(12))
        yield* changes.followPullRequest(task.id, 'merged', pr(12))
        assert.lengthOf(yield* cardsIn(task.threadId), 0)
        assert.lengthOf(yield* cardsIn(threadId), 0)
        assert.strictEqual((yield* tracker.issue('MER-233')).status.name, 'Done')
        const { task: dropped } = yield* led(projectId, access, 'Dropped work', 'MER-234')
        yield* changes.followPullRequest(dropped.id, 'merged', pr(13))
        assert.lengthOf(yield* cardsIn(threadId), 0)
        assert.strictEqual((yield* tracker.issue('MER-234')).status.name, 'Canceled')
      }).pipe(Effect.provide(withQueries({ linear: tracker })))
    })
  })
})
