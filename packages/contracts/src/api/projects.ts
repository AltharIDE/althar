import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { BroughtIn, Elsewhere } from '../elsewhere'
import { FeedPosition } from '../identities'
import { call, ClientAuthority, command, SocketAllowed } from './rpc'
import {
  AccountStrategy,
  AfterMergeRule,
  ApiError,
  Cursor,
  PlanStep,
  Product,
  ProjectInk,
  ProjectSummary,
  RuleKind,
  UsageLimit,
  WorksIn,
} from './shared'

/** A new project's id, made by the window before the project is, so its mark is drawn from it while it is named: `proj_` and 32 hex digits. */
export const NewProjectId = Schema.String.check(Schema.isPattern(/^proj_[0-9a-f]{32}$/))
export type NewProjectId = typeof NewProjectId.Type

export const ProjectList = Schema.Struct({
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  projects: Schema.Array(ProjectSummary),
})

export type ProjectList = typeof ProjectList.Type

/** Where issues are filed on a tracker, by its own id and its name: a Linear team, a Jira project, a Trello list, a repository. */
export const TrackerContainer = Schema.Struct({
  id: Schema.String,
  /** A short name a person may type for it, where the tracker has one: a team's key (MER). */
  key: Schema.NullOr(Schema.String),
  name: Schema.String,
})
export type TrackerContainer = typeof TrackerContainer.Type

/**
 * The tracker a project is bound to (ADR-059): one connection, and where its
 * issues are filed there, null to be asked. Its drafts go there unless
 * another is named, its issues are listed from it alone, and a bare key is
 * looked for there first.
 */
export const ProjectTracker = Schema.Struct({
  connectionId: Schema.String,
  container: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** Where it was bound to a connection removed since and not made again: its service and server, and the workspace it reached. */
  gone: Schema.optional(
    Schema.NullOr(Schema.Struct({ product: Schema.String, webUrl: Schema.String, workspace: Schema.NullOr(Schema.String) })),
  ),
})
export type ProjectTracker = typeof ProjectTracker.Type

/** What a repository is to its project. The runtime's vocabulary, said again here, as the contract stands alone. */
export const RepositoryRole = Schema.Literals(['service', 'frontend', 'infrastructure', 'library', 'docs', 'other'])
export type RepositoryRole = typeof RepositoryRole.Type

/**
 * Where a fork's tasks' work goes: pull requests on the repository it was
 * forked from, from the fork's branches; on the fork; or, where its host says
 * the person can push there, branches and pull requests both on the
 * repository it was forked from (ADR-085).
 */
export const ChangeTarget = Schema.Literals(['upstream', 'fork', 'upstream_branch'])
export type ChangeTarget = typeof ChangeTarget.Type

/**
 * Where a repository's work goes: the code host its remote is on, its path
 * there, and who Althar reaches it as. A host Althar doesn't know is named
 * by its address alone.
 */
export const RepositoryHost = Schema.Struct({
  /** The code host, where Althar knows it; null for one it doesn't. */
  product: Schema.NullOr(Product),
  /** As the page says it: GitHub; or, for a host Althar doesn't know, its address, git.example.com. */
  name: Schema.String,
  /** A company's own server, by its address, where the host isn't the hosted service: gitlab.example.com. */
  instance: Schema.NullOr(Schema.String),
  /** Its path there: meridian/app. A fork's is the fork's. */
  path: Schema.String,
  /** Its page there; null on a host Althar doesn't know. */
  url: Schema.NullOr(Schema.String),
  /** Who Althar is signed in as there, and whether that sign-in still works; null where it isn't connected. */
  account: Schema.NullOr(Schema.Struct({ login: Schema.String, state: Schema.Literals(['ready', 'reauth_required']) })),
})
export type RepositoryHost = typeof RepositoryHost.Type

/** One of a project's repositories, as this Mac has it. */
/** A repository's setup (ADR-080): the ignored files to copy from the person's checkout, from its root, and the commands that get a task's folder ready, in order. */
export const RepositorySetup = Schema.Struct({
  copy: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
})
export type RepositorySetup = typeof RepositorySetup.Type

