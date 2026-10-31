import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { AgentDefinition, AgentId, SessionOptions } from '@althar/provider-adapters'
import { codexLikeMeanings, fakeAgent, type FakeAgentOptions, fakeAgentMain } from '@althar/provider-adapters/testing'
import { Clock, Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { type AdapterOptions, type Fetch, products } from '@althar/connectors'
import { byToken, type FakeService } from '@althar/connectors/testing'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import {
  Agents,
  type AgentEntry,
  type AutomationOptions,
  type BusyOptions,
  Connectors,
  type IdleOptions,
  type RuntimeOptions,
  type SetupOptions,
  type StallOptions,
} from '../src/Config'
import type { CliUnanswered } from '../src/errors'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { Secrets } from '../src/Secrets'
import type { LoadOptions } from '../src/MachineLoad'
import { WORK } from '../src/machine'
import type { PlanUsageOptions } from '../src/PlanUsage'
import type { ModelFactsOptions } from '../src/ModelFacts'

/** The repository every test starts from, made once per worker: copying it is much quicker than running git anew. */
let template: string | undefined

/** A git repository with one commit on `main`. */
export const repository = () => {
  if (template === undefined) {
    template = mkdtempSync(join(tmpdir(), 'althar-template-'))
    const run = (...args: Array<string>) =>
      execFileSync('git', args, {
        cwd: template,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@althar.test',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@althar.test',
        },
      })
    run('init', '-q', '-b', 'main')
    // A commit starts `git maintenance run --auto --detach`, which can take and drop a lock in .git/objects after the
    // commit returns, so a copy made then fails on the lock that went. Off here, it is off in every copy too.
    run('config', 'maintenance.auto', 'false')
    writeFileSync(join(template, 'README.md'), '# Meridian\n')
    run('add', '.')
    run('commit', '-q', '-m', 'Start')
  }
  const path = mkdtempSync(join(tmpdir(), 'althar-repo-'))
  cpSync(template, path, { recursive: true })
  return path
}

/** Where the fake agents' usual folders are: each agent's own, under one made for the test run. */
const fakeHomes = mkdtempSync(join(tmpdir(), 'althar-fake-homes-'))

/** Lines the runtime would have opened in a terminal, such as an account's sign-in. */
export const opened: Array<string> = []

/**
 * Every fake agent started, where it started, with the environment its
 * account gave it (its home, or nothing for its usual folder), and how its
 * session was started beyond its role: as a review's lead, untrusted.
 */
export const launches: Array<{
  readonly agentId: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly options?: SessionOptions | undefined
}> = []

/** What each session of the fake agent with session options (`claude-code`) was started as: its role, and its options. */
export const sessionMetas: Array<{ readonly role: 'lead' | 'reader' | undefined; readonly options: SessionOptions | undefined }> = []

/** Whether the fake `claude-code` holds the coordinator in a sandbox it never leaves, as Claude Code's does where it starts. */
export const fakeSandbox = { contains: false }

