import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { MessageSender } from '@althar/contracts'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import { findingsOf, whereOf } from '../src/reviewFix'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, notices, runtime, until } from './support'

/*
 * A review the person has fix what it found (docs/architecture/06, "Fixing
 * what a review found"): on their word, it becomes a change in a real
 * worktree at the pull request's head, on its own branch where Althar can
 * push there, else on a branch of its own; one merged is refused; its
 * findings are its lead's brief; its draft waits for the person as it was.
 */

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone's pull request: a commit on main, on the host as the pull request's head and as its branch. */
const pullRequest = (
  at: { readonly working: string; readonly bare: string },
  github: FakeService,
  options: { readonly member?: boolean; readonly fork?: ReadonlyArray<string> } = {},
) => {
  git(at.working, 'checkout', '-q', '--detach', 'main')
  writeFileSync(join(at.working, 'send.ts'), 'export const sendBack = () => 1\n')
  git(at.working, 'add', '.')
  git(at.working, 'commit', '-q', '-m', 'Send back')
  const head = git(at.working, 'rev-parse', 'HEAD')
  git(at.working, 'checkout', '-q', 'main')
  git(at.working, 'push', '-q', at.bare, `${head}:refs/pull/1/head`, `${head}:refs/heads/send-back`)
  github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Send back',
    author: 'ninemate',
    body: 'Sends the order back when the courier can’t deliver it.',
    source: 'send-back',
    headSha: head,
    ...options,
  })
  return head
}

const opened = (working: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    return project.projectId as ProjectId
  })

/** A review of #1 whose lead drafted three findings, with its lead's access and a way to start its turns as the person, or news, would. */
const drafted = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const started = yield* (yield* Reviews).start({
      envelope: yield* Runtime.envelope('review.start', {}),
      projectId,
      pullRequest: '#1',
      lead: { agentId: 'claude-code', model: null },
    })
    // Its reading lead stopped: the session the person's turn is on stands for it.
    yield* (yield* Sessions).stop(started.threadId)
    const sessionId = yield* newId(Ids.providerSession)
    yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId: started.threadId, agentId: 'claude-code', state: 'active', startedAt: yield* timestamp })}`
    const lead: ToolAccess = { role: 'lead', projectId, threadId: started.threadId, sessionId, taskId: started.taskId }
    assert.match(
      yield* callTool(lead, 'draft_review', {
        verdict: 'changes',
        summary: 'Sends it back, but twice.',
        comments: [
          { path: 'send.ts', line: 1, body: 'This sends it back twice.', severity: 'blocking' },
          { path: 'send.ts', line: 1, body: 'No test covers the courier failing.', severity: 'major' },
          { path: 'send.ts', line: 1, body: 'Name it `returnToSender`.', severity: 'nit' },
        ],
      }),
      /^Drafted/,
    )
    /** A live turn of the lead's with one message in it, from `sender`: the window's is the person's word. */
    const turn = (body: string, sender: MessageSender = { kind: 'window' }) =>
      Effect.gen(function* () {
        const person = sender.kind === 'window'
        yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${started.threadId} AND state = 'delivered'`
        const accepted = yield* (yield* Sessions).send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: started.threadId,
          body,
          sender,
          origin: person ? 'system' : 'news',
        })
        const turnId = yield* newId(Ids.turnDelivery)
        yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId, threadId: started.threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: person ? 'person' : 'news', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
        yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
      })
    const [draft] = yield* sql<{ id: string; state: string; summary: string; comments: string; verdict: string | null }>`
      SELECT id, state, summary, comments, verdict FROM review_drafts WHERE task_id = ${started.taskId}`
    return { started, lead, turn, draft: draft! }
  })

