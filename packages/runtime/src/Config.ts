import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { available, type Fetch, type Product, type ProductInfo } from '@althar/connectors'
import { agents, type AgentDefinition, type Transport } from '@althar/provider-adapters'
import { Context, Crypto, type Duration, Effect, Layer } from 'effect'

import { UnknownAgent } from './errors'

export interface RuntimeOptions {
  /** Where task worktrees go: `<root>/<project>/<task>/<repository>` (ADR-006). */
  readonly worktreeRoot: string
  /** Where the homes of accounts Althar makes go (ADR-012): `<root>/<account>`. Without it, it makes none. */
  readonly accountsRoot?: string
  /** Opens a line in a terminal for the person to run, such as an agent's own sign-in; whether it could. Without it, the person runs it. */
  readonly openTerminal?: (line: string) => Effect.Effect<boolean>
  readonly appVersion: string
  /** What this device is called, when the profile is new. */
  readonly deviceName: string
  /** How long a proposed plan waits before it starts on its own: 25 seconds unless a test says otherwise. */
  readonly countdown?: Duration.Duration
  /** How often a task's pull requests are asked for news while it listens: 30 seconds unless a test says otherwise. */
  readonly listenEvery?: Duration.Duration
  /** The public ids of Althar's apps registered with code hosts and trackers, for their browser sign-in. */
  readonly clientIds?: Partial<Record<Product, string>>
  /** How long stopping an agent waits for it to end its turn before it stops its process: 10 seconds unless a test says otherwise. */
  readonly stopGrace?: Duration.Duration
  /** When a turn counts as stalled, and how much work goes on before the person is asked (`Stalls.ts`). */
  readonly stalls?: StallOptions
}

/** Each is the default unless a test says otherwise. */
export interface StallOptions {
  /** How often running turns are looked at: 30 seconds. */
  readonly every?: Duration.Duration
  /** How long a turn may show no sign of life before it counts as stalled: 10 minutes. */
  readonly quiet?: Duration.Duration
  /** The same while one of the agent's tools is running, such as a command: 20 minutes. */
  readonly quietInTool?: Duration.Duration
  /** How long an agent has to end a turn it was asked to stop, before it is started afresh: a minute. */
  readonly cancelGrace?: Duration.Duration
  /** How late a look at the turns may come before it means the machine slept: a minute past when it was due. */
  readonly asleepAfter?: Duration.Duration
  /** How long the agents may work on a thread since the person last said anything there: 6 hours. */
  readonly work?: Duration.Duration
  /** How many turns they may take in that time: 40. */
  readonly turns?: number
  /** The CPU time each process and everything it started have used, in milliseconds, or null once it's gone: read with `ps`, once a look. */
  readonly cpuOf?: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyMap<number, number | null>>
}

export class RuntimeConfig extends Context.Service<RuntimeConfig, RuntimeOptions>()('@althar/runtime/RuntimeConfig') {}

/** An agent the runtime can start: its registry entry, and how to reach it from a working directory. */
export interface AgentEntry {
  readonly definition: AgentDefinition
  /** How to reach it from a working directory, with an account's home in its environment (ADR-012). */
  readonly transport: (cwd: string, env?: Readonly<Record<string, string>>) => Transport
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
>()('@althar/runtime/Agents') {
  /** Agents from a list of entries. */
  static readonly from = (entries: ReadonlyArray<AgentEntry>) =>
    Agents.of({
      list: entries,
      get: (agentId) => {
        const entry = entries.find((candidate) => candidate.definition.id === agentId)
        return entry === undefined ? Effect.fail(new UnknownAgent({ agentId })) : Effect.succeed(entry)
      },
    })

  /**
   * The registry's agents, each run as a process without the person's ways
   * into a code host, so they reach one only through Althar (ADR-011):
   * `gh` and `glab` signed out, their config folders an empty one; git's
   * credential helpers reset, so neither git nor `curl` through it signs in
   * as the person; and git never asks for a password. The person's SSH agent
   * isn't passed on either (provider-adapters' process environment).
   */
  static readonly registry: Layer.Layer<Agents> = Layer.sync(Agents, () => {
    const signedOut = mkdtempSync(join(tmpdir(), 'althar-no-sign-in-'))
    return Agents.from(
      Object.values(agents).map((definition) => ({
        definition,
        transport: (cwd: string, env: Readonly<Record<string, string>> = {}) => {
          const spec = definition.launch(process.execPath)
          return { _tag: 'Process' as const, spec: { ...spec, env: { ...spec.env, ...withoutSignIns(signedOut), ...env } }, cwd }
        },
      })),
    )
  })
}

/** What an agent's environment adds so it carries none of the person's sign-ins to code hosts. */
export const withoutSignIns = (signedOut: string): Readonly<Record<string, string>> => ({
  GH_CONFIG_DIR: signedOut,
  GLAB_CONFIG_DIR: signedOut,
  // An empty helper resets git's list of them: the person's keychain and stored credentials aren't asked.
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
  GIT_TERMINAL_PROMPT: '0',
})

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

/**
 * The code hosts and trackers the runtime connects to (docs/architecture/06):
 * each product it has an adapter for, how it calls their APIs, the public ids
 * of Althar's own apps registered with them (a product without one takes
 * a pasted token), and the loopback port a browser sign-in comes back to.
 * Tests put fakes here.
 */
export class Connectors extends Context.Service<
  Connectors,
  {
    readonly products: ReadonlyArray<ProductInfo>
    readonly fetch: Fetch
    readonly clientIds: Partial<Record<Product, string>>
    readonly callbackPort: number
  }
>()('@althar/runtime/Connectors') {
  /** The products with adapters, over the network. */
  static readonly live = (clientIds: Partial<Record<Product, string>> = {}): Layer.Layer<Connectors> =>
    Layer.succeed(Connectors, Connectors.of({ products: available(), fetch: globalThis.fetch, clientIds, callbackPort: 47821 }))
}
