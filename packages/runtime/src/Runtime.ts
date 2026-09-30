import { Commands, Database, Ledger } from '@charrette/persistence-sqlite'
import { Layer } from 'effect'

import { Agents, RuntimeConfig, type RuntimeOptions, WebCrypto } from './Config'
import { Instance } from './Instance'
import { Live } from './Live'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Coordinator } from './Coordinator'
import { Plans } from './Plans'
import { Runs } from './Runs'
import { Sessions } from './Sessions'
import { SignIns } from './SignIns'
import { ToolServer } from './ToolServer'

export interface RuntimeLayerOptions extends RuntimeOptions {
  /** The profile's database file, or `:memory:` for tests. */
  readonly database: string
  /** The agents it may start. The registry's, unless a test gives others. */
  readonly agents?: Layer.Layer<Agents>
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
  )
  const core = Layer.mergeAll(Projects.layer, Sessions.layer).pipe(Layer.provideMerge(Permissions.layer.pipe(Layer.provideMerge(base))))
  // Runs drive a task's steps; plans start runs when their time comes; the coordinator plans tasks and passes messages on.
  const work = Plans.layer.pipe(Layer.provideMerge(Runs.layer.pipe(Layer.provideMerge(core))))
  return Coordinator.layer.pipe(Layer.provideMerge(SignIns.layer.pipe(Layer.provideMerge(work))))
}

export { envelope } from './envelope'
