import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer, withEffort } from '../src/coordinatorNews'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { IssueDrafts } from '../src/IssueDrafts'
import { Issues } from '../src/Issues'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { change, fact } from '../src/records'
import * as Runtime from '../src/Runtime'
import type { PlanStep } from '../src/Runs'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, repository, runtime, until } from './support'

/*
 * What the coordinator is told before its next turn, "since you last spoke"
 * (coordinatorNews.ts): its issue drafts as the person left them, the issues
 * its tasks came from as Althar moved them or couldn't, its plans as the
 * person changed them, and quick tasks made changes; each closed by the words
 * that fit what there was, and nothing at all where there was nothing to say.
 */

const withQueries = (services: { readonly linear?: FakeService }) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services) })))

const connect = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  return yield* connections.connectToken({ product: 'linear', token: 't', actorId: instance.personId })
})

/** A project in a repository of its own, its coordinator's thread, and the coordinator as its tools see it. */
const project = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const projectId = opened.projectId as ProjectId
  const threadId = yield* coordinator.thread(projectId)
  const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
  return { projectId, threadId, access }
})

/** The coordinator speaks, and its turn is over: what it hears next is what came after. */
const spoken = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const coordinator = yield* Coordinator
    const deliveries = sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`
    const before = (yield* deliveries).length
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Hello.', disposition: 'after_current' })
    yield* until(deliveries, (rows) => rows.length > before && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'))
  })

/** What the coordinator would be told now. */
const news = (threadId: string, projectId: string) => Effect.flatMap(modelNamer, (named) => coordinatorNews(threadId, projectId, named))

/** A task drafted in the project, waiting on nothing. */
const drafted = (projectId: string, title: string, issueKey?: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      draft: true,
      ...(issueKey === undefined ? {} : { issueKey }),
    })
  })

const MERIDIAN = { id: 'team-1', key: 'MER', name: 'Meridian' }

const linearWith = (...teams: ReadonlyArray<{ readonly id: string; readonly key: string; readonly name: string }>) => {
  const linear = makeFakeService({ product: 'linear' })
  for (const team of teams) linear.addContainer(team)
  return linear
}

describe('what the coordinator hears since it last spoke', () => {
  it.live('names a step’s model as its agent offers it, or by its id where no agent does, with its effort where it has one', () =>
    Effect.gen(function* () {
      const named = yield* modelNamer
      const step = (agentId: string, model: string | null, effort?: string): PlanStep => ({
        key: 'implement',
        agentId,
        model,
        skipped: false,
        ...(effort === undefined ? {} : { effort }),
      })
      assert.strictEqual(named(step('codex', null)), "Fake codex's default model")
      // An agent no longer offered: its id, and the model as the plan has it.
      assert.strictEqual(named(step('retired-agent', null)), "retired-agent's default model")
      assert.strictEqual(named(step('retired-agent', 'large')), 'large')
      // As a plan is told to a coordinator taking it over: its effort where it has one.
      assert.strictEqual(withEffort(named)(step('codex', null, 'high')), "Fake codex's default model (effort high)")
      assert.strictEqual(withEffort(named)(step('retired-agent', 'large')), 'large')
    }).pipe(Effect.provide(withQueries({}))),
  )

  it.live('of its drafts: not those it changed itself, nor a lead’s; one the person couldn’t file, as it now stands', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect
      const sql = yield* SqlClient.SqlClient
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const { projectId, threadId, access } = yield* project
      yield* spoken(threadId)
      const draftOf = (title: string) =>
        Effect.gen(function* () {
          assert.match(yield* callTool(access, 'draft_issue', { title }), /^Drafted the issue /)
          const [row] = yield* sql<{ id: string }>`SELECT id FROM issue_drafts WHERE title = ${title}`
          return row?.id ?? assert.fail(`no draft ${title}`)
        })

      // Changed by the coordinator itself, it is as it drafted it: nothing to tell.
      yield* drafts.change(yield* draftOf('Flaky test'), { title: 'Flaky checkout test', body: '', labels: [] }, instance.coordinatorId)
      // A lead's draft, in its task's thread, discarded: the lead hears of it, not the coordinator.
      const task = yield* drafted(projectId, 'Add a retry')
      const leads = yield* drafts.draft({
        projectId,
        threadId: task.threadId,
        title: 'Checkout logs no request ids',
        body: '',
        labels: [],
        taskId: task.taskId,
        actorId: instance.systemId,
      })
      yield* drafts.discard(leads.draftId, instance.personId)
      assert.isNull(yield* news(threadId, projectId))

      // Filing one of its own fails: that it hears, and nothing of the others.
      const refused = yield* draftOf('Retry webhooks')
      linear.failNext('create', 'rejected')
      assert.strictEqual((yield* drafts.file(refused, instance.personId)).state, 'failed')
      assert.strictEqual(
        yield* news(threadId, projectId),
        [
          'Since you last spoke, in Althar:',
          '- The issue “Retry webhooks” couldn’t be filed on Linear: The fake create failed (rejected) The person can file it again from its card.',
          'Speak of these issues as they are now, not as you drafted them.',
        ].join('\n'),
      )
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('of the issues its tasks came from: moved to In Progress, left as someone had them, or not moved, and why', () => {
    const linear = makeFakeService({ product: 'linear' })
    linear.addIssue({ ref: 'MER-1', title: 'Rate-limit refunds' })
    linear.addIssue({ ref: 'MER-2', title: 'Log request ids', status: { name: 'In Review', category: 'started' } })
    linear.addIssue({ ref: 'MER-3', title: 'Retry webhooks' })
    linear.addIssue({ ref: 'MER-4', title: 'Tidy the logs' })
    linear.addIssue({ ref: 'MER-5', title: 'Bump the SDK' })
    linear.addIssue({ ref: 'MER-6', title: 'Spike the cache' })
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const issues = yield* Issues
      const instance = yield* Instance
      const connection = yield* connect
      const { projectId, threadId } = yield* project
      yield* spoken(threadId)
      const fromIssue = (title: string, key: string) =>
        Effect.gen(function* () {
          const task = yield* drafted(projectId, title, key)
          yield* issues.attach({ projectId, taskId: task.taskId, issue: key })
          const [link] = yield* sql<{ id: string }>`SELECT id FROM external_links WHERE task_id = ${task.taskId} AND kind = 'issue'`
          return { ...task, linkId: link?.id ?? assert.fail(`no link to ${key}`) }
        })
      /** Its task starts, and Althar moves its issue, or doesn't: once that is on the record. */
      const startedOnce = (taskId: string) =>
        Effect.gen(function* () {
          yield* issues.started(taskId)
          yield* until(
            sql<{ type: string }>`
              SELECT e.type FROM record_events e JOIN external_links x ON x.id = e.aggregate_id
              WHERE x.task_id = ${taskId} AND e.type IN ('external_link.issue_started', 'external_link.issue_start_failed')`,
            (rows) => rows.length > 0,
          )
        })
      const moved = yield* fromIssue('Rate-limit refunds', 'MER-1')
      const left = yield* fromIssue('Log request ids', 'MER-2')
      const refused = yield* fromIssue('Retry webhooks', 'MER-3')
      const gone = yield* fromIssue('Tidy the logs', 'MER-4')
      const unnamed = yield* fromIssue('Bump the SDK', 'MER-5')
      const unsaid = yield* fromIssue('Spike the cache', 'MER-6')

      yield* startedOnce(moved.taskId)
      // Someone had started it: left as it was, and nothing to tell.
      yield* startedOnce(left.taskId)
      linear.failNext('start', 'forbidden')
      yield* startedOnce(refused.taskId)
      // Linear removed meanwhile: Althar can't ask it.
      yield* (yield* Connections).remove(connection.id, instance.personId)
      yield* startedOnce(gone.taskId)
      // As a record kept without the status it moved to, or its key or reason, has them.
      const recorded = (link: string, type: string, payload: unknown) =>
        Effect.gen(function* () {
          const revision = yield* change('external_links', link, { updatedAt: new Date().toISOString() })
          yield* fact({ projectId, aggregateType: 'external_link', aggregateId: link, revision, type, payload, actorId: instance.systemId })
        })
      yield* recorded(unnamed.linkId, 'external_link.issue_started', { moved: true })
      yield* recorded(unsaid.linkId, 'external_link.issue_start_failed', {})

      assert.strictEqual(
        yield* news(threadId, projectId),
        [
          'Since you last spoke, in Althar:',
          `- ${moved.slug} (Rate-limit refunds): as it started, Althar moved its issue MER-1 to In Progress on Linear. Don’t ask the person to.`,
          `- ${refused.slug} (Retry webhooks): Althar couldn’t move its issue MER-3 to In Progress on Linear: The fake start failed (forbidden). It is as it was; the person can move it themselves.`,
          `- ${gone.slug} (Tidy the logs): Althar couldn’t move its issue MER-4 to In Progress on Linear: something went wrong. It is as it was; the person can move it themselves.`,
          `- ${unnamed.slug} (Bump the SDK): as it started, Althar moved its issue  to In Progress on Linear. Don’t ask the person to.`,
          `- ${unsaid.slug} (Spike the cache): Althar couldn’t move its issue  to In Progress on Linear: . It is as it was; the person can move it themselves.`,
          'Speak of these issues as they are now.',
        ].join('\n'),
      )
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live('says nothing where only its own plan changed; with the person’s change and a draft, speaks of plans and issues both', () => {
    const linear = linearWith(MERIDIAN)
    return Effect.gen(function* () {
      yield* connect
      const plans = yield* Plans
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const { projectId, threadId, access } = yield* project
      yield* spoken(threadId)
      const propose = (taskId: string, startsIn?: Duration.Duration) =>
        plans.propose({
          projectId,
          taskId,
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          reason: null,
          actorId: instance.coordinatorId,
          ...(startsIn === undefined ? { held: true } : { startsIn }),
        })
      const codex: ReadonlyArray<PlanStep> = [{ key: 'implement', agentId: 'codex', model: null, skipped: false }]

      // Counting down, changed by the coordinator alone: something happened, but nothing to tell.
      const quiet = yield* propose((yield* drafted(projectId, 'Quiet one')).taskId, Duration.minutes(5))
      yield* plans.change(quiet, codex, instance.coordinatorId)
      assert.isNull(yield* news(threadId, projectId))

      // The person changes one it proposed, which waits on them, and discards one of its drafts.
      const retry = yield* drafted(projectId, 'Retry the checkout call')
      yield* plans.change(yield* propose(retry.taskId), codex, instance.personId)
      yield* callTool(access, 'draft_issue', { title: 'Rename the env var' })
      const sql = yield* SqlClient.SqlClient
      const [draft] = yield* sql<{ id: string }>`SELECT id FROM issue_drafts WHERE title = 'Rename the env var'`
      yield* drafts.discard(draft?.id ?? '', instance.personId)

      assert.strictEqual(
        yield* news(threadId, projectId),
        [
          'Since you last spoke, in Althar:',
          `- ${retry.slug} (Retry the checkout call): The person changed its plan: you proposed Fake claude-code's default model leads, no review. Now Fake codex's default model leads, no review. The person is holding it: it waits until they start it.`,
          '- The person discarded the issue “Rename the env var”: nothing was filed.',
          'Speak of these plans and issues as they are now, not as you proposed or drafted them.',
        ].join('\n'),
      )
    }).pipe(Effect.provide(withQueries({ linear })))
  })

  it.live(
    'of a quick task its lead made a change under the same title, with no review and no host: in a line, with nothing to close on',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const queries = yield* Queries
        const { projectId, threadId, access } = yield* project
        yield* spoken(threadId)
        const title = 'Which partners still call v1?'
        assert.match(
          yield* callTool(access, 'start_task', { title, description: 'Look, and say. [lead:finish]', lead: { agent: 'claude-code' } }),
          /^Started /,
        )
        const [task] = yield* sql<{ id: string; slug: string; threadId: string }>`
        SELECT k.id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.project_id = ${projectId} AND k.title = ${title}`
        if (task === undefined) return assert.fail('no task')
        yield* until(
          Effect.map(queries.card(task.id), (card) => [card]),
          ([card]) => card?.phase === 'ready',
        )
        // It has heard of the task starting; speaking again, it has nothing new.
        yield* spoken(threadId)
        assert.isNull(yield* news(threadId, projectId))

        const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`
        const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: session?.id ?? '', taskId: task.id }
        assert.match(yield* callTool(lead, 'make_it_a_change', { title, review: null, output: 'draft' }), /^The task is a change now/)
        assert.strictEqual(
          yield* news(threadId, projectId),
          [
            'Since you last spoke, in Althar:',
            `- ${task.slug} (${title}): the person asked its lead to make this quick task a change, and it is one now: no review, and it ends on its branch, with nothing sent to the host.`,
          ].join('\n'),
        )
      }).pipe(Effect.provide(withQueries({}))),
  )
})

