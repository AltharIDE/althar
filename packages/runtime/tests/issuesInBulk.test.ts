import { changeTable, findTable } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { IssueChanges } from '../src/IssueChanges'
import { Instance } from '../src/Instance'
import { Issues } from '../src/Issues'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, listTools, repository, runtime, toolsOf, until } from './support'

/*
 * Issues worked through in bulk (docs/architecture/06, "What leads do with
 * issues"): a lead and a reviewer find them by any filter, a page at a time;
 * a lead reads several in one call, and changes and comments on several,
 * each issue said on its own. A tracker without a filter's field isn't
 * searched by it, and says so.
 */

type Services = { readonly linear?: FakeService; readonly trello?: FakeService }

const withQueries = (services: Services) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services) })))

/** A Linear team of 200 issues, newest last: every tenth a bug in Q4 launch, every twentieth of those done. */
const backlog = () => {
  const service = makeFakeService({ product: 'linear' })
  service.addContainer({ id: 'team-1', key: 'MER', name: 'Meridian' })
  for (let number = 1; number <= 200; number += 1)
    service.addIssue({
      ref: `MER-${number}`,
      title: `Issue ${number}`,
      assigned: false,
      ...(number % 20 === 0 ? { status: { name: 'Done', category: 'done' } } : {}),
      with:
        number % 10 === 0
          ? { labels: ['bug'], project: { id: 'project-q4', name: 'Q4 launch' } }
          : { project: { id: 'project-payments', name: 'Payments v2' } },
    })
  return service
}

const connect = (product: 'linear' | 'trello') =>
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
    return { projectId: opened.projectId as ProjectId, access }
  })

