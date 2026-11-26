import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Reviews } from '../src/Reviews'
import * as Runtime from '../src/Runtime'
import { singleTypes } from '../src/toolSchemas'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * Every tool Althar serves, in a schema Gemini takes: one `type` per schema, never a list, and `properties` and `required`
 * only on an object's. Gemini refuses a whole request for one that isn't, so a Gemini lead failed on its first turn. The
 * values each tool took stay allowed, null where it was, to a client that checks a call against the schema it was listed.
 */

/** Each tool a session is offered, by name, with its input as the agent reads it. */
const schemasOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return new Map<string, unknown>()
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.inputSchema as unknown] as const))
      } finally {
        await client.close()
      }
    })
  })

/** What Gemini would refuse in a schema, or JSON Schema doesn't know (OpenAPI's `nullable`), each with where it is. */
const refusedByGemini = (schema: unknown, at: string): Array<string> => {
  if (Array.isArray(schema)) return schema.flatMap((one, index) => refusedByGemini(one, `${at}[${index}]`))
  if (schema === null || typeof schema !== 'object') return []
  const node = schema as Record<string, unknown>
  const own = [
    ...(Array.isArray(node.type) ? [`${at}.type is a list`] : []),
    ...('nullable' in node ? [`${at}.nullable isn’t JSON Schema`] : []),
    ...(node.type !== 'object' && 'properties' in node ? [`${at}.properties on ${String(node.type)}`] : []),
    ...(node.type !== 'object' && 'required' in node ? [`${at}.required on ${String(node.type)}`] : []),
  ]
  // `properties` is a map of names, each a schema; `enum`, `required` and the like hold values, not schemas.
  const below = Object.entries(node).flatMap(([key, value]) =>
    key === 'properties' && value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([name, one]) => refusedByGemini(one, `${at}.properties.${name}`))
      : key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf' || key === 'additionalProperties'
        ? refusedByGemini(value, `${at}.${key}`)
        : [],
  )
  return [...own, ...below]
}

/** Whether a call's input is allowed by the schema its tool was listed with, as a JSON Schema client checks it. */
const allows = (schema: unknown, input: unknown) =>
  new AjvJsonSchemaValidator().getValidator(schema as Parameters<AjvJsonSchemaValidator['getValidator']>[0])(input)

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** Someone else's pull request, #1: a commit on main, on the host only as the pull request's head. */
const pullRequest = (at: { readonly working: string; readonly bare: string }, github: FakeService) => {
  git(at.working, 'checkout', '-q', '--detach', 'main')
  writeFileSync(join(at.working, 'send.ts'), 'export const sendBack = () => 1\n')
  git(at.working, 'add', '.')
  git(at.working, 'commit', '-q', '-m', 'Send back')
  const head = git(at.working, 'rev-parse', 'HEAD')
  git(at.working, 'checkout', '-q', 'main')
  git(at.working, 'push', '-q', at.bare, `${head}:refs/pull/1/head`)
  github.addPullRequest({ path: ['meridian', 'api'], title: 'Send back', author: 'ninemate', headSha: head })
}

