/*
 * Whether each agent, in its read-only mode, calls a tool from an MCP server
 * Althar serves over HTTP: what the coordinator stands on (docs/architecture/04).
 * It starts a one-tool server, asks each agent once to call it, and prints the
 * permission requests and questions that came, and whether the call arrived.
 * It sends one short prompt per agent, so it costs a little usage.
 *
 *   bun run probe:tools                  # every agent, in its read-only mode
 *   bun run probe:tools codex            # one agent
 *   bun run probe:tools claude-code ask  # in the mode that asks
 *   ALLOW_ALL=1 bun run probe:tools      # allowing every permission request
 *
 * Found on 30 September 2026: Claude Code's plan mode and OpenCode's plan
 * agent refuse the call, since it would change something; in their asking
 * modes both make it. Codex makes it in its read-only sandbox, asking with
 * only the call's id.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { agents, type AgentId, connect } from '@althar/provider-adapters'
import { Effect, Stream } from 'effect'

const TOKEN = 'probe-token'
const calls: Array<{ readonly agent: string; readonly title: unknown }> = []
let current = ''

const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end()
    return
  }
  const server = new Server({ name: 'althar', version: '0.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'draft_task',
        description: 'Drafts a task in Althar. Takes its title.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push({ agent: current, title: request.params.arguments?.title })
    return { content: [{ type: 'text', text: 'Drafted.' }] }
  })
  // Without a session id generator, each request stands alone.
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => void transport.close())
  // The SDK's transport types its optional handlers loosely, which strict optional types reject.
  await server.connect(transport as Parameters<typeof server.connect>[0])
  await transport.handleRequest(req, res)
})
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`

const probe = (id: AgentId) =>
  Effect.scoped(
    Effect.gen(function* () {
      const definition = agents[id]
      const cwd = mkdtempSync(join(tmpdir(), `althar-tools-${id}-`))
      const asked: Array<string> = []
      const connection = yield* connect({
        transport: { _tag: 'Process', spec: definition.launch(process.execPath), cwd },
        permissions: definition.permissions,
        onPermission: (request) =>
          Effect.sync(() => {
            asked.push(`permission: ${request.kind} "${request.title}" ${JSON.stringify(request.rawInput ?? null).slice(0, 200)}`)
            const said = `${request.title} ${JSON.stringify(request.rawInput ?? null)}`
            return /draft_task|althar/i.test(said) || process.env.ALLOW_ALL === '1'
              ? { decision: 'allow' as const }
              : { decision: 'reject' as const, reason: 'Not in this probe.' }
          }),
        onQuestion: (question) =>
          Effect.sync(() => {
            asked.push(`question: ${question.message} ${JSON.stringify(question.fields)}`)
            return { action: 'accept' as const, content: {} }
          }),
      })
      const session = yield* connection.newSession({
        cwd,
        mode: process.argv[3] === 'ask' ? definition.modes.ask : definition.modes.readOnly,
        modeOptionId: definition.options.mode,
        mcpServers: [{ type: 'http', name: 'althar', url, headers: { Authorization: `Bearer ${TOKEN}` } }],
        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta() }),
      })
      const tools: Array<string> = []
      let said = ''
      yield* Stream.runForEach(
        session.prompt(
          'Call the draft_task tool from the althar MCP server with the title "Probe". Do nothing else, then reply with the word done.',
        ),
        (event) =>
          Effect.sync(() => {
            if (event._tag === 'ToolCall') tools.push(`${event.kind} "${event.title}"`)
            if (event._tag === 'AgentMessage') said += event.text
          }),
      )
      rmSync(cwd, { recursive: true, force: true })
      return { tools, asked, said: said.trim().slice(0, 120), mode: yield* session.mode }
    }),
  )

const wanted = (
  process.argv[2] === undefined || process.argv[2] === 'all' ? Object.keys(agents) : [process.argv[2]]
) as ReadonlyArray<AgentId>
for (const id of wanted) {
  current = id
  const result = await Effect.runPromise(Effect.timeout(probe(id), '150 seconds')).catch((error: unknown) => ({ error: String(error) }))
  process.stdout.write(`${JSON.stringify({ agent: id, called: calls.filter((call) => call.agent === id), ...result }, null, 2)}\n`)
}
http.close()
process.exit(0)