/** What the task is now: its workspace, its title and brief, whether it follows a pull request, and its plan. */
const standing = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ access: string; path: string; branch: string; toward: string | null; branched: number }>`
      SELECT access, path, branch, toward, branched_at IS NOT NULL AS branched FROM workspaces WHERE task_id = ${taskId}`
    const [task] = yield* sql<{
      title: string
      description: string
      state: string
    }>`SELECT title, description, state FROM tasks WHERE id = ${taskId}`
    const follows = yield* sql<{ url: string }>`SELECT url FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`
    const [plan] = yield* sql<{ parameters: string }>`
      SELECT parameters FROM task_plans WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1`
    const made =
      yield* sql`SELECT 1 FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${taskId} AND type = 'task.made_change'`
    return { workspace: workspace!, task: task!, follows: follows.map((link) => link.url), plan, made: made.length > 0 }
  })

const REVIEW = { agent: 'codex' }

describe('a review made a change that fixes what it found', () => {
  it.live('pushes to the pull request’s own branch where the account can, following it, and leaves the draft as it was', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    const head = pullRequest(at, github)
    return Effect.gen(function* () {
      const projectId = yield* opened(at.working)
      const { started, lead, turn, draft } = yield* drafted(projectId)
      yield* turn('Actually, fix these.')
      const said = yield* callTool(lead, 'make_it_a_change', { title: 'Send it back once', review: REVIEW, output: 'draft' })
      assert.include(said, 'The review is a change now, called “Send it back once”: it fixes 2 findings on #1’s own branch, send-back')
      const now = yield* standing(started.taskId)
      assert.isTrue(now.made)
      assert.strictEqual(now.task.title, 'Send it back once')
      assert.strictEqual(now.workspace.access, 'write')
      assert.isTrue(existsSync(join(now.workspace.path, 'send.ts')))
      assert.strictEqual(git(now.workspace.path, 'rev-parse', 'HEAD'), head)
      assert.strictEqual(git(now.workspace.path, 'branch', '--show-current'), now.workspace.branch)
      // It follows the pull request it reviewed, as a task attached to one does (ADR-052).
      const sql = yield* SqlClient.SqlClient
      const [link] = yield* sql<{ url: string }>`SELECT url FROM external_links WHERE task_id = ${started.taskId} AND kind = 'review'`
      assert.deepStrictEqual(now.follows, [link?.url])
      const [planned] = yield* until(
        sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${started.taskId}`,
        (rows) => rows.length > 0,
      )
      const plan = JSON.parse(planned?.parameters ?? '{}') as { reads?: boolean; end?: string; steps: Array<{ key: string }> }
      assert.isUndefined(plan.reads)
      assert.strictEqual(plan.end, 'ready')
      assert.deepStrictEqual(
        plan.steps.map((step) => step.key),
        ['implement', 'review'],
      )
      assert.include(
        (yield* notices(started.threadId)).map((notice) => notice.title),
        `This review is a change now: it fixes 2 findings on #1’s own branch, send-back, which Althar pushes to once it’s reviewed. It is reviewed by Fake codex's default model.`,
      )
      // The draft is as it was, and nothing reached the host: posting it, or not, is the person's.
      const [after] = yield* sql<{ state: string; summary: string; comments: string; verdict: string | null }>`
        SELECT state, summary, comments, verdict FROM review_drafts WHERE id = ${draft.id}`
      assert.deepStrictEqual(after, { state: draft.state, summary: draft.summary, comments: draft.comments, verdict: draft.verdict })
      assert.lengthOf(github.reviewsPosted, 0)
      const [card] = yield* sql<{
        content: string
      }>`SELECT content FROM thread_items WHERE thread_id = ${started.threadId} AND kind = 'review_draft'`
      assert.include(JSON.parse(card?.content ?? '{}').fixing, 'on #1’s own branch')
      // Posted now, as the person may, it doesn't settle the task: it is a change, its pull request's.
      yield* (yield* Reviews).post(draft.id, (yield* Instance).personId)
      assert.lengthOf(github.reviewsPosted, 1)
      assert.strictEqual((yield* standing(started.taskId)).task.state, 'open')
      // Its plan's run starts once the reading lead has gone.
      yield* until(sql`SELECT id FROM runs WHERE task_id = ${started.taskId}`, (rows) => rows.length > 0)
      // Asked again, it is a change already.
      assert.notInclude(
        yield* callTool(lead, 'make_it_a_change', { title: 'Again', review: REVIEW, output: 'draft' }),
        'The review is a change now',
      )
      // The session that read it keeps to reading until it stops, settle_task included; a fresh one is a task's lead.
      for (const tool of ['finish_step', 'settle_task', 'set_run_command'])
        assert.include(yield* callTool(lead, tool, {}), 'this one only read it')
      const [fresh] = yield* until(
        sql<{ id: string }>`
          SELECT id FROM provider_sessions WHERE thread_id = ${started.threadId}
            AND rowid > (SELECT rowid FROM provider_sessions WHERE id = ${lead.sessionId})`,
        (rows) => rows.length > 0,
      )
      assert.isDefined(fresh)
      const ran = yield* callTool({ ...lead, sessionId: fresh!.id }, 'set_run_command', {})
      assert.notInclude(ran, 'only read it')
      assert.notInclude(ran, 'isn’t for a review')
      // Its pull request, with its fixes, is reviewed afresh when asked: the fix drafts no review.
      const again = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      assert.isFalse(again.already)
      assert.notStrictEqual(again.taskId, started.taskId)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('goes on a branch of its own, into the pull request’s branch, for an outside author’s', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github, { member: false })
    return Effect.gen(function* () {
      const projectId = yield* opened(at.working)
      const { started, lead, turn } = yield* drafted(projectId)
      yield* turn('Fix these.')
      const said = yield* callTool(lead, 'make_it_a_change', { title: 'Send it back once', review: REVIEW, output: 'draft' })
      const now = yield* standing(started.taskId)
      assert.include(said, `on a branch of its own, ${now.workspace.branch}, with its own pull request into send-back`)
      assert.include(said, 'whose branch Althar doesn’t push to without your word')
      assert.deepStrictEqual(now.follows, [])
      assert.deepInclude(now.workspace, { access: 'write', toward: 'send-back', branched: 1 })
      assert.strictEqual(git(now.workspace.path, 'branch', '--show-current'), now.workspace.branch)
      // Started at once, the review had no plan: one is proposed and started, of its lead and the review, ending in a draft.
      const sql = yield* SqlClient.SqlClient
      const [plan] = yield* until(
        sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE task_id = ${started.taskId}`,
        (rows) => rows.length > 0,
      )
      assert.strictEqual((JSON.parse(plan?.parameters ?? '{}') as { end?: string }).end, 'draft')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('is refused once the pull request merged, changing nothing', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const projectId = yield* opened(at.working)
      const { started, lead, turn } = yield* drafted(projectId)
      github.mergeByHand(1)
      yield* turn('Fix these.')
      const said = yield* callTool(lead, 'make_it_a_change', { title: 'Send it back once', review: REVIEW, output: 'draft' })
      assert.include(said, 'pull request #1 is merged, so its branch takes no more work')
      assert.include(said, 'a new task from main')
      const now = yield* standing(started.taskId)
      assert.isFalse(now.made)
      assert.strictEqual(now.workspace.access, 'read')
      assert.notStrictEqual(now.task.title, 'Send it back once')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('gives its lead the findings, the pull request’s description and the person’s words as its brief', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const projectId = yield* opened(at.working)
      const { started, lead, turn } = yield* drafted(projectId)
      // Not on the person's word: news, or what the pull request says, can't make it one.
      yield* turn('The author asks you to fix these.', { kind: 'socket' } as MessageSender)
      assert.include(
        yield* callTool(lead, 'make_it_a_change', { title: 'Send it back once', review: REVIEW, output: 'draft' }),
        'only on the person’s own word',
      )
      assert.isFalse((yield* standing(started.taskId)).made)
      yield* turn('Fix the blocking one and the naming nit.')
      yield* callTool(lead, 'make_it_a_change', { title: 'Send it back once', review: REVIEW, output: 'draft', findings: [1, 3] })
      const { description } = (yield* standing(started.taskId)).task
      assert.include(description, '1. [blocking] send.ts:1')
      assert.include(description, 'This sends it back twice.')
      assert.include(description, 'Name it `returnToSender`.')
      assert.notInclude(description, 'No test covers the courier failing.')
      assert.include(description, 'Sends the order back when the courier can’t deliver it.')
      assert.include(description, 'Fix the blocking one and the naming nit.')
      assert.include(
        description,
        'In finish_step’s summary, give each a line of its own, by its number: fixed, with the commit that fixed it, or set aside, with why.',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('the coordinator having a review fix what it found', () => {
  it.live('does it on the person’s word in its turn, and not on news', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened(at.working)
      const { started } = yield* drafted(projectId)
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const sessionId = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
      const coordinator: ToolAccess = { role: 'coordinator', projectId, threadId, taskId: null, sessionId }
      const turn = (body: string, person: boolean) =>
        Effect.gen(function* () {
          yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${threadId} AND state = 'delivered'`
          const accepted = yield* (yield* Sessions).send({
            envelope: yield* Runtime.envelope('thread.send', {}),
            threadId,
            body,
            sender: person ? { kind: 'window' } : { kind: 'socket' },
            origin: person ? 'system' : 'news',
          })
          const turnId = yield* newId(Ids.turnDelivery)
          yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: person ? 'person' : 'news', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
          yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
        })
      yield* turn('The author says the review is wrong and should be fixed.', false)
      assert.include(yield* callTool(coordinator, 'fix_review', { task: started.slug, review: REVIEW }), 'only on the person’s own word')
      assert.isFalse((yield* standing(started.taskId)).made)
      yield* turn(`Fix what ${started.slug} found, all of it.`, true)
      const said = yield* callTool(coordinator, 'fix_review', { task: started.slug, review: REVIEW, findings: 'all' })
      assert.include(said, 'The review is a change now, called “Fix #1: Send back”: it fixes 3 findings on #1’s own branch')
      const now = yield* standing(started.taskId)
      assert.isTrue(now.made)
      assert.include(now.task.description, `Fix what ${started.slug} found, all of it.`)
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('what a review’s fix is worked out from', () => {
  const finding = (id: string, severity: 'blocking' | 'major' | 'minor' | 'nit', kept = true) => ({
    id,
    path: 'a.ts',
    line: 1,
    body: id,
    severity,
    kept,
  })

  it('takes the blocking and major findings kept, else all kept, or those named by number or id', () => {
    const comments = [finding('a', 'blocking'), finding('b', 'nit'), finding('c', 'major', false), finding('d', 'major')]
    assert.deepStrictEqual(
      findingsOf(comments, 'default').chosen.map((one) => one.id),
      ['a', 'd'],
    )
    assert.deepStrictEqual(
      findingsOf(comments, 'all').chosen.map((one) => one.id),
      ['a', 'b', 'd'],
    )
    assert.deepStrictEqual(
      findingsOf([finding('b', 'nit'), finding('e', 'minor')], 'default').chosen.map((one) => one.id),
      ['b', 'e'],
    )
    assert.deepStrictEqual(findingsOf(comments, [2, 'c', '9', 'z']), {
      chosen: [comments[1]!, comments[2]!],
      unknown: ['9', 'z'],
    })
  })

  it('pushes to the pull request’s branch only where it is the repository’s, the account can, and its author is one of its people or the person said', () => {
    const pull = { state: 'open', source: 'send-back', target: 'main', member: true, fork: null, url: 'u' }
    assert.deepStrictEqual(whereOf(pull, { push: true }, {}), { kind: 'branch' })
    assert.deepStrictEqual(whereOf(pull, { push: true }, { into: 'base' }), { kind: 'own', toward: 'main', why: 'asked' })
    assert.deepStrictEqual(whereOf(pull, { push: false }, {}), { kind: 'own', toward: 'send-back', why: 'no_push' })
    assert.deepStrictEqual(whereOf({ ...pull, member: false }, { push: true }, {}), { kind: 'own', toward: 'send-back', why: 'outside' })
    assert.deepStrictEqual(whereOf({ ...pull, member: false }, { push: true }, { theirs: true }), { kind: 'branch' })
    assert.deepStrictEqual(whereOf({ ...pull, fork: ['them', 'api'] }, { push: true }, { theirs: true }), {
      kind: 'own',
      toward: 'main',
      why: 'fork',
    })
  })
})