describe('a tool’s input as Althar serves it', () => {
  it('keeps mixed enums and type-specific constraints on the branches they apply to', () => {
    const array = ['draft']
    const object = { state: 'draft' }
    const before = {
      title: 'Selection',
      default: object,
      type: ['array', 'object', 'integer', 'number', 'boolean', 'null'],
      enum: [array, object, 2, 0.5, true, null],
      minItems: 1,
      required: ['state'],
      minimum: 0,
    }
    const after = singleTypes(before)
    assert.deepStrictEqual(after, {
      title: 'Selection',
      default: object,
      anyOf: [
        { type: 'array', enum: [array], minItems: 1 },
        { type: 'object', enum: [object], required: ['state'] },
        { type: 'integer', enum: [2], minimum: 0 },
        { type: 'number', enum: [2, 0.5], minimum: 0 },
        { type: 'boolean', enum: [true] },
        { type: 'null' },
      ],
    })
    for (const input of [array, object, 2, 0.5, true, null, [], {}, 3, false, 'draft'])
      assert.strictEqual(allows(after, input).valid, allows(before, input).valid, JSON.stringify(input))
  })

  it('makes a list of types anyOf branches of one type each, the same values allowed', () => {
    const before = {
      type: 'object',
      properties: {
        review: { type: ['object', 'null'], description: 'null, none.', properties: { model: { type: 'string' } }, required: ['model'] },
        brief: { type: ['string', 'null'], description: 'null, the built-in’s own.', minLength: 1 },
        pull_request: { type: ['string', 'integer'], description: 'Its number or link.' },
        days: { type: 'array', items: { type: ['number', 'null'], minimum: 0 } },
        kind: { type: ['string', 'null'], enum: ['a', 'b', null] },
        one: { type: ['boolean'] },
      },
      required: ['review'],
    }
    const after = singleTypes(before)
    assert.deepStrictEqual(after, {
      type: 'object',
      properties: {
        review: {
          description: 'null, none.',
          anyOf: [{ type: 'object', properties: { model: { type: 'string' } }, required: ['model'] }, { type: 'null' }],
        },
        brief: { description: 'null, the built-in’s own.', anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        pull_request: { description: 'Its number or link.', anyOf: [{ type: 'string' }, { type: 'integer' }] },
        days: { type: 'array', items: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] } },
        kind: { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] },
        one: { type: 'boolean' },
      },
      required: ['review'],
    })
    assert.deepStrictEqual(refusedByGemini(after, 'it'), [])
    // What the list allowed, the branches allow, and what it refused they refuse.
    const inputs = [
      { review: null, brief: null, pull_request: 12, days: [1, null], kind: null },
      { review: { model: 'm' }, brief: 'b', pull_request: '#12', kind: 'a' },
      { review: {} },
      { review: null, brief: '' },
      { review: null, pull_request: true },
      { review: null, days: [-1] },
      { review: null, kind: 'c' },
      { brief: 'b' },
    ]
    for (const input of inputs) assert.strictEqual(allows(after, input).valid, allows(before, input).valid, JSON.stringify(input))
  })

  it.live('has nothing Gemini refuses for the coordinator, a task’s lead, a review’s lead and a reviewer, and takes null as listed', () => {
    const at = hosted()
    const github = makeFakeService({ pushUrl: () => at.bare })
    github.addRepository(['meridian', 'api'])
    pullRequest(at, github)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: at.working })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      // A quick task, done: its lead may make it a change, whose review is required and may be null.
      assert.match(
        yield* callTool(coordinator, 'start_task', {
          title: 'Sketch the settings',
          description: 'Sketch it. [lead:commit] [lead:finish] [review:pass]',
          lead: { agent: 'claude-code' },
        }),
        /^Started /,
      )
      const [task] = yield* until(
        sql<{ id: string; threadId: string }>`
          SELECT k.id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
          WHERE k.title = 'Sketch the settings'`,
        (rows) => rows.length > 0,
      )
      yield* until(
        Effect.map((yield* Queries).card(task?.id ?? ''), (card) => [card]),
        ([card]) => card?.phase === 'ready' && card.kind === 'plain',
      )
      const lead: ToolAccess = { ...coordinator, role: 'lead', threadId: task?.threadId ?? '', taskId: task?.id ?? null }
      // A review of someone else's pull request: its lead is given only what reads and drafts it.
      const review = yield* (yield* Reviews).start({
        envelope: yield* Runtime.envelope('review.start', {}),
        projectId: project.projectId as ProjectId,
        pullRequest: '#1',
        lead: { agentId: 'claude-code', model: null },
      })
      const reviewLead: ToolAccess = { ...coordinator, role: 'lead', threadId: review.threadId, taskId: review.taskId }
      const sessions = { coordinator, lead, reviewLead, reviewer: { ...lead, role: 'reviewer' as const } }
      const listed: Record<string, Map<string, unknown>> = {}
      for (const [who, access] of Object.entries(sessions)) {
        const tools = yield* schemasOf(access)
        listed[who] = tools
        assert.deepStrictEqual(
          [...tools].flatMap(([name, input]) => refusedByGemini(input, `${who}:${name}`)),
          [],
        )
      }
      assert.includeMembers([...(listed.lead?.keys() ?? [])], ['make_it_a_change', 'tune_preset', 'propose_plan', 'finish_step'])
      assert.includeMembers([...(listed.reviewLead?.keys() ?? [])], ['draft_review', 'finish_step'])
      assert.notInclude([...(listed.reviewLead?.keys() ?? [])], 'make_it_a_change')
      assert.isAbove(listed.reviewer?.size ?? 0, 5)
      // Null where a tool took it, allowed by the schema it was listed with, and taken by the tool as before.
      const asked = { title: 'Sketch the settings', review: null, output: 'draft' }
      assert.isTrue(allows(listed.lead?.get('make_it_a_change'), asked).valid)
      assert.isFalse(allows(listed.lead?.get('make_it_a_change'), { ...asked, review: 'none' }).valid)
      const nulls = { preset: 'Prototype', lead: null, review: null, brief: null }
      assert.isTrue(allows(listed.coordinator?.get('tune_preset'), nulls).valid)
      assert.include(yield* callTool(coordinator, 'tune_preset', { preset: 'Prototype', brief: 'Mine.' }), 'Prototype is tuned as theirs')
      assert.match(yield* callTool(coordinator, 'tune_preset', nulls), /^Prototype /)
      assert.match(yield* callTool(lead, 'make_it_a_change', asked), /^The task is a change now, called “Sketch the settings”/)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(undefined, {}, { connectors: fakeConnectors({ github }) })))))
  })
})
