import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@althar/provider-adapters'
import { Context, Effect, Exit, Layer, Schema } from 'effect'

/*
 * Althar's tools, served to agents over MCP (docs/architecture/04): how the
 * coordinator drafts and plans tasks, and how a lead or a reviewer reports a
 * step's result. Every agent Althar supports takes an MCP server over HTTP
 * (scripts/probe-tools.ts), so the runtime serves them itself, on this
 * machine only, with a token for each session that says who is calling. A
 * session sees only its role's tools, and its token stops working when the
 * session ends.
 */

/** Who is calling a tool: the session, its role, and what it works on. */
export interface ToolAccess {
  readonly role: ToolRole
  readonly projectId: string
  readonly threadId: string
  /** The provider session's row id. */
  readonly sessionId: string
  /** The task, for a lead or a reviewer. */
  readonly taskId: string | null
}

export type ToolRole = 'coordinator' | 'lead' | 'reviewer'

/** A tool's answer when it can't do what was asked: told to the agent, which can try again. */
export class ToolRefused extends Schema.TaggedError<ToolRefused>()('ToolRefused', { message: Schema.String }) {}

export interface Tool {
  readonly name: string
  readonly description: string
  /** The input, as JSON Schema. */
  readonly input: Readonly<Record<string, unknown>>
  /** Runs the tool; the text the agent reads back. */
  readonly call: (input: unknown, access: ToolAccess) => Effect.Effect<string, ToolRefused>
}

export class ToolServer extends Context.Service<
  ToolServer,
  {
    /** The server a session is given, and how to take it back. */
    grant(access: ToolAccess): Effect.Effect<{ readonly server: McpServer; readonly revoke: Effect.Effect<void> }>
    /** Adds tools to a role, replacing any of the same name. Each service that owns tools adds them once it is built. */
    serve(role: ToolRole, tools: ReadonlyArray<Tool>): Effect.Effect<void>
  }
>()('@althar/runtime/ToolServer') {
  static readonly layer: Layer.Layer<ToolServer> = Layer.effect(
    ToolServer,
    Effect.gen(function* () {
      const grants = new Map<string, ToolAccess>()
      const roles = new Map<ToolRole, ReadonlyArray<Tool>>()

      const respond = async (req: IncomingMessage, res: ServerResponse) => {
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
        const access = token === undefined ? undefined : grants.get(token)
        if (access === undefined) {
          res.writeHead(401).end()
          return
        }
        const tools = roles.get(access.role) ?? []
        const server = new Server({ name: 'althar', version: '1.0.0' }, { capabilities: { tools: {} } })
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.input as { type: 'object' } })),
        }))
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const tool = tools.find((candidate) => candidate.name === request.params.name)
          if (tool === undefined)
            return { isError: true, content: [{ type: 'text' as const, text: `Althar has no tool called ${request.params.name}.` }] }
          const exit = await Effect.runPromiseExit(tool.call(request.params.arguments ?? {}, access))
          if (Exit.isSuccess(exit)) return { content: [{ type: 'text' as const, text: exit.value }] }
          const refused = exit.cause.reasons.find((reason) => reason._tag === 'Fail')
          const text =
            refused !== undefined && refused._tag === 'Fail' && refused.error instanceof ToolRefused
              ? refused.error.message
              : 'Althar could not do that. Try again, or tell the person.'
          return { isError: true, content: [{ type: 'text' as const, text }] }
        })
        // Without a session id generator, each request stands alone: the token says who is calling.
        const transport = new StreamableHTTPServerTransport({})
        res.on('close', () => void transport.close())
        // The SDK's transport types its optional handlers loosely, which strict optional types reject.
        await server.connect(transport as Parameters<typeof server.connect>[0])
        await transport.handleRequest(req, res)
      }

      const http = createServer((req, res) => {
        respond(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500).end()
        })
      })
      yield* Effect.callback<void>((resume) => {
        http.listen(0, '127.0.0.1', () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.callback<void>((resume) => void http.close(() => resume(Effect.void))))
      const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`

      return ToolServer.of({
        grant: (access) =>
          Effect.sync(() => {
            const token = randomBytes(24).toString('hex')
            grants.set(token, access)
            return {
              server: { type: 'http', name: 'althar', url, headers: { Authorization: `Bearer ${token}` } },
              revoke: Effect.sync(() => void grants.delete(token)),
            }
          }),
        serve: (role, tools) =>
          Effect.sync(() => {
            const kept = (roles.get(role) ?? []).filter((tool) => !tools.some((added) => added.name === tool.name))
            roles.set(role, [...kept, ...tools])
          }),
      })
    }),
  )
}
