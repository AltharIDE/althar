import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { agentTools, commandEnv, runIn, serversFor, setToolRoles } from '../src/agentTools'
import { turnOn } from '../src/mcpSync'
import { fakeAgents, homeWith } from './agentHome'
import { runtime } from './support'

/*
 * What Settings reads of the person's servers and skills, and the servers a
 * session is given, in a home of the test's own (ADR-097): each kind of
 * server as a session takes it, a reference to a variable expanded from
 * Althar's own environment, and what waits for the person, each kind as
 * Settings says it.
 */

const TOKEN = 'ALTHAR_AGENT_TOOLS_TEST_TOKEN'

/** A home whose agents have a server of each kind, and one set up two ways. */
const mixedHome = () => {
  const home = homeWith({
    claude: {
      mcpServers: {
        althar: { type: 'stdio', command: 'althar-mcp' },
        local: { type: 'stdio', command: 'srv', env: { TOKEN: `\${${TOKEN}}`, GONE: '${ALTHAR_AGENT_TOOLS_NOT_SET}', MODE: 'one' } },
        web: { type: 'http', url: 'https://web.example/mcp', headers: { Authorization: `Bearer \${${TOKEN}}`, 'X-Team': 'web' } },
        events: { type: 'sse', url: 'https://events.example/sse' },
        twice: { type: 'stdio', command: 'one' },
      },
    },
    codex: {
      mcp_servers: {
        local: { command: 'srv-codex' },
        hosted: { url: 'https://hosted.example/mcp', bearer_token_env_var: TOKEN },
        quiet: { command: 'quiet', enabled: false },
        twice: { command: 'two' },
      },
    },
    opencode: '{ "mcp": { oops',
  })
  // Its real path, as a skill's folder is read by.
  return { home: realpathSync(home), folder: mkdtempSync(join(tmpdir(), 'althar-agent-tools-')), env: {} }
}

const withToken = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      process.env[TOKEN] = 'live-token'
    }),
    () => effect,
    () =>
      Effect.sync(() => {
        delete process.env[TOKEN]
      }),
  )

describe('the person’s servers a session is given', () => {
  it.live('takes each kind as a session can call it, with what its references name expanded, and leaves out what it can’t', () => {
    const { home, folder, env } = mixedHome()
    return withToken(
      Effect.gen(function* () {
        const given = yield* serversFor('lead', 'project-a', true)
        assert.deepStrictEqual(
          [...given].sort((one, other) => one.name.localeCompare(other.name)),
          [
            { type: 'http', name: 'hosted', url: 'https://hosted.example/mcp', headers: { Authorization: 'Bearer live-token' } },
            { type: 'stdio', name: 'local', command: 'srv', args: [], env: { TOKEN: 'live-token', MODE: 'one' } },
            { type: 'stdio', name: 'twice', command: 'one', args: [], env: {} },
            {
              type: 'http',
              name: 'web',
              url: 'https://web.example/mcp',
              headers: { Authorization: 'Bearer live-token', 'X-Team': 'web' },
            },
          ],
        )
        // An agent that can't call one over HTTP gets only those it runs.
        assert.deepStrictEqual((yield* serversFor('lead', 'project-a', false)).map((one) => one.name).sort(), ['local', 'twice'])
        // Taken off leads in one project: not given there, given in another.
        yield* setToolRoles('server', 'web', ['reviewer'], 'project-a')
        assert.notInclude(
          (yield* serversFor('lead', 'project-a', true)).map((one) => one.name),
          'web',
        )
        assert.include(
          (yield* serversFor('lead', 'project-b', true)).map((one) => one.name),
          'web',
        )
        assert.include(
          (yield* serversFor('reviewer', 'project-a', true)).map((one) => one.name),
          'web',
        )
      }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env } }))),
    )
  })

  it.live('are none where the runtime reads no agents’ settings', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* serversFor('lead', 'project-a', true), [])
      const tools = yield* agentTools(null)
      assert.strictEqual(tools.enabled, false)
      assert.deepStrictEqual(tools.servers, [])
    }).pipe(Effect.provide(runtime(':memory:'))),
  )
})

