import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type AgentDefinition, agents } from '../src/registry'
import { signInStatus } from '../src/signIn'

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

describe('signInStatus', () => {
  it.live('runs the status command and reads it', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* signInStatus(withStatus("console.log('Logged in using ChatGPT')")), 'signed_in')
      assert.strictEqual(yield* signInStatus(withStatus("console.log('Not logged in'); process.exit(1)")), 'signed_out')
      assert.strictEqual(yield* signInStatus(withStatus("console.log('something else')")), 'unknown')
    }),
  )

  it.live('says unknown when the command is missing', () =>
    Effect.gen(function* () {
      const missing: AgentDefinition = {
        ...agents.codex,
        signIn: { ...agents.codex.signIn, status: () => ({ command: 'charrette-no-such-cli', args: [] }) },
      }
      assert.strictEqual(yield* signInStatus(missing), 'unknown')
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
