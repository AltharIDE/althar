import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ServerSpec } from '@althar/provider-adapters'
import { waitFor } from '@althar/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { probeServer } from '../src/mcpHealth'
import { forgetProbes, probe, PROBE_LIMITS } from '../src/mcpProbe'

/*
 * Althar's own count of a server's tools, against real servers of the test's own: a tiny MCP server over stdio
 * (fixtures/mcp/server.mjs), run with this Node, and a local HTTP one, answering in JSON or in server-sent events.
 */

const SERVER = join(import.meta.dirname, 'fixtures', 'mcp', 'server.mjs')
const stdio = (mode: string, env?: Record<string, string>): ServerSpec => ({
  name: `fake-${mode}`,
  transport: 'stdio',
  command: process.execPath,
  args: [SERVER, mode],
  ...(env === undefined ? {} : { env }),
})
/** A limit a server that never answers reaches at once: what the probe says then, not how long it waited. */
const SHORT = { ...PROBE_LIMITS, millis: 1_000 }

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('a server that runs as a command', () => {
  beforeEach(forgetProbes)

  it('counts its tools across their pages, answering what it asks first, with its environment given', async () => {
    expect(await probe(stdio('pages'))).toEqual({ tools: 5 })
    expect(await probe(stdio('pages', { FAKE_TOOLS: '7' }))).toEqual({ tools: 7 })
  })

  it('says the first words it wrote where it ended at its start', async () => {
    expect(await probe(stdio('exits'))).toEqual({ tools: null, why: 'It didn’t start: fake: GITHUB_TOKEN isn’t set.' })
  })

  it('says it answered with an error where it refused to start', async () => {
    expect(await probe(stdio('refuses'))).toEqual({ tools: null, why: 'It didn’t start: Unsupported protocol version.' })
  })

  it('says a command that isn’t there', async () => {
    const found = await probe({ name: 'gone', transport: 'stdio', command: 'althar-no-such-command-anywhere' })
    expect(found).toEqual({ tools: null, why: 'It didn’t start: althar-no-such-command-anywhere isn’t on this computer.' })
  })

  it('says the code or the signal where a command ended without a word', async () => {
    const exited = { name: 'exits', transport: 'stdio' as const, command: process.execPath, args: ['-e', 'process.exit(7)'] }
    expect(await probe(exited)).toEqual({ tools: null, why: 'It didn’t start: it exited with code 7.' })
    // Windows ends a command by a signal as an exit, so there is nothing of a signal to say there.
    if (process.platform !== 'win32') {
      const stopped = {
        name: 'stopped',
        transport: 'stdio' as const,
        command: process.execPath,
        args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
      }
      expect(await probe(stopped)).toEqual({ tools: null, why: 'It didn’t start: it was stopped by SIGTERM.' })
    }
  })

  it('stops one that never answers, and what it started', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'althar-probe-')), 'pid')
    expect(await probe(stdio('hangs', { FAKE_PID_FILE: pidFile }), SHORT)).toEqual({ tools: null, why: 'It didn’t answer in 1 second.' })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await waitFor(
      () => alive(pid),
      (still) => !still,
      'the server stopped',
    )
  })

  it('reads past what isn’t JSON-RPC, and gives up on one that never answers', async () => {
    expect(await probe(stdio('garbage'), SHORT)).toMatchObject({ tools: null, why: expect.stringMatching(/^It didn’t answer/) })
  })

  it('reads no more than its limit of what a server writes', async () => {
    expect(await probe(stdio('floods'))).toEqual({ tools: null, why: 'It said more than Althar reads before answering.' })
  })

  it('says why it can’t ask a server-sent-events server, or one with no command', async () => {
    expect(await probe({ name: 's', transport: 'sse', url: 'http://localhost/sse' })).toEqual({
      tools: null,
      why: 'It is a server-sent-events server, which Althar can’t ask.',
    })
    expect(await probe({ name: 'n', transport: 'stdio' })).toEqual({ tools: null, why: 'It has no command.' })
    expect(await probe({ name: 'n', transport: 'http' })).toEqual({ tools: null, why: 'It has no address.' })
  })

  it('keeps what it counted a minute, so opening a server again doesn’t start it again', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'althar-probe-')), 'pid')
    const spec = stdio('pages', { FAKE_PID_FILE: pidFile })
    const [one, two] = await Promise.all([probeServer(spec), probeServer({ ...spec })])
    expect([one, two]).toEqual([{ tools: 5 }, { tools: 5 }])
    const first = readFileSync(pidFile, 'utf8')
    expect(await probeServer({ ...spec, off: true })).toEqual({ tools: 5 })
    expect(readFileSync(pidFile, 'utf8')).toBe(first)
    forgetProbes()
    expect(await probeServer(spec)).toEqual({ tools: 5 })
    expect(readFileSync(pidFile, 'utf8')).not.toBe(first)
  })
})