describe('what Settings reads', () => {
  it.live('says each thing that waits for the person, each kind its own way, and each skill with its description', () => {
    const { home, folder, env } = mixedHome()
    const skills = (agent: string, name: string, body: string) => {
      mkdirSync(join(home, agent, name), { recursive: true })
      writeFileSync(join(home, agent, name, 'SKILL.md'), body)
    }
    skills(join('.claude', 'skills'), 'design-review', '---\nname: design-review\ndescription: "Reviews a design against DESIGN.md"\n---\n')
    skills(join('.claude', 'skills'), 'bare', 'no frontmatter at all\n')
    skills(join('.claude', 'skills'), 'notes', 'one version\n')
    skills(join('.agents', 'skills'), 'notes', 'another version\n')
    return Effect.gen(function* () {
      const tools = yield* agentTools('project-a')
      assert.strictEqual(tools.enabled, true)
      const settle = tools.serverSync.settle
      assert.deepInclude(settle, { kind: 'cant', name: 'events', agent: 'codex', why: 'sse' })
      assert.deepInclude(settle, {
        kind: 'differs',
        name: 'twice',
        ways: [
          { agent: 'claude', runs: 'one' },
          { agent: 'codex', runs: 'two' },
        ],
      })
      assert.isTrue(settle.some((one) => one.kind === 'unreadable' && one.agent === 'opencode'))
      const local = tools.servers.find((one) => one.name === 'local')
      assert.deepStrictEqual(
        local?.sources.map((one) => one.from),
        ['claude', 'codex'],
      )
      assert.strictEqual(local?.about, 'srv')
      assert.deepStrictEqual(local?.here, { claude: 'differs', codex: 'differs', opencode: 'missing' })

      assert.deepStrictEqual(
        tools.skills.map((one) => [one.name, one.about]),
        [
          ['bare', ''],
          ['design-review', 'Reviews a design against DESIGN.md'],
          ['notes', ''],
        ],
      )
      assert.deepStrictEqual(tools.skillSync.settle, [
        {
          kind: 'differs',
          name: 'notes',
          ways: [
            { agent: 'claude', runs: '~/.claude/skills/notes' },
            { agent: 'codex', runs: '~/.agents/skills/notes' },
          ],
        },
      ])
      assert.deepStrictEqual(
        tools.skillSync.targets.map((one) => one.agent),
        ['claude', 'codex'],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder, env } })))
  })

  it.live('says a remote server it copied waits on a sign-in, and what it added to each agent once it is on', () => {
    const home = homeWith({ claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } } })
    const { io } = fakeAgents(home)
    return Effect.gen(function* () {
      yield* Effect.promise(() => turnOn(io))
      const tools = yield* agentTools(null)
      assert.deepInclude(tools.serverSync.settle, { kind: 'signIn', name: 'linear', agents: ['codex', 'opencode'] })
      assert.deepStrictEqual(tools.serverSync.targets.find((one) => one.agent === 'codex')?.adds, ['linear'])
      assert.deepStrictEqual(tools.servers[0]?.here, { claude: 'in', codex: 'added', opencode: 'added' })
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder: io.folder, run: io.run, env: {} } })))
  })

  it.live('reads every role as on where what was kept of them can’t be read', () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO settings (key, value, updated_at) VALUES ('agent_tools', 'not json', '2026-11-07T10:00:00.000Z')`
      assert.deepStrictEqual((yield* agentTools(null)).servers[0]?.roles, ['lead', 'reviewer', 'coordinator'])
    }).pipe(
      Effect.provide(
        runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder: mkdtempSync(join(tmpdir(), 'althar-roles-')), env: {} } }),
      ),
    )
  })
})

describe('an agent’s command, as sync runs it', () => {
  it('says plainly one that isn’t on this computer, and gives a failing one’s code and words', async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-run-'))
    const empty = mkdtempSync(join(tmpdir(), 'althar-no-bin-'))
    const missing = await runIn(home, { PATH: empty })('codex', ['mcp', 'list'])
    assert.strictEqual(missing.code, 127)
    assert.strictEqual(missing.output, 'Its `codex` command isn’t on this computer, so Codex wasn’t changed.')
    const failing = await runIn(home, { PATH: '/bin:/usr/bin' })('sh', ['-c', 'echo nope >&2; exit 3'])
    assert.deepStrictEqual(failing, { code: 3, output: 'nope\n' })
  })

  it('keeps a configured CODEX_HOME, and finds the agents’ commands where they are installed', () => {
    const env = commandEnv('/home/someone', { CODEX_HOME: '/elsewhere/codex' }, { HOME: '/home/other', LANG: 'en_GB.UTF-8' })
    assert.strictEqual(env['CODEX_HOME'], '/elsewhere/codex')
    assert.strictEqual(env['HOME'], '/home/someone')
    assert.strictEqual(env['LANG'], 'en_GB.UTF-8')
    assert.include(env['PATH'], '/home/someone/.local/bin')
    assert.isFalse(env['PATH']!.startsWith(':'))
  })
})
