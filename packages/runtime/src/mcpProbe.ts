import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'

import type { ServerSpec } from '@althar/provider-adapters'

import { commandEnv } from './agentTools'

/*
 * Althar's own count of one of the person's MCP servers' tools, for the
 * server's sheet in Settings: it starts the server (or calls its address) as
 * an MCP client would, asks for its tools page by page, and stops it. It is
 * only asked when the person opens a server, may start a server of theirs,
 * and never throws: what it couldn't count is said, in plain words. It takes
 * the spec with its references filled in (`expandedSpec` in agentTools.ts).
 *
 * It runs outside any effect, on Node's own timers: a child's time to answer
 * is kept by Node, as `runIn` keeps an agent command's (`lint/clock.js`).
 */

/** What Althar's own check of a server found: how many tools it offers, or why it couldn't count them. */
export type Probed = { readonly tools: number } | { readonly tools: null; readonly why: string }

/** How long a probe may take, and how much it reads: 8 seconds and 5 MB, unless a test says otherwise. */
export interface ProbeLimits {
  readonly millis: number
  readonly bytes: number
}

export const PROBE_LIMITS: ProbeLimits = { millis: 8_000, bytes: 5 * 1024 * 1024 }

const PROTOCOL = '2025-06-18'
/** The most pages of tools it follows: a server that hands out cursors for ever is counted no further. */
const PAGES = 100
const STDERR_KEPT = 2048
const KILL_AFTER = 2_000
const CACHED_FOR = 60_000

