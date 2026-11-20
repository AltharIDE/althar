import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Duration, Effect } from 'effect'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { singleTypes } from '../src/toolSchemas'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * Every tool Althar serves, in a schema Gemini takes: one `type` per schema, never a list, and `properties` and `required`
 * only on an object's. Gemini refuses a whole request for one that isn't, so a Gemini lead failed on its first turn.
 */

/** Each tool a session is offered, by name, with its input as the agent reads it. */
const schemasOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return []
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return (await client.listTools()).tools.map((tool) => ({ name: tool.name, input: tool.inputSchema as unknown }))
      } finally {
        await client.close()
      }
    })
  })

/** What Gemini would refuse in a schema, each with where it is. */
const refusedByGemini = (schema: unknown, at: string): Array<string> => {
  if (Array.isArray(schema)) return schema.flatMap((one, index) => refusedByGemini(one, `${at}[${index}]`))
  if (schema === null || typeof schema !== 'object') return []
  const node = schema as Record<string, unknown>
  const own = [
    ...(Array.isArray(node.type) ? [`${at}.type is a list`] : []),
    ...(typeof node.type === 'string' && node.type !== 'object' && 'properties' in node ? [`${at}.properties on ${node.type}`] : []),
    ...(typeof node.type === 'string' && node.type !== 'object' && 'required' in node ? [`${at}.required on ${node.type}`] : []),
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

describe('a tool’s input as Althar serves it', () => {
  it('makes a list of types one type, nullable where null was in it', () => {
    assert.deepStrictEqual(
      singleTypes({
        type: 'object',
        properties: {
          review: { type: ['object', 'null'], properties: { model: { type: 'string' } }, required: ['model'] },
          brief: { type: ['string', 'null'], description: 'null, the built-in’s own.' },
          pull_request: { type: ['string', 'integer'] },
          days: { type: 'array', items: { type: ['number', 'null'] } },
          kind: { type: 'string', enum: ['a', 'b'] },
        },
        required: ['review'],
      }),
      {
        type: 'object',
        properties: {
          review: { type: 'object', nullable: true, properties: { model: { type: 'string' } }, required: ['model'] },
          brief: { type: 'string', nullable: true, description: 'null, the built-in’s own.' },
          pull_request: { type: 'string' },
          days: { type: 'array', items: { type: 'number', nullable: true } },
          kind: { type: 'string', enum: ['a', 'b'] },
        },
        required: ['review'],
      },
    )
  })

  it.live('has nothing Gemini refuses, for the coordinator, a lead and a reviewer, and still takes null where it did', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const instance = yield* Instance
      yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const roles: ReadonlyArray<ToolAccess> = [coordinator, { ...coordinator, role: 'lead' }, { ...coordinator, role: 'reviewer' }]
      let seen = 0
      for (const access of roles) {
        const tools = yield* schemasOf(access)
        assert.isAbove(tools.length, 5, `${access.role} is offered tools`)
        seen += tools.length
        assert.deepStrictEqual(
          tools.flatMap((tool) => refusedByGemini(tool.input, `${access.role}:${tool.name}`)),
          [],
        )
      }
      assert.isAbove(seen, 100)
      // What was a list keeps its null, as Gemini and the others read it.
      const tune = (yield* schemasOf(coordinator)).find((tool) => tool.name === 'tune_preset')
      const tuned = tune?.input as { properties?: Record<string, unknown> } | undefined
      assert.deepInclude(tuned?.properties?.review, { type: 'object', nullable: true })
      // And a call that gives null is taken as before: null puts that part back to the built-in's.
      assert.include(yield* callTool(coordinator, 'tune_preset', { preset: 'Prototype', brief: 'Mine.' }), 'Prototype is tuned as theirs')
      const back = yield* callTool(coordinator, 'tune_preset', { preset: 'Prototype', lead: null, review: null, brief: null })
      assert.notInclude(back, 'should be')
      assert.match(back, /^Prototype /)
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })))
  })
})
