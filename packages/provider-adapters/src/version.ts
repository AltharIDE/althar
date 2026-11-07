import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { adapterNode, asNode } from './process'
import type { AgentDefinition } from './registry'

/*
 * An agent's own version, as its CLI says it (`claude --version`: "2.1.263
 * (Claude Code)"), for Settings to show under its name. Null where it has no
 * such command, or it doesn't answer.
 */

/** The first version in what a CLI printed, keeping a pre-release suffix so minimum checks can reject it. */
export const versionIn = (output: string): string | null =>
  /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?/.exec(output)?.[0] ?? null

/** A version's major number: 2 for `2.0.29`; null where it isn't a version. */
export const majorOf = (version: string): number | null => {
  const major = /^(\d+)\./.exec(version)?.[1]
  return major === undefined ? null : Number(major)
}

/** Whether a complete numeric CLI version meets a complete numeric minimum; unknown versions fail closed. */
export const atLeastVersion = (version: string | null, minimum: string): boolean => {
  const parts = (one: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(one)
    if (match === null) return null
    const numbers = match.slice(1).map(Number)
    return numbers.every(Number.isSafeInteger) ? numbers : null
  }
  const actual = version === null ? null : parts(version)
  const required = parts(minimum)
  if (actual === null || required === null) return false
  for (let at = 0; at < actual.length; at += 1) {
    if (actual[at] !== required[at]) return (actual[at] ?? 0) > (required[at] ?? 0)
  }
  return true
}

export const agentVersion = (agent: AgentDefinition, node: string = adapterNode()): Effect.Effect<string | null> => {
  const spec = agent.version?.(node)
  if (spec === undefined) return Effect.succeed(null)
  return Effect.callback<string | null>((resume) => {
    // Its own environment too, as its status and sign-out have: an npm-installed one found off the PATH finds its Node by it.
    const env = { ...process.env, ...asNode(spec), ...spec.env }
    // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled.
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
    execFile(launched.command, [...launched.args], { timeout: 10_000, env, windowsHide: true }, (error, stdout) =>
      resume(Effect.succeed(error === null ? versionIn(stdout) : null)),
    )
  })
}
