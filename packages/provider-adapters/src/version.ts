import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { asNode } from './process'
import type { AgentDefinition } from './registry'

/*
 * An agent's own version, as its CLI says it (`claude --version`: "2.1.263
 * (Claude Code)"), for Settings to show under its name. Null where it has no
 * such command, or it doesn't answer.
 */

/** The first version number in what a CLI printed. */
export const versionIn = (output: string): string | null => /\d+\.\d+(?:\.\d+)?/.exec(output)?.[0] ?? null

export const agentVersion = (agent: AgentDefinition, node: string = process.execPath): Effect.Effect<string | null> => {
  const spec = agent.version?.(node)
  if (spec === undefined) return Effect.succeed(null)
  return Effect.callback<string | null>((resume) => {
    const env = { ...process.env, ...asNode(spec) }
    // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled.
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
    execFile(launched.command, [...launched.args], { timeout: 10_000, env }, (error, stdout) =>
      resume(Effect.succeed(error === null ? versionIn(stdout) : null)),
    )
  })
}
