import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { asNode } from './process'
import type { AgentDefinition } from './registry'

export type SignInStatus = 'signed_in' | 'signed_out' | 'unknown'

/**
 * Whether the user is signed in to an agent, from its documented status
 * command. A command that is missing, fails to run, or prints something
 * unexpected gives `unknown`, never an error: the first prompt will say.
 */
export const signInStatus = (agent: AgentDefinition, node: string = process.execPath): Effect.Effect<SignInStatus> =>
  Effect.callback<SignInStatus>((resume) => {
    const spec = agent.signIn.status(node)
    execFile(
      spec.command,
      [...spec.args],
      { timeout: 15_000, env: { ...process.env, ...asNode(spec), ...spec.env } },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') return resume(Effect.succeed('unknown'))
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        const signedIn = agent.signIn.read(`${stdout}\n${stderr}`, exitCode)
        resume(Effect.succeed(signedIn === undefined ? 'unknown' : signedIn ? 'signed_in' : 'signed_out'))
      },
    )
  })