export const definition = (
  id: string,
  signedOut: ReadonlyArray<string> = [],
  perUse: ReadonlyArray<string> = [],
  /** Agents whose sign-in every folder shares, which have their one account. */
  oneAccount: ReadonlyArray<string> = [],
  /** Agents whose status can't tell a plan from a key, as Mistral Vibe's can't. */
  unsure: ReadonlyArray<string> = [],
): AgentDefinition => ({
  id: id as AgentId,
  name: `Fake ${id}`,
  source: 'bundled',
  launch: () => ({ command: 'bun', args: [fakeAgentMain] }),
  modes: { ask: 'ask', readOnly: 'read-only', reader: 'read-only' },
  options: { mode: 'mode', model: 'model', effort: 'effort' },
  // Claude Code's runs on Anthropic's and Codex on OpenAI's, as the registry says; OpenCode on whichever the person picks.
  ...(id === 'claude-code' ? { service: { name: 'Anthropic', url: 'https://api.anthropic.test' } } : {}),
  ...(id === 'codex' ? { service: { name: 'OpenAI', url: 'https://api.openai.test' } } : {}),
  // Its status says the home it ran in: signed out, or paid per use, where the test names the agent or that home.
  signIn: {
    status: () => ({ command: 'sh', args: ['-c', 'printf %s "$FAKE_HOME"'] }),
    read: (output) => !signedOut.includes(id) && !signedOut.includes(output.trim()),
    // On a plan, unless the test says it is paid per use, or that its status can't tell.
    paidBy: (output) => (unsure.includes(id) ? undefined : perUse.includes(id) || perUse.includes(output.trim()) ? 'key' : 'plan'),
    login: `fake-login ${id}`,
    // Says which home it signed out of, in the file the test names.
    logout: {
      // Fails where the test says so.
      run: () => ({
        command: 'sh',
        args: ['-c', '[ -z "$FAKE_SIGN_OUT_FAILS" ] && printf "%s\\n" "$FAKE_HOME" >> "${FAKE_SIGNED_OUT:-/dev/null}"'],
      }),
      line: 'fake-logout',
    },
  },
  // Shares everything in its usual folder but its sign-in, as OpenCode's data folder does.
  home: {
    variable: 'FAKE_HOME',
    usual: () => join(fakeHomes, id),
    shared: (names) => names.filter((name) => name !== 'auth.json'),
    ...(oneAccount.includes(id) ? { accounts: 'one' as const } : {}),
  },
  permissions: codexLikeMeanings,
  permissionJudge: { sessionMeta: { fake: { tools: [] } } },
  // One fake agent passes session options, as Claude Code's entry does.
  ...(id === 'claude-code'
    ? {
        sessionMeta: (role?: 'lead' | 'reader', options?: SessionOptions) => {
          sessionMetas.push({ role, options })
          return { fake: { asks: true } }
        },
        contains: () => fakeSandbox.contains,
        upFront: true as const,
      }
    : {}),
  // Each may lead a review of a pull request from outside but `codex`, as the registry's Codex may not.
  reviewing: { outside: id !== 'codex' },
  knownGaps: [],
})

/**
 * Agents for tests: the fake agent, in this process, under any id, on the
 * runtime's clock. The id `process` runs it as a real process with Bun, on
 * the system's, and `process-temp` too, with a temp folder of its own as
 * Antigravity's launch asks (`privateTemp`); `missing` names a command that
 * doesn't exist.
 */
export const fakeAgents = (
  options: FakeAgentOptions = {},
  signedOut: ReadonlyArray<string> = [],
  /** Options for one agent, over the ones for all. */
  each: Readonly<Record<string, FakeAgentOptions>> = {},
  perUse: ReadonlyArray<string> = [],
  oneAccount: ReadonlyArray<string> = [],
  unsure: ReadonlyArray<string> = [],
) => {
  const entry =
    (clock: Clock.Clock) =>
    (agentId: string): AgentEntry => ({
      definition: definition(agentId, signedOut, perUse, oneAccount, unsure),
      transport: (cwd, env = {}, session) => {
        launches.push({ agentId, cwd, env, options: session })
        // As a real process, it carries whose work it is, as every agent does (machine.ts).
        const work = env[WORK]
        return agentId === 'process' || agentId === 'process-temp'
          ? {
              _tag: 'Process',
              spec: {
                command: 'bun',
                args: [fakeAgentMain],
                ...(work === undefined ? {} : { env: { [WORK]: work } }),
                ...(agentId === 'process-temp' ? { privateTemp: true as const } : {}),
              },
              cwd,
            }
          : agentId === 'missing'
            ? { _tag: 'Process', spec: { command: 'althar-no-such-agent', args: [] }, cwd }
            : // An account's own options, by its home's folder name (`codex@work`), or `@usual` for the agent's usual folder.
              {
                _tag: 'InProcess',
                agent: fakeAgent({
                  now: () => clock.currentTimeMillisUnsafe(),
                  ...options,
                  ...each[agentId],
                  ...each[`${agentId}@${env.FAKE_HOME === undefined ? 'usual' : basename(env.FAKE_HOME)}`],
                }),
              }
      },
    })
  return Layer.effect(
    Agents,
    Clock.clockWith((clock) =>
      Effect.succeed(
        Agents.of({
          list: ['claude-code', 'codex', 'opencode'].map(entry(clock)),
          get: (agentId) => Effect.succeed(entry(clock)(agentId)),
        }),
      ),
    ),
  )
}

/**
 * Code hosts and trackers for tests: GitHub and Linear, each answered by a
 * fake service, and sign-in endpoints answered by `fetch`, a stand-in.
 */
