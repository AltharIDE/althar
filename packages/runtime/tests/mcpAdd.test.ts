import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentServers } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { addServer, removeServer, serverDetail } from '../src/mcpAdd'
import { claudeLines, codexLines, mask, openCodeLines } from '../src/mcpLines'
import { keepOut, readRecord, reconcile, syncState, turnOn } from '../src/mcpSync'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { fakeAgents, homeWith } from './agentHome'
import { repository, runtime } from './support'

/*
 * A server opened out, added and taken out, in a home of the test's own with
 * fakes of the agents' commands (ADR-097): each agent's file as it keeps the
 * server, its values masked; a server added as the person's own, never over
 * one of its name, the others written where one agent can't be; and one taken
 * out of every agent, which sync then doesn't copy back.
 */

/** Commands that are on no computer: Althar's own check of them fails at once, and starts nothing. */
const GH = 'althar-test-no-such-github-server'

const names = (home: string, agent: 'claude' | 'codex' | 'opencode') =>
  agentServers(agent, { homeDir: home }).servers.map((one) => one.name)

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => assert.fail('it should have failed'),
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('the lines each agent keeps', () => {
  it('draws a server as each agent writes it, its written-out values masked and its references kept', () => {
    const spec = mask({
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@github/github-mcp-server'],
      env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', MODE: 'fast' },
    })
    assert.deepStrictEqual(claudeLines(spec), [
      '"gh": {',
      '  "type": "stdio",',
      '  "command": "npx",',
      '  "args": [',
      '    "-y",',
      '    "@github/github-mcp-server"',
      '  ],',
      '  "env": {',
      '    "GITHUB_TOKEN": "${GITHUB_TOKEN}",',
      '    "MODE": "••••"',
      '  }',
      '}',
    ])
    assert.deepStrictEqual(codexLines(spec), [
      '[mcp_servers.gh]',
      'command = "npx"',
      'args = ["-y", "@github/github-mcp-server"]',
      '',
      '[mcp_servers.gh.env]',
      'GITHUB_TOKEN = "${GITHUB_TOKEN}"',
      'MODE = "••••"',
    ])
    assert.deepStrictEqual(openCodeLines({ ...spec, off: true }), [
      '"gh": {',
      '  "type": "local",',
      '  "command": [',
      '    "npx",',
      '    "-y",',
      '    "@github/github-mcp-server"',
      '  ],',
      '  "environment": {',
      '    "GITHUB_TOKEN": "{env:GITHUB_TOKEN}",',
      '    "MODE": "••••"',
      '  },',
      '  "enabled": false',
      '}',
    ])
    const web = mask({
      name: 'my server',
      transport: 'http',
      url: 'https://web.example/mcp',
      tokenVariable: 'WEB_TOKEN',
      headers: { 'X-Team': 'web', Authorization: 'Bearer written-out' },
    })
    assert.deepStrictEqual(codexLines(web), [
      '[mcp_servers."my server"]',
      'url = "https://web.example/mcp"',
      'bearer_token_env_var = "WEB_TOKEN"',
      '',
      '[mcp_servers."my server".http_headers]',
      'X-Team = "••••"',
      'Authorization = "Bearer ••••"',
    ])
  })
})

