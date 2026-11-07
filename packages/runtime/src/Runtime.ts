import { Commands, Database, Ledger, type Migration, migrations } from '@althar/persistence-sqlite'
import { Layer } from 'effect'

import { startupLayer } from './startup'

import { Accounts } from './Accounts'
import { Artifacts } from './Artifacts'
import { Automations } from './Automations'
import { AccountSignIns } from './AccountSignIns'
import { Busy } from './Busy'
import { Changes } from './Changes'
import { Agents, Connectors, RuntimeConfig, type RuntimeOptions, WebCrypto } from './Config'
import { Connections } from './Connections'
import { Connectivity } from './Connectivity'
import { Installs, type InstallsOptions } from './Installs'
import { Instance } from './Instance'
import { IssueChanges } from './IssueChanges'
import { IssueDrafts } from './IssueDrafts'
import { Issues } from './Issues'
import { Fetches } from './Fetches'
import { Launches } from './Launches'
import { Live } from './Live'
import { MachineLoad } from './MachineLoad'
import { Overlaps } from './Overlaps'
import { PlanUsage } from './PlanUsage'
import { Permissions } from './Permissions'
import { Questions } from './Questions'
import { PermissionJudge } from './PermissionJudge'
import { Policies } from './Policies'
import { Projects } from './Projects'
import { Coordinator } from './Coordinator'
import { TaskActions } from './TaskActions'
import { Plans } from './Plans'
import { Reviews } from './Reviews'
import { Runs } from './Runs'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import { fillIndex } from './Search'
import { FolderCleanup } from './FolderCleanup'
import { Tasks } from './Tasks'
import { Secrets } from './Secrets'
import { Sessions } from './Sessions'
import { LeftBehind } from './LeftBehind'
import { Setups } from './Setups'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { SignIns } from './SignIns'
import { Errands } from './Errands'
import { MergeLine } from './MergeLine'
import { ToolServer } from './ToolServer'
import { WorktreeRepair } from './WorktreeRepair'

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
  /**
   * Where the person's own agents are looked for: their PATH and the usual places, unless a test gives its own, as the
   * end-to-end tests do, so that what this computer has installed isn't what they find (`Installs.ts`).
   */
  readonly agentSearch?: InstallsOptions['search']
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
      startupLayer(
        'store',
        Database.layer({
          filename: options.database,
          ...(options.backups === undefined ? {} : { backups: options.backups }),
          ...(options.extraMigrations === undefined ? {} : { migrations: [...migrations, ...options.extraMigrations] }),
        }),
      ),
    ),
    Layer.provideMerge(WebCrypto),
  )
  const base = Layer.mergeAll(
    ToolServer.layer.pipe(Layer.provideMerge(Errands.layer.pipe(Layer.provideMerge(startupLayer('instance', Instance.layer))))),
    Live.layer,
    startupLayer('modelfacts', ModelFacts.layer),
    Artifacts.layer,
  ).pipe(
    Layer.provideMerge(store),
    Layer.provideMerge(Layer.succeed(RuntimeConfig, options)),
    Layer.provideMerge(options.agents ?? Agents.registry(options.agentStderr)),
    // Agents Althar downloads at the person's asking, where it keeps them; the registry's point at them where the person has none.
    Layer.provideMerge(
      Installs.layer({ root: options.agentsRoot, fetch: options.fetch, onDevice: options.onDevice, search: options.agentSearch }),
    ),
    Layer.provideMerge(options.secrets ?? Secrets.none('Althar keeps sign-ins in the app; it can open them, and this can’t.')),
    Layer.provideMerge(options.connectors ?? Connectors.live(options.clientIds, options.fetch, options.githubApp)),
  )
  // Each project's rules; each agent's accounts, whether each is signed in, and which are out of usage until their reset (ADR-012).
  // The models each agent offers, read from its sessions, or asked of it once: sessions name them to the coordinator.
  // Whether the computer is online, as the app says, and whether an agent's service answers (ADR-060).
  const connected = startupLayer('connectivity', Connectivity.layer).pipe(Layer.provideMerge(base))
  const able = Layer.mergeAll(startupLayer('limits', Limits.layer), startupLayer('planusage', PlanUsage.layer)).pipe(
    Layer.provideMerge(startupLayer('models', Models.layer)),
    Layer.provideMerge(
      startupLayer('signins', SignIns.layer).pipe(
        Layer.provideMerge(
          startupLayer('accounts', Accounts.layer).pipe(
            Layer.provideMerge(startupLayer('policies', Policies.layer).pipe(Layer.provideMerge(connected))),
          ),
        ),
      ),
    ),
  )
  const judging = startupLayer('permissionjudge', PermissionJudge.layer).pipe(Layer.provideMerge(able))
  // A task's worktrees are set up as they are made, and its lead's first turn waits for them.
  // Runs fetch the branch or pull request they run through the person's connections to code hosts, as leads ask Althar to (ADR-066).
  const core = Layer.mergeAll(startupLayer('projects', Projects.layer), startupLayer('sessions', Sessions.layer), Launches.layer).pipe(
    Layer.provideMerge(Fetches.layer),
    Layer.provideMerge(
      Layer.mergeAll(Permissions.layer, Questions.layer, Setups.layer, startupLayer('connections', Connections.layer)).pipe(
        Layer.provideMerge(judging),
      ),
    ),
  )
  // How many tasks are at work at once on this machine, and what waits for a place among them; and a task that settles stops all it left running.
  const busy = Layer.mergeAll(Busy.layer, LeftBehind.layer).pipe(Layer.provideMerge(core))
  // A task's issue, and changes to issues on the person's trackers, which its pull request offers as it opens and merges.
  const tracked = IssueChanges.layer.pipe(Layer.provideMerge(Issues.layer.pipe(Layer.provideMerge(busy))))
  // A task's pull request, the issues the coordinator drafts and the reviews leads draft, through the person's connections to code hosts and trackers.
  const linked = Layer.mergeAll(Changes.layer, IssueDrafts.layer, Reviews.layer).pipe(Layer.provideMerge(tracked))
  // A task's screenshots, in one comment on its pull request, kept as its Outputs show them (ADR-077).
  const shown = PullRequestScreenshots.layer.pipe(Layer.provideMerge(linked))
  // Runs drive a task's steps; plans start runs when their time comes; the person steers a task's course; the coordinator plans tasks and passes messages on.
  // Finished tasks' folders go after their wait, or when the person cleans up, and come back when needed (ADR-056).
  // Worktrees whose link to their repository broke are repaired as Althar starts, or as git fails in one (ADR-099).
  const work = Layer.mergeAll(Tasks.layer, FolderCleanup.layer, WorktreeRepair.layer).pipe(
    Layer.provideMerge(Plans.layer.pipe(Layer.provideMerge(startupLayer('runs', Runs.layer).pipe(Layer.provideMerge(shown))))),
  )
  // Signing accounts in inside Althar, with each agent's own login (ADR-012).
  const signing = startupLayer('account-signins', AccountSignIns.layer).pipe(Layer.provideMerge(work))
  // Work that starts by itself on a schedule, as tasks and reviews like any other (docs/plans/automations.md).
  const automating = startupLayer('automations', Automations.layer).pipe(Layer.provideMerge(signing))
  // How hard this computer works, and each piece of work's part, while a window shows it. Tasks made before search, indexed.
  // Leads whose work meets another running task's hear of it once (Overlaps.ts).
  // The coordinator merges on the person's word: through the host's queue, or Althar's own line for each branch (ADR-081).
  return MergeLine.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        startupLayer('coordinator', Coordinator.layer),
        TaskActions.layer,
        MachineLoad.layer,
        Overlaps.layer,
        startupLayer('search-index', fillIndex),
      ).pipe(Layer.provideMerge(automating)),
    ),
  )
}

export { envelope } from './envelope'
