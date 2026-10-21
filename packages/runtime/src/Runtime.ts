import { Commands, Database, Ledger, type Migration, migrations } from '@althar/persistence-sqlite'
import { Layer } from 'effect'

import { Accounts } from './Accounts'
import { Artifacts } from './Artifacts'
import { AccountSignIns } from './AccountSignIns'
import { Busy } from './Busy'
import { Changes } from './Changes'
import { Agents, Connectors, RuntimeConfig, type RuntimeOptions, WebCrypto } from './Config'
import { Connections } from './Connections'
import { Installs } from './Installs'
import { Instance } from './Instance'
import { IssueDrafts } from './IssueDrafts'
import { Issues } from './Issues'
import { Launches } from './Launches'
import { Live } from './Live'
import { MachineLoad } from './MachineLoad'
import { Permissions } from './Permissions'
import { Questions } from './Questions'
import { PermissionJudge } from './PermissionJudge'
import { Policies } from './Policies'
import { Projects } from './Projects'
import { Coordinator } from './Coordinator'
import { Plans } from './Plans'
import { Reviews } from './Reviews'
import { Runs } from './Runs'
import { fillIndex } from './Search'
import { FolderCleanup } from './FolderCleanup'
import { Tasks } from './Tasks'
import { Secrets } from './Secrets'
import { Sessions } from './Sessions'
import { Setups } from './Setups'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { SignIns } from './SignIns'
import { ToolServer } from './ToolServer'

export interface RuntimeLayerOptions extends RuntimeOptions {
  /** The profile's database file, or `:memory:` for tests. */
  readonly database: string
  /** Where the store copies itself before an update migrates it (`backupsIn(profile)`); without it, no copy is made. */
  readonly backups?: string
  /** Migrations a test adds after the store's own, such as one that fails. Never in a packaged app. */
  readonly extraMigrations?: ReadonlyArray<Migration>
  /** The agents it may start. The registry's, unless a test gives others. */
  readonly agents?: Layer.Layer<Agents>
  /** Where secrets are kept: sealed by the app's main process, in memory for tests; without it, nowhere, as in the command-line client. */
  readonly secrets?: Layer.Layer<Secrets>
  /** The code hosts and trackers it connects to: theirs, over the network, unless a test gives fakes. */
  readonly connectors?: Layer.Layer<Connectors>
}

/**
 * The runtime, composed: the store, this launch, and the services clients
 * call. Building it opens and migrates the database (copying it first, where
 * a migration is pending) and reconciles what an earlier launch left; closing
 * it stops every session and records the end of the launch. A store that
 * can't be copied or migrated fails the build, so nothing runs on it.
 */
export const layer = (options: RuntimeLayerOptions) => {
  const store = Layer.mergeAll(Ledger.layer, Commands.layer).pipe(
    Layer.provideMerge(
      Database.layer({
        filename: options.database,
        ...(options.backups === undefined ? {} : { backups: options.backups }),
        ...(options.extraMigrations === undefined ? {} : { migrations: [...migrations, ...options.extraMigrations] }),
      }),
    ),
    Layer.provideMerge(WebCrypto),
  )
  const base = Layer.mergeAll(Instance.layer, Live.layer, ToolServer.layer, ModelFacts.layer, Artifacts.layer).pipe(
    Layer.provideMerge(store),
    Layer.provideMerge(Layer.succeed(RuntimeConfig, options)),
    Layer.provideMerge(options.agents ?? Agents.registry(options.agentStderr)),
    // Agents Althar downloads at the person's asking, where it keeps them; the registry's point at them where the person has none.
    Layer.provideMerge(Installs.layer({ root: options.agentsRoot, fetch: options.fetch, onDevice: options.onDevice })),
    Layer.provideMerge(options.secrets ?? Secrets.none('Althar keeps sign-ins in the app; it can open them, and this can’t.')),
    Layer.provideMerge(options.connectors ?? Connectors.live(options.clientIds, options.fetch, options.githubApp)),
  )
  // Each project's rules; each agent's accounts, whether each is signed in, and which are out of usage until their reset (ADR-012).
  // The models each agent offers, read from its sessions, or asked of it once: sessions name them to the coordinator.
  const able = Layer.mergeAll(Limits.layer, Models.layer).pipe(
    Layer.provideMerge(
      SignIns.layer.pipe(Layer.provideMerge(Accounts.layer.pipe(Layer.provideMerge(Policies.layer.pipe(Layer.provideMerge(base)))))),
    ),
  )
  const judging = PermissionJudge.layer.pipe(Layer.provideMerge(able))
  // A task's worktrees are set up as they are made, and its lead's first turn waits for them.
  const core = Layer.mergeAll(Projects.layer, Sessions.layer, Launches.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Permissions.layer, Questions.layer, Setups.layer).pipe(Layer.provideMerge(judging))),
  )
  // How many tasks are at work at once on this machine, and what waits for a place among them.
  const busy = Busy.layer.pipe(Layer.provideMerge(core))
  // A task's pull request and issue, the issues the coordinator drafts and the reviews leads draft, through the person's connections to code hosts and trackers.
  const linked = Layer.mergeAll(Changes.layer, Issues.layer, IssueDrafts.layer, Reviews.layer).pipe(
    Layer.provideMerge(Connections.layer.pipe(Layer.provideMerge(busy))),
  )
  // Runs drive a task's steps; plans start runs when their time comes; the person steers a task's course; the coordinator plans tasks and passes messages on.
  // Finished tasks' folders go after their wait, or when the person cleans up, and come back when needed (ADR-056).
  const work = Layer.mergeAll(Tasks.layer, FolderCleanup.layer).pipe(
    Layer.provideMerge(Plans.layer.pipe(Layer.provideMerge(Runs.layer.pipe(Layer.provideMerge(linked))))),
  )
  // Signing accounts in inside Althar, with each agent's own login (ADR-012).
  const signing = AccountSignIns.layer.pipe(Layer.provideMerge(work))
  // How hard this computer works, and each piece of work's part, while a window shows it. Tasks made before search, indexed.
  return Layer.mergeAll(Coordinator.layer, MachineLoad.layer, fillIndex).pipe(Layer.provideMerge(signing))
}

export { envelope } from './envelope'
