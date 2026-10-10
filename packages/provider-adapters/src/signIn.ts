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

/** A terminal command for the same executable and account environment the runtime uses. */
export const signInCommand = (
  agent: AgentDefinition,
  home: string | undefined,
  node: string = process.execPath,
  underElectron = process.versions.electron !== undefined,
): string => {
  const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`
  const spec = agent.signIn.loginRun?.(node)
  const env = {
    ...(spec === undefined ? {} : { ...asNode(spec, underElectron), ...spec.env }),
    ...(home === undefined ? {} : { [agent.home.variable]: home }),
  }
  const line = spec === undefined ? agent.signIn.login : [spec.command, ...spec.args].map(quote).join(' ')
  // Unset is significant: Claude chooses a different Keychain entry when its
  // config variable is present, even if it names the default directory.
  return [
    ...(home === undefined ? ['env', '-u', agent.home.variable] : []),
    ...Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`),
    line,
  ].join(' ')
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

/**
 * Signs an account out with the agent's own sign-out command, run in the
 * account's home: true when it says it did, or when the agent has none (its
 * sign-in is a file in the home). Never an error.
 */
export const signOut = (
  agent: AgentDefinition,
  node: string = process.execPath,
  home: Readonly<Record<string, string>> = {},
): Effect.Effect<boolean> => {
  const logout = agent.signIn.logout
  if (logout === undefined) return Effect.succeed(true)
  return Effect.callback<boolean>((resume) => {
    const spec = logout.run(node)
    execFile(spec.command, [...spec.args], { timeout: 15_000, env: { ...process.env, ...asNode(spec), ...spec.env, ...home } }, (error) =>
      resume(Effect.succeed(error === null)),
    )
  })
}
