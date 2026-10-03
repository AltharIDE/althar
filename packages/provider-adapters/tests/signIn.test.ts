import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type AgentDefinition, agents } from '../src/registry'
import { signInCheck, signInStatus } from '../src/signIn'

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

  it('names the command the user runs to sign in', () => {
    assert.deepStrictEqual(
      Object.values(agents).map((agent) => agent.signIn.login),
      ['claude auth login', 'codex login', 'opencode auth login'],
    )
  })
})

describe('an agent’s homes', () => {
  it('names the variable that points each agent at a home, and its usual folder', () => {
    const usual = (env: Record<string, string>) =>
      Object.values(agents).map((agent) => [agent.home.variable, agent.home.usual(env, '/Users/me')])
    assert.deepStrictEqual(usual({}), [
      ['CLAUDE_CONFIG_DIR', '/Users/me/.claude'],
      ['CODEX_HOME', '/Users/me/.codex'],
      ['XDG_DATA_HOME', '/Users/me/.local/share'],
    ])
    assert.deepStrictEqual(
      usual({ CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x', XDG_DATA_HOME: '/d' }).map(([, folder]) => folder),
      ['/c', '/x', '/d'],
    )
  })

  it('shares only settings and instructions, never a sign-in', () => {
    for (const agent of Object.values(agents))
      for (const name of agent.home.shared) assert.notMatch(name, /auth|credential|token|\.claude\.json|keychain/i, agent.id)
  })
})

describe('signInStatus', () => {
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

  it.live('says unknown when the command is missing', () =>
    Effect.gen(function* () {
      const missing: AgentDefinition = {
        ...agents.codex,
        signIn: { ...agents.codex.signIn, status: () => ({ command: 'charrette-no-such-cli', args: [] }) },
      }
      assert.strictEqual(yield* signInStatus(missing), 'unknown')
      assert.deepStrictEqual(yield* signInCheck(missing), { status: 'unknown', paidBy: 'unknown' })
    }),
  )

  it.live('runs bundled status commands on the Node it is given', () =>
    Effect.sync(() => {
      const spec = agents.codex.signIn.status('/path/to/node')
      assert.strictEqual(spec.command, '/path/to/node')
      assert.match(spec.args[0] ?? '', /@openai\/codex\/bin\/codex\.js$/)
    }),
  )
})
