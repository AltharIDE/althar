import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Fetch } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { Ids, newId } from '@althar/domain'
import { removeTreeSync } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { timestamp } from '../src/records'
import { agentFolderOf } from '../src/sentFiles'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, repository, runtime, turnsFor } from './support'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: Readonly<Record<string, unknown>>
  readonly headers: Headers
}
const harness = (answer: (call: Call) => unknown = () => ({ data: { viewer: { id: 'me' } } })) => {
  const github = makeFakeService()
  github.addRepository(['meridian', 'api'])
  const pull = github.addPullRequest({ path: ['meridian', 'api'], title: 'Fix retries', author: 'colleague', headSha: 'a'.repeat(40) })
  const linear = makeFakeService({ product: 'linear' })
  linear.addIssue({ ref: 'MER-1', title: 'Retry uploads' })
  const sent: Array<Call> = []
  const fetch: Fetch = async (url, init = {}) => {
    const body =
      typeof init.body === 'string'
        ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(init.body)
        : {}
    const call = { url, method: init.method ?? 'GET', body, headers: new Headers(init.headers) }
    sent.push(call)
    return new Response(JSON.stringify(answer(call)), { status: 200 })
  }
  return { github, linear, pull, sent, layer: runtime(':memory:', {}, { connectors: fakeConnectors({ github, linear }, { fetch }) }) }
}

const coordinator = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  yield* connections.connectToken({
    product: 'github',
    token: 'github-test-token',
    actorId: instance.personId,
    webUrl: 'https://github.com',
  })
  yield* connections.connectToken({ product: 'linear', token: 'linear-test-token', actorId: instance.personId })
  const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* (yield* Coordinator).thread(project.projectId)
  const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, taskId: null, sessionId: 'none' }
  return yield* turnsFor(access)
})

