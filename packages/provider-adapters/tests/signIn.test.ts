import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type AgentDefinition, agents } from '../src/registry'
import { usingLocated } from '../src/installs'
import { signInCheck, signInStatus, signOut } from '../src/signIn'

const withStatus = (script: string): AgentDefinition => ({
  ...agents.codex,
  signIn: { ...agents.codex.signIn, status: () => ({ command: 'bun', args: ['-e', script] }) },
})

describe('reading sign-in status', () => {
  it("reads Claude Code's JSON", () => {
    const { read } = agents['claude-code'].signIn
    assert.isTrue(read('{"loggedIn": true, "authMethod": "claude.ai"}', 0))
    assert.isFalse(read('{"loggedIn": false, "authMethod": "none"}', 0))
    assert.isUndefined(read('not json', 0))
    assert.isUndefined(read('{"authMethod": "none"}', 0))
  })

  it('reads how each sign-in is paid for: a plan, or per use, on a key', () => {
    const claude = agents['claude-code'].signIn.paidBy
    assert.deepStrictEqual(
      [
        claude?.('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}'),
        claude?.('{"loggedIn": true, "authMethod": "api_key"}'),
        claude?.('{"loggedIn": false, "authMethod": "none"}'),
        claude?.('{"loggedIn": true}'),
        claude?.('not json'),
      ],
      ['plan', 'key', undefined, undefined, undefined],
    )
    const codex = agents.codex.signIn.paidBy
    assert.deepStrictEqual(
      [codex?.('Logged in using ChatGPT'), codex?.('Logged in using an API key - sk-…'), codex?.('Not logged in')],
      ['plan', 'key', undefined],
    )
    assert.strictEqual(agents.opencode.signIn.paidBy?.('2 credentials'), 'key')
  })

  it("reads Codex's sentence and exit code", () => {
    const { read } = agents.codex.signIn
    assert.isTrue(read('Logged in using ChatGPT', 0))
    assert.isFalse(read('Not logged in', 1))
    assert.isUndefined(read('Logged in using ChatGPT', 1))
    assert.isUndefined(read('', 0))
  })

  it("reads OpenCode's credential count, where none is not a sign-out", () => {
    const { read } = agents.opencode.signIn
    assert.isTrue(read('└  2 credentials', 0))
    assert.isUndefined(read('└  0 credentials', 0))
    assert.isUndefined(read('', 0))
  })

  it('reads OpenCode 2’s JSON, a Console account as a sign-in like a key', () => {
    const { read, status } = agents.opencode.signIn
    assert.deepStrictEqual(status?.('node').args, ['auth', 'list', '--standalone', '--format', 'json'])
    // Seen on 2.2.5, 2 November 2026, ids redacted.
    const console_ = [
      { id: 'opencode', name: 'OpenCode Console', connections: [{ type: 'credential', id: 'cred_x', label: 'Default', method: 'oauth' }] },
    ]
    const key = [
      { id: 'opencode-go', name: 'OpenCode Go', connections: [{ type: 'credential', id: 'cred_y', label: 'default', method: 'key' }] },
    ]
    assert.isTrue(read(JSON.stringify(console_, null, 2), 0))
    assert.isTrue(read(JSON.stringify(key, null, 2) + '\n', 0))
    assert.isTrue(read(JSON.stringify([...key, ...console_]), 0))
    // None is "can't tell": the free models run signed out.
    assert.isUndefined(read('[]', 0))
    assert.isUndefined(read(JSON.stringify([{ id: 'opencode', connections: [] }]), 0))
    // The table 2.x prints without --format json carries no count.
    assert.isUndefined(read('OpenCode Go       default                     stored\n', 0))
  })

  it('reads the sign-ins 2.2.5 lists after `auth login --standalone`: Go and Zen keys, one Zen asks to reconnect', () => {
    const { read, providers } = agents.opencode.signIn
    // Seen 3 November 2026, made with fake keys in a home of its own: a Zen key is listed under OpenCode Console, with a status.
    const listed = [
      { id: 'opencode-go', name: 'OpenCode Go', connections: [{ type: 'credential', id: 'cred_go', label: 'Go key', method: 'key' }] },
      {
        id: 'opencode',
        name: 'OpenCode Console',
        connections: [
          {
            type: 'credential',
            id: 'cred_zen',
            label: 'Zen key',
            method: 'key',
            status: { status: 'needs_auth', message: 'Reconnect OpenCode Console to continue' },
          },
        ],
      },
    ]
    assert.isTrue(read(JSON.stringify(listed, null, 2) + '\n', 0))
    // Zen is what the person knows it as; each is paid as its provider is, Go on a plan.
    assert.deepStrictEqual(providers?.read(JSON.stringify(listed, null, 2)), [
      { id: 'opencode-go', name: 'OpenCode Go', connections: 'cred_go', pays: 'plan' },
      { id: 'opencode', name: 'OpenCode Zen', connections: 'cred_zen', pays: 'key' },
    ])
    assert.deepStrictEqual(providers?.plans, ['opencode-go'])
  })

  it('signs in where it is checked: in the home the line names, not the background service’s', () => {
    // 2.x's `auth login` without --standalone hands the key to its background service, which keeps it in the home it started in.
    assert.strictEqual(agents.opencode.signIn.login, 'opencode auth login --standalone')
    assert.includeMembers([...(agents.opencode.signIn.status?.('node').args ?? [])], ['--standalone'])
    assert.includeMembers([...(agents.opencode.signIn.credentials?.('node').args ?? [])], ['--standalone'])
  })

  it('lists the providers OpenCode has a sign-in for, and the provider a model goes through', () => {
    const providers = agents.opencode.signIn.providers
    assert.isDefined(providers)
    const listing = [
      { id: 'opencode-go', name: 'OpenCode Go', connections: [{ type: 'credential', id: 'cred_b', label: 'default', method: 'key' }] },
      { id: 'anthropic', name: 'Anthropic', connections: [{ type: 'credential', id: 'cred_a', label: 'default', method: 'oauth' }] },
      { id: 'google', name: 'Google', connections: [] },
    ]
    assert.deepStrictEqual(providers?.read(JSON.stringify(listing, null, 2)), [
      { id: 'opencode-go', name: 'OpenCode Go', connections: 'cred_b', pays: 'plan' },
      { id: 'anthropic', name: 'Anthropic', connections: 'cred_a' },
    ])
    // 1.x prints a count only: no providers, not an error.
    assert.deepStrictEqual(providers?.read('2 credentials'), [])
    assert.strictEqual(providers?.of('opencode-go/deepseek-v4.1-flash'), 'opencode-go')
    assert.isUndefined(providers?.of('big-pickle'))
  })

  it('signs an account out with the agent’s own command, in its home, where the agent has one', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const outIn = (script: string): AgentDefinition => ({
          ...agents.codex,
          signIn: { ...agents.codex.signIn, logout: { run: () => ({ command: 'bun', args: ['-e', script] }), line: 'codex logout' } },
        })
        assert.isTrue(
          yield* signOut(outIn("process.exit(process.env.CODEX_HOME === '/homes/work' ? 0 : 1)"), process.execPath, {
            CODEX_HOME: '/homes/work',
          }),
        )
        assert.isFalse(yield* signOut(outIn('process.exit(1)')))
        assert.isTrue(yield* signOut(agents.opencode))
        assert.deepStrictEqual(
          [
            agents['claude-code'].signIn.logout?.run('node').args,
            agents.codex.signIn.logout?.run('node').args.at(-1),
            agents.codex.signIn.logout?.line,
          ],
          [['auth', 'logout'], 'logout', 'codex logout'],
        )
      }),
    ))

  it('names the command the user runs to sign in', () => {
    assert.deepStrictEqual(
      Object.values(agents).map((agent) => agent.signIn.login),
      [
        'claude auth login',
        'codex login',
        'opencode auth login --standalone',
        'copilot login',
        'junie',
        'grok login',
        'kimi login',
        'vibe --setup',
        'qwen',
        // It signs in only over ACP, inside Althar.
        '',
      ],
    )
  })
})

