import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { AgentDefinition, AgentId } from '@charrette/provider-adapters'
import { codexLikeMeanings, fakeAgent, type FakeAgentOptions, fakeAgentMain } from '@charrette/provider-adapters/testing'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { type Fetch, products } from '@charrette/connectors'
import type { FakeService } from '@charrette/connectors/testing'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { Agents, type AgentEntry, Connectors } from '../src/Config'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { Secrets } from '../src/Secrets'

/** A git repository with one commit on `main`. */
export const repository = () => {
  const path = mkdtempSync(join(tmpdir(), 'charrette-repo-'))
  const run = (...args: Array<string>) =>
    execFileSync('git', args, {
      cwd: path,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@charrette.test',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@charrette.test',
      },
    })
  run('init', '-q', '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# Meridian\n')
  run('add', '.')
  run('commit', '-q', '-m', 'Start')
  return path
}

/** Where the fake agents' usual folders are: each agent's own, under one made for the test run. */
const fakeHomes = mkdtempSync(join(tmpdir(), 'charrette-fake-homes-'))

/** Lines the runtime would have opened in a terminal, such as an account's sign-in. */
export const opened: Array<string> = []

/** Every fake agent started, with the environment its account gave it: its home, or nothing for its usual folder. */
export const launches: Array<{ readonly agentId: string; readonly env: Readonly<Record<string, string>> }> = []

export const definition = (id: string, signedOut: ReadonlyArray<string> = [], perUse: ReadonlyArray<string> = []): AgentDefinition => ({
  id: id as AgentId,
  name: `Fake ${id}`,
  source: 'bundled',
  launch: () => ({ command: 'bun', args: [fakeAgentMain] }),
  modes: { ask: 'ask', readOnly: 'read-only', reader: 'read-only' },
  options: { mode: 'mode', model: 'model', effort: 'effort' },
  // Its status says the home it ran in: signed out, or paid per use, where the test names the agent or that home.
  signIn: {
    status: () => ({ command: 'sh', args: ['-c', 'printf %s "$FAKE_HOME"'] }),
    read: (output) => !signedOut.includes(id) && !signedOut.includes(output.trim()),
    // On a plan, unless the test says it is paid per use.
    paidBy: (output) => (perUse.includes(id) || perUse.includes(output.trim()) ? 'key' : 'plan'),
    login: `fake-login ${id}`,
  },
  home: { variable: 'FAKE_HOME', usual: () => join(fakeHomes, id), shared: ['settings.json'] },
  permissions: codexLikeMeanings,
  // One fake agent passes session options, as Claude Code's entry does.
  ...(id === 'claude-code' ? { sessionMeta: () => ({ fake: { asks: true } }) } : {}),
  knownGaps: [],
})

/**
 * Agents for tests: the fake agent, in this process, under any id. The id
 * `process` runs it as a real process with Bun; `missing` names a command
 * that doesn't exist.
 */
export const fakeAgents = (
  options: FakeAgentOptions = {},
  signedOut: ReadonlyArray<string> = [],
  /** Options for one agent, over the ones for all. */
  each: Readonly<Record<string, FakeAgentOptions>> = {},
  perUse: ReadonlyArray<string> = [],
) => {
  const entry = (agentId: string): AgentEntry => ({
    definition: definition(agentId, signedOut, perUse),
    transport: (cwd, env = {}) => {
      launches.push({ agentId, env })
      return agentId === 'process'
        ? { _tag: 'Process', spec: { command: 'bun', args: [fakeAgentMain] }, cwd }
        : agentId === 'missing'
          ? { _tag: 'Process', spec: { command: 'charrette-no-such-agent', args: [] }, cwd }
          : // An account's own options, by its home's folder name (`codex@work`), or `@usual` for the agent's usual folder.
            {
              _tag: 'InProcess',
              agent: fakeAgent({
                ...options,
                ...each[agentId],
                ...each[`${agentId}@${env.FAKE_HOME === undefined ? 'usual' : basename(env.FAKE_HOME)}`],
              }),
            }
    },
  })
  return Layer.succeed(
    Agents,
    Agents.of({ list: ['claude-code', 'codex', 'opencode'].map(entry), get: (agentId) => Effect.succeed(entry(agentId)) }),
  )
}

/**
 * Code hosts and trackers for tests: GitHub and Linear, each answered by a
 * fake service, and sign-in endpoints answered by `fetch`, a stand-in.
 */
export const fakeConnectors = (
  services: { readonly github?: FakeService; readonly linear?: FakeService },
  more: { readonly fetch?: Fetch; readonly clientIds?: Readonly<Record<string, string>>; readonly callbackPort?: number } = {},
) =>
  Layer.succeed(
    Connectors,
    Connectors.of({
      products: [
        {
          ...products.github,
          make: () => (services.github === undefined ? {} : { host: services.github, tracker: services.github }),
        },
        { ...products.linear, make: () => (services.linear === undefined ? {} : { tracker: services.linear }) },
      ],
      fetch: more.fetch ?? (() => Promise.reject(new Error('No network in tests'))),
      clientIds: more.clientIds ?? {},
      callbackPort: more.callbackPort ?? 0,
    }),
  )