/** A repository's kept setup as the settings show it: who has it as it is, a lead who recorded it or the person who edited it (an agent asks before replacing the person's). */
export const KeptSetup = Schema.Struct({ ...RepositorySetup.fields, by: Schema.Literals(['agent', 'person']) })
export type KeptSetup = typeof KeptSetup.Type

export const ProjectRepository = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Its root on this Mac; null where this Mac has none. */
  path: Schema.NullOr(Schema.String),
  /** The folder inside it the project is about, such as one package of a monorepo; null for all of it. */
  folder: Schema.NullOr(Schema.String),
  /** The branch checked out there. */
  branch: Schema.NullOr(Schema.String),
  /** Where its work goes, from its `origin` (else its first remote); null with no remote, or one that is a folder. */
  host: Schema.NullOr(RepositoryHost),
  role: RepositoryRole,
  /**
   * The fork it is, as its host says, else as its remotes' names say (an `upstream` beside `origin`), by each one's path on its
   * host, and where its work goes; the clone's remote the repository it was forked from is on, by whatever name, null where none
   * is, which AddParentRemote adds; whether its host says the person can push to the repository it was forked from, null where
   * Althar couldn't ask; and whether Althar offers, once, to push its tasks' branches there now that they can (ADR-085).
   */
  fork: Schema.NullOr(
    Schema.Struct({
      fork: Schema.String,
      upstream: Schema.String,
      remote: Schema.NullOr(Schema.String),
      by: Schema.Literals(['host', 'names']),
      target: ChangeTarget,
      canPush: Schema.NullOr(Schema.Boolean),
      offer: Schema.Boolean,
    }),
  ),
  /** Tasks under way that change it: they keep it if it is left out. */
  tasks: Schema.Number,
  /** How each new task's folder of it gets ready (ADR-080): the files copied from the checkout here, and the commands; null until a lead records it. */
  setup: Schema.NullOr(KeptSetup),
  /** Its default branch, as its remote says: main. */
  defaultBranch: Schema.optional(Schema.String),
  /** The branch new tasks work toward there, where it isn't the default (ADR-093): release/0.8.0; null or absent for the default. */
  workToward: Schema.optional(Schema.NullOr(Schema.String)),
  /** Its remote's branches, as this Mac last fetched them, its default first: what Work toward offers. */
  branches: Schema.optional(Schema.Array(Schema.String)),
})
export type ProjectRepository = typeof ProjectRepository.Type

/** A git repository found where a folder was opened. */
export const FoundRepository = Schema.Struct({
  /** Its root on this Mac. */
  path: Schema.String,
  /** The folder inside it the project would be about, such as one package of a monorepo; null for all of it. */
  folder: Schema.NullOr(Schema.String),
  name: Schema.String,
  /** The branch checked out there, or null when none is. */
  branch: Schema.NullOr(Schema.String),
  /** Its first remote, without any password in it; null when it has none. */
  remote: Schema.NullOr(Schema.String),
  /** Whether it has a commit yet: false for one just made with `git init`, which a task can't branch from. */
  commits: Schema.optional(Schema.Boolean),
})
export type FoundRepository = typeof FoundRepository.Type

/** A repository not made yet, in a folder the person chose: its folder's name, and its path on this computer. */
export const PlacedRepository = Schema.Struct({
  /** Its folder's name, from the project's: northwind-ops. */
  name: Schema.String,
  path: Schema.String,
})
export type PlacedRepository = typeof PlacedRepository.Type

/** A repository just made: its root, and the grant a project is opened with it by. */
export const MadeRepository = Schema.Struct({
  grant: Schema.String,
  path: Schema.String,
})
export type MadeRepository = typeof MadeRepository.Type

/** What making a folder ready to be a project's repository did: started git in it, made its first commit, or nothing; on which branch. */
export const PreparedFolder = Schema.Struct({
  did: Schema.Literals(['started', 'committed', 'nothing']),
  /** The repository's root: the folder, or the repository it is in. */
  path: Schema.String,
  branch: Schema.String,
  /** The files its first commit has, where one was made. */
  files: Schema.Number,
})
export type PreparedFolder = typeof PreparedFolder.Type

