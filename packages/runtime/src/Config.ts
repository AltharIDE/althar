import { agents, type AgentDefinition, type Transport } from '@charrette/provider-adapters'
import { Context, Crypto, type Duration, Effect, Layer } from 'effect'

import { UnknownAgent } from './errors'

export interface RuntimeOptions {
  /** Where task worktrees go: `<root>/<project>/<task>/<repository>` (ADR-006). */
  readonly worktreeRoot: string
  readonly appVersion: string
  /** What this device is called, when the profile is new. */
  readonly deviceName: string
  /** How long a proposed plan waits before it starts on its own: 25 seconds unless a test says otherwise. */
  readonly countdown?: Duration.Duration
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
export class Agents extends Context.Service<
  Agents,
  {
    /** Every agent the runtime can start. */
    readonly list: ReadonlyArray<AgentEntry>
    get(agentId: string): Effect.Effect<AgentEntry, UnknownAgent>
  }
>()('@charrette/runtime/Agents') {
  /** Agents from a list of entries. */
  static readonly from = (entries: ReadonlyArray<AgentEntry>) =>
    Agents.of({
      list: entries,
      get: (agentId) => {
        const entry = entries.find((candidate) => candidate.definition.id === agentId)
        return entry === undefined ? Effect.fail(new UnknownAgent({ agentId })) : Effect.succeed(entry)
      },
    })

  static readonly registry: Layer.Layer<Agents> = Layer.succeed(
    Agents,
    Agents.from(
      Object.values(agents).map((definition) => ({
        definition,
        transport: (cwd: string) => ({ _tag: 'Process' as const, spec: definition.launch(process.execPath), cwd }),
      })),
    ),
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
