import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { adapterNode, asNode } from './process'
import type { AgentDefinition, LaunchSpec, PaidBy } from './registry'

export type SignInStatus = 'signed_in' | 'signed_out' | 'unknown'

/** An agent's sign-in, and how it is paid for, where its status says. */
export interface SignInCheck {
  readonly status: SignInStatus
  readonly paidBy: PaidBy | 'unknown'
  /** For an agent with a sign-in for each provider it reaches: the providers it lists as signed in. */
  readonly providers?: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly connections: string
    readonly pays?: 'plan' | 'key'
  }>
}

/**
 * Whether the user is signed in to an agent, and how that is paid for, from
 * its documented status command. An agent with none, a command that is
 * missing, fails to run, or prints something unexpected gives `unknown`,
 * never an error: the first prompt will say.
 */
export const signInCheck = (
  agent: AgentDefinition,
  node: string = adapterNode(),
  /** An account's home, as the agent's environment points at it (ADR-012); none for its usual folder. */
  home: Readonly<Record<string, string>> = {},
): Effect.Effect<SignInCheck> =>
  Effect.callback<SignInCheck>((resume) => {
    const unknown: SignInCheck = { status: 'unknown', paidBy: 'unknown' }
    const first = agent.signIn.status?.(node)
    if (first === undefined) return resume(Effect.succeed(unknown))
    const run = (spec: LaunchSpec, again: (() => void) | undefined) => {
      const env = { ...process.env, ...asNode(spec), ...spec.env, ...home }
      // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled.
      const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
      execFile(launched.command, [...launched.args], { timeout: 15_000, env, windowsHide: true }, (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number') return again === undefined ? resume(Effect.succeed(unknown)) : again()
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        const output = `${stdout}\n${stderr}`
        const signedIn = agent.signIn.read(output, exitCode)
        // The fallback is for a version that rejects the first's flags: one that answered, even with nothing to read, said what it knows.
        if (signedIn === undefined && exitCode !== 0 && again !== undefined) return again()
        const providers = agent.signIn.providers?.read(output) ?? []
        resume(
          Effect.succeed({
            status: signedIn === undefined ? 'unknown' : signedIn ? 'signed_in' : 'signed_out',
            paidBy: agent.signIn.paidBy?.(output) ?? 'unknown',
            ...(providers.length === 0 ? {} : { providers }),
          }),
        )
      })
    }
    const second = agent.signIn.statusFallback?.(node)
    run(first, second === undefined ? undefined : () => run(second, undefined))
  })

/** Whether the user is signed in to an agent (see `signInCheck`). */
export const signInStatus = (agent: AgentDefinition, node: string = adapterNode()): Effect.Effect<SignInStatus> =>
  Effect.map(signInCheck(agent, node), (check) => check.status)

/**
 * Signs an account out with the agent's own sign-out command, run in the
 * account's home: true when it says it did, or when the agent has none (its
 * sign-in is a file in the home). Never an error.
 */
export const signOut = (
  agent: AgentDefinition,
  node: string = adapterNode(),
  home: Readonly<Record<string, string>> = {},
): Effect.Effect<boolean> => {
  const logout = agent.signIn.logout
  if (logout === undefined) return Effect.succeed(true)
  return Effect.callback<boolean>((resume) => {
    const spec = logout.run(node)
    const env = { ...process.env, ...asNode(spec), ...spec.env, ...home }
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
    execFile(launched.command, [...launched.args], { timeout: 15_000, env, windowsHide: true }, (error) =>
      resume(Effect.succeed(error === null)),
    )
  })
}