/** A repository on a connected code host, for choosing one to clone. */
export const HostRepository = Schema.Struct({
  /** As its host names it, by its parts: northwind, app. */
  path: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  private: Schema.Boolean,
  /** When it was last pushed to, as an ISO time; null where the host doesn't say. */
  pushedAt: Schema.NullOr(Schema.String),
  webUrl: Schema.String,
  archived: Schema.Boolean,
})
export type HostRepository = typeof HostRepository.Type

/** Where a connection's account can make a repository: itself, an organization, a group, a workspace or a project. */
export const RepositoryOwner = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(['user', 'organization', 'group', 'workspace', 'project']),
})
export type RepositoryOwner = typeof RepositoryOwner.Type

/** A repository cloned onto this computer: the grant of its folder, for OpenProject, and where it is. */
export const ClonedRepository = Schema.Struct({
  grant: Schema.String,
  path: Schema.String,
})
export type ClonedRepository = typeof ClonedRepository.Type

/** A project's repository put on a host: as the host names it, its page, and the branch pushed. */
export const PublishedRepository = Schema.Struct({
  remote: Schema.String,
  webUrl: Schema.String,
  branch: Schema.String,
})
export type PublishedRepository = typeof PublishedRepository.Type

/**
 * What opening a folder would make, read before anything is: a repository, a
 * folder inside one, or a folder holding several, one level down. Reading it
 * changes nothing there.
 */
export const FolderReading = Schema.Struct({
  kind: Schema.Literals(['repository', 'inside', 'folder']),
  /** The project's name, unless the person gives another: the folder's. */
  name: Schema.String,
  repositories: Schema.Array(FoundRepository),
  /** The project it already is, when it was opened before. */
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** A folder that isn't a repository: whether it has nothing in it but what is hidden, as .DS_Store is. */
  empty: Schema.optional(Schema.Boolean),
  /** A folder that isn't a repository: where it is, as git would be started in it. */
  path: Schema.optional(Schema.String),
})
export type FolderReading = typeof FolderReading.Type

/** A repository found on a home's disk where people keep code, by the grant it opens by and where it is as the person knows it (~/code/site). */
export const HomeRepository = Schema.Struct({
  grant: Schema.String,
  name: Schema.String,
  where: Schema.String,
  /** The branch checked out, or null where none is. */
  branch: Schema.NullOr(Schema.String),
  /** When it was last worked on, as ms since the epoch. */
  worked: Schema.Number,
})
export type HomeRepository = typeof HomeRepository.Type

/**
 * Where on a home a new project's code can come from and go, as the home
 * finds it, for a window that can't show its folder picker there: the
 * repositories in the usual places (~/code, ~/projects and the like), newest
 * work first, and the folder a clone or a new repository goes in. Each by a
 * grant the home made, so the window still names no path of its own.
 */
export const HomeFolders = Schema.Struct({
  /** The places looked in that there are, as the person knows them. */
  lookedIn: Schema.Array(Schema.String),
  repositories: Schema.Array(HomeRepository),
  /** Where a clone or a new repository goes: the folder most of those found are in, else the usual one, made when first used. */
  place: Schema.Struct({ grant: Schema.String, where: Schema.String }),
})
export type HomeFolders = typeof HomeFolders.Type

/**
 * A command the person named: asked about, refused, or let through without
 * asking (ADR-018). By how it starts (`npm publish`, `terraform *`), or, with
 * `match: 'exact'`, as this whole line.
 */
export const CommandRule = Schema.Struct({
  pattern: Schema.String,
  decision: Schema.Literals(['ask', 'never', 'allow']),
  match: Schema.optional(Schema.Literals(['prefix', 'exact'])),
})
export type CommandRule = typeof CommandRule.Type

/** A name pattern a repository's docs spell out, and the doc, by its path in the repository. */
export const FoundPattern = Schema.Struct({ pattern: Schema.String, from: Schema.String })
export type FoundPattern = typeof FoundPattern.Type