/** What a usual folder might hold: settings, sign-ins, and other tools' data. */
const PRESENT = ['settings.json', 'CLAUDE.md', 'config.toml', 'AGENTS.md', 'auth.json', '.credentials.json', 'opencode', 'mise', 'pnpm']

describe('an agent’s homes', () => {
  it('names the variable that points each agent at a home, and its usual folder', () => {
    const usual = (env: Record<string, string>) =>
      Object.values(agents).map((agent) => [agent.home.variable, agent.home.usual(env, '/Users/me')])
    assert.deepStrictEqual(usual({}), [
      ['CLAUDE_CONFIG_DIR', join('/Users/me', '.claude')],
      ['CODEX_HOME', join('/Users/me', '.codex')],
      ['XDG_DATA_HOME', join('/Users/me', '.local', 'share')],
      ['COPILOT_HOME', join('/Users/me', '.copilot')],
      ['JUNIE_HOME', join('/Users/me', '.junie')],
      ['GROK_HOME', join('/Users/me', '.grok')],
      ['KIMI_CODE_HOME', join('/Users/me', '.kimi-code')],
      ['VIBE_HOME', join('/Users/me', '.vibe')],
      ['QWEN_HOME', join('/Users/me', '.qwen')],
      ['GEMINI_HOME', join('/Users/me', '.gemini')],
    ])
    assert.deepStrictEqual(
      usual({
        CLAUDE_CONFIG_DIR: '/c',
        CODEX_HOME: '/x',
        XDG_DATA_HOME: '/d',
        COPILOT_HOME: '/p',
        JUNIE_HOME: '/j',
        GROK_HOME: '/g',
        KIMI_CODE_HOME: '/k',
        VIBE_HOME: '/v',
        QWEN_HOME: '/q',
        GEMINI_HOME: '/m',
      }).map(([, folder]) => folder),
      ['/c', '/x', '/d', '/p', '/j', '/g', '/k', '/v', '/q', '/m'],
    )
  })

  it('shares only settings and instructions, never a sign-in', () => {
    // Where the home is the agent's own folder, nothing that signs in is shared.
    for (const agent of [agents['claude-code'], agents.codex])
      for (const name of agent.home.shared(PRESENT)) assert.notMatch(name, /auth|credential|token|\.claude\.json|keychain/i, agent.id)
    assert.deepStrictEqual(agents['claude-code'].home.shared(PRESENT), ['settings.json', 'CLAUDE.md'])
    assert.deepStrictEqual(agents.codex.home.shared(PRESENT), ['config.toml', 'AGENTS.md'])
    // OpenCode's home is the data folder every program uses: only its own stays apart.
    assert.deepStrictEqual(
      agents.opencode.home.shared(PRESENT),
      PRESENT.filter((name) => name !== 'opencode'),
    )
  })

  it('shares none of what signs the later agents in, or approves for them, or brings the person’s own tools', () => {
    const kept = [
      'config.json',
      'settings.json',
      'config.toml',
      'auth.json',
      '.env',
      'allowlist.json',
      'trusted_folders.toml',
      'permissions-config.json',
      'mcp-config.json',
      'mcp',
      'hooks',
      'installed-plugins',
      'sessions',
      'secure_credentials.json',
      'AGENTS.md',
      'skills',
    ]
    for (const id of ['copilot', 'junie', 'grok', 'kimi', 'mistral-vibe', 'qwen-code'] as const)
      assert.includeMembers(['AGENTS.md', 'skills'], [...agents[id].home.shared(kept)], id)
    // Antigravity's usual folder is Gemini CLI's too: its sign-in, its `config/` of MCP servers and hooks, and Gemini CLI's own stay.
    assert.deepStrictEqual(
      agents.antigravity.home.shared(['antigravity-acp', 'config', 'antigravity-cli', 'settings.json', 'oauth_creds.json', 'GEMINI.md']),
      ['GEMINI.md'],
    )
  })
})