describe('drafting an issue for the coordinator to hear of', () => {
  it.live('takes a blank tracker or place as none named, lists twenty places and how many more, and files nothing twice', () => {
    const teams = Array.from({ length: 21 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0')
      return { id: `team-${number}`, key: `T${number}`, name: `Team ${number}` }
    })
    const linear = linearWith(...teams)
    return Effect.gen(function* () {
      yield* connect
      const sql = yield* SqlClient.SqlClient
      const drafts = yield* IssueDrafts
      const instance = yield* Instance
      const { projectId, access } = yield* project
      const places = teams
        .slice(0, 20)
        .map((team) => `${team.key} (${team.name})`)
        .join(', ')
      assert.strictEqual(
        yield* callTool(access, 'draft_issue', { title: 'Refunds skip the limiter', tracker: ' ', container: '  ' }),
        `Say where on Linear it goes, as container: ${places}, and 1 more.`,
      )
      assert.match(
        yield* callTool(access, 'draft_issue', { title: 'Refunds skip the limiter', container: 'T21' }),
        /^Drafted the issue “Refunds skip the limiter” on Linear, in Team 21\./,
      )
      const [row] = yield* sql<{ id: string }>`SELECT id FROM issue_drafts WHERE project_id = ${projectId}`
      const draftId = row?.id ?? assert.fail('no draft')
      // Pressed again while the tracker is still being asked: its card as it stands, and nothing filed twice.
      yield* sql`UPDATE issue_drafts SET state = 'filing' WHERE id = ${draftId}`
      const card = yield* drafts.file(draftId, instance.personId)
      assert.deepInclude(card, { state: 'filing', issue: null })
      assert.lengthOf(linear.created, 0)
      // A draft that isn't there isn't filed.
      assert.instanceOf(yield* Effect.flip(drafts.file('idr_none', instance.personId)), NotFound)
    }).pipe(Effect.provide(withQueries({ linear })))
  })
})