/** What one of a project's repositories says of its pull requests, on its default branch: where Althar's names come from without a rule. */
export const RepositoryConventions = Schema.Struct({
  repository: Schema.String,
  /** How its docs say branches and titles are named; null where they don't, and Althar names them its own way. */
  branch: Schema.NullOr(FoundPattern),
  title: Schema.NullOr(FoundPattern),
  /** Its pull request template, by its path; null without one. */
  template: Schema.NullOr(Schema.String),
})
export type RepositoryConventions = typeof RepositoryConventions.Type

/** What the person added to a list Althar works out for a project, and took from it. */
export const SandboxEdits = Schema.Struct({ added: Schema.Array(Schema.String), removed: Schema.Array(Schema.String) })
export type SandboxEdits = typeof SandboxEdits.Type

/**
 * What a project's leads' sandboxes let through from the start: commands
 * they run outside it rather than failing inside it first, and hosts they
 * reach without asking. Each list is what Althar works out from the project,
 * with the person's edits; a command still meets the rules, and the hosts
 * apply only while the rules let the rest through.
 */
export const SandboxReachView = Schema.Struct({
  /** Commands by how they start: `bunx playwright`, `bun run test:e2e`. */
  commands: Schema.Array(Schema.String),
  /** Hosts by name: `github.com`, `registry.npmjs.org`. */
  hosts: Schema.Array(Schema.String),
  /** What the person changed of each, kept over what is worked out later. */
  edits: Schema.Struct({ commands: SandboxEdits, hosts: SandboxEdits }),
})
export type SandboxReachView = typeof SandboxReachView.Type

/**
 * What an ask or a refusal is counted as (ADR-071): one of the project's
 * kinds, what the rules can't read (`unclear`), a command the project named,
 * credentials and keys, the code host, what a role that only reads may not
 * do, and the rest.
 */
export const TallyKind = Schema.Literals([
  'default-branch',
  'force-push',
  'many-branches',
  'delete-branch',
  'deploy',
  'outside',
  'unclear',
  'command',
  'credentials',
  'code-host',
  'reader',
  'other',
])
export type TallyKind = typeof TallyKind.Type

/**
 * How one kind went over the last 14 days, for leads and the coordinator:
 * how often it asked the person and how often they allowed it, how often it
 * was refused, and how often the agent carried on in the same turn after
 * one it wasn't allowed (`workedAround`), which says it found another way.
 */
export const KindTally = Schema.Struct({
  kind: TallyKind,
  asked: Schema.Number,
  allowed: Schema.Number,
  refused: Schema.Number,
  workedAround: Schema.Number,
})
export type KindTally = typeof KindTally.Type

/** A project's rules, as its rules screen shows them. */
/** Skill and OpenSpec files in a project's repositories: three separate permissions, each off until the person turns it on. */
export const RepositoryFilesSetting = Schema.Struct({
  /** Althar may write its managed skills into the repository's native skill folders when a task asks it to. */
  writeSkills: Schema.Boolean,
  /** OpenSpec artifacts may live in, and be versioned with, the repository. */
  writeOpenSpec: Schema.Boolean,
  /** Changes under the protected skill folders and `openspec/` may be pushed; never follows from either write setting. */
  pushProtected: Schema.Boolean,
})
export type RepositoryFilesSetting = typeof RepositoryFilesSetting.Type

/** A bot a project's leads may hear (code-hosts § Review and triage bots): its account on the host, and what it is called. */
export const TrustedBot = Schema.Struct({
  /** In small letters: `coderabbitai[bot]`. */
  login: Schema.String,
  /** CodeRabbit. */
  name: Schema.String,
})
export type TrustedBot = typeof TrustedBot.Type

