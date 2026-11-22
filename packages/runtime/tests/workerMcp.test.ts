import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { expect, it } from 'vitest'
import { workerMcpMounts, workerStdioMcp } from '../src/workerMcp'

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fixture port')
  return address.port
}

it('keeps MCP credentials on the home and revokes an open tool stream', async () => {
  const mounts = workerMcpMounts()
  const calls: Array<{ auth: string | undefined; path: string | undefined; injected: string | string[] | undefined; body: string }> = []
  let disconnected!: () => void
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve
  })
  const upstream = createServer((request, response) => {
    if (request.method === 'GET') {
      response.on('close', disconnected)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: waiting\n\n')
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      calls.push({ auth: request.headers.authorization, path: request.url, injected: request.headers['x-unapproved'], body })
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'upstream-session', 'set-cookie': 'home=secret' })
      response.end('{"ok":true}')
    })
  })
  const home = createServer((request, response) => {
    void mounts.serve(request.headers.authorization?.slice(7), request, response)
  })
  try {
    const upstreamPort = await listen(upstream)
    const port = await listen(home)
    const grant = mounts.grant(
      {
        type: 'http',
        name: 'Selected server',
        url: `http://127.0.0.1:${upstreamPort}/original`,
        headers: { Authorization: 'Bearer home-mcp-credential' },
      },
      port,
    )
    if (grant === null) throw new Error('Could not mount the selected server')
    expect(grant.server.headers.Authorization).not.toContain('home-mcp-credential')
    expect((await fetch(grant.server.url)).status).toBe(401)
    const response = await fetch(grant.server.url, {
      method: 'POST',
      headers: { ...grant.server.headers, 'content-type': 'application/json', 'x-unapproved': 'ignored' },
      body: '{"method":"tools/list"}',
    })
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('mcp-session-id')).toBe('upstream-session')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(calls).toEqual([{ auth: 'Bearer home-mcp-credential', path: '/original', injected: undefined, body: '{"method":"tools/list"}' }])
    expect((await fetch(grant.server.url, { method: 'PUT', headers: grant.server.headers })).status).toBe(405)
    const events = await fetch(grant.server.url, { headers: grant.server.headers })
    const reader = events.body?.getReader()
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('data: waiting\n\n')
    grant.revoke()
    await closed
    expect((await fetch(grant.server.url, { headers: grant.server.headers })).status).toBe(401)
  } finally {
    for (const server of [home, upstream]) {
      server.close()
      server.closeAllConnections()
    }
  }
})

it('uses only the worker registration for a selected command-based MCP server', () => {
  const home = {
    type: 'stdio' as const,
    name: 'projectTools',
    command: '/home/private/server',
    args: ['--config', '/home/private/config'],
    env: { TOOL_TOKEN: 'home-only-secret' },
  }
  const worker = [{ name: 'projectTools', executable: '/opt/worker/server' }]
  expect(workerStdioMcp(home)).toBeNull()
  expect(workerStdioMcp({ ...home, name: 'different' }, worker)).toBeNull()
  expect(workerStdioMcp(home, worker)).toEqual({
    type: 'stdio',
    name: 'projectTools',
    command: '/opt/worker/server',
    args: [],
    env: {},
  })
})

it('limits active MCP calls and refuses oversized uploads and redirects', async () => {
  const mounts = workerMcpMounts()
  const calls: string[] = []
  const upstream = createServer((request, response) => {
    calls.push(request.url ?? '')
    if (request.url === '/redirect') {
      response.writeHead(307, { location: '/secret' }).end()
      return
    }
    if (request.method === 'DELETE') {
      response.writeHead(204).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: waiting\n\n')
  })
  const home = createServer((request, response) => {
    void mounts.serve(request.headers.authorization?.slice(7), request, response)
  })
  const grants: Array<{ revoke: () => void }> = []
  try {
    const upstreamPort = await listen(upstream)
    const port = await listen(home)
    const settings = { type: 'http' as const, name: 'Mounted tool', url: `http://127.0.0.1:${upstreamPort}/mounted`, headers: {} }
    for (const url of ['not a url', 'file:///home/config', 'http://test@example.com/', 'http://:secret@example.com/'])
      expect(mounts.grant({ ...settings, url }, port)).toBeNull()
    for (const invalid of [0, 65536, 1.5]) expect(mounts.grant(settings, invalid)).toBeNull()
    expect(mounts.grant({ ...settings, headers: { 'Invalid Header': 'value' } }, port)).toBeNull()
    const mount = mounts.grant(settings, port)
    const redirects = mounts.grant({ ...settings, url: `http://127.0.0.1:${upstreamPort}/redirect` }, port)
    if (mount === null || redirects === null) throw new Error('Could not grant the tool fixture')
    grants.push(mount, redirects)
    const request = (method: string, body?: string) =>
      fetch(mount.server.url, { method, headers: mount.server.headers, ...(body === undefined ? {} : { body }) })
    const tooLarge = await request('POST', 'a'.repeat(1024 * 1024 + 1))
    expect(tooLarge.status).toBe(413)
    expect(calls).toEqual([])
    expect((await request('DELETE')).status).toBe(204)
    expect((await fetch(redirects.server.url, { headers: redirects.server.headers })).status).toBe(502)
    expect(calls).toEqual(['/mounted', '/redirect'])
    const pending = await Promise.all(Array.from({ length: 4 }, () => request('GET')))
    expect(pending.map((call) => call.status)).toEqual([200, 200, 200, 200])
    expect((await request('GET')).status).toBe(429)
  } finally {
    for (const grant of grants) grant.revoke()
    for (const server of [home, upstream]) {
      server.close()
      server.closeAllConnections()
    }
  }
})