describe('a server opened out', () => {
  it.live('says how it stands in each agent’s own file, with the lines it has or would have there', () => {
    const home = homeWith({
      claude: {
        mcpServers: {
          gh: { type: 'stdio', command: GH, args: ['--stdio'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', MODE: 'fast' } },
          events: { type: 'sse', url: 'https://events.example/sse', headers: { 'X-Team': 'web' } },
          two: { type: 'stdio', command: 'althar-test-no-such-one' },
        },
      },
      codex: { mcp_servers: { two: { command: 'althar-test-no-such-two', env: { MODE: 'plain' } } } },
    })
    const { io } = fakeAgents(home)
    return Effect.gen(function* () {
      yield* Effect.promise(() => turnOn(io))
      yield* Effect.promise(() => keepOut(io, 'opencode', 'events'))

      const gh = yield* serverDetail('gh', null)
      assert.strictEqual(gh.runs, `${GH} --stdio`)
      assert.deepStrictEqual(
        gh.files.map((one) => [one.agent, one.where, one.state, one.why]),
        [
          ['claude', '~/.claude.json', 'yours', null],
          ['codex', '~/.codex/config.toml', 'cant', 'It reads a variable Codex takes only as a value.'],
          ['opencode', '~/.config/opencode/opencode.json', 'copied', null],
        ],
      )
      // Codex hasn't it: the lines Althar would write there, as Codex keeps them.
      assert.deepStrictEqual(gh.files[1]?.lines, [
        '[mcp_servers.gh]',
        `command = "${GH}"`,
        'args = ["--stdio"]',
        '',
        '[mcp_servers.gh.env]',
        'GITHUB_TOKEN = "${GITHUB_TOKEN}"',
        'MODE = "••••"',
      ])
      assert.include(gh.files[2]?.lines.join('\n'), '"GITHUB_TOKEN": "{env:GITHUB_TOKEN}"')
      assert.notInclude(JSON.stringify(gh), 'fast')
      // Althar's own check couldn't start a command that isn't there: no count, and why.
      assert.strictEqual(gh.tools, null)
      assert.isString(gh.toolsWhy)

      const two = yield* serverDetail('two', null)
      assert.deepStrictEqual(
        two.files.map((one) => [one.agent, one.state, one.runs]),
        [
          ['claude', 'yours', 'althar-test-no-such-one'],
          ['codex', 'differs', 'althar-test-no-such-two'],
          ['opencode', 'missing', 'althar-test-no-such-one'],
        ],
      )
      assert.deepStrictEqual(two.files[1]?.lines, [
        '[mcp_servers.two]',
        'command = "althar-test-no-such-two"',
        'args = []',
        '',
        '[mcp_servers.two.env]',
        'MODE = "••••"',
      ])

      const events = yield* serverDetail('events', null)
      assert.deepStrictEqual(
        events.files.map((one) => [one.agent, one.state, one.why]),
        [
          ['claude', 'yours', null],
          ['codex', 'cant', 'It runs over SSE, which Codex doesn’t take.'],
          ['opencode', 'out', null],
        ],
      )
      assert.include(events.files[2]?.lines.join('\n'), '"X-Team": "••••"')

      const missing = yield* Effect.flip(serverDetail('nowhere', null))
      assert.strictEqual(missing.message, 'None of your agents has a server named nowhere.')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder: io.folder, run: io.run, env: {} } })))
  })

  it.live('shows a repository’s own as its .mcp.json keeps it', () => {
    const home = homeWith({})
    const { io } = fakeAgents(home)
    const root = repository()
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: GH, env: { KEY: 'written-out' } } } }))
    return Effect.gen(function* () {
      const { projectId } = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
      const docs = yield* serverDetail('docs', projectId)
      assert.deepStrictEqual(
        docs.files.map((one) => [one.agent, one.where, one.state, one.signIn]),
        [['repository', '.mcp.json', 'yours', 'unknown']],
      )
      assert.include(docs.files[0]?.lines.join('\n'), '"KEY": "••••"')
      assert.notInclude(JSON.stringify(docs), 'written-out')
    }).pipe(Effect.provide(runtime(':memory:', {}, { agentConfigs: { homeDir: home, folder: io.folder, run: io.run, env: {} } })))
  })
})