export const ProjectRulesView = Schema.Struct({
  projectId: Schema.String,
  /** Which revision of the rules these are: a change that replaces a list names it, so one made meanwhile isn't lost. */
  revision: Schema.Number,
  /**
   * What no rule keeps: allowed (`rules`), judged by the coordinator (`coordinator`), or asked about (`ask`).
   * While everything is allowed, what comes back once it isn't.
   */
  permissions: Schema.Literals(['rules', 'coordinator', 'ask']),
  /** Everything is allowed, what always asks included: only what can't be undone from the task still asks (ADR-067), and `never` holds. */
  allowEverything: Schema.Boolean,
  alwaysAsk: Schema.Array(RuleKind),
  never: Schema.Array(RuleKind),
  /** The kinds let through without asking, short of what always asks or is never allowed (ADR-018). */
  alwaysAllow: Schema.Array(RuleKind),
  commands: Schema.Array(CommandRule),
  /** How a task ends when its plan doesn't say; null: a draft pull request where Althar is connected to the host, else its branch. */
  end: Schema.NullOr(Schema.Literals(['draft', 'ready', 'none'])),
  /** Where new tasks start: a worktree of their own, or Local, in each repository's checkout here (ADR-091). */
  worksIn: WorksIn,
  /** Whether a task's lead resolves a conflict with its default branch on its own, without the person asking it. */
  resolveConflicts: Schema.Boolean,
  /** Whether a lead's commits go up to its task's open pull request on their own as its turn ends, whoever has looked (ADR-072). */
  pushCommits: Schema.Boolean,
  /** Whether a task's screenshots go in a comment on its open pull request on their own, kept as Outputs shows them (ADR-077). */
  postScreenshots: Schema.Boolean,
  /** The bots whose comments and reviews its leads hear, as findings framed as data (code-hosts § Review and triage bots), by their accounts; none unless trusted. */
  trustedBots: Schema.Array(TrustedBot),
  /** Review and triage bots Althar recognised on its tasks' pull requests that aren't trusted yet, the latest first. */
  suggestedBots: Schema.Array(TrustedBot),
  leadsReachWeb: Schema.Boolean,
  usageLimit: UsageLimit,
  rotateAccounts: Schema.Boolean,
  accountStrategy: AccountStrategy,
  onlyAccounts: Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** The person's patterns for branches and titles (`names.ts`), over what each repository says; null without one. */
  branchPattern: Schema.NullOr(Schema.String),
  titlePattern: Schema.NullOr(Schema.String),
  /** Whether a task's issue is moved along with it: to its tracker's In Progress as it starts, In Review and Done with its pull request. */
  moveIssues: Schema.Boolean,
  /** Whether a task's pull request is linked on its issue as it opens: an attachment, a remote link, or a comment on ClickUp. */
  linkIssues: Schema.Boolean,
  /** What a small change's review after it merges brings back to the person: only major findings, any, or no review at all. */
  afterMergeReview: AfterMergeRule,
  /** Whether skill and OpenSpec files may be written to, committed in, or pushed from the project's repositories; each off unless turned on. */
  repositoryFiles: RepositoryFilesSetting,
  /** What each of the project's repositories says, in the project's order. */
  conventions: Schema.Array(RepositoryConventions),
  /** What its leads' sandboxes let through from the start. */
  sandbox: SandboxReachView,
  /** Each kind that asked or was refused in the last `TALLY_DAYS` days, the most first (ADR-071). */
  tally: Schema.Array(KindTally),
})
export type ProjectRulesView = typeof ProjectRulesView.Type

/**
 * One of a project's notes (ADR-031): a decision the person made in
 * conversation that the code doesn't show, which every coordinator session
 * starts with. The coordinator keeps them; the person sees them in the
 * project's settings, and drops what no longer holds.
 */
export const ProjectNote = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  keptBy: Schema.Literals(['coordinator', 'person']),
})
export type ProjectNote = typeof ProjectNote.Type

/**
 * Making, opening and removing a project, and what it is made of: folders, repositories, its mark and tracker.
 * Its rules, notes and vocabulary; what other tools left there; the code host's repositories and owners to clone or publish.
 */