/** Linear, through one fake, or through the workspace's a connection's token signs in to. */
const linearOf = (linear: FakeService | Readonly<Record<string, FakeService>> | undefined) => {
  if (linear === undefined) return { ...products.linear, make: () => ({}), access: null }
  if ('product' in linear && typeof linear.product === 'string') {
    const one = linear as FakeService
    return { ...products.linear, make: () => ({ tracker: one }), access: one.access }
  }
  const routed = byToken(linear as Readonly<Record<string, FakeService>>)
  return { ...products.linear, make: (options: AdapterOptions) => ({ tracker: routed.tracker(options) }), access: routed.access }
}

export const fakeConnectors = (
  services: {
    readonly github?: FakeService
    /** Linear's fake, or one for each workspace, by the token that signs in to it. */
    readonly linear?: FakeService | Readonly<Record<string, FakeService>>
    readonly trello?: FakeService
  },
  more: {
    readonly fetch?: Fetch
    readonly clientIds?: Readonly<Record<string, string>>
    readonly callbackPort?: number
    readonly cliToken?: (tool: 'gh' | 'glab', host: string) => Effect.Effect<string | null, CliUnanswered>
  } = {},
) =>
  Layer.succeed(
    Connectors,
    Connectors.of({
      products: [
        {
          ...products.github,
          make: () => (services.github === undefined ? {} : { host: services.github, tracker: services.github }),
          access: services.github?.access ?? null,
        },
        linearOf(services.linear),
        {
          ...products.trello,
          make: () => (services.trello === undefined ? {} : { tracker: services.trello }),
          access: services.trello?.access ?? null,
        },
      ],
      fetch: more.fetch ?? (() => Promise.reject(new Error('No network in tests'))),
      clientIds: more.clientIds ?? {},
      callbackPort: more.callbackPort ?? 0,
      cliToken: more.cliToken ?? (() => Effect.succeed(null)),
    }),
  )

