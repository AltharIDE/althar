import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import type { McpServer } from '@althar/provider-adapters'
import type { WorkerLocalMcpCommand } from '@althar/worker-protocol/agent-runs'

type HttpServer = Extract<McpServer, { type: 'http' }>
type StdioServer = Extract<McpServer, { type: 'stdio' }>

/** A role-selected tool uses its worker's installed command and local configuration. */
export const workerStdioMcp = (server: StdioServer, available: ReadonlyArray<WorkerLocalMcpCommand> = []): StdioServer | null => {
  const command = available.find(({ name }) => name === server.name)
  if (command === undefined) return null
  return { type: 'stdio', name: server.name, command: command.executable, args: [], env: {} }
}
const MAX_BODY = 1024 * 1024
const MAX_ACTIVE = 4
export const WORKER_MCP_PATH = '/mounted-mcp'
const REQUEST_HEADERS = ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'] as const
const RESPONSE_HEADERS = ['content-type', 'mcp-protocol-version', 'mcp-session-id', 'cache-control'] as const

interface Mount {
  readonly upstream: string
  readonly headers: Headers
  readonly scope: AbortController
  active: number
}

const bodyOf = async (request: IncomingMessage) => {
  let size = 0
  const chunks: Buffer[] = []
  for await (const data of request as AsyncIterable<Buffer>) {
    size += data.length
    if (size > MAX_BODY) return null
    chunks.push(data)
  }
  return Uint8Array.from(Buffer.concat(chunks, size))
}

/** The worker sees a session capability, and the selected MCP server's credential stays on the home. */
export const workerMcpMounts = () => {
  const mounts = new Map<string, Mount>()
  return {
    grant(server: HttpServer, port: number): { readonly server: HttpServer; readonly revoke: () => void } | null {
      const url = URL.parse(server.url)
      if (
        url === null ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535
      )
        return null
      let headers: Headers
      try {
        headers = new Headers(server.headers)
      } catch {
        return null
      }
      const token = randomBytes(24).toString('hex')
      const mount = { upstream: url.href, headers, scope: new AbortController(), active: 0 }
      mounts.set(token, mount)
      return {
        server: {
          type: 'http',
          name: server.name,
          url: `http://127.0.0.1:${port}${WORKER_MCP_PATH}`,
          headers: { Authorization: `Bearer ${token}` },
        },
        revoke: () => {
          mounts.delete(token)
          mount.scope.abort()
        },
      }
    },
    async serve(token: string | undefined, request: IncomingMessage, response: ServerResponse) {
      const mount = token === undefined ? undefined : mounts.get(token)
      if (mount === undefined) {
        response.writeHead(401).end()
        return
      }
      const method = request.method
      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
        response.writeHead(405).end()
        return
      }
      if (mount.active >= MAX_ACTIVE) {
        response.writeHead(429).end()
        return
      }
      mount.active++
      const connection = new AbortController()
      const close = () => connection.abort()
      response.once('close', close)
      const signal = AbortSignal.any([connection.signal, mount.scope.signal, AbortSignal.timeout(10 * 60_000)])
      try {
        const headers = new Headers(mount.headers)
        for (const name of REQUEST_HEADERS) {
          const value = request.headers[name]
          if (typeof value === 'string' && !headers.has(name)) headers.set(name, value)
        }
        const body = method === 'POST' ? await bodyOf(request) : undefined
        if (body === null) {
          response.writeHead(413).end()
          return
        }
        const result = await fetch(mount.upstream, { method, headers, signal, redirect: 'error', ...(body === undefined ? {} : { body }) })
        for (const name of RESPONSE_HEADERS) {
          const value = result.headers.get(name)
          if (value !== null) response.setHeader(name, value)
        }
        response.writeHead(result.status)
        if (result.body === null) response.end()
        else await pipeline(Readable.fromWeb(result.body as NodeReadableStream<Uint8Array>), response, { signal })
      } catch {
        if (!response.headersSent && !response.destroyed) response.writeHead(502).end()
        else response.destroy()
      } finally {
        mount.active--
        response.removeListener('close', close)
      }
    },
  }
}
