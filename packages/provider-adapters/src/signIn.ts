import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { asNode } from './process'
import type { AgentDefinition, PaidBy } from './registry'

export type SignInStatus = 'signed_in' | 'signed_out' | 'unknown'

/** An agent's sign-in, and how it is paid for, where its status says. */
export interface SignInCheck {
  readonly status: SignInStatus
  readonly paidBy: PaidBy | 'unknown'
}

/**
 * Whether the user is signed in to an agent, and how that is paid for, from
 * its documented status command. A command that is missing, fails to run, or
 * prints something unexpected gives `unknown`, never an error: the first
 * prompt will say.
 */
export const signInCheck = (
  agent: AgentDefinition,
  node: string = process.execPath,
  /** An account's home, as the agent's environment points at it (ADR-012); none for its usual folder. */
  home: Readonly<Record<string, string>> = {},
): Effect.Effect<SignInCheck> =>
  Effect.callback<SignInCheck>((resume) => {
    const spec = agent.signIn.status(node)
    execFile(
      spec.command,
      [...spec.args],
      { timeout: 15_000, env: { ...process.env, ...asNode(spec), ...spec.env, ...home } },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') return resume(Effect.succeed({ status: 'unknown', paidBy: 'unknown' }))
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        const output = `${stdout}\n${stderr}`
        const signedIn = agent.signIn.read(output, exitCode)
        resume(
          Effect.succeed({
            status: signedIn === undefined ? 'unknown' : signedIn ? 'signed_in' : 'signed_out',
            paidBy: agent.signIn.paidBy?.(output) ?? 'unknown',
          }),
        )
      },
    )
  })

/** Whether the user is signed in to an agent (see `signInCheck`). */
export const signInStatus = (agent: AgentDefinition, node: string = process.execPath): Effect.Effect<SignInStatus> =>
  Effect.map(signInCheck(agent, node), (check) => check.status)