describe('signInStatus', () => {
  it.live('falls back to the plain command where OpenCode 1.x rejects the JSON flags', () =>
    Effect.gen(function* () {
      // 1.x exits 1 on --standalone / --format json; its plain `auth list` prints a count.
      const script =
        "if (process.argv.includes('json')) { console.error('Unknown argument: standalone'); process.exit(1) } console.log('2 credentials')"
      const spec = (...extra: string[]) => ({ command: 'bun', args: ['-e', script, ...extra] })
      const old: AgentDefinition = {
        ...agents.opencode,
        signIn: {
          ...agents.opencode.signIn,
          status: () => spec('json'),
          statusFallback: () => spec(),
        },
      }
      assert.strictEqual((yield* signInCheck(old)).status, 'signed_in')
      // With no fallback the rejected flags would read as "can't tell".
      const { statusFallback: _dropped, ...withoutFallback } = old.signIn
      const bare: AgentDefinition = { ...old, signIn: withoutFallback }
      assert.strictEqual((yield* signInCheck(bare)).status, 'unknown')
      assert.deepStrictEqual(agents.opencode.signIn.statusFallback?.('node').args, ['auth', 'list'])
    }),
  )

  it.live('doesn’t fall back where 2.x answered with no sign-ins: the plain command answers for another home', () =>
    Effect.gen(function* () {
      // An account's own home with nothing in it yet; without --standalone the background service would list the usual home's.
      const script = "console.log(process.argv.includes('json') ? '[]' : '2 credentials')"
      const spec = (...extra: string[]) => ({ command: 'bun', args: ['-e', script, ...extra] })
      const empty: AgentDefinition = {
        ...agents.opencode,
        signIn: { ...agents.opencode.signIn, status: () => spec('json'), statusFallback: () => spec() },
      }
      assert.strictEqual((yield* signInCheck(empty)).status, 'unknown')
    }),
  )

  it.live('runs the status command and reads it', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* signInStatus(withStatus("console.log('Logged in using ChatGPT')")), 'signed_in')
      assert.strictEqual(yield* signInStatus(withStatus("console.log('Not logged in'); process.exit(1)")), 'signed_out')
      assert.strictEqual(yield* signInStatus(withStatus("console.log('something else')")), 'unknown')
      // In an account's home: the status command runs with it.
      const home = withStatus("console.log(process.env.CODEX_HOME === '/homes/work' ? 'Logged in using ChatGPT' : 'Not logged in')")
      assert.strictEqual((yield* signInCheck(home, process.execPath, { CODEX_HOME: '/homes/work' })).status, 'signed_in')
      assert.strictEqual((yield* signInCheck(home)).status, 'signed_out')
      // With how it is paid for, where the agent says.
      assert.deepStrictEqual(yield* signInCheck(withStatus("console.log('Logged in using ChatGPT')")), {
        status: 'signed_in',
        paidBy: 'plan',
      })
      assert.deepStrictEqual(yield* signInCheck(withStatus("console.log('something else')")), { status: 'unknown', paidBy: 'unknown' })
      // An agent whose status doesn't say how it is paid for.
      const { paidBy: _, ...without } = withStatus("console.log('Logged in using ChatGPT')").signIn
      const unread: AgentDefinition = { ...agents.codex, signIn: without }
      assert.strictEqual((yield* signInCheck(unread)).paidBy, 'unknown')
    }),
  )

  it.live('says unknown, running nothing, for an agent with no status command', () =>
    Effect.map(signInCheck(agents.copilot, '/no/such/node'), (check) =>
      assert.deepStrictEqual(check, { status: 'unknown', paidBy: 'unknown' }),
    ),
  )

  it('reads Grok’s sign-in from what `grok models` says first', () => {
    const { read, paidBy } = agents.grok.signIn
    assert.isFalse(read('You are not authenticated.\nDefault model: grok-4.6', 0))
    assert.isTrue(read('You are logged in with dana@example.com.\nDefault model: grok-4.6', 0))
    assert.isUndefined(read('Default model: grok-4.6', 0))
    assert.strictEqual(paidBy?.('You are logged in with dana@example.com.'), 'plan')
    assert.strictEqual(paidBy?.('You are using XAI_API_KEY.'), 'key')
    assert.isUndefined(paidBy?.('Default model: grok-4.6'))
  })

  it('reads Kimi Code as signed out only where it lists no provider', () => {
    const { read } = agents.kimi.signIn
    assert.isFalse(read('No providers configured. Run `kimi login`.', 0))
    assert.isUndefined(read('kimi-code  https://api.kimi.com', 0))
  })

  it.live('says unknown when the command is missing', () =>
    Effect.gen(function* () {
      const missing: AgentDefinition = {
        ...agents.codex,
        signIn: { ...agents.codex.signIn, status: () => ({ command: 'althar-no-such-cli', args: [] }) },
      }
      assert.strictEqual(yield* signInStatus(missing), 'unknown')
      assert.deepStrictEqual(yield* signInCheck(missing), { status: 'unknown', paidBy: 'unknown' })
    }),
  )

  it.live('resolves Codex status through the CLI the session uses', () =>
    Effect.sync(() => {
      const spec = agents.codex.signIn.status?.('/path/to/node')
      assert.strictEqual(spec?.command, 'codex')
      assert.deepStrictEqual(spec?.args, ['login', 'status'])
      const bundled = usingLocated(agents.codex, () => ({ command: '/bundle/codex', whose: 'bundled' }))
      assert.deepStrictEqual(bundled.signIn.status?.('/path/to/node'), { command: '/bundle/codex', args: ['login', 'status'] })
    }),
  )
})