describe('a server at an address', () => {
  let server: Server
  let base = ''
  const seen: Array<{ readonly path: string; readonly session: string | undefined; readonly auth: string | undefined }> = []

  const json = async (request: IncomingMessage) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    return JSON.parse(body) as { id?: number; method: string; params?: { cursor?: string } }
  }
  const page = (cursor: string | undefined) =>
    cursor === undefined ? { tools: [{ name: 'a' }, { name: 'b' }], nextCursor: 'two' } : { tools: [{ name: 'c' }] }
  const reply = (response: ServerResponse, message: { id?: number; method: string; params?: { cursor?: string } }) => ({
    jsonrpc: '2.0',
    id: message.id,
    result: message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} } : page(message.params?.cursor),
  })

  beforeAll(async () => {
    server = createServer((request, response) => {
      void (async () => {
        const path = request.url ?? ''
        const session = request.headers['mcp-session-id']
        seen.push({ path, session: typeof session === 'string' ? session : undefined, auth: request.headers.authorization })
        if (path === '/slow') return
        if (path === '/auth') return response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end()
        if (path === '/broken') return response.writeHead(500).end('no')
        // A body of no kind at all, as a server answering 204 does.
        if (path === '/empty') return response.writeHead(204).end()
        const message = await json(request)
        if (message.id === undefined) return response.writeHead(202).end()
        // A JSON reply with no content type, and one that is a batch of messages.
        if (path === '/bare') return response.writeHead(200).end(JSON.stringify(reply(response, message)))
        if (path === '/array') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          return response.end(JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/message' }, reply(response, message)]))
        }
        if (path === '/error') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          return response.end(
            JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'No tools for you\nmore' } }),
          )
        }
        if (path === '/unanswered') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          return response.end(JSON.stringify({ jsonrpc: '2.0', id: 9_999, result: { tools: [] } }))
        }
        if (path === '/no-tools') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          return response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { nothing: true } }))
        }
        if (path === '/json') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          return response.end(JSON.stringify(reply(response, message)))
        }
        if (path === '/odd-sse') {
          // A line that isn't JSON, then an event without its `event:` line, its answer split across two writes.
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          response.write('event: message\ndata: {not json}\n\n')
          response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message' })}\n\n`)
          const answer = JSON.stringify(reply(response, message))
          response.write(`data: ${answer.slice(0, 12)}`)
          response.end(`${answer.slice(12)}\n\n`)
          return
        }
        // Server-sent events, with a session the next requests must carry, and a notification before the answer.
        if (message.method !== 'initialize' && session !== 'session-1') return response.writeHead(400).end()
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'session-1' })
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message' })}\n\n`)
        response.write(`event: message\ndata: ${JSON.stringify(reply(response, message))}\n\n`)
        // Left open, as a server that streams more may.
      })()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  const http = (path: string, more: Partial<ServerSpec> = {}): ServerSpec => ({
    name: path,
    transport: 'http',
    url: `${base}${path}`,
    ...more,
  })

  it('counts its tools from a JSON reply, with the headers it is given', async () => {
    expect(await probe(http('/json', { headers: { Authorization: 'Bearer abc' } }))).toEqual({ tools: 3 })
    expect(seen.filter((one) => one.path === '/json').every((one) => one.auth === 'Bearer abc')).toBe(true)
  })

  it('counts its tools from server-sent events, keeping the session it was given', async () => {
    expect(await probe(http('/sse'))).toEqual({ tools: 3 })
  })

  it('says a sign-in is needed where the address asks for one', async () => {
    expect(await probe(http('/auth'))).toEqual({ tools: null, why: 'It needs a sign-in first.' })
  })

  it('says what the address answered where it failed', async () => {
    expect(await probe(http('/broken'))).toEqual({ tools: null, why: 'The address answered 500.' })
  })

  it('gives up on an address that never answers', async () => {
    expect(await probe(http('/slow'), SHORT)).toEqual({ tools: null, why: 'It didn’t answer in 1 second.' })
  })

  it('says an address with nothing there', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise((resolve) => closed.close(resolve))
    expect(await probe({ name: 'gone', transport: 'http', url: `http://127.0.0.1:${port}/mcp` })).toEqual({
      tools: null,
      why: 'The address didn’t answer.',
    })
  })

  it('reads a JSON reply with no content type, or a batch with its notification first', async () => {
    expect(await probe(http('/bare'))).toEqual({ tools: 3 })
    expect(await probe(http('/array'))).toEqual({ tools: 3 })
  })

  it('reads server-sent events past what isn’t an answer, and an event without its name', async () => {
    expect(await probe(http('/odd-sse'))).toEqual({ tools: 3 })
  })

  it('says what it got where the answer was an error, for another request, or no tools', async () => {
    expect(await probe(http('/error'))).toEqual({ tools: null, why: 'It didn’t start: No tools for you.' })
    expect(await probe(http('/unanswered'))).toEqual({ tools: null, why: 'It answered, but not as an MCP server does.' })
    expect(await probe(http('/no-tools'))).toEqual({ tools: null, why: 'It answered, but not with a list of tools.' })
  })

  it('says an address that answered with no body, and gives a token by its variable', async () => {
    expect(await probe(http('/empty'))).toEqual({ tools: null, why: 'It answered with nothing.' })
    process.env.ALTHAR_PROBE_TOKEN = 'from-the-environment'
    try {
      expect(await probe(http('/json', { tokenVariable: 'ALTHAR_PROBE_TOKEN' }))).toEqual({ tools: 3 })
    } finally {
      delete process.env.ALTHAR_PROBE_TOKEN
    }
    expect(seen.filter((one) => one.path === '/json').some((one) => one.auth === 'Bearer from-the-environment')).toBe(true)
  })
})