const SIGN_IN = 'It needs a sign-in first.'
const SSE = 'It is a server-sent-events server, which Althar can’t ask.'
const tooSlow = (limits: ProbeLimits) => {
  const seconds = Math.max(1, Math.round(limits.millis / 1000))
  return `It didn’t answer in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
}
const tooMuch = 'It said more than Althar reads before answering.'

/** Where a probe stopped early: the answer it gives. */
class Stop extends Error {
  constructor(readonly why: string) {
    super(why)
  }
}

interface Message {
  readonly id?: unknown
  readonly method?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** Words as a sentence's end: at most 300 characters, ending in a stop where they had none. */
const sentence = (words: string): string => {
  const short = words.length > 300 ? `${words.slice(0, 299).trimEnd()}…` : words
  return /[.!?…]$/.test(short) ? short : `${short}.`
}

const errorWords = (error: unknown): string => {
  const message = record(error)?.['message']
  return sentence(typeof message === 'string' && message.trim() !== '' ? message.trim().split('\n')[0]! : 'it answered with an error')
}

/** One page of `tools/list`: how many it has, and the cursor to the next, if any. */
const pageOf = (result: unknown): { readonly count: number; readonly next: string | undefined } => {
  const tools = record(result)?.['tools']
  if (!Array.isArray(tools)) throw new Stop('It answered, but not with a list of tools.')
  const next = record(result)?.['nextCursor']
  return { count: tools.length, next: typeof next === 'string' && next !== '' ? next : undefined }
}

const INITIALIZE = (version: string) => ({
  protocolVersion: PROTOCOL,
  capabilities: {},
  clientInfo: { name: 'althar', version },
})

/** Asks for the tools page by page, through one way of sending a request; the count of them all. */
const countTools = async (request: (method: string, params: Record<string, unknown>) => Promise<unknown>): Promise<number> => {
  let count = 0
  let cursor: string | undefined
  for (let page = 0; page < PAGES; page += 1) {
    const found = pageOf(await request('tools/list', cursor === undefined ? {} : { cursor }))
    count += found.count
    if (found.next === undefined || found.next === cursor) break
    cursor = found.next
  }
  return count
}

/** Stops a child and what it started: asked first, then made to, after two seconds. */
const end = (child: ChildProcess) => {
  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, name)
      else child.kill(name)
    } catch {
      // Already gone.
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return signal('SIGKILL')
  signal('SIGTERM')
  // oxlint-disable-next-line althar/one-clock -- a child's time to stop is kept by Node, outside any effect.
  const kill = setTimeout(() => signal('SIGKILL'), KILL_AFTER)
  kill.unref()
  child.once('exit', () => clearTimeout(kill))
}

/** A server that runs as a command, spoken to over its stdin and stdout, a JSON-RPC message a line. */
const probeStdio = (spec: ServerSpec, limits: ProbeLimits, version: string): Promise<Probed> =>
  new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(spec.command ?? '', [...(spec.args ?? [])], {
        cwd: tmpdir(),
        env: { ...commandEnv(homedir(), process.env), ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      return resolve({ tools: null, why: `It didn’t start: ${error instanceof Error ? error.message : String(error)}` })
    }
    let done = false
    let stderr = ''
    let read = 0
    let buffer = ''
    let nextId = 1
    const waiting = new Map<number, { readonly ok: (result: unknown) => void; readonly fail: (error: Stop) => void }>()
    const finish = (probed: Probed) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const each of waiting.values()) each.fail(new Stop(''))
      waiting.clear()
      end(child)
      resolve(probed)
    }
    const fail = (why: string) => finish({ tools: null, why })
    // oxlint-disable-next-line althar/one-clock -- a child's time to answer is kept by Node, outside any effect.
    const timer = setTimeout(() => fail(tooSlow(limits)), limits.millis)
    const send = (message: Record<string, unknown>) => {
      if (done || child.stdin === null || child.stdin.destroyed) return
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
    }
    const request = (method: string, params: Record<string, unknown>) =>
      new Promise<unknown>((ok, failed) => {
        const id = nextId
        nextId += 1
        waiting.set(id, { ok, fail: failed })
        send({ id, method, params })
      })
    const heard = (message: Message) => {
      // A request of the server's own, such as a ping, is answered, so it doesn't wait on Althar.
      if (typeof message.method === 'string' && message.id !== undefined) {
        send(
          message.method === 'ping'
            ? { id: message.id, result: {} }
            : { id: message.id, error: { code: -32601, message: 'Althar only counts the tools.' } },
        )
        return
      }
      if (typeof message.id !== 'number') return
      const answer = waiting.get(message.id)
      if (answer === undefined) return
      waiting.delete(message.id)
      if (message.error !== undefined) answer.fail(new Stop(`It didn’t start: ${errorWords(message.error)}`))
      else answer.ok(message.result)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      read += chunk.length
      if (read > limits.bytes) return fail(tooMuch)
      buffer += chunk.toString('utf8')
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        at = buffer.indexOf('\n')
        if (line === '') continue
        try {
          const parsed = record(JSON.parse(line))
          if (parsed !== undefined) heard(parsed)
        } catch {
          // A line that isn't JSON-RPC, as a server that logs to its stdout writes: not an answer.
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_KEPT) stderr = (stderr + chunk.toString('utf8')).slice(0, STDERR_KEPT)
    })
    child.stdin?.on('error', () => undefined)
    child.on('error', (error: NodeJS.ErrnoException) =>
      fail(
        error.code === 'ENOENT'
          ? `It didn’t start: ${spec.command ?? 'its command'} isn’t on this computer.`
          : `It didn’t start: ${error.message}`,
      ),
    )
    // Closed once its output is all read, so an answer it gave just before it ended still counts.
    child.on('close', (code, signal) => {
      const first = stderr
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '')
      fail(
        `It didn’t start: ${sentence(first ?? (code === null ? `it was stopped by ${signal ?? 'a signal'}` : `it exited with code ${code}`))}`,
      )
    })
    void (async () => {
      try {
        await request('initialize', INITIALIZE(version))
        send({ method: 'notifications/initialized' })
        const tools = await countTools(request)
        finish({ tools })
      } catch (error) {
        if (error instanceof Stop && error.why !== '') fail(error.why)
      }
    })()
  })

/** The JSON-RPC answer to a request, from a reply that is JSON or a stream of server-sent events; read up to the limit. */
const answerIn = async (response: Response, id: number, limits: ProbeLimits): Promise<Message> => {
  const type = response.headers.get('content-type') ?? ''
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Stop('It answered with nothing.')
  const decoder = new TextDecoder()
  let text = ''
  let read = 0
  const matches = (data: string): Message | undefined => {
    try {
      const parsed: unknown = JSON.parse(data)
      const found = (Array.isArray(parsed) ? parsed : [parsed]).map(record).find((each) => each?.['id'] === id)
      return found
    } catch {
      return undefined
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value !== undefined) {
        read += value.length
        if (read > limits.bytes) throw new Stop(tooMuch)
        text += decoder.decode(value, { stream: true })
      }
      if (type.includes('text/event-stream')) {
        // Events end at a blank line; the first `message` event that answers this request is the answer.
        const events = text.replace(/\r\n/g, '\n').split('\n\n')
        const complete = done ? events : events.slice(0, -1)
        for (const event of complete) {
          const lines = event.split('\n')
          const kind =
            lines
              .find((line) => line.startsWith('event:'))
              ?.slice(6)
              .trim() ?? 'message'
          const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n')
          const found = kind === 'message' && data !== '' ? matches(data) : undefined
          if (found !== undefined) return found
        }
      }
      if (done) break
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  const found = type.includes('text/event-stream') ? undefined : matches(text)
  if (found === undefined) throw new Stop('It answered, but not as an MCP server does.')
  return found
}

/** A server at an address, spoken to over streamable HTTP. */
const probeHttp = async (spec: ServerSpec, limits: ProbeLimits, version: string): Promise<Probed> => {
  const abort = new AbortController()
  // oxlint-disable-next-line althar/one-clock -- an address's time to answer is kept by Node, outside any effect.
  const timer = setTimeout(() => abort.abort(), limits.millis)
  const token = spec.tokenVariable === undefined ? undefined : process.env[spec.tokenVariable]
  const headers: Record<string, string> = {
    ...spec.headers,
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  let nextId = 1
  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(spec.url ?? '', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal: abort.signal,
    })
    if (response.status === 401 || response.headers.has('www-authenticate')) {
      void response.body?.cancel().catch(() => undefined)
      throw new Stop(SIGN_IN)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new Stop(`The address answered ${response.status}.`)
    }
    const session = response.headers.get('mcp-session-id')
    if (session !== null) headers['Mcp-Session-Id'] = session
    return response
  }
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = nextId
    nextId += 1
    const answer = await answerIn(await post({ id, method, params }), id, limits)
    if (answer.error !== undefined) throw new Stop(`It didn’t start: ${errorWords(answer.error)}`)
    return answer.result
  }
  try {
    await request('initialize', INITIALIZE(version))
    headers['MCP-Protocol-Version'] = PROTOCOL
    const sent = await post({ method: 'notifications/initialized' })
    void sent.body?.cancel().catch(() => undefined)
    return { tools: await countTools(request) }
  } catch (error) {
    if (error instanceof Stop) return { tools: null, why: error.why }
    if (abort.signal.aborted) return { tools: null, why: tooSlow(limits) }
    return { tools: null, why: 'The address didn’t answer.' }
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}

/** Starts the server (or calls its address), asks it for its tools and stops it, within the limits; never throws. */
export const probe = async (spec: ServerSpec, limits: ProbeLimits = PROBE_LIMITS, version = '0'): Promise<Probed> => {
  try {
    if (spec.transport === 'sse') return { tools: null, why: SSE }
    if (spec.transport === 'http') {
      if (spec.url === undefined || spec.url === '') return { tools: null, why: 'It has no address.' }
      return await probeHttp(spec, limits, version)
    }
    if (spec.command === undefined || spec.command === '') return { tools: null, why: 'It has no command.' }
    return await probeStdio(spec, limits, version)
  } catch (error) {
    return { tools: null, why: `It didn’t start: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Probes by the spec's whole set-up, kept a minute, so opening and closing a server's sheet doesn't start it again. */
const cache = new Map<string, { readonly at: number; readonly probed: Promise<Probed> }>()

/** A value as JSON with each object's keys in order, so the same set-up is the same key however it was read. */
const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : typeof value === 'object' && value !== null
      ? `{${Object.entries(value)
          .filter(([, each]) => each !== undefined)
          .sort(([one], [other]) => one.localeCompare(other))
          .map(([key, each]) => `${JSON.stringify(key)}:${stable(each)}`)
          .join(',')}}`
      : JSON.stringify(value)

const keyOf = (spec: ServerSpec) => {
  const { off: _, ...rest } = spec
  return createHash('sha256').update(stable(rest)).digest('hex')
}

/** What Althar's own check of a server finds, from the last minute's where there is one; never throws. */
export const probeServer = (spec: ServerSpec, version = '0'): Promise<Probed> => {
  const key = keyOf(spec)
  // oxlint-disable-next-line althar/one-clock -- a cache kept outside any effect, a minute by the system's clock.
  const now = Date.now()
  const kept = cache.get(key)
  if (kept !== undefined && now - kept.at < CACHED_FOR) return kept.probed
  for (const [each, entry] of cache) if (now - entry.at >= CACHED_FOR) cache.delete(each)
  const probed = probe(spec, PROBE_LIMITS, version)
  cache.set(key, { at: now, probed })
  return probed
}

/** Forgets what was probed: for a test. */
export const forgetProbes = () => cache.clear()
