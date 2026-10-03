import { Commands, Database, Ledger } from '@charrette/persistence-sqlite'
import { Layer } from 'effect'

import { Accounts } from './Accounts'
import { Changes } from './Changes'
import { Agents, Connectors, RuntimeConfig, type RuntimeOptions, WebCrypto } from './Config'
import { Connections } from './Connections'
import { Instance } from './Instance'
import { Issues } from './Issues'
import { Live } from './Live'
import { Permissions } from './Permissions'
import { Policies } from './Policies'
import { Projects } from './Projects'
import { Coordinator } from './Coordinator'
import { Plans } from './Plans'
import { Runs } from './Runs'
import { Secrets } from './Secrets'
import { Sessions } from './Sessions'
import { Limits } from './Limits'
import { Models } from './Models'
import { SignIns } from './SignIns'
import { ToolServer } from './ToolServer'

export interface RuntimeLayerOptions extends RuntimeOptions {
  /** The profile's database file, or `:memory:` for tests. */
  readonly database: string
  /** The agents it may start. The registry's, unless a test gives others. */
  readonly agents?: Layer.Layer<Agents>
  /** Where secrets are kept: sealed by the app's main process, in memory for tests; without it, nowhere, as in the command-line client. */
  readonly secrets?: Layer.Layer<Secrets>
  /** The code hosts and trackers it connects to: theirs, over the network, unless a test gives fakes. */
  readonly connectors?: Layer.Layer<Connectors>
}

/**
 * The runtime, composed: the store, this launch, and the services clients
 * call. Building it opens and migrates the database and reconciles what an
 * earlier launch left; closing it stops every session and records the end of
 * the launch.
 */
export const layer = (options: RuntimeLayerOptions) => {
  const store = Layer.mergeAll(Ledger.layer, Commands.layer).pipe(
    Layer.provideMerge(Database.layer({ filename: options.database })),
    Layer.provideMerge(WebCrypto),
  )
  const base = Layer.mergeAll(Instance.layer, Live.layer, ToolServer.layer).pipe(
    Layer.provideMerge(store),
    Layer.provideMerge(Layer.succeed(RuntimeConfig, options)),
    Layer.provideMerge(options.agents ?? Agents.registry),
    Layer.provideMerge(options.secrets ?? Secrets.none('Charrette keeps sign-ins in the app; it can open them, and this can’t.')),
    Layer.provideMerge(options.connectors ?? Connectors.live(options.clientIds)),
  )
  // Each agent's accounts, whether each is signed in, and which are out of usage until their reset (ADR-012).
  const able = Limits.layer.pipe(Layer.provideMerge(SignIns.layer.pipe(Layer.provideMerge(Accounts.layer.pipe(Layer.provideMerge(base))))))
  const core = Layer.mergeAll(Projects.layer, Sessions.layer).pipe(Layer.provideMerge(Permissions.layer.pipe(Layer.provideMerge(able))))
  // A task's pull request and issue, through the person's connections to code hosts and trackers.
  const linked = Layer.mergeAll(Changes.layer, Issues.layer).pipe(Layer.provideMerge(Connections.layer.pipe(Layer.provideMerge(core))))
  // Runs drive a task's steps; plans start runs when their time comes; the coordinator plans tasks and passes messages on.
  const work = Plans.layer.pipe(Layer.provideMerge(Runs.layer.pipe(Layer.provideMerge(Policies.layer.pipe(Layer.provideMerge(linked))))))
  // The models each agent offers, read from its sessions, or asked of it once.
  const known = Models.layer.pipe(Layer.provideMerge(work))
  return Coordinator.layer.pipe(Layer.provideMerge(known))
}

export { envelope } from './envelope'