export const ProjectsApi = RpcGroup.make(
  Rpc.make('ListProjects', { success: ProjectList, error: ApiError }).annotate(SocketAllowed, true),
  /** Reads a folder the person chose, by its grant, for what opening it would make. */
  call('ReadFolder', { grant: Schema.String }, FolderReading),
  /** Where on the home a new project's code can come from and go: what it finds where people keep code, and where a new one goes. */
  call('FindHomeFolders', {}, HomeFolders),
  /**
   * Where a new repository named after `name` would go, in the folder the
   * person chose by `grant`, read without making anything: refused where a
   * folder of its name has something in it already.
   */
  call('PlaceRepository', { grant: Schema.String, name: Schema.String }, PlacedRepository),
  /**
   * Makes that repository: its folder, `git init` on main, and a first
   * commit with nothing in it, so a task has a commit to branch from. Its
   * grant comes back, for OpenProject.
   */
  call('MakeRepository', { grant: Schema.String, name: Schema.String }, MadeRepository),
  /**
   * Makes the folder the person chose ready to be a project's repository, as
   * the project is made: git on main, with what is in it as its first
   * commit, where it has no git; its first commit, where it has git and no
   * commit. Refused where it can't be read, is too wide to be one project
   * (the home folder), has too many files, or has repositories inside it.
   * What this made is taken away where it fails. `path` is a repository's
   * root inside the folder chosen, where it is one of several found there.
   */
  command('PrepareFolder', { grant: Schema.String, path: Schema.optional(Schema.String) }, PreparedFolder),
  /**
   * What other tools left for a project's repositories on this computer
   * (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"):
   * their worktrees, the setups they keep, and Claude Code's and Codex's
   * conversations there, each with what it became where it was brought in
   * already. Read only: nothing of another tool's changes. Of a project, or
   * of a folder the person chose (`grant`), before its project is made: the
   * keys are the same, so what is picked there is brought in once it is.
   */
  call('LookElsewhere', { projectId: Schema.optional(Schema.String), grant: Schema.optional(Schema.String) }, Elsewhere),
  /**
   * Brings in what the person picked, by the keys LookElsewhere gave: each
   * worktree as a task in place, its plan held on `steps` until they start
   * it, with the conversations that ran in it as its history; each setup as
   * its repository's; each other conversation as an aside. What was brought
   * in before is found, never made twice; one that can't come in says why,
   * and the rest come in all the same.
   */
  command(
    'BringIn',
    {
      projectId: Schema.String,
      worktrees: Schema.Array(Schema.String),
      setups: Schema.Array(Schema.String),
      conversations: Schema.Array(Schema.String),
      steps: Schema.Array(PlanStep),
    },
    BroughtIn,
  ),
  /** Every repository a code host's connection reaches, last pushed to first. */
  call('ListHostRepositories', { connectionId: Schema.String }, Schema.Array(HostRepository)),
  /** Where a code host's connection can make a repository: its account first, then its organizations, groups or workspaces. */
  call('ListRepositoryOwners', { connectionId: Schema.String }, Schema.Array(RepositoryOwner)),
  /**
   * Clones a repository into a folder of its name in the folder the person
   * chose (`grant`): one on a connection's host, by its path there; or one by
   * its URL, signed in through the connection whose host it is on, else with
   * the person's own git sign-in. Refused where that folder has something in
   * it already; what a failed clone made is taken away.
   */
  command(
    'CloneRepository',
    {
      grant: Schema.String,
      from: Schema.Union([
        Schema.Struct({ connectionId: Schema.String, path: Schema.Array(Schema.String) }),
        Schema.Struct({ url: Schema.String }),
      ]),
    },
    ClonedRepository,
  ),
  /**
   * Puts a repository only on this computer on a code host: a project's, or
   * one in a folder the person chose, before its project is made. Makes an
   * empty repository there, under `owner`, sets it as `origin`, and pushes
   * the branch checked out, which follows it from then on. Refused where the
   * repository has a remote already, or the host has one of that name. Made
   * and not pushed, trying again pushes to the one made.
   */
  command(
    'PublishRepository',
    {
      at: Schema.Union([
        /** A project's repository, by its id, or its slug, as a task's names it. */
        Schema.Struct({ projectId: Schema.String, repositoryId: Schema.String }),
        Schema.Struct({ grant: Schema.String, path: Schema.optional(Schema.String) }),
      ]),
      connectionId: Schema.String,
      owner: RepositoryOwner,
      name: Schema.String,
      private: Schema.Boolean,
    },
    PublishedRepository,
  ),
  /**
   * Opens the folder the person chose, by the grant the app gave for it: the
   * window never names a path. A folder holding several repositories opens
   * with `repositories`, the ones the person kept, each by the grant of the
   * folder it was found in and its root as read; without it, every one found.
   * A project made on purpose comes with the id the window made for it
   * (`projectId`, refused where it is taken), and is made even where its
   * folder is another project's already; with `ink`, in the ink the person
   * chose, otherwise the runtime's pick (`inkFor`).
   */
  command(
    'OpenProject',
    {
      grant: Schema.String,
      name: Schema.optional(Schema.String),
      repositories: Schema.optional(Schema.Array(Schema.Struct({ grant: Schema.String, path: Schema.String }))),
      projectId: Schema.optional(NewProjectId),
      ink: Schema.optional(ProjectInk),
    },
    ProjectSummary,
  ),
  /** Renames a project. Its mark, and the folders its tasks' worktrees are in, stay as they are. */
  command('RenameProject', { projectId: Schema.String, name: Schema.String }, Schema.Void),
  /** Draws a project's mark in another ink, wherever it shows. The drawing, which comes from its id, stays. */
  command('SetProjectInk', { projectId: Schema.String, ink: ProjectInk }, Schema.Void),
  /** The tracker a project is bound to, through a connection still there; null where its issues' tracker is learned. */
  call('GetProjectTracker', { projectId: Schema.String }, Schema.NullOr(ProjectTracker)),
  /** Binds a project to a tracker, and where its issues are filed there, or, with null, leaves it to be learned again. */
  command('SetProjectTracker', { projectId: Schema.String, tracker: Schema.NullOr(ProjectTracker) }, Schema.Void),
  /** Where issues can be filed on a connected tracker: its teams, projects or lists, as it says them. */
  call('ListContainers', { connectionId: Schema.String }, Schema.Array(TrackerContainer)),
  /**
   * Removes a project from Althar: its agents stop, its plans don't start and
   * its runs end. Its folders, its tasks' worktrees and their branches stay.
   */
  command('RemoveProject', { projectId: Schema.String }, Schema.Void),
  /** A project's repositories, as this Mac has them. */
  call('GetRepositories', { projectId: Schema.String }, Schema.Array(ProjectRepository)),
  /** Adds the repositories at a folder the person chose, by its grant: the one it is or is in, or those directly inside it. */
  command('AddRepositories', { projectId: Schema.String, grant: Schema.String }, Schema.Void),
  /** Leaves a repository out of the project: new tasks can't change it; tasks made with it keep it. */
  command('LeaveOutRepository', { projectId: Schema.String, repositoryId: Schema.String }, Schema.Void),
  /**
   * Sets a repository's role; for a fork, where its work goes: choosing answers the offer to push its branches upstream, as
   * `notNow` does without changing it, and its branches go upstream only where its host says the person can push there; or how
   * each new task's folder of it gets ready.
   */
  command(
    'SetRepository',
    {
      projectId: Schema.String,
      repositoryId: Schema.String,
      role: Schema.optional(RepositoryRole),
      changeTarget: Schema.optional(ChangeTarget),
      notNow: Schema.optional(Schema.Boolean),
      /** The setup the person edited, kept as theirs; null clears it, so a lead records it again. Worktrees made already are left as they are. */
      setup: Schema.optional(Schema.NullOr(RepositorySetup)),
      /** The branch new tasks work toward there (ADR-093); null for its default branch. Tasks made already keep theirs. */
      workToward: Schema.optional(Schema.NullOr(Schema.String)),
    },
    Schema.Void,
  ),
  /**
   * Adds the repository a fork was forked from as a remote of its clone, where its host says it is a fork and none of its remotes
   * has that repository: as `upstream`, or `parent` where that is taken. The person's own remotes stay as they are.
   */
  command('AddParentRemote', { projectId: Schema.String, repositoryId: Schema.String }, Schema.Void),
  /**
   * Makes a branch on the code host, from the remote's default branch, where
   * the repository's tasks start (ADR-093): a name typed in a branch list
   * that it didn't have. Never forced: one there already is left as it is.
   * Answers the branch's name as made.
   */
  command(
    'CreateBranch',
    {
      projectId: Schema.String,
      repositoryId: Schema.String,
      branch: Schema.String,
    },
    Schema.String,
  ),
  /** A project's rules. */
  call('GetProjectRules', { projectId: Schema.String }, ProjectRulesView),
  /** A project's notes, oldest first: the decisions the coordinator keeps for it. */
  call('GetProjectNotes', { projectId: Schema.String }, Schema.Array(ProjectNote)),
  /** Drops one of a project's notes: it no longer holds, and no coordinator session starts with it. */
  command('DropProjectNote', { projectId: Schema.String, noteId: Schema.String }, Schema.Void),
  /** Says one of a project's notes in other words, the person's: a sentence or two, as the coordinator keeps one. */
  command('EditProjectNote', { projectId: Schema.String, noteId: Schema.String, body: Schema.String }, Schema.Void),
  /**
   * The names a project's code uses that have parts (`RefundLedger`,
   * `useEffect`, `charges-api.ts`), most used first, so dictation can write
   * them as the project does (ADR-017).
   */
  call('GetVocabulary', { projectId: Schema.String }, Schema.Array(Schema.String)),
  /** Changes what is given of a project's rules, as a new revision recorded as the person's. */
  command(
    'SetProjectRules',
    {
      projectId: Schema.String,
      permissions: Schema.optional(Schema.Literals(['rules', 'coordinator', 'ask'])),
      /** Turned on, what waits on the person in the project's tasks is decided again, and goes ahead, short of `never`. */
      allowEverything: Schema.optional(Schema.Boolean),
      alwaysAsk: Schema.optional(Schema.Array(RuleKind)),
      never: Schema.optional(Schema.Array(RuleKind)),
      alwaysAllow: Schema.optional(Schema.Array(RuleKind)),
      commands: Schema.optional(Schema.Array(CommandRule)),
      end: Schema.optional(Schema.NullOr(Schema.Literals(['draft', 'ready', 'none']))),
      /** Where new tasks start; tasks under way stay where they are. */
      worksIn: Schema.optional(WorksIn),
      /** Turned on, the project's tasks that already conflict are resolved now, not at their next conflict. */
      resolveConflicts: Schema.optional(Schema.Boolean),
      /** Turned on, what each open task's lead committed and left waiting goes up now, not at its next turn's end. */
      pushCommits: Schema.optional(Schema.Boolean),
      /** Turned on, each open task's screenshots go up to its pull request now, not when they next change. */
      postScreenshots: Schema.optional(Schema.Boolean),
      /** The bots its leads hear, by their accounts, the list whole. */
      trustedBots: Schema.optional(Schema.Array(Schema.String)),
      leadsReachWeb: Schema.optional(Schema.Boolean),
      usageLimit: Schema.optional(UsageLimit),
      rotateAccounts: Schema.optional(Schema.Boolean),
      accountStrategy: Schema.optional(AccountStrategy),
      onlyAccounts: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String)))),
      /** Null goes back to what each repository says. */
      branchPattern: Schema.optional(Schema.NullOr(Schema.String)),
      titlePattern: Schema.optional(Schema.NullOr(Schema.String)),
      moveIssues: Schema.optional(Schema.Boolean),
      linkIssues: Schema.optional(Schema.Boolean),
      afterMergeReview: Schema.optional(AfterMergeRule),
      repositoryFiles: Schema.optional(RepositoryFilesSetting),
      /** What the person changed of what leads' sandboxes let through, each list whole. */
      sandbox: Schema.optional(Schema.Struct({ commands: Schema.optional(SandboxEdits), hosts: Schema.optional(SandboxEdits) })),
      /** The revision the change was made against: refused (`RulesChanged`) where the rules have moved on since. */
      expectedRevision: Schema.optional(Schema.Number),
    },
    ProjectRulesView,
  ),
).middleware(ClientAuthority)
