import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type AgentDefinition, agents, type LaunchSpec, type OutOnDevice } from '../src/registry'
import { signInCheck, signOut } from '../src/signIn'
import { agentVersion } from '../src/version'

/*
 * An agent whose command lives out on the device (a Flatpak's host): its
 * status, sign-out and version run there, as its `onDevice` says, with the
 * environment Althar assembled for it, the account's home included.
 */

/** A command that isn't here, run out on the device as `bun -e script`; each environment it was run with is kept. */
const outThere = (script: string, seen: Array<Readonly<Record<string, string | undefined>>>): LaunchSpec => {
  const onDevice: OutOnDevice = (at) => {
    seen.push(at.env)
    return { command: 'bun', args: ['-e', script] }
  }
  return { command: 'althar-not-on-this-side', args: [], env: { ALTHAR_ASSEMBLED: 'yes' }, onDevice }
}

describe('an agent out on the device', () => {
  it.live('reads its sign-in from the status it runs out there, in the account’s home', () =>
    Effect.gen(function* () {
      const seen: Array<Readonly<Record<string, string | undefined>>> = []
      const agent: AgentDefinition = {
        ...agents.codex,
        signIn: { ...agents.codex.signIn, status: () => outThere("console.log('Logged in using ChatGPT')", seen) },
      }
      assert.deepStrictEqual(yield* signInCheck(agent, process.execPath, { CODEX_HOME: '/homes/work' }), {
        status: 'signed_in',
        paidBy: 'plan',
      })
      assert.deepStrictEqual(
        seen.map((env) => [env.CODEX_HOME, env.ALTHAR_ASSEMBLED]),
        [['/homes/work', 'yes']],
      )
    }),
  )

  it.live('signs an account out with the command it runs out there, and says when that failed', () =>
    Effect.gen(function* () {
      const seen: Array<Readonly<Record<string, string | undefined>>> = []
      const outWith = (script: string): AgentDefinition => ({
        ...agents.codex,
        signIn: { ...agents.codex.signIn, logout: { run: () => outThere(script, seen), line: 'codex logout' } },
      })
      assert.isTrue(yield* signOut(outWith('process.exit(0)'), process.execPath, { CODEX_HOME: '/homes/work' }))
      assert.isFalse(yield* signOut(outWith('process.exit(1)')))
      assert.deepStrictEqual(
        seen.map((env) => env.CODEX_HOME),
        ['/homes/work', process.env.CODEX_HOME],
      )
    }),
  )

  it.live('asks its version out there', () =>
    Effect.gen(function* () {
      const seen: Array<Readonly<Record<string, string | undefined>>> = []
      const agent: AgentDefinition = { ...agents.opencode, version: () => outThere("console.log('opencode 1.18.31')", seen) }
      assert.strictEqual(yield* agentVersion(agent), '1.18.31')
      assert.strictEqual(seen[0]?.ALTHAR_ASSEMBLED, 'yes')
    }),
  )
})