describe('the lead and coordinator’s integrations over MCP', () => {
  it.live('edits a GitHub comment after matching its API issue URL to the browser issue reference', () => {
    const h = harness((call) =>
      call.method === 'GET' && call.url.includes('/issues/comments/')
        ? { id: 42, issue_url: 'https://api.github.com/repos/meridian/api/issues/12' }
        : { id: 42, body: 'Corrected' },
    )
    const issue = h.github.addIssue({ ref: 'meridian/api#12', title: 'Retry once' })
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const message = yield* turn('Correct that GitHub issue comment')
      assert.include(
        yield* callTool(access, 'edit_issue_comment', { issue: issue.url, comment: '42', body: 'Corrected', message }),
        'Corrected',
      )
      assert.lengthOf(
        h.sent.filter((one) => one.method === 'PATCH'),
        1,
      )
    }).pipe(Effect.provide(h.layer))
  })
  it.live('posts an existing review card once and settles its task without leaving a duplicate card to post', () => {
    const h = harness()
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const projects = yield* Projects
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: access.projectId,
        title: 'Review retries',
        draft: true,
      })
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      yield* sql`UPDATE tasks SET state = 'open' WHERE id = ${task.taskId}`
      yield* sql`UPDATE workspaces SET access = 'read' WHERE task_id = ${task.taskId}`
      const connections = yield* (yield* Connections).list
      const connection = connections.find((one) => one.product === 'github')
      assert.isDefined(connection)
      const draft = yield* newId(Ids.reviewDraft)
      const at = yield* timestamp
      yield* sql`INSERT INTO review_drafts ${sql.insert({ id: draft, projectId: access.projectId, taskId: task.taskId, threadId: task.threadId, connectionId: connection?.id ?? '', product: 'github', repository: 'meridian/api', number: h.pull.number, url: h.pull.url, title: h.pull.title, author: 'colleague', outside: 0, headCommit: h.pull.headSha, drafter: null, account: null, suggested: 'approve', verdict: null, summary: 'Reviewed retries', comments: '[]', state: 'pending', draftedByActorId: instance.systemId, createdAt: at, updatedAt: at })}`
      const message = yield* turn('Post the review card')
      assert.include(yield* callTool(access, 'post_review', { draft, message }), '"state":"posted"')
      assert.include(yield* callTool(access, 'post_review', { draft, message }), '"state":"posted"')
      assert.lengthOf(h.github.reviewsPosted, 1)
      assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`)[0]?.state, 'done')
      assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM review_drafts WHERE id = ${draft}`)[0]?.state, 'posted')
    }).pipe(Effect.provide(h.layer))
  })
  it.live('reads through the connection without leaking its credential and refuses unasked writes', () => {
    const h = harness((call) => (call.url.endsWith('/user') ? { id: 'me' } : { items: [{ text: 'Read this' }] }))
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      yield* turn('News', 'news')
      assert.include(yield* callTool(access, 'code_host_api', { connection: 'github', path: '/repos/meridian/api/issues' }), 'Read this')
      assert.include(yield* callTool(access, 'list_integrations'), 'linear')
      assert.notInclude(yield* callTool(access, 'list_integrations'), 'github-test-token')
      const denied = yield* callTool(access, 'code_host_api', {
        connection: 'github',
        method: 'POST',
        path: '/repos/meridian/api/issues',
        body: { title: 'New' },
      })
      assert.match(denied, /person|message|word/i)
      assert.isFalse(h.sent.some((one) => one.method === 'POST'))
      assert.strictEqual(h.sent[0]?.headers.get('authorization'), 'Bearer github-test-token')
    }).pipe(Effect.provide(h.layer))
  })

  it.live('classifies a GraphQL mutation as a write and records it once across repeated calls', () => {
    const h = harness((call) =>
      String(call.body['query']).includes('mutation')
        ? { data: { result: { success: true, issue: { id: 'i' } } } }
        : { data: { viewer: { id: 'me' } } },
    )
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const args = {
        connection: 'linear',
        query: 'mutation { result: issueUpdate(id: "MER-1", input: { title: "New" }) { success issue { id } } }',
      }
      yield* turn('News', 'news')
      assert.match(yield* callTool(access, 'tracker_api', args), /message|person|word/i)
      assert.lengthOf(h.sent, 0)
      const message = yield* turn('Rename MER-1')
      const first = yield* callTool(access, 'tracker_api', { ...args, message })
      assert.include(first, 'success')
      assert.strictEqual(yield* callTool(access, 'tracker_api', { ...args, message }), first)
      assert.lengthOf(
        h.sent.filter((one) => String(one.body['query']).includes('mutation')),
        1,
      )
      const sql = yield* SqlClient.SqlClient
      assert.strictEqual(
        (yield* sql<{ state: string }>`SELECT state FROM mutation_receipts WHERE operation = 'tracker_api'`)[0]?.state,
        'confirmed',
      )
    }).pipe(Effect.provide(h.layer))
  })

  it.live('keeps a lost write uncertain instead of sending a duplicate', () => {
    let mutations = 0
    const h = harness((call) => {
      if (String(call.body['query']).includes('mutation')) {
        mutations++
        throw new Error('Connection lost after the write')
      }
      return { data: { viewer: { id: 'me' } } }
    })
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const message = yield* turn('Create the project')
      const args = { connection: 'linear', entity: 'project', data: { name: 'Uploads', teamIds: ['team'] }, message }
      assert.match(yield* callTool(access, 'save_linear_resource', args), /uncertain|lost|read back/i)
      assert.match(yield* callTool(access, 'save_linear_resource', args), /earlier|lost|twice/i)
      assert.strictEqual(mutations, 1)
    }).pipe(Effect.provide(h.layer))
  })

  it.live('pages full discussions and makes resources, relationships and comment operations available to leads too', () => {
    const full = 'Paragraph\n\n' + 'x'.repeat(1400)
    const h = harness((call) => {
      const query = String(call.body['query'])
      if (query.includes('comments(first:'))
        return {
          data: {
            issue: {
              comments: {
                nodes: [{ id: 'comment-id', body: full, parent: { id: 'root' } }],
                pageInfo: { hasNextPage: true, endCursor: 'after' },
              },
            },
          },
        }
      if (query.includes('mutation')) return { data: { result: { success: true, id: 'saved' } } }
      return {
        data: {
          viewer: { id: 'me' },
          comment: { id: 'comment-id', issue: { id: 'issue-1' }, parent: null },
          result: { id: 'doc', content: full },
          issue: { result: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
        },
      }
    })
    return Effect.gen(function* () {
      const session = yield* coordinator
      const access = { ...session.access, role: 'lead' as const }
      const message = yield* session.turn('Update the spec and link MER-1 to MER-2; reply and correct the comment')
      const discussion = yield* callTool(access, 'read_issue_comments', { issue: 'MER-1', cursor: 'before' })
      assert.include(discussion, JSON.stringify(full).slice(1, -1))
      assert.include(discussion, 'comment-id')
      assert.include(discussion, 'after')
      assert.include(yield* callTool(access, 'read_linear_resource', { entity: 'document', id: 'doc' }), 'Paragraph')
      assert.include(
        yield* callTool(access, 'save_linear_resource', { entity: 'document', id: 'doc', data: { content: 'New spec' }, message }),
        'success',
      )
      assert.include(
        yield* callTool(access, 'change_issue_relation', { issue: 'MER-1', related: 'MER-2', type: 'blocks', message }),
        'success',
      )
      assert.include(
        yield* callTool(access, 'reply_to_issue_comment', { issue: 'MER-1', comment: 'root', body: 'Reply', message }),
        'success',
      )
      assert.include(
        yield* callTool(access, 'edit_issue_comment', { issue: 'MER-1', comment: 'comment-id', body: 'Correction', message }),
        'success',
      )
    }).pipe(Effect.provide(h.layer))
  })

  it.live('finds PRs beyond a project and explicitly pages or partitions the search window', () => {
    const h = harness(() => ({
      total_count: 1500,
      incomplete_results: false,
      items: [{ number: 47, repository_url: 'https://github.test/another/repo' }],
    }))
    return Effect.gen(function* () {
      const { access } = yield* coordinator
      const first = yield* callTool(access, 'search_pull_requests', { query: 'org:meridian updated:>=2026-11-01' })
      assert.include(first, '"next_page":2')
      assert.include(first, '"partition_required":true')
      const last = yield* callTool(access, 'search_pull_requests', { query: 'org:meridian', page: 10 })
      assert.include(last, '"window_exhausted":true')
      assert.include(last, '"next_page":null')
      assert.match(yield* callTool(access, 'search_pull_requests', { query: 'org:meridian', page: 11 }), /Split|1000/)
      assert.include(h.sent[0]?.url ?? '', encodeURIComponent('is:pr org:meridian updated:>=2026-11-01'))
    }).pipe(Effect.provide(h.layer))
  })

  it.live('requests reviews, resolves conversations and returns a PR to draft on the person’s word', () => {
    const h = harness((call) =>
      call.url.endsWith('/user')
        ? { id: 'me' }
        : call.method === 'GET'
          ? { node_id: 'PR_node', version: 1 }
          : String(call.body['query']).includes('mutation')
            ? { data: { result: { thread: { id: 'thread', isResolved: true }, pullRequest: { isDraft: true } } } }
            : String(call.body['query']).includes('node(id:')
              ? { data: { node: { pullRequest: { url: 'https://github.com/meridian/api/pull/1' } } } }
              : { requested_reviewers: ['ada'] },
    )
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const message = yield* turn('Ask Ada to review this; resolve the thread and put it back in draft')
      assert.include(
        yield* callTool(access, 'request_pull_request_reviewers', { pull_request: h.pull.url, reviewers: ['ada'], message }),
        'ada',
      )
      assert.include(
        yield* callTool(access, 'resolve_review_thread', { pull_request: h.pull.url, thread: 'thread', message }),
        'isResolved',
      )
      assert.include(yield* callTool(access, 'mark_pull_request_draft', { pull_request: h.pull.url, message }), 'isDraft')
      assert.isTrue(h.sent.some((one) => one.url.endsWith('/requested_reviewers')))
    }).pipe(Effect.provide(h.layer))
  })

  it.live('posts an explicitly requested review of the commit read, refuses a moved head and self-approval', () => {
    const h = harness()
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const message = yield* turn('Approve the colleague’s change')
      assert.include(
        yield* callTool(access, 'post_review', {
          pull_request: h.pull.url,
          verdict: 'approve',
          body: 'Reviewed',
          commit: h.pull.headSha,
          message,
        }),
        'id',
      )
      assert.lengthOf(h.github.reviewsPosted, 1)
      assert.match(
        yield* callTool(access, 'post_review', {
          pull_request: h.pull.url,
          verdict: 'comment',
          body: 'Old review',
          commit: 'b'.repeat(40),
          message,
        }),
        /head moved/i,
      )
      const own = h.github.addPullRequest({ path: ['meridian', 'api'], title: 'Own change', author: 'you', headSha: 'c'.repeat(40) })
      assert.match(
        yield* callTool(access, 'post_review', { pull_request: own.url, verdict: 'approve', body: 'No', commit: own.headSha, message }),
        /cannot approve/,
      )
      assert.lengthOf(h.github.reviewsPosted, 1)
    }).pipe(Effect.provide(h.layer))
  })

  it.live('rejects uploading files outside the caller’s folder before preparing a remote upload', () => {
    const h = harness()
    const outside = mkdtempSync(join(tmpdir(), 'althar-attachment-outside-'))
    return Effect.gen(function* () {
      const { access, turn } = yield* coordinator
      const { folder } = yield* agentFolderOf(access.threadId)
      assert.isNotNull(folder)
      if (folder === null) return
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'report.txt'), 'Report')
      const file = join(outside, 'report.txt')
      writeFileSync(file, 'Outside report')
      const message = yield* turn('Attach the report')
      const denied = yield* callTool(access, 'upload_issue_attachment', { issue: 'MER-1', path: file, message })
      assert.include(denied, 'working folder')
      assert.lengthOf(h.sent, 0)
    }).pipe(Effect.provide(h.layer), Effect.ensuring(Effect.sync(() => removeTreeSync(outside))))
  })
})
