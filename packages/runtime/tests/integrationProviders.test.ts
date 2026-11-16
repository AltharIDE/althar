import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Fetch, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { Connectors } from '../src/Config'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { agentFolderOf } from '../src/sentFiles'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, turnsFor } from './support'

const setup = (product: 'jira_cloud' | 'jira_dc' | 'trello' | 'gitlab') => {
  const service = makeFakeService({ product })
  const issue = service.addIssue({
    ref: product === 'gitlab' ? 'a/b#2' : 'DEV-1',
    title: 'Retry uploads',
    ...(product === 'gitlab' ? { with: { url: 'https://gitlab.com/a/b/-/issues/2' } } : {}),
  })
  const root =
    product === 'gitlab'
      ? 'https://gitlab.com/api/v4'
      : product === 'trello'
        ? 'https://api.trello.com/1'
        : `https://jira.test/team/rest/api/${product === 'jira_cloud' ? '3' : '2'}`
  const sent: Array<{ url: string; method: string; bytes: boolean }> = []
  const fetch: Fetch = async (url, init = {}) => {
    sent.push({ url, method: init.method ?? 'GET', bytes: init.body instanceof Uint8Array })
    return new Response(
      JSON.stringify(
        product === 'gitlab' && init.method !== 'POST'
          ? [{ id: 'discussion', individual_note: false, notes: [{ id: 42, body: 'Full discussion' }] }]
          : init.body instanceof Uint8Array
            ? [{ id: 'file', filename: 'report.txt' }]
            : { id: 'saved', values: [] },
      ),
    )
  }
  const connectors = Layer.succeed(
    Connectors,
    Connectors.of({
      products: [
        {
          ...products[product],
          apiFor: () => root,
          apiAt: () => Effect.succeed(root),
          access: null,
          make: () => ({ tracker: service, ...(product === 'gitlab' ? { host: service } : {}) }),
        },
      ],
      fetch,
      clientIds: {},
      callbackPort: 0,
      cliToken: () => Effect.succeed(null),
    }),
  )
  const open = Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({
      product,
      token: 'test-token',
      user: 'you@example.com',
      key: 'a'.repeat(32),
      ...(product.startsWith('jira') ? { webUrl: 'https://jira.test/team' } : {}),
      actorId: instance.personId,
    })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, taskId: null, sessionId: 'none' }
    return yield* turnsFor(access)
  })
  return { service, issue, root, sent, open, layer: runtime(':memory:', {}, { connectors }) }
}

describe('provider operations through the lead/coordinator MCP server', () => {
  for (const product of ['jira_cloud', 'jira_dc', 'trello'] as const)
    it.live(`uploads one attachment on ${product} across repeated calls, and reaches Jira’s Agile root`, () => {
      const h = setup(product)
      return Effect.gen(function* () {
        const { access, turn } = yield* h.open
        const { folder } = yield* agentFolderOf(access.threadId)
        assert.isNotNull(folder)
        if (folder === null) return
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, 'report.txt'), 'Report')
        const message = yield* turn('Attach the report and move DEV-1 into sprint 21')
        const args = { issue: h.issue.ref, path: 'report.txt', media_type: 'text/plain', message }
        assert.include(yield* callTool(access, 'upload_issue_attachment', args), 'report.txt')
        assert.include(yield* callTool(access, 'upload_issue_attachment', args), 'report.txt')
        assert.lengthOf(
          h.sent.filter((one) => one.bytes),
          1,
        )
        if (product !== 'trello') {
          yield* callTool(access, 'tracker_api', { namespace: 'agile', path: '/board/7/sprint' })
          assert.isTrue(h.sent.some((one) => one.url === 'https://jira.test/team/rest/agile/1.0/board/7/sprint'))
          yield* callTool(access, 'tracker_api', {
            namespace: 'agile',
            method: 'POST',
            path: '/sprint/21/issue',
            body: { issues: ['DEV-1'] },
            message,
          })
          assert.isTrue(h.sent.some((one) => one.method === 'POST' && one.url.endsWith('/rest/agile/1.0/sprint/21/issue')))
        }
      }).pipe(Effect.provide(h.layer))
    })
  it.live('preserves a GitLab discussion ID for a lead’s requested threaded reply', () => {
    const h = setup('gitlab')
    return Effect.gen(function* () {
      const session = yield* h.open
      const access = { ...session.access, role: 'lead' as const }
      const message = yield* session.turn('Reply to that discussion')
      assert.include(yield* callTool(access, 'read_issue_comments', { issue: h.issue.url }), '"threadId":"discussion"')
      assert.include(
        yield* callTool(access, 'reply_to_issue_comment', { issue: h.issue.url, comment: 'discussion', body: 'Fixed', message }),
        'saved',
      )
      assert.isTrue(h.sent.some((one) => one.method === 'POST' && one.url.endsWith('/issues/2/discussions/discussion/notes')))
    }).pipe(Effect.provide(h.layer))
  })
})
