import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { adapterNode, asNode } from './process'
import type { AgentDefinition } from './registry'

/*
 * An agent's own version, as its CLI says it (`claude --version`: "2.1.263
 * (Claude Code)"), for Settings to show under its name. Null where it has no
 * such command, or it doesn't answer.
 */

/** The first version number in what a CLI printed. */
export const versionIn = (output: string): string | null => /\d+\.\d+(?:\.\d+)?/.exec(output)?.[0] ?? null

/** A version's major number: 2 for `2.0.29`; null where it isn't a version. */
export const majorOf = (version: string): number | null => {
  const major = /^(\d+)\./.exec(version)?.[1]
  return major === undefined ? null : Number(major)
}

/**
 * Why no session starts on this version of the agent: its `why`, where the
 * agent runs at one major only and this is another. Null where it runs, or
 * where the version couldn't be read, which isn't taken as another major.
 */
export const unsupportedAt = (agent: Pick<AgentDefinition, 'supported'>, version: string | null): string | null => {
  const major = version === null ? null : majorOf(version)
  return agent.supported === undefined || major === null || major === agent.supported.major ? null : agent.supported.why
}

/** The same, for the copy its commands run now, asked of it now: the person may have changed it since Althar started. */
export const unsupportedNow = (agent: AgentDefinition, node: string = adapterNode()): Effect.Effect<string | null> =>
  agent.supported === undefined ? Effect.succeed(null) : Effect.map(agentVersion(agent, node), (version) => unsupportedAt(agent, version))

export const agentVersion = (agent: AgentDefinition, node: string = adapterNode()): Effect.Effect<string | null> => {
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