/** The runtime over a database, with worktrees in a temporary folder and fake agents, and a plan's countdown of a moment. */
export const runtime = (
  database = ':memory:',
  options: FakeAgentOptions = {},
  more: {
    readonly signedOut?: ReadonlyArray<string>
    readonly countdown?: Duration.Duration
    readonly connectors?: Layer.Layer<Connectors>
    readonly listenEvery?: Duration.Duration
    readonly each?: Readonly<Record<string, FakeAgentOptions>>
    /** Agents signed in on a key, paid per use, rather than a plan. */
    readonly perUse?: ReadonlyArray<string>
  } = {},
) =>
  Runtime.layer({
    database,
    worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
    accountsRoot: mkdtempSync(join(tmpdir(), 'charrette-accounts-')),
    // Nothing opens on the Mac running the tests: what would have is kept.
    openTerminal: (line) => Effect.sync(() => void opened.push(line)).pipe(Effect.as(false)),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(options, more.signedOut, more.each, more.perUse),
    countdown: more.countdown ?? Duration.millis(300),
    secrets: Secrets.memory(),
    connectors: more.connectors ?? fakeConnectors({}),
    ...(more.listenEvery === undefined ? {} : { listenEvery: more.listenEvery }),
  })

/** A GitHub instance that never answers: `.test` names nothing, so git's fetches fail at once, and the fake service stands in for its API. */
export const HOST = 'https://github.test'

/**
 * A repository whose origin is on a GitHub instance, as far as its remote
 * says, and a bare repository on disk that takes what is pushed to it.
 */
export const hosted = (path: ReadonlyArray<string> = ['meridian', 'api']) => {
  const working = repository()
  execFileSync('git', ['remote', 'add', 'origin', `${HOST}/${path.join('/')}.git`], { cwd: working })
  const bare = mkdtempSync(join(tmpdir(), 'charrette-remote-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare })
  execFileSync('git', ['push', '-q', bare, 'main'], { cwd: working })
  return { working, bare }
}

/** Opens a new repository as a project and creates a task in it. */
export const task = (title = 'Retry checkout') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId: project.projectId,
      title,
    })
    return { project, task: created }
  })

/** Waits until a query returns a row matching the check, reading the store every few milliseconds. */
export const until = <A, R = SqlClient.SqlClient>(
  query: Effect.Effect<ReadonlyArray<A>, unknown, R>,
  check: (rows: ReadonlyArray<A>) => boolean,
  limit = Duration.seconds(10),
) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(limit)
    for (;;) {
      const rows = yield* Effect.orDie(query)
      if (check(rows)) return rows
      if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out waiting; last saw ${JSON.stringify(rows)}`))
      yield* Effect.sleep('20 millis')
    }
  })

/** The thread's items, oldest first, with their content parsed. */
export const items = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      kind: string
      content: string
      toolCallId: string | null
    }>`SELECT kind, content, tool_call_id FROM thread_items WHERE thread_id = ${threadId} ORDER BY sequence`
    return rows.map((row) => ({ kind: row.kind, content: JSON.parse(row.content) as Record<string, unknown>, toolCallId: row.toolCallId }))
  })

/** The thread's turns, oldest first. */
export const turns = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      state: string
      stopReason: string | null
      errorClass: string | null
      usage: string | null
      providerSessionId: string
      prompt: string | null
      inputs: number
    }>`
      SELECT t.id, t.state, t.stop_reason, t.error_class, t.usage, t.provider_session_id, t.prompt,
        (SELECT count(*) FROM turn_delivery_inputs i WHERE i.delivery_id = t.id) AS inputs
      FROM turn_deliveries t WHERE t.thread_id = ${threadId} ORDER BY t.requested_at, t.id`
  })

/** The notices on a thread, as their titles and descriptions, oldest first. */
export const notices = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      content: string
    }>`SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' ORDER BY sequence`
    return rows.map((row) => JSON.parse(row.content) as Readonly<Record<string, string>>)
  })

/** Calls one of Charrette's tools as an agent with this access would: over MCP, with the session's token. */
export const callTool = (access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const toolServer = yield* ToolServer
    const granted = yield* toolServer.grant(access)
    const server = granted.server
    if (server.type !== 'http') return ''
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        const result = await client.callTool(args === undefined ? { name } : { name, arguments: args })
        const content = Array.isArray(result.content) ? result.content : []
        return content.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '')).join('')
      } finally {
        await client.close()
      }
    })
  })