describe('adding a server', () => {
  it('writes it into the one agent chosen, as the person’s own, with a copy of its file kept first', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' } } } })
    const { io, calls } = fakeAgents(home)
    await addServer(io, { name: 'linear', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR}' } }, ['claude'])
    assert.deepStrictEqual(
      agentServers('claude', { homeDir: home }).servers.find((one) => one.name === 'linear'),
      {
        name: 'linear',
        transport: 'http',
        url: 'https://mcp.linear.app/mcp',
        headers: { Authorization: 'Bearer ${LINEAR}' },
      },
    )
    assert.deepStrictEqual(names(home, 'codex'), [])
    assert.deepStrictEqual(calls.length, 1)
    const record = readRecord(io)
    assert.deepStrictEqual(record.added, [])
    assert.isTrue(existsSync(record.backups.claude ?? ''))
  })

  it('writes it into two, and into all three, where sync then has nothing to do', async () => {
    const home = homeWith({})
    const { io } = fakeAgents(home)
    await addServer(io, { name: 'gh', command: 'npx', args: ['-y', 'gh-mcp'], env: { MODE: 'fast' } }, ['claude', 'codex'])
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'codex'), names(home, 'opencode')], [['gh'], ['gh'], []])
    assert.deepStrictEqual(agentServers('codex', { homeDir: home }).servers[0], {
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'gh-mcp'],
      env: { MODE: 'fast' },
    })

    await turnOn(io)
    await addServer(io, { name: 'linear', url: 'https://mcp.linear.app/mcp' }, ['claude', 'codex', 'opencode'])
    await reconcile(io)
    const { record, plan } = syncState(io)
    assert.deepStrictEqual(plan.here['linear'], { claude: 'in', codex: 'in', opencode: 'in' })
    assert.deepStrictEqual(
      record.since.filter((one) => one.server === 'linear'),
      [],
    )
    assert.isFalse(record.added.some((one) => one.spec.name === 'linear'))
    assert.isFalse(plan.settle.some((one) => one.kind === 'signIn' && one.server === 'linear'))
  })

  it('refuses a name one of the chosen agents has, and writes nothing', async () => {
    const home = homeWith({ claude: { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } } })
    const { io, calls } = fakeAgents(home)
    const said = await failure(addServer(io, { name: 'linear', command: 'x' }, ['claude', 'codex']))
    assert.strictEqual(said, 'Claude Code already has a server named linear.')
    assert.deepStrictEqual(calls, [])
    assert.deepStrictEqual(names(home, 'codex'), [])
  })

  it('says in words what is wrong with what was given', async () => {
    const home = homeWith({})
    const { io, calls } = fakeAgents(home)
    const said = (server: Parameters<typeof addServer>[1], agents: Parameters<typeof addServer>[2] = ['claude']) =>
      failure(addServer(io, server, agents))
    assert.strictEqual(await said({ name: 'my server', command: 'x' }), 'A server’s name is letters, digits, hyphens and underscores.')
    assert.strictEqual(await said({ name: 'Althar', command: 'x' }), 'althar is the name of Althar’s own server.')
    assert.strictEqual(await said({ name: 'a' }), 'Give it an address or a command.')
    assert.strictEqual(await said({ name: 'a', url: 'https://a.example', command: 'x' }), 'Give it an address or a command, not both.')
    assert.strictEqual(await said({ name: 'a', url: 'ftp://a.example' }), 'Its address starts with https:// or http://.')
    assert.strictEqual(await said({ name: 'a', url: 'not an address' }), 'Its address starts with https:// or http://.')
    assert.strictEqual(await said({ name: 'a', command: 'x', headers: { 'X-A': 'b' } }), 'Only an address takes headers.')
    assert.strictEqual(
      await said({ name: 'a', command: 'x', env: { '1A': 'b' } }),
      '1A isn’t a variable’s name: letters, digits and underscores, not starting with a digit.',
    )
    assert.strictEqual(await said({ name: 'a', command: 'x' }, []), 'Choose an agent to add it to.')
    assert.deepStrictEqual(calls, [])
  })

  it('writes the others where one agent’s command fails or isn’t there, then says which wasn’t changed and why', async () => {
    const home = homeWith({})
    const { io } = fakeAgents(home, ['codex'])
    const said = await failure(addServer(io, { name: 'a', command: 'a' }, ['claude', 'codex', 'opencode']))
    assert.strictEqual(said, "Codex wasn’t changed: codex: couldn't write its settings.")
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'codex'), names(home, 'opencode')], [['a'], [], ['a']])

    const absent = fakeAgents(homeWith({}))
    const missing = { ...absent.io, run: async () => ({ code: 127, output: 'not found' }) }
    assert.strictEqual(
      await failure(addServer(missing, { name: 'b', command: 'b' }, ['claude', 'codex', 'opencode'])),
      'Claude Code wasn’t changed: its `claude` command isn’t on this computer. Codex wasn’t changed: its `codex` command isn’t on this computer.',
    )
    assert.deepStrictEqual(names(absent.io.home.homeDir, 'opencode'), ['b'])
  })

  it('doesn’t write to Codex what Codex can’t take, and says so', async () => {
    const home = homeWith({})
    const { io } = fakeAgents(home)
    const said = await failure(
      addServer(io, { name: 'web', url: 'https://web.example/mcp', headers: { 'X-Team': 'web' } }, ['claude', 'codex']),
    )
    assert.strictEqual(said, 'Codex wasn’t changed: it sends headers Codex can’t be given.')
    assert.deepStrictEqual(names(home, 'claude'), ['web'])
  })
})

describe('taking a server out', () => {
  it('takes it out of every agent, what Althar copied and what the person added alike, and sync doesn’t copy it back', async () => {
    const home = homeWith({ claude: { mcpServers: { a: { command: 'a' }, b: { command: 'b' } } } })
    const { io } = fakeAgents(home)
    await turnOn(io)
    assert.deepStrictEqual(names(home, 'opencode'), ['a', 'b'])
    await removeServer(io, 'a')
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'codex'), names(home, 'opencode')], [['b'], ['b'], ['b']])
    await reconcile(io)
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'codex'), names(home, 'opencode')], [['b'], ['b'], ['b']])
    const record = readRecord(io)
    assert.isFalse(record.added.some((one) => one.spec.name === 'a'))
    assert.deepStrictEqual(record.keptOut, { claude: [], codex: [], opencode: [] })
    assert.deepStrictEqual(record.since, [])
    // Put back by hand later, it is the person's again, and copied as any they add.
    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    claude.mcpServers['a'] = { command: 'a' }
    writeFileSync(join(home, '.claude.json'), JSON.stringify(claude))
    await reconcile(io)
    assert.include(names(home, 'codex'), 'a')
  })

  it('takes it out of the others where one agent can’t be changed, and keeps it out of them', async () => {
    const home = homeWith({
      claude: { mcpServers: { a: { command: 'a' } } },
      codex: { mcp_servers: { a: { command: 'a' } } },
      opencode: '{ "mcp": { "a": { "type": "local", "command": ["a"] } } }',
    })
    const working = fakeAgents(home)
    await turnOn(working.io)
    const failing = fakeAgents(home, ['codex'])
    const said = await failure(removeServer(failing.io, 'a'))
    assert.strictEqual(said, "Codex wasn’t changed: codex: couldn't write its settings.")
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'codex'), names(home, 'opencode')], [[], ['a'], []])
    await reconcile(working.io)
    assert.deepStrictEqual([names(home, 'claude'), names(home, 'opencode')], [[], []])
  })

  it('says so where no agent has it', async () => {
    const { io } = fakeAgents(homeWith({}))
    assert.strictEqual(await failure(removeServer(io, 'a')), 'None of your agents has a server named a.')
  })
})
