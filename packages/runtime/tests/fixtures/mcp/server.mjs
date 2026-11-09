// A tiny MCP server over stdio, for the probe's tests (mcpProbe.test.ts): JSON-RPC a line, as a real one speaks it.
// How it behaves is its first argument: `pages` answers, its tools three pages long (FAKE_TOOLS of them, five without
// it), asking Althar for a ping first; `exits` ends at once, saying why on stderr; `hangs` never answers; `garbage`
// prints what isn't JSON-RPC and never answers; `refuses` answers `initialize` with an error, `long-error` with a very long one
// and `blank-error` with none; `floods` writes without end.
// Its pid goes to FAKE_PID_FILE where that is set, so a test can see it was stopped.
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const mode = process.argv[2] ?? 'pages'
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid))

if (mode === 'exits') {
  process.stderr.write('\nfake: GITHUB_TOKEN isn’t set\nmore detail\n')
  process.exit(3)
}
if (mode === 'floods') {
  const line = `${'x'.repeat(64 * 1024)}\n`
  const write = () => {
    while (process.stdout.write(line));
    process.stdout.once('drain', write)
  }
  write()
}
if (mode === 'garbage') process.stdout.write('starting up…\n{not json\n[1,2,3]\n')

const tools = Number(process.env.FAKE_TOOLS ?? '5')
const all = Array.from({ length: tools }, (_, at) => ({ name: `tool${at}`, inputSchema: { type: 'object' } }))
const per = Math.max(1, Math.ceil(tools / 3))
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
let pinged = false
let initialized = false
let waiting

createInterface({ input: process.stdin }).on('line', (line) => {
  if (mode === 'hangs' || mode === 'garbage' || mode === 'floods') return
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    if (mode === 'refuses') return send({ id: message.id, error: { code: -32602, message: 'Unsupported protocol version\nmore' } })
    if (mode === 'long-error') return send({ id: message.id, error: { code: -32602, message: 'x'.repeat(400) } })
    if (mode === 'blank-error') return send({ id: message.id, error: { code: -32602, message: '   ' } })
    if (message.params?.protocolVersion !== '2025-06-18' || message.params?.clientInfo?.name !== 'althar')
      return send({ id: message.id, error: { code: -32602, message: 'unexpected initialize' } })
    return send({ id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } })
  }
  if (message.method === 'notifications/initialized') return (initialized = true)
  if (message.id === 'ping-1') {
    pinged = true
    return waiting?.()
  }
  if (message.method === 'tools/list') {
    if (!initialized) return send({ id: message.id, error: { code: -32600, message: 'not initialized' } })
    const answer = () => {
      const from = message.params?.cursor === undefined ? 0 : Number(message.params.cursor)
      const next = from + per
      send({ id: message.id, result: { tools: all.slice(from, next), ...(next < tools ? { nextCursor: String(next) } : {}) } })
    }
    // Before its first page, it asks Althar something of its own, which must be answered for it to go on.
    if (!pinged) {
      waiting = answer
      send({ id: 'ping-1', method: 'ping' })
      send({ id: 'roots-1', method: 'roots/list' })
      return
    }
    return answer()
  }
})