/** A task started with a lead at work, and the lead's tools as it is given them. */
const led = (projectId: ProjectId, access: ToolAccess) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    assert.match(
      yield* callTool(access, 'start_task', { title: 'Triage', description: 'Wait.', lead: { agent: 'claude-code' } }),
      /^Started /,
    )
    const [task] = yield* sql<{ id: string; threadId: string }>`
      SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.title = 'Triage'`
    if (task === undefined) return assert.fail('no task')
    yield* until(
      sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${task.threadId}`,
      (rows) => (rows[0]?.n ?? 0) > 0,
    )
    const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'lead-session', taskId: task.id }
    return { task, lead }
  })

/** What the person says in a task's thread. */
const say = (projectId: ProjectId, threadId: string, body: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    yield* sql`INSERT INTO user_inputs ${sql.insert({
      id: yield* newId(Ids.userInput),
      projectId,
      threadId,
      sequence: 1000,
      commandId: `cmd_${'b'.repeat(32)}`,
      disposition: 'after_current',
      body,
      authorActorId: instance.personId,
      state: 'delivered',
      acceptedAt: new Date().toISOString(),
    })}`
  })

/** The keys a find_issues answer lists, and the cursor it ends with, if any. */
const listed = (said: string) => ({
  keys: said.split('\n').flatMap((line) => /^- (\S+):/.exec(line)?.[1] ?? []),
  cursor: /cursor "([^"]+)"/.exec(said)?.[1],
})

describe('issues in bulk', () => {
  it.live('a lead finds them by label and project, pages through 200, reads 20 at once, and moves 15 at once', () => {
    const tracker = backlog()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const { task, lead } = yield* led(projectId, access)
      const tools = yield* listTools(lead)
      assert.includeMembers(tools, ['find_issues', 'read_issue', 'change_issue', 'comment_on_issue'])

      // Every open issue labelled bug in Q4 launch: every tenth, less the done ones.
      const bugs = listed(yield* callTool(lead, 'find_issues', { labels: ['bug'], project: 'Q4 launch', limit: 100 }))
      assert.lengthOf(bugs.keys, 10)
      assert.isTrue(bugs.keys.every((key) => Number(key.slice(4)) % 10 === 0 && Number(key.slice(4)) % 20 !== 0))
      assert.isUndefined(bugs.cursor)
      assert.match(yield* callTool(lead, 'find_issues', { labels: ['bug'], project: 'Q4 launch' }), / · unassigned · bug/)

      // The whole backlog, a page at a time, each once, newest change first, and no cursor on the last.
      const seen: Array<string> = []
      let cursor: string | undefined
      let pages = 0
      do {
        const page = listed(yield* callTool(lead, 'find_issues', { state: 'all', limit: 50, ...(cursor === undefined ? {} : { cursor }) }))
        seen.push(...page.keys)
        cursor = page.cursor
        pages += 1
      } while (cursor !== undefined && pages < 10)
      assert.strictEqual(pages, 4)
      assert.lengthOf(seen, 200)
      assert.lengthOf(new Set(seen), 200)
      assert.strictEqual(seen[0], 'MER-200')
      assert.match(yield* callTool(lead, 'find_issues', { cursor: 'not-one' }), /That cursor isn’t one find_issues gave/)

      // Twenty in one call, without their comments; one with them.
      const read = yield* callTool(lead, 'read_issue', { issues: ['MER-1..MER-20'] })
      assert.lengthOf(read.split('\n\n---\n\n'), 20)
      assert.notInclude(read, 'No comments.')
      assert.include(yield* callTool(lead, 'read_issue', { issue: 'MER-1' }), 'No comments.')
      assert.match(yield* callTool(lead, 'read_issue', { issues: ['MER-1..MER-30'] }), /read at most 25 at once/)
      // One no tracker has says so among the others.
      assert.include(yield* callTool(lead, 'read_issue', { issues: ['MER-1', 'MER-999'] }), 'Althar can’t read MER-999')

      // Fifteen the person named, as a run of keys, moved at once; one they didn't waits on a card for them, and is said.
      yield* say(projectId, task.threadId, 'Move MER-1..MER-15 to In Review.')
      const moved = yield* callTool(lead, 'change_issue', { issues: ['MER-1..MER-15', 'MER-16'], status: 'In Review', at_once: true })
      assert.match(moved, /^Done: MER-1: status to In Review; MER-2: status to In Review;/)
      assert.include(
        moved,
        'MER-16 isn’t this task’s issue, one it filed, or one the person named to it, so it waits on a card for the person',
      )
      assert.include(moved, 'Proposed MER-16: status to In Review.')
      for (let number = 1; number <= 15; number += 1) assert.strictEqual((yield* tracker.issue(`MER-${number}`)).status.name, 'In Review')
      assert.strictEqual((yield* tracker.issue('MER-16')).status.name, 'Todo')
      // Without at_once, one card for all of them waits on the person.
      assert.match(
        yield* callTool(lead, 'change_issue', { issues: ['MER-1..MER-3'], priority: 'low' }),
        /^Proposed MER-1: priority to Low;/,
      )
      assert.strictEqual((yield* tracker.issue('MER-1')).priority?.level, 'high')
      // Each its own change, and what is so already said for it.
      const each = yield* callTool(lead, 'change_issue', {
        changes: [
          { issue: 'MER-4', status: 'Done' },
          { issue: 'MER-5', status: 'In Review' },
        ],
        at_once: true,
      })
      assert.match(each, /^Done: MER-4: status to Done\./)
      assert.include(each, 'Already so: MER-5: status In Review.')

      // The same comment on several, each said.
      const commented = yield* callTool(lead, 'comment_on_issue', { issues: ['MER-6', 'MER-7', 'MER-17'], body: 'Seen in triage.' })
      assert.include(commented, 'Commented on MER-6, MER-7.')
      assert.include(commented, 'MER-17 isn’t this task’s issue')
      assert.include(commented, 'The comment on MER-17 waits on its card in this thread until the person posts it')
      assert.deepStrictEqual(tracker.issueComments('MER-6'), ['Seen in triage.'])
      assert.deepStrictEqual(tracker.issueComments('MER-17'), [])
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  it.live('a lead moves the issues it found, none named to it, on one card the person applies, never at once', () => {
    const tracker = backlog()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const { task, lead } = yield* led(projectId, access)
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      yield* say(projectId, task.threadId, 'Find the open bugs in Q4 launch and move them to In Review.')
      const bugs = listed(yield* callTool(lead, 'find_issues', { labels: ['bug'], project: 'Q4 launch', limit: 100 })).keys
      assert.lengthOf(bugs, 10)
      // Asked at once, and none of them the lead's: all on one card for the person, nothing changed yet.
      const moved = yield* callTool(lead, 'change_issue', { issues: bugs, status: 'In Review', at_once: true })
      assert.match(moved, /^MER-\d+, .+ aren’t this task’s issue, one it filed, or one the person named to it, so they wait on a card/)
      assert.include(moved, 'Nothing changes until the person applies it')
      for (const key of bugs) assert.strictEqual((yield* tracker.issue(key)).status.name, 'Todo')
      const cards = yield* sql<{ id: string; direct: number; state: string; note: string | null }>`
        SELECT id, direct, state, note FROM issue_changes WHERE thread_id = ${task.threadId}`
      assert.lengthOf(cards, 1)
      assert.deepStrictEqual([cards[0]?.direct, cards[0]?.note], [0, 'Not this task’s issues: its lead asks you to apply these.'])
      // The person applies it: every one moves, each said.
      const applied = yield* (yield* IssueChanges).apply(cards[0]?.id ?? '', instance.personId)
      assert.strictEqual(applied.state, 'applied')
      assert.lengthOf(applied.issues, 10)
      for (const key of bugs) assert.strictEqual((yield* tracker.issue(key)).status.name, 'In Review')
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })

  it.live('a tracker without a filter’s field isn’t searched by it, and says so; each tool says what each tracker can', () => {
    const linear = backlog()
    const trello = makeFakeService({ product: 'trello' })
    trello.addIssue({ ref: 'Card0001', title: 'A card', assigned: false, with: { labels: ['bug'] } })
    return Effect.gen(function* () {
      yield* connect('linear')
      yield* connect('trello')
      const { projectId, access } = yield* project()
      const { lead } = yield* led(projectId, access)
      // Trello's cards have no priority: Linear's are found, Trello isn't searched.
      const urgent = yield* callTool(lead, 'find_issues', { priority: ['high'], limit: 3 })
      assert.lengthOf(listed(urgent).keys, 3)
      assert.include(urgent, 'Trello wasn’t searched: it can’t find issues by priority.')
      // By label, both are.
      const labelled = listed(yield* callTool(lead, 'find_issues', { labels: ['bug'], tracker: 'Trello' })).keys
      assert.deepStrictEqual(labelled, ['Card0001'])
      // Each tool says what each tracker can, in the table the trackers' capabilities make.
      const described = new Map((yield* toolsOf(lead)).map((tool) => [tool.name, tool.description]))
      assert.include(findTable(), '| priority | yes | yes | no | no | no |')
      assert.include(described.get('find_issues'), findTable())
      assert.include(changeTable(), '| assignees | one | one | several | several | several |')
      assert.include(described.get('change_issue'), changeTable())
    }).pipe(Effect.provide(withQueries({ linear, trello })))
  })

  it.live('a reviewer finds and reads issues, and changes none', () => {
    const tracker = backlog()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, access } = yield* project()
      const { lead } = yield* led(projectId, access)
      const reviewer: ToolAccess = { ...lead, role: 'reviewer' }
      const tools = yield* listTools(reviewer)
      assert.includeMembers(tools, ['find_issues', 'read_issue'])
      assert.notInclude(tools, 'change_issue')
      assert.notInclude(tools, 'comment_on_issue')
      assert.match(yield* callTool(reviewer, 'find_issues', { keys: 'MER-3, MER-1' }), /^- MER-3: [^\n]+\n- MER-1:/)
      const found = yield* (yield* Issues).find(projectId, { keys: ['MER-1..MER-3'], status: ['Todo'] })
      assert.deepStrictEqual(
        found.issues.map((issue) => issue.key),
        ['MER-1', 'MER-2', 'MER-3'],
      )
    }).pipe(Effect.provide(withQueries({ linear: tracker })))
  })
})
