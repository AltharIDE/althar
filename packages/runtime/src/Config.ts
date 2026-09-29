import { agents, type AgentDefinition, type Transport } from '@charrette/provider-adapters'
import { Context, Crypto, Effect, Layer } from 'effect'

import { UnknownAgent } from './errors'

export interface RuntimeOptions {
  /** Where task worktrees go: `<root>/<project>/<task>/<repository>` (ADR-006). */
  readonly worktreeRoot: string
  readonly appVersion: string
  /** What this device is called, when the profile is new. */
  readonly deviceName: string
}

export class RuntimeConfig extends Context.Service<RuntimeConfig, RuntimeOptions>()('@charrette/runtime/RuntimeConfig') {}

/** An agent the runtime can start: its registry entry, and how to reach it from a working directory. */
export interface AgentEntry {
  readonly definition: AgentDefinition
  readonly transport: (cwd: string) => Transport
}

/**
 * The agents the runtime starts. In the app they are the registry's, each run
 * as a process; tests put the fake agent here.
 */
export class Agents extends Context.Service<Agents, { get(agentId: string): Effect.Effect<AgentEntry, UnknownAgent> }>()(
  '@charrette/runtime/Agents',
) {
  static readonly registry: Layer.Layer<Agents> = Layer.succeed(
    Agents,
    Agents.of({
      get: (agentId) => {
        const definition = Object.values(agents).find((agent) => agent.id === agentId)
        return definition === undefined
          ? Effect.fail(new UnknownAgent({ agentId }))
          : Effect.succeed({
              definition,
              transport: (cwd) => ({ _tag: 'Process', spec: definition.launch(process.execPath), cwd }),
            })
      },
    }),
  )
}

/** Crypto from the platform's Web Crypto, which Node and Electron both have. */
export const WebCrypto: Layer.Layer<Crypto.Crypto> = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.map(
        Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, Uint8Array.from(data))),
        (buffer) => new Uint8Array(buffer),
      ),
  }),
)