/** The runtime over a database, with worktrees in a temporary folder and fake agents, and a plan's countdown of a moment. */
export const runtime = (
  database = ':memory:',
  options: FakeAgentOptions = {},
  more: {
    readonly signedOut?: ReadonlyArray<string>
    readonly agents?: Layer.Layer<Agents>
    /** A plan's countdown; null leaves it to the person's setting (longRuns.ts). */
    readonly countdown?: Duration.Duration | null
    readonly connectors?: Layer.Layer<Connectors>
    readonly listenEvery?: Duration.Duration
    /** How long a pull request may show no checks before it counts as having none; none at all unless a test says. */
    readonly checksAppear?: Duration.Duration
    /** How long a change's checks may run before it is the person's; 45 minutes unless a test says. */
    readonly checksStuck?: Duration.Duration
    readonly each?: Readonly<Record<string, FakeAgentOptions>>
    /** Agents signed in on a key, paid per use, rather than a plan: by id, or by an account's home. */
    readonly perUse?: ReadonlyArray<string>
    /** Agents whose status can't tell a plan from a key. */
    readonly unsure?: ReadonlyArray<string>
    /** Agents whose sign-in every folder shares, which have their one account. */
    readonly oneAccount?: ReadonlyArray<string>
    readonly stalls?: StallOptions
    readonly stopGrace?: Duration.Duration
    readonly permissionJudgeTimeout?: Duration.Duration
    /** Where what is known of models comes from; nothing is fetched without it. */
    readonly modelFacts?: ModelFactsOptions
    /** The editors a task's files open in, and what opening one does. */
    readonly editors?: RuntimeOptions['editors']
    /** Where the artifact store keeps bytes; a folder of its own unless a test says (null: nowhere). */
    readonly artifactsRoot?: string | null
    /** How worktrees are set up: in sh, rather than the person's own shell and its profile, unless a test says. */
    readonly setups?: SetupOptions
    /** How this computer's load is read. */
    readonly load?: LoadOptions
    /** How plan usage is read from each agent. */
    readonly usage?: PlanUsageOptions
    /** When a lead that ended its turn counts as done, and how long a round waits for one that isn't. */
    readonly idle?: IdleOptions
    /** The device outside a sandbox, as for a Flatpak. */
    readonly onDevice?: RuntimeOptions['onDevice']
    /** The machine how many agents are at work at once comes from; a large one unless a test says, so no test waits on the Mac it runs on. */
    readonly busy?: BusyOptions
    /** The keychain, kept across runtimes given the same one; else each its own. */
    readonly keychain?: Map<string, string>
    /** How a screenshot is taken, where a test takes one; without, none can be. */
    readonly screenshot?: RuntimeOptions['screenshot']
    /** The clock and zone automations are read by, and how often they are looked at. */
    readonly automations?: AutomationOptions
    /** The disk finished tasks' folders are on; a roomy one unless a test says, so no test removes them for the Mac it runs on being full. */
    readonly disk?: RuntimeOptions['disk']
    /** Whether agents' services answer, and how long a step waits to try one again; no service answers any test unless it says. */
    readonly connectivity?: RuntimeOptions['connectivity']
    /** When what settled tasks left running is first looked for, and how often after; not within a test unless it says. */
    readonly leftFirst?: Duration.Duration
    readonly leftEvery?: Duration.Duration
  } = {},
) =>
  Runtime.layer({
    database,
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
    ...(more.artifactsRoot === null ? {} : { artifactsRoot: more.artifactsRoot ?? mkdtempSync(join(tmpdir(), 'althar-artifacts-')) }),
    // Nothing opens on the Mac running the tests: what would have is kept.
    openTerminal: (line) => Effect.sync(() => void opened.push(line)).pipe(Effect.as(false)),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: more.agents ?? fakeAgents(options, more.signedOut, more.each, more.perUse, more.oneAccount, more.unsure),
    ...(more.countdown === null ? {} : { countdown: more.countdown ?? Duration.millis(300) }),
    secrets: Secrets.memory(more.keychain),
    connectors: more.connectors ?? fakeConnectors({}),
    ...(more.listenEvery === undefined ? {} : { listenEvery: more.listenEvery }),
    checksAppear: more.checksAppear ?? Duration.zero,
    ...(more.checksStuck === undefined ? {} : { checksStuck: more.checksStuck }),
    ...(more.stalls === undefined ? {} : { stalls: more.stalls }),
    ...(more.stopGrace === undefined ? {} : { stopGrace: more.stopGrace }),
    ...(more.permissionJudgeTimeout === undefined ? {} : { permissionJudgeTimeout: more.permissionJudgeTimeout }),
    ...(more.modelFacts === undefined ? {} : { modelFacts: more.modelFacts }),
    ...(more.editors === undefined ? {} : { editors: more.editors }),
    setups: { shell: '/bin/sh', ...more.setups },
    ...(more.load === undefined ? {} : { load: more.load }),
    // No test reads a real sign-in: a provider's usage endpoint answers that there is none, unless a test says.
    usage: { readEndpoint: () => Promise.resolve({ kind: 'none' as const }), ...more.usage },
    // A round waits a moment, not two seconds, for its lead to report what it left running after its turn: the fake
    // agents report it within the turn, but where a test says.
    idle: { reports: Duration.millis(300), ...more.idle },
    ...(more.onDevice === undefined ? {} : { onDevice: more.onDevice }),
    ...(more.screenshot === undefined ? {} : { screenshot: more.screenshot }),
    busy: { machine: ROOMY, ...more.busy },
    ...(more.automations === undefined ? {} : { automations: more.automations }),
    disk: more.disk ?? (() => Effect.succeed(ROOMY_DISK)),
    // No test reaches a real service: one asked about answers, as it would online, unless the test says.
    connectivity: { answers: () => Effect.succeed(true), ...more.connectivity },
    leftFirst: more.leftFirst ?? Duration.hours(1),
    ...(more.leftEvery === undefined ? {} : { leftEvery: more.leftEvery }),
  })

/** A disk with half of its 1 TB free: room enough that no finished task's folder goes for want of space. */
export const ROOMY_DISK = { total: 1024 ** 4, free: 1024 ** 4 / 2, used: 1024 ** 4 / 2 }

/** A machine with room for as many agents at once as Althar runs: 64 cores and 256 GB. */
export const ROOMY = { cores: 64, memory: 256 * 1024 ** 3 }

/** A GitHub instance that never answers: `.test` names nothing, so git's fetches fail at once, and the fake service stands in for its API. */
export const HOST = 'https://github.test'

/**
 * A repository whose origin is on a GitHub instance, as far as its remote
 * says, and a bare repository on disk that takes what is pushed to it.
 */
export const hosted = (path: ReadonlyArray<string> = ['meridian', 'api']) => {
  const working = repository()
  execFileSync('git', ['remote', 'add', 'origin', `${HOST}/${path.join('/')}.git`], { cwd: working })
  const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
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

/**
 * A reset two minutes off, for a test on its clock (`onTestClock`): the test moves the clock to it (`atReset`) once
 * what comes before it has, as another task's lead taking the one place, however long getting there took. Further
 * than any test takes to get there, and nearer than what else the runtime does by the clock meanwhile, which the move
 * brings on too: a quiet turn's stall at ten minutes, a plan's countdown at five.
 */
export const later = () => Date.now() + 2 * 60_000

/** The test's clock moved on to a reset as an agent's error gives it, to the second, and no further: nothing due after it comes yet. */
export const atReset = (at: number) => TestClock.setTime(Math.ceil(at / 1000) * 1000)

/** Waits until a query returns rows that pass the check, as long as its test may take (@althar/testing). */
export { until } from '@althar/testing/effect'

/**
 * Runs a test on its TestClock (`it.effect`), set to now and kept going with real time: what the runtime waits a
 * moment for, as a plan's countdown or a git process, comes as it would, and the test moves the clock on at once
 * (`TestClock.adjust`, `TestClock.setTime`) to what it would wait minutes or hours for, as a reset or a sweep. The
 * runtime and the fake agents in this process read that clock, so what waits for a time goes on exactly when the test
 * moves the clock past it: never before, on a slow machine, and never later.
 */
export const onTestClock = <A, E, R>(test: Effect.Effect<A, E, R>) =>
  TestClock.testClockWith((clock) =>
    Effect.gen(function* () {
      let last = Date.now()
      yield* clock.setTime(last)
      // Forked from the test, it ends with it.
      yield* Effect.forkChild(
        Effect.forever(
          Effect.andThen(
            clock.withLive(Effect.sleep(Duration.millis(10))),
            Effect.suspend(() => {
              const passed = Date.now() - last
              last += passed
              return clock.adjust(passed)
            }),
          ),
        ),
      )
      return yield* test
    }),
  )

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

/** The names of the tools a session is given, as its agent lists them. */
export const listTools = (access: ToolAccess) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return []
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return (await client.listTools()).tools.map((tool) => tool.name).toSorted()
      } finally {
        await client.close()
      }
    })
  })

/** The tools an agent with this access is offered, as it reads them: each one's name, description and input. */
export const toolsOf = (access: ToolAccess) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return []
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return (await client.listTools()).tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          properties: Object.keys(tool.inputSchema.properties ?? {}),
        }))
      } finally {
        await client.close()
      }
    })
  })

/** The tools an agent with this access is offered, each with the description it reads. */
export const toolDescriptions = (access: ToolAccess) =>
  Effect.map(toolsOf(access), (tools): Record<string, string> => Object.fromEntries(tools.map((tool) => [tool.name, tool.description])))

/** Calls one of Althar's tools as an agent with this access would: over MCP, with the session's token. */
export const callTool = (access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  Effect.map(callToolAtOnce(access, name, [args]), (said) => said[0] ?? '')

/** Calls one of Althar's tools, and gives back all it answered: its words, and any picture, as the agent gets them. */
export const callToolWhole = (access: ToolAccess, name: string, args?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return { isError: true, content: [] as ReadonlyArray<Record<string, unknown>> }
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        const result = await client.callTool(args === undefined ? { name } : { name, arguments: args })
        return {
          isError: result.isError === true,
          content: (Array.isArray(result.content) ? result.content : []) as ReadonlyArray<Record<string, unknown>>,
        }
      } finally {
        await client.close()
      }
    })
  })

/** Calls one of Althar's tools several times at once over one connection, as an agent's parallel calls reach it: what each said. */
export const callToolAtOnce = (access: ToolAccess, name: string, calls: ReadonlyArray<Record<string, unknown> | undefined>) =>
  Effect.gen(function* () {
    const toolServer = yield* ToolServer
    const granted = yield* toolServer.grant(access)
    const server = granted.server
    if (server.type !== 'http') return calls.map(() => '')
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return await Promise.all(
          calls.map(async (args) => {
            const result = await client.callTool(args === undefined ? { name } : { name, arguments: args })
            const content = Array.isArray(result.content) ? result.content : []
            return content.map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '')).join('')
          }),
        )
      } finally {
        await client.close()
      }
    })
  })
