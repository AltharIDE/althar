import { agentVersion } from '@althar/provider-adapters'
import { lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, type posix, relative, resolve, sep } from 'node:path'

import {
  type AccountStatus,
  API_VERSION,
  apiVersionRefusal,
  ClientAuthority,
  SocketAllowed,
  type MessageSender,
  Api,
  ApiError,
  type AgentStatus,
  type Attachment,
  type PortLike,
  serverProtocol,
  type WatchEvent,
  type ProjectRulesView,
  type SentFile,
  type SentImage,
} from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Commands, Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { AccountSignIns } from './AccountSignIns'
import { Artifacts } from './Artifacts'
import { Automations } from './Automations'
import { Changes } from './Changes'
import {
  approve,
  checkUpdates,
  findSkills,
  type GitHubAccess,
  type Install,
  parseGitHubSource,
  resolveRef,
  resolveTree,
  rollBack,
  SkillRefused,
  stageFromGitHub,
  uninstall,
} from '@althar/skills'
import { codeRootOf } from './code'
import { NotFound, ProjectRefused, RetryRefused } from './errors'
import { contained, Failures, failuresLayer } from './Failures'
import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import { modelNamer } from './coordinatorNews'
import { teamChanges, teamLine } from './teamWords'
import { addItem } from './threads'
import { type ConnectionInfo, Connections } from './Connections'
import { coAuthorLine, coAuthorOn, setCoAuthor } from './credit'
import { plansAndReviewsOf, newProjectDefaultsOf, setPlansAndReviews, setNewProjectDefaults } from './plansAndReviews'
import { reviewSeal, setReviewSeal, setReviewSealStyle } from './pullRequestReview'
import { bringBackThen } from './bringBack'
import { FolderCleanup } from './FolderCleanup'
import { Folders } from './Folders'
import { vocabulary } from './vocabulary'
import { conventionsOnBase } from './conventions'
import { Instance } from './Instance'
import { Fetches } from './Fetches'
import { Launches } from './Launches'
import { LeftBehind } from './LeftBehind'
import { localTasksIn } from './local'
import { MachineLoad } from './MachineLoad'
import { modelRooms } from './modelRooms'
import { PlanUsage } from './PlanUsage'
import { Issues } from './Issues'
import { Limits } from './Limits'
import { Live } from './Live'
import { missedReports } from './missedReports'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import {
  accountsOf,
  allowsEverything,
  modeOf,
  movesIssues,
  Policies,
  type ProjectRules,
  repositoryFilesOf,
  resolvesConflicts,
  worksInOf,
  pushesCommits,
  postsScreenshots,
  ruleSetOf,
  usageLimitOf,
} from './Policies'
import { Models } from './Models'
import { Installs } from './Installs'
import { Permissions } from './Permissions'
import { dropNote, editNote, notesOf } from './notes'
import { Questions } from './Questions'
import { type ProjectRepository, Projects } from './Projects'
import { Nudges } from './Nudges'
import { projectTracker } from './projectTracker'
import { applyRules } from './rulesChange'
import { UsageData } from './UsageData'
import { Queries } from './Queries'
import { Busy } from './Busy'
import { clearView, showEarlier, undoClearView } from './chatView'
import { timestamp } from './records'
import { Setups } from './Setups'
import * as Runtime from './Runtime'
import { withEdits, workedOutReach } from './sandboxReach'
import { afterOpen, startup } from './startup'
import { tallyOf } from './tally'
import { Coordinator } from './Coordinator'
import { SettingsTools } from './SettingsTools'
import { TaskActions } from './TaskActions'
import { IssueChanges } from './IssueChanges'
import { IssueDrafts } from './IssueDrafts'
import { postTeamReviews, Reviews, runOutside, setPostTeamReviews, setRunOutside } from './Reviews'
import { shelve } from './scratch'
import { Helpers } from './Helpers'
import { describe as describePreset, editPreset, partsOfTask, presetsIn, removePreset, savePreset } from './presets'
import { FastLane } from './fastLane'
import { MergeReviews } from './MergeReviews'
import { Plans } from './Plans'
import { presetModels } from './presetModels'
import { usableModels } from './usableModels'
import { Runs } from './Runs'
import { findTasks } from './Search'
import { Tasks } from './Tasks'
import { Sessions } from './Sessions'
import { makeRepository, placeRepository } from './newRepository'
import { type InputFile, keepFiles } from './sentFiles'
import { type InputImage, keepSent } from './sentImages'
import { anyOf, SignIns } from './SignIns'
import { describe, listSkills, type SkillsConfig } from './Skills'
import { expected, words } from './words'
import { makeBranch } from './newBranch'
import { agentTools, forgetSkillRoles, setSkillRoles, setToolInProject, setToolRoles, syncIo } from './agentTools'
import { addServer, removeServer, serverDetail } from './mcpAdd'
import { checkHealth } from './mcpHealth'
import { Canvases } from './Canvases'
import * as mcpSync from './mcpSync'
import * as skillSync from './skillSync'

/** Runs one of sync's steps against the person's agents' settings, where this runtime reads them; refused where it doesn't. */
const withSync = (step: (io: mcpSync.SyncIo & skillSync.SkillIo) => Promise<unknown>) =>
  Effect.gen(function* () {
    const io = yield* syncIo
    if (io === undefined) return yield* Effect.fail(new Error('This Althar doesn’t read your agents’ settings.'))
    yield* Effect.tryPromise({ try: () => step(io), catch: (error) => (error instanceof Error ? error : new Error(String(error))) })
  })

/*
 * The runtime's side of the API (`@althar/contracts`): each call runs the
 * service that owns it. Commands from the window become the person's commands
 * here, with the window's own command ids, so a retry gets the first one's
 * receipt. Every failure reaches the window as an `ApiError`, in words; what
 * the person can't put right goes to the log whole.
 */

/** How often the change feed is read when nothing says it grew: a fallback, not the way changes arrive. */
const FEED_FALLBACK = '1 second'

/** How many session commands' results are kept for retries, per launch. */
const RECENT_COMMANDS = 1_000

/** How long what a host said about who can push to a repository is kept: opening a project again soon after doesn't ask again. */
const PUSHABLE_KEPT = 5 * 60_000

/** How long a repository's page waits for a host to say who can push: it reads on without. */
const PUSHABLE_WAIT = Duration.seconds(5)

/** A path as the file system has it, without symbolic links; as given, where it can't be read. */
/** What an issue card's Always file at once and Always ask first say: to the coordinator, as the person, and to a task's lead. */
export const text = {
  issuesAtOnce: 'From now on, file and change issues at once, without a card for me first. Keep that as a note.',
  issuesAskFirst: 'From now on, ask me first: each issue, and each change to one, as a card for me to file or apply. Keep that as a note.',
  leadIssuesAtOnce:
    'The person wants issues filed and changed at once from now on: use draft_issue’s file_now and change_issue’s at_once. Each card is the record of it.',
  leadIssuesAskFirst:
    'The person wants to be asked first from now on: each issue, and each change to one, as a card for them to file or apply.',
}

const realpathOf = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Whether something is at a path, a link to nothing included. */
const isThere = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Where a path really is, links followed: for one not there yet, its nearest
 * folder that is, and the rest after it. A link to nothing is nowhere: the
 * empty path, which is inside no folder.
 */
const realOf = (path: string): string => {
  let at = path
  const rest: string[] = []
  while (!isThere(at) && dirname(at) !== at) {
    rest.unshift(basename(at))
    at = dirname(at)
  }
  try {
    return join(realpathSync(at), ...rest)
  } catch {
    return ''
  }
}
/** What the person asked for, as a task they made says it: what they wrote, or, from an issue, which the thread shows, what they added to it. */
const requestOf = (title: string, description: string | undefined, issue: string | undefined): { readonly request?: string } => {
  const words = issue === undefined ? [title, description ?? ''].filter((part) => part.trim() !== '').join('\n\n') : (description ?? '')
  return words.trim() === '' ? {} : { request: words }
}
/** Authority attached by the host to this connection. */
export const ConnectionSender = Context.Reference<MessageSender>('@althar/runtime/ConnectionSender', {
  defaultValue: () => ({ kind: 'internal' }),
})

export const handlers = Api.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const sender = yield* ConnectionSender
    const artifacts = yield* Artifacts
    const projects = yield* Projects
    const sessions = yield* Sessions
    const launches = yield* Launches
    const leftBehind = yield* LeftBehind
    const fetches = yield* Fetches
    const machine = yield* MachineLoad
    const planUsage = yield* PlanUsage
    const permissions = yield* Permissions
    const questions = yield* Questions
    const queries = yield* Queries
    const folders = yield* Folders
    const live = yield* Live
    const signIns = yield* SignIns
    const accounts = yield* Accounts
    const limits = yield* Limits
    const installs = yield* Installs
    const models = yield* Models
    const accountSignIns = yield* AccountSignIns
    const policies = yield* Policies
    const plans = yield* Plans
    const issueDrafts = yield* IssueDrafts
    const issueChanges = yield* IssueChanges
    const reviews = yield* Reviews
    const helpers = yield* Helpers
    const fastLane = yield* FastLane
    const mergeReviews = yield* MergeReviews
    const runs = yield* Runs
    const tasks = yield* Tasks
    const coordinator = yield* Coordinator
    const canvases = yield* Canvases
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    // What writes a project's notes needs, as the services have it.
    const store = yield* Effect.context<SqlClient.SqlClient | Ledger | Commands>()
    // What bringing a task's removed folder back needs (ADR-056).
    const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
    const cleanup = yield* FolderCleanup
    const setups = yield* Setups
    /**
     * A task's folder about to open: brought back first, where it was removed
     * to free the disk, and set up again; and kept as opened before anything
     * can remove it again, which holds it back from removal for a day and
     * restarts its wait (ADR-056).
     */
    const openingFolder = (taskId: string) =>
      Effect.gen(function* () {
        const opened = Effect.flatMap(timestamp, (at) => sql`UPDATE tasks SET opened_at = ${at} WHERE id = ${taskId}`)
        if (yield* Effect.provideContext(bringBackThen(taskId, instance.personId, opened), folderStore)) yield* setups.begin(taskId)
      })
    const agents = yield* Agents
    const config = yield* RuntimeConfig
    const connections = yield* Connections
    const issues = yield* Issues
    const pullRequests = yield* Changes
    const screenshots = yield* PullRequestScreenshots
    const busy = yield* Busy
    const automations = yield* Automations
    const taskActions = yield* TaskActions
    const settingsTools = yield* SettingsTools
    /** Where the change feed stands, read before what a snapshot shows, so a client watching from it misses nothing. */
    const cursorNow = Effect.map(
      sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`,
      ([row]) => row?.cursor ?? 0,
    )
    const envelope = (type: string, payload: unknown, commandId: string) =>
      Effect.provideContext(Runtime.envelope(type, payload, commandId), context)
    const agentName = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId
    /** The images sent with a message to a thread, read, checked and kept in the thread's project's store, in order. */
    const keptFor = (threadId: string, images: ReadonlyArray<SentImage>) =>
      Effect.gen(function* () {
        const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${threadId}`
        if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
        return yield* keepSent(thread.projectId, images)
      }).pipe(Effect.provideService(Artifacts, artifacts), Effect.provideService(SqlClient.SqlClient, sql))
    /** What a message's command says of its images: their digests, in order, where it has any; nothing where it has none, as before images. */
    const imagesSaid = (kept: ReadonlyArray<InputImage>) => (kept.length === 0 ? {} : { images: kept.map((image) => image.sha256) })
    /** The files sent with a message to a thread, measured and copied where its agent reads, in order. */
    const filesFor = (threadId: string, files: ReadonlyArray<SentFile> | undefined) =>
      files === undefined || files.length === 0
        ? Effect.succeed([])
        : keepFiles(threadId, files).pipe(
            Effect.provideService(Folders, folders),
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.provideService(RuntimeConfig, config),
            Effect.provideService(Instance, instance),
          )
    /** What a message's command says of its files: how many, never their names or paths; nothing where it has none. */
    const filesSaid = (kept: ReadonlyArray<InputFile>) => (kept.length === 0 ? {} : { files: kept.length })

    const failures = yield* Failures
    /** The call being answered, by the name the RPC server gives its span: `Status`, `ListProjects`. */
    const callName = Effect.currentSpan.pipe(
      Effect.map((span) => span.name.replace(/^RpcServer\./, '')),
      Effect.map((name) => (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'call')),
      Effect.orElseSucceed(() => 'call'),
    )

    /**
     * A call's failure as the window gets it: in words; and, when it isn't
     * the person's to put right, in the log and reported, by the call's name.
     */
    const api = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiError, R> =>
      Effect.catchCause(effect, (cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
        const error = Cause.findErrorOption(cause)
        // Refused by the call itself, in the window's own words already: as it is, and nothing went wrong.
        if (Option.isSome(error) && error.value instanceof ApiError) return Effect.fail(error.value)
        const said = words(Option.getOrUndefined(error), agentName)
        const told =
          Option.isSome(error) && expected.has(said.reason)
            ? Effect.void
            : Effect.andThen(
                Effect.logWarning('A call from the window did not succeed', cause),
                Effect.flatMap(callName, (call) => failures.report(cause, call)),
              )
        return Effect.andThen(told, Effect.fail(new ApiError(said)))
      })

    /*
     * Session commands have no receipts in the store yet (they start and stop
     * processes, outside any transaction), so a retry within the launch gets
     * the first one's result from here. One interrupted before it finished
     * may run again.
     */
    /* GitHub as the skills page reaches it: over the app's own network, unauthenticated, for public repositories. */
    const github: GitHubAccess = config.fetch === undefined ? {} : { fetch: config.fetch }
    /**
     * A skills store operation as the window gets it, through `api()` (ADR-047): a refusal in the person's words, never
     * reported; anything else (a store that failed, a defect) in the log and reported by the call. Refused where the
     * runtime has no store.
     */
    const skills = <A, E>(work: (store: SkillsConfig) => Effect.Effect<A, E>): Effect.Effect<A, ApiError> => {
      const store = config.skills
      const effect: Effect.Effect<A, E | SkillRefused> =
        store === undefined ? Effect.fail(new SkillRefused({ message: 'Skills are off in this runtime' })) : work(store)
      return api(effect)
    }
    /**
     * A change the person made to what is installed, recorded as their own act under the window's command id (as a
     * rule's revision is): the store's installs.json says what is installed now, the record who changed it and to
     * what. Recording it tells the window's feed that the skill changed.
     */
    const skillAct = (commandId: string, id: string, act: string, payload: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        const type = `skill.${act}`
        const said = yield* envelope(type, { id, ...payload }, commandId)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const [last] = yield* sql<{ revision: number | null }>`
              SELECT max(aggregate_revision) AS revision FROM record_events WHERE aggregate_type = 'skill' AND aggregate_id = ${id}`
            yield* ledger.record({
              aggregateType: 'skill',
              aggregateId: id,
              aggregateRevision: (last?.revision ?? 0) + 1,
              type,
              payload,
              actorId: said.actorId,
              commandId: said.commandId,
            })
          }),
        )
      })
    /** What the record keeps of a version: where it is from and which files, by their tree hash. */
    const versionSaid = (install: Install) => ({
      source: install.source,
      treeHash: install.treeHash,
      ...(install.repo === undefined ? {} : { repo: install.repo }),
      ...(install.subpath === undefined ? {} : { subpath: install.subpath }),
      ...(install.ref === undefined ? {} : { ref: install.ref }),
      ...(install.sha === undefined ? {} : { sha: install.sha }),
    })
    const recent = new Map<string, Deferred.Deferred<unknown, ApiError>>()
    const once = <A>(commandId: string, effect: Effect.Effect<A, ApiError>): Effect.Effect<A, ApiError> =>
      Effect.suspend(() => {
        const seen = recent.get(commandId)
        if (seen !== undefined) return Deferred.await(seen as Deferred.Deferred<A, ApiError>)
        const result = Deferred.makeUnsafe<A, ApiError>()
        recent.set(commandId, result as Deferred.Deferred<unknown, ApiError>)
        const oldest = recent.keys().next().value
        if (recent.size > RECENT_COMMANDS && oldest !== undefined) recent.delete(oldest)
        return Effect.onExit(effect, (exit) =>
          Exit.hasInterrupts(exit) ? Effect.sync(() => recent.delete(commandId)) : Deferred.done(result, exit),
        )
      })

    const connectionOf = (info: ConnectionInfo) => ({
      id: info.id,
      product: info.product,
      name: info.name,
      webUrl: info.webUrl,
      account: { login: info.account.login, name: info.account.name },
      auth: info.auth,
      state: info.state,
      workspace: info.workspace,
    })

    /** What a host last said about who can push where, by the repository's address, and when it said it. */
    const pushable = new Map<string, { readonly at: number; readonly can: boolean }>()

    /**
     * Whether the person can push to a repository, as its host says through
     * the connection that reaches it (ADR-085): asked as a project's
     * repositories are read, and kept a few minutes, so opening the project
     * again doesn't ask again; `fresh` asks now. Null where no connection
     * reaches it, or the host couldn't say.
     */
    const canPushTo = (url: string, fresh = false) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const kept = pushable.get(url)
        if (!fresh && kept !== undefined && now - kept.at < PUSHABLE_KEPT) return kept.can
        const found = yield* Effect.orElseSucceed(connections.hostOf([url]), () => null)
        if (found === null) return null
        // Read as the repositories' page is: a host that doesn't answer soon doesn't hold it up.
        const can = yield* found.host.repository(found.path).pipe(
          Effect.map((repository) => repository.canPush),
          Effect.timeout(PUSHABLE_WAIT),
          Effect.orElseSucceed(() => null),
        )
        if (can !== null) pushable.set(url, { at: now, can })
        return can
      })

    /**
     * A repository as its page shows it: where its work goes, from its
     * remote, with the code host Althar knows there and who it is signed in
     * as; a host it doesn't know by its address alone. A fork says whether
     * the person can push to the repository it was forked from, and offers
     * once to push its tasks' branches there, once they can.
     */
    const repositoryOf = ({ remote, fork: forked, ...repository }: ProjectRepository) =>
      Effect.gen(function* () {
        const fork =
          forked === null
            ? null
            : yield* Effect.map(canPushTo(forked.upstreamUrl), (canPush) => ({
                fork: forked.fork,
                upstream: forked.upstream,
                target: forked.target,
                canPush,
                offer: canPush === true && forked.target !== 'upstream_branch' && !forked.offered,
              }))
        const place = remote === null ? null : yield* Effect.orElseSucceed(connections.placeOf(remote), () => null)
        const path = place?.path.join('/')
        const host =
          place === null || path === undefined
            ? null
            : {
                product: place.code?.product ?? null,
                name: place.code?.name ?? place.host,
                instance: place.code === null || place.code.hosted ? null : place.host,
                path,
                url: place.url,
                account: place.connection === null ? null : { login: place.connection.account.login, state: place.connection.state },
              }
        return { ...repository, fork, host }
      })

    /** The issue a task comes from, read before the task is made, so its key can go in the task's branch. */
    const issueFor = (projectId: string, issue: string | undefined) =>
      issue === undefined ? Effect.succeed(undefined) : issues.read(issue, projectId)

    /** A list Althar works out that the person hasn't changed. */
    const UNEDITED = { added: [], removed: [] }

    /** A project's rules as its rules screen shows them, with what each of its repositories says on its default branch. */
    const rulesView = (projectId: string, { rules, revision }: { readonly rules: ProjectRules; readonly revision: number }) =>
      Effect.gen(function* () {
        const repositories = yield* sql<{ name: string; path: string; base: string | null }>`
          SELECT b.display_name AS name, l.path, b.default_base_ref AS base FROM repository_bindings b
          JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
          WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
        const conventions = yield* Effect.forEach(
          repositories,
          (repository) =>
            Effect.map(conventionsOnBase(repository.path, repository.base ?? 'main'), (found) => ({
              repository: repository.name,
              branch: found.branch,
              title: found.title,
              template: found.template?.path ?? null,
            })),
          { concurrency: 4 },
        )
        // What its leads' sandboxes let through, as worked out from its repositories here, with what the person changed of it.
        const reach = yield* workedOutReach(projectId, null).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(Instance, instance),
        )
        const edits = { commands: rules.sandbox?.commands ?? UNEDITED, hosts: rules.sandbox?.hosts ?? UNEDITED }
        const sandbox = {
          commands: withEdits(reach.commands, edits.commands),
          hosts: withEdits(reach.hosts, edits.hosts),
          edits,
        }
        // How each kind of ask and refusal went lately, so the person can drop one that mostly gets worked around (ADR-071).
        const tally = yield* tallyOf(projectId).pipe(Effect.provideService(SqlClient.SqlClient, sql))
        return { ...rulesFields(projectId, rules), revision, conventions, sandbox, tally }
      })

    const rulesFields = (
      projectId: string,
      rules: ProjectRules,
    ): Omit<ProjectRulesView, 'conventions' | 'revision' | 'sandbox' | 'tally'> => {
      const set = ruleSetOf(rules)
      const accounts = accountsOf(rules)
      return {
        projectId,
        permissions: modeOf(rules),
        allowEverything: allowsEverything(rules),
        alwaysAsk: set.ask,
        never: set.never,
        alwaysAllow: set.allow,
        commands: set.commands,
        end: rules.end ?? null,
        worksIn: worksInOf(rules),
        resolveConflicts: resolvesConflicts(rules),
        pushCommits: pushesCommits(rules),
        postScreenshots: postsScreenshots(rules),
        leadsReachWeb: rules.leadsReachWeb ?? true,
        usageLimit: usageLimitOf(rules),
        rotateAccounts: accounts.rotate,
        onlyAccounts: accounts.only ?? null,
        branchPattern: rules.branchPattern ?? null,
        titlePattern: rules.titlePattern ?? null,
        moveIssues: movesIssues(rules),
        repositoryFiles: repositoryFilesOf(rules),
      }
    }

    /* An account as the window shows it: signed in, checked at most once a minute, paid for how, and out until when. One whose check failed shows as unknown; the others are shown as they are. */
    const accountStatus = (account: Account, recheck: boolean) =>
      Effect.gen(function* () {
        const check = yield* signIns.account(account, recheck)
        const out = yield* limits.outAccount(account.id)
        const providers = yield* signIns.providers(account, check)
        return {
          id: account.id,
          name: account.name,
          home: account.home,
          signIn: check.status,
          paidBy: check.paidBy,
          outUntil: Option.getOrNull(Option.map(out, (each) => each.until)),
          adoptedFrom: account.adoptedFrom,
          ...(providers === undefined ? {} : { providers }),
        } satisfies AccountStatus
      }).pipe(
        contained(
          'Status.account',
          (): AccountStatus => ({
            id: account.id,
            name: account.name,
            home: account.home,
            signIn: 'unknown',
            paidBy: 'unknown',
            outUntil: null,
            adoptedFrom: account.adoptedFrom,
          }),
          account.agentId,
        ),
      )

    /* Each agent's version, asked of its CLI once a launch. */
    const versions = new Map<string, string | null>()
    const versionOf = (entry: AgentEntry) =>
      versions.has(entry.definition.id)
        ? Effect.succeed(versions.get(entry.definition.id) ?? null)
        : agentVersion(entry.definition).pipe(
            Effect.tap((found) => Effect.sync(() => versions.set(entry.definition.id, found))),
            // Asked again next time: one that failed says no version, not a wrong one.
            contained('Status.version', () => null, entry.definition.id),
          )

    /*
     * An agent, with its accounts: each check starts the agent's own status
     * command, in the account's home. An agent that couldn't be looked at
     * says so on its own, and every other agent is shown as it is.
     */
    const signIn = (entry: AgentEntry, recheck: boolean) =>
      Effect.gen(function* () {
        const statuses = yield* Effect.forEach(yield* accounts.of(entry.definition.id), (account) => accountStatus(account, recheck), {
          concurrency: 'unbounded',
        })
        const install = yield* installs.state(entry.definition)
        return {
          id: entry.definition.id,
          name: entry.definition.name,
          installed: entry.definition.cli === undefined || install.located !== null,
          kept: install.located?.whose === 'althar',
          download:
            install.downloadable && install.size !== null
              ? { size: install.size, installing: install.installing, pinned: install.pinned }
              : null,
          signIn: anyOf(statuses.map((account) => account.signIn)),
          login: entry.definition.signIn.login,
          version: yield* versionOf(entry),
          ways: entry.definition.signIn.inApp?.ways ?? [],
          accounts: statuses,
          addsAccounts: entry.definition.home.accounts !== 'one',
          guide: entry.definition.cli?.guide ?? null,
          problem: null,
        } satisfies AgentStatus
      }).pipe(
        contained(
          'Status.agent',
          (): AgentStatus => ({
            id: entry.definition.id,
            name: entry.definition.name,
            installed: true,
            kept: false,
            download: null,
            signIn: 'unknown',
            login: entry.definition.signIn.login,
            version: null,
            ways: entry.definition.signIn.inApp?.ways ?? [],
            accounts: [],
            addsAccounts: entry.definition.home.accounts !== 'one',
            // Nothing that might be what failed: its command is read no more here.
            guide: null,
            problem: `Althar couldn't check ${entry.definition.name}. Its log has the details.`,
          }),
          entry.definition.id,
        ),
      )

    /*
     * Changes from the store's feed after `since`, or from now: the window
     * reads again what shows them. It reads when the ledger says the feed grew,
     * so it is quick when something happens and idle when nothing does, and
     * once a second in case a signal is ever missed.
     */
    const changes = (since: number | undefined): Stream.Stream<WatchEvent, ApiError> =>
      Stream.unwrap(
        api(
          Effect.gen(function* () {
            // Listening starts before the first read, so nothing added in between is missed.
            const grown = yield* ledger.listen
            const start = since ?? (yield* queries.cursor)
            return Stream.paginate(start, (cursor) =>
              api(
                Effect.gen(function* () {
                  const batch = yield* queries.changesSince(cursor, 500)
                  if (batch.length === 0) yield* Effect.raceFirst(grown, Effect.sleep(FEED_FALLBACK))
                  const events: ReadonlyArray<WatchEvent> = batch.map((change) => ({ _tag: 'Changed', ...change }))
                  return [events, Option.some(batch.at(-1)?.cursor ?? cursor)] as const
                }),
              ),
            )
          }),
        ),
      )

    /* An agent's message or thought as far as it has streamed, before the store has all of it; and how full its context is, as it says. */
    const streaming = Stream.unwrap(
      Effect.map(live.subscribe, (events) =>
        events.pipe(
          Stream.flatMap((event): Stream.Stream<WatchEvent> =>
            event._tag === 'Streaming'
              ? Stream.make({
                  _tag: 'Streaming',
                  threadId: event.threadId,
                  itemId: event.itemId,
                  sequence: event.sequence,
                  kind: event.kind,
                  agentId: event.agentId,
                  text: event.text,
                })
              : event._tag === 'Output'
                ? Stream.make({ _tag: 'Output', threadId: event.threadId, itemId: event.itemId, text: event.text, dropped: event.dropped })
                : event._tag === 'Agent' && event.event._tag === 'ContextUsage'
                  ? Stream.make({ _tag: 'Context', threadId: event.threadId, used: event.event.used, size: event.event.size })
                  : event._tag === 'Background'
                    ? Stream.make({ _tag: 'Background', threadId: event.threadId, background: event.background })
                    : event._tag === 'Launches'
                      ? Stream.make({ _tag: 'Launches', projectId: event.projectId, launches: event.launches })
                      : event._tag === 'PlanUsage'
                        ? Stream.make({ _tag: 'PlanUsage', usage: event.usage })
                        : Stream.empty,
          ),
        ),
      ),
    )

    return Api.of({
      Status: ({ recheck }) =>
        Effect.map(
          api(
            afterOpen(
              startup(
                'agent-checks',
                Effect.forEach(agents.list, (entry) => startup(`agent-${entry.definition.id}`, signIn(entry, recheck === true)), {
                  concurrency: 'unbounded',
                }),
              ),
            ),
          ),
          (statuses) => ({
            apiVersion: API_VERSION,
            appVersion: config.appVersion,
            agents: statuses,
          }),
        ),
      ListProjects: () => api(queries.projects),
      ReadFolder: ({ grant }) =>
        api(
          Effect.gen(function* () {
            const reading = yield* projects.read(yield* folders.path(grant))
            return { ...reading, repositories: [...reading.repositories] }
          }),
        ),
      PlaceRepository: ({ grant, name }) => api(Effect.flatMap(folders.path(grant), (parent) => placeRepository(parent, name))),
      MakeRepository: ({ grant, name }) =>
        api(
          Effect.gen(function* () {
            const made = yield* makeRepository(yield* folders.path(grant), name)
            return { grant: yield* folders.allow(made.path), path: made.path }
          }),
        ),
      OpenProject: ({ commandId, grant, name, repositories, projectId, ink }) =>
        api(
          Effect.gen(function* () {
            const path = yield* folders.path(grant)
            // Each repository the person kept is named by its root, inside a folder they chose: the window names no other path.
            const roots =
              repositories === undefined
                ? undefined
                : yield* Effect.forEach(repositories, (repository) =>
                    Effect.gen(function* () {
                      const within = realpathOf(yield* folders.path(repository.grant))
                      const root = realpathOf(repository.path)
                      if (root !== within && !root.startsWith(`${within}${sep}`))
                        return yield* new NotFound({ kind: 'folder', id: repository.path })
                      return root
                    }),
                  )
            const opened = yield* projects.open({
              envelope: yield* envelope('project.open', projectId === undefined ? { path } : { path, projectId }, commandId),
              path,
              ...(name === undefined ? {} : { name }),
              ...(roots === undefined ? {} : { repositories: roots }),
              ...(projectId === undefined ? {} : { projectId }),
              ...(ink === undefined ? {} : { ink }),
            })
            const { projects: all } = yield* queries.projects
            const found = all.find((project) => project.id === opened.projectId)
            return (
              found ?? {
                id: opened.projectId,
                name: opened.name,
                slug: opened.slug,
                ink: 'clay' as const,
                lastWorkAt: null,
                repository: opened.repository,
                repositories: [],
                worktrees: null,
                tasks: 0,
                running: 0,
                waiting: 0,
                working: 0,
                ready: 0,
                usageLimit: 'move' as const,
                rotateAccounts: false,
                onlyAccounts: null,
              }
            )
          }),
        ),
      RenameProject: ({ commandId, projectId, name }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.rename', { projectId, name }, commandId)
              yield* projects.rename(projectId, name, said.commandId)
            }),
          ),
        ),
      SetProjectInk: ({ commandId, projectId, ink }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.set_ink', { projectId, ink }, commandId)
              yield* projects.setInk(projectId, ink, said.commandId)
            }),
          ),
        ),
      GetProjectTracker: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const [project] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${projectId}`
            if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
            const bound = yield* projectTracker(projectId)
            if (bound === null) return null
            return {
              connectionId: bound.connectionId,
              container: bound.container,
              gone: bound.gone === null ? null : { product: bound.product, ...bound.gone },
            }
          }),
        ),
      SetProjectTracker: ({ commandId, projectId, tracker }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.set_tracker', { projectId, tracker }, commandId)
              yield* projects.setTracker(projectId, tracker, said.commandId)
            }),
          ),
        ),
      ListContainers: ({ connectionId }) =>
        api(
          Effect.gen(function* () {
            const found = (yield* connections.trackers).find((one) => one.connectionId === connectionId)
            if (found === undefined) return yield* new NotFound({ kind: 'connection', id: connectionId })
            return yield* found.tracker.containers()
          }),
        ),
      RemoveProject: ({ commandId, projectId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.remove', { projectId }, commandId)
              // A checkout its tasks hold stays theirs until all of them has stopped, counted from before it is removed; then it goes back (ADR-091).
              const local = yield* localTasksIn(projectId).pipe(Effect.provideContext(folderStore))
              const removing = Effect.gen(function* () {
                const threads = yield* projects.remove(projectId, said.commandId)
                // Its runs are over, so no step answers an agent going: each one still on it stops, the coordinator too.
                yield* Effect.forEach(threads, (threadId) => Effect.ignore(sessions.stop(threadId)), { discard: true })
                // And what it runs stops, with no project left to stop it from.
                yield* launches.stopAll(projectId)
                // What its Local tasks' agents left running in their checkouts, as a server outside their group, stops as a settled task's does.
                yield* Effect.forEach(local, (taskId) => leftBehind.settled(taskId), { discard: true })
              })
              yield* local.reduce((inner, taskId) => leftBehind.stoppingWhile(taskId, inner), removing)
              if (local.length > 0) yield* runs.checkoutsMoved
            }),
          ),
        ),
      GetRepositories: ({ projectId }) =>
        api(Effect.flatMap(projects.repositories(projectId), (list) => Effect.forEach(list, repositoryOf))),
      AddRepositories: ({ commandId, projectId, grant }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.add_repositories', { projectId }, commandId)
              yield* projects.addRepositories(projectId, yield* folders.path(grant), said.commandId)
            }),
          ),
        ),
      LeaveOutRepository: ({ commandId, projectId, repositoryId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.leave_out_repository', { projectId, repositoryId }, commandId)
              yield* projects.leaveOut(projectId, repositoryId, said.commandId)
            }),
          ),
        ),
      SetRepository: ({ commandId, projectId, repositoryId, role, changeTarget, notNow, setup, workToward }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope(
                'project.set_repository',
                { projectId, repositoryId, role, changeTarget, notNow, setup, workToward },
                commandId,
              )
              // Its branches go upstream only where its host says now that the person can push there.
              if (changeTarget === 'upstream_branch') {
                const fork = (yield* projects.repositories(projectId)).find((one) => one.id === repositoryId)?.fork ?? null
                if (fork !== null && (yield* canPushTo(fork.upstreamUrl, true)) !== true)
                  return yield* new ProjectRefused({ reason: 'no_upstream_access' })
              }
              yield* projects.setRepository({
                projectId,
                repositoryId,
                ...(role === undefined ? {} : { role }),
                ...(changeTarget === undefined ? {} : { changeTarget }),
                ...(notNow === undefined ? {} : { notNow }),
                ...(setup === undefined ? {} : { setup }),
                ...(workToward === undefined ? {} : { workToward }),
                commandId: said.commandId,
              })
            }),
          ),
        ),
      CreateBranch: ({ commandId, projectId, repositoryId, branch }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              yield* envelope('project.create_branch', { projectId, repositoryId, branch }, commandId)
              return yield* makeBranch({ projectId, repositoryId, branch }).pipe(
                Effect.provideService(SqlClient.SqlClient, sql),
                Effect.provideService(Instance, instance),
                Effect.provideService(Connections, connections),
              )
            }),
          ),
        ),
      ListTasks: ({ projectId }) => api(queries.tasks(projectId)),
      SearchTasks: ({ projectId, text, limit }) =>
        api(
          Effect.gen(function* () {
            const working = new Set((yield* sessions.onTasks).flatMap((session) => (session.turnRunning ? [session.taskId] : [])))
            const input = { text, ...(projectId === undefined ? {} : { projectId }), ...(limit === undefined ? {} : { limit }) }
            return { tasks: yield* findTasks(input, working) }
          }),
        ),
      CreateTask: ({ commandId, projectId, title, description, issue, repositories }) =>
        api(
          Effect.gen(function* () {
            const from = yield* issueFor(projectId, issue)
            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description, issue }, commandId),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
              ...(from === undefined ? {} : { issueKey: from.key }),
              ...(repositories === undefined ? {} : { repositories }),
              ...requestOf(title, description, issue),
            })
            if (issue !== undefined) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue })
            return yield* queries.task(created.taskId)
          }),
        ),
      GetThread: ({ threadId, before, limit, fresh }) =>
        api(
          queries.thread(threadId, {
            ...(before === undefined ? {} : { before }),
            ...(limit === undefined ? {} : { limit }),
            ...(fresh === true ? { fresh } : {}),
          }),
        ),
      GetThreadItem: ({ threadId, itemId }) => api(queries.item(threadId, itemId)),
      ReadOutput: ({ threadId, itemId }) => api(queries.output(threadId, itemId)),
      ReadDocument: ({ threadId, path }) => api(queries.document(threadId, path)),
      ListCanvases: ({ projectId, archived }) => api(canvases.list(projectId, archived === true)),
      GetCanvas: ({ canvasId }) => api(canvases.get(canvasId)),
      ReadCanvasText: ({ canvasId, version }) => api(canvases.text(canvasId, version)),
      FindCode: ({ threadId, messages }) => api(queries.findCode(threadId, messages)),
      ReadCode: ({ threadId, path, commit, line }) => api(queries.readCode(threadId, path, commit, line)),
      GetFileDiff: ({ taskId, path, untouched }) => api(queries.fileDiff(taskId, path, untouched === true)),
      GetTaskFindings: ({ taskId, review }) => api(queries.findings(taskId, review)),
      GetBoard: ({ projectId }) => api(queries.board(projectId)),
      GetOlderSettled: ({ projectId, before, taskId }) =>
        api(Effect.map(queries.olderSettled(projectId, before, taskId), (tasks) => ({ tasks }))),
      GetHome: ({ since }) => api(queries.home(since)),
      LeftHome: () =>
        api(
          Effect.gen(function* () {
            yield* sql`UPDATE devices SET home_looked_at = ${yield* timestamp} WHERE id = ${instance.deviceId}`
          }),
        ),
      // The person opened a task: when, kept. It moves nothing: a finished task waits for them to settle it.
      SeeTask: ({ taskId }) => api(tasks.see({ taskId })),
      SettledWithOnePress: ({ taskId, attentionId, action }) =>
        api(tasks.pressed({ ...(taskId === undefined ? {} : { taskId }), ...(attentionId === undefined ? {} : { attentionId }), action })),
      StartSession: ({ commandId, threadId, agentId, model, effort }) =>
        once(
          commandId,
          api(
            sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }),
          ),
        ),
      SwitchAgent: ({ commandId, threadId, agentId, model, effort, body, images, files, dictated }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              // Its images and files are read and kept first, outside any transaction; one that can't be sent refuses the switch.
              const kept = body === undefined || images === undefined || images.length === 0 ? [] : yield* keptFor(threadId, images)
              const copied = body === undefined ? [] : yield* filesFor(threadId, files)
              // What the person said with it is said to the thread, under a command of its own.
              const message =
                body === undefined
                  ? undefined
                  : {
                      // Its own command id, made from the switch's, so a retry of the switch is a retry of it too.
                      envelope: yield* envelope(
                        'thread.send',
                        {
                          threadId,
                          body,
                          disposition: 'after_current',
                          ...imagesSaid(kept),
                          ...filesSaid(copied),
                          ...(dictated === true ? { dictated } : {}),
                        },
                        `cmd_${createHash('sha256').update(`${commandId}\u0000said`).digest('hex').slice(0, 32)}`,
                      ),
                      body,
                      sender,
                      ...(kept.length === 0 ? {} : { images: kept }),
                      ...(copied.length === 0 ? {} : { files: copied }),
                      ...(dictated === true ? { dictated: true } : {}),
                    }
              // Written to again with the switch, a task kept for later is back, as when it is sent on its own.
              if (message !== undefined) {
                const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId} AND kind = 'task'`
                if (thread?.taskId != null) yield* tasks.bringBack(thread.taskId)
              }
              const sessionId = yield* sessions.switchAgent({
                threadId,
                agentId,
                ...(model === undefined ? {} : { model }),
                ...(effort === undefined ? {} : { effort }),
                ...(message === undefined ? {} : { message }),
                // The person's switch: its first turn goes on at once (ADR-037).
                byPerson: sender.kind === 'window' || sender.kind === 'paired_device',
              })
              // Links in what the person said unfurl on their message, as when it is sent on its own.
              if (message !== undefined) yield* Effect.forkDetach(issues.unfurlInput(message.envelope.commandId))
              return sessionId
            }),
          ),
        ),
      SetModel: ({ commandId, threadId, model }) => once(commandId, api(sessions.setModel({ threadId, model }))),
      SetEffort: ({ commandId, threadId, effort }) => once(commandId, api(sessions.setEffort({ threadId, effort }))),
      GetModels: () => api(models.catalog),
      SetDefaultEffort: ({ commandId, agentId, model, effort }) =>
        once(commandId, api(models.setDefaultEffort({ agentId, model, effort }))),
      SetModelBlocked: ({ commandId, agentId, model, blocked }) =>
        once(commandId, api(models.setModelBlocked({ agentId, model, blocked }))),
      GetSettings: () =>
        api(
          Effect.gen(function* () {
            const on = yield* coAuthorOn
            const atOnce = yield* busy.atOnce
            return {
              plansAndReviews: yield* plansAndReviewsOf,
              newProjects: yield* newProjectDefaultsOf,
              coAuthor: { on, line: coAuthorLine },
              reviewSeal: yield* reviewSeal,
              postTeamReviews: yield* postTeamReviews,
              runOutside: yield* runOutside,
              automationsPaused: yield* automations.allPaused,
              folderWait: yield* cleanup.wait,
              agentsAtOnce: {
                count: atOnce.count,
                own: atOnce.own,
                machine: { count: atOnce.machine.count, cores: atOnce.machine.cores, memory: atOnce.machine.memory },
              },
            }
          }),
        ).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetCoAuthor: ({ commandId, on }) => once(commandId, api(setCoAuthor(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      GetAgentTools: ({ projectId }) =>
        api(agentTools(projectId)).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.provideService(RuntimeConfig, config)),
      SetToolRoles: ({ commandId, kind, name, roles, projectId, repository }) =>
        once(
          commandId,
          api(
            kind === 'server'
              ? setToolRoles(kind, name, roles, projectId, repository ?? null)
              : // A skill added from GitHub is on while any role gets it, which turns it on or off in the store, as a switch there did.
                Effect.gen(function* () {
                  const turned = yield* setSkillRoles(config.skills, name, roles, projectId, repository ?? null)
                  if (turned !== undefined)
                    yield* skillAct(commandId, turned.id, turned.active ? 'turned_on' : 'turned_off', { treeHash: turned.treeHash })
                }),
          ).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
        ),
      SetToolInProject: ({ commandId, kind, name, projectId, on }) =>
        once(commandId, api(setToolInProject(kind, name, projectId, on)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      GetServerDetail: ({ name, repository }) =>
        api(serverDetail(name, repository)).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(RuntimeConfig, config),
        ),
      AddServer: ({ commandId, server, agents }) =>
        once(commandId, api(withSync((io) => addServer(io, server, agents))).pipe(Effect.provideService(RuntimeConfig, config))),
      RemoveServer: ({ commandId, name }) =>
        once(commandId, api(withSync((io) => removeServer(io, name))).pipe(Effect.provideService(RuntimeConfig, config))),
      SetToolSync: ({ commandId, kind, on, takeBack }) =>
        once(
          commandId,
          api(
            withSync((io) =>
              kind === 'server'
                ? on
                  ? mcpSync.turnOn(io)
                  : mcpSync.turnOff(io, takeBack)
                : mcpSync.serialized(io, () => (on ? skillSync.turnSkillsOn(io) : skillSync.turnSkillsOff(io, takeBack))),
            ),
          ).pipe(Effect.provideService(RuntimeConfig, config)),
        ),
      // A read of how the person's servers stand in their agents, kept for the tiles; a runtime that doesn't read their agents asks none.
      CheckServers: ({ commandId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const io = yield* syncIo
              if (io !== undefined) yield* Effect.promise(() => checkHealth(io))
            }),
          ).pipe(Effect.provideService(RuntimeConfig, config)),
        ),
      SetToolKeptOut: ({ commandId, kind, agent, name, out }) =>
        once(
          commandId,
          api(
            withSync((io) =>
              kind === 'server'
                ? out
                  ? mcpSync.keepOut(io, agent, name)
                  : mcpSync.putBack(io, agent, name)
                : mcpSync.serialized(io, () => (out ? skillSync.keepSkillOut(io, agent, name) : skillSync.putSkillBack(io, agent, name))),
            ),
          ).pipe(Effect.provideService(RuntimeConfig, config)),
        ),
      PickToolWay: ({ commandId, kind, name, way }) =>
        once(
          commandId,
          api(
            withSync((io) =>
              kind === 'server' ? mcpSync.pickWay(io, name, way) : mcpSync.serialized(io, () => skillSync.pickSkill(io, name, way)),
            ),
          ).pipe(Effect.provideService(RuntimeConfig, config)),
        ),
      UndoToolSync: ({ commandId, id }) =>
        once(commandId, api(withSync((io) => mcpSync.undoSince(io, id))).pipe(Effect.provideService(RuntimeConfig, config))),
      SignInToolServer: ({ commandId, agent, name }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const io = yield* syncIo
              const line = io === undefined ? undefined : mcpSync.signIn(io, agent, name)
              if (line !== undefined && config.openTerminal !== undefined) yield* config.openTerminal(line)
            }),
          ).pipe(Effect.provideService(RuntimeConfig, config)),
        ),
      SetReviewSeal: ({ commandId, on }) => once(commandId, api(setReviewSeal(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      SetReviewSealStyle: ({ commandId, style }) =>
        once(commandId, api(setReviewSealStyle(style)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      SetAgentsAtOnce: ({ commandId, count }) => once(commandId, api(busy.set(count))),
      SetFolderWait: ({ commandId, wait }) => once(commandId, api(cleanup.setWait(wait))),
      SetPlansAndReviews: ({ commandId, ...change }) =>
        once(commandId, api(setPlansAndReviews(change)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      SetNewProjectDefaults: ({ commandId, ...change }) =>
        once(commandId, api(setNewProjectDefaults(change)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      GetTaskFolders: () => api(cleanup.list),
      CleanUpFolders: ({ commandId }) => once(commandId, api(cleanup.cleanUp(instance.personId))),
      RemoveTaskFolder: ({ commandId, taskId, seen }) => once(commandId, api(cleanup.remove(taskId, seen, instance.personId))),
      MoveInLine: ({ commandId, taskId, to }) => once(commandId, api(Effect.asVoid(busy.move(taskId, to)))),
      LineOldestFirst: ({ commandId, projectId }) => once(commandId, api(busy.oldestFirst(projectId))),
      SetPostTeamReviews: ({ commandId, on }) =>
        once(commandId, api(setPostTeamReviews(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      SetRunOutside: ({ commandId, to }) => once(commandId, api(setRunOutside(to)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      RunIt: ({ commandId, taskId, how }) => once(commandId, api(reviews.runIt({ taskId, ...(how === undefined ? {} : { how }) }))),
      StopRunning: ({ commandId, taskId }) => once(commandId, api(reviews.stopRunning({ taskId, actorId: instance.personId }))),
      GetAutomations: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const cursor = yield* cursorNow
            return { cursor, automations: yield* automations.list(projectId), allPaused: yield* automations.allPaused }
          }),
        ),
      GetAutomation: ({ automationId }) =>
        api(
          Effect.gen(function* () {
            const cursor = yield* cursorNow
            return { cursor, automation: yield* automations.read(automationId) }
          }),
        ),
      MakeAutomation: ({ commandId, projectId, definition, on }) =>
        once(
          commandId,
          api(
            Effect.map(
              automations.make({ projectId, definition, ...(on === undefined ? {} : { on }), actorId: instance.personId }),
              (automationId) => ({ automationId }),
            ),
          ),
        ),
      ChangeAutomation: ({ commandId, automationId, definition }) =>
        once(commandId, api(automations.change(automationId, definition, instance.personId))),
      TurnOnAutomation: ({ commandId, automationId, itemId }) =>
        once(commandId, api(automations.turnOn(automationId, instance.personId, itemId))),
      PauseAutomation: ({ commandId, automationId }) => once(commandId, api(automations.pause(automationId, instance.personId))),
      RunAutomationNow: ({ commandId, automationId, itemId }) =>
        once(commandId, api(automations.runNow(automationId, instance.personId, itemId))),
      DeleteAutomation: ({ commandId, automationId }) => once(commandId, api(automations.remove(automationId, instance.personId))),
      AnswerTaskAsk: ({ commandId, itemId, yes }) => once(commandId, api(taskActions.answer(itemId, yes, instance.personId))),
      MakeItAFullTask: ({ commandId, taskId }) => once(commandId, api(fastLane.makeFullTask(taskId))),
      KeepTheModel: ({ commandId, itemId }) => once(commandId, api(fastLane.keepTheModel(itemId))),
      UndoTheModelMove: ({ commandId, itemId }) => once(commandId, api(fastLane.undoTheModelMove(itemId))),
      UndoAutomationChange: ({ commandId, itemId }) => once(commandId, api(automations.undo(itemId, instance.personId))),
      AnswerSettingChange: ({ commandId, itemId, yes }) => once(commandId, api(settingsTools.answer(itemId, yes))),
      UndoSettingChange: ({ commandId, itemId }) => once(commandId, api(settingsTools.undo(itemId))),
      GetSettingChanges: ({ projectId }) => api(settingsTools.changed(projectId)),
      SetAutomationPostsReviews: ({ commandId, automationId, on }) =>
        once(commandId, api(automations.setPostsReviews(automationId, on, instance.personId))),
      SetAutomationsPaused: ({ commandId, paused }) => once(commandId, api(automations.setAllPaused(paused))),
      // Interrupted by the person, a conflict its lead was resolving is theirs (ADR-030): handed over first, so the turn's end doesn't ask the lead again.
      Interrupt: ({ commandId, threadId }) =>
        once(commandId, api(Effect.andThen(pullRequests.leadStopped({ threadId }, 'interrupted'), sessions.interrupt(threadId)))),
      TryAgain: ({ commandId, threadId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              if (!(yield* sessions.tryAgain(threadId))) return yield* new RetryRefused()
            }),
          ),
        ),
      CompactContext: ({ commandId, threadId }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('thread.compact', { threadId }, commandId), (made) => sessions.compact({ envelope: made, threadId })),
          ),
        ),
      ClearView: ({ commandId, threadId }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('thread.clear_view', { threadId }, commandId), (made) =>
              Effect.provideContext(clearView({ envelope: made, threadId }), store),
            ),
          ),
        ),
      ShowEarlier: ({ commandId, threadId, open }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('thread.show_earlier', { threadId, open }, commandId), (made) =>
              Effect.provideContext(showEarlier({ envelope: made, threadId, open }), store),
            ),
          ),
        ),
      UndoClearView: ({ commandId, threadId }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('thread.undo_clear_view', { threadId }, commandId), (made) =>
              Effect.provideContext(undoClearView({ envelope: made, threadId }), store),
            ),
          ),
        ),
      ForgetConversation: ({ commandId, threadId }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('thread.forget_conversation', { threadId }, commandId), (made) =>
              sessions.forget({ envelope: made, threadId }),
            ),
          ),
        ),
      // Stopped by the person, a conflict its lead was resolving is theirs (ADR-030): the lead isn't started again for it.
      StopSession: ({ commandId, threadId }) =>
        once(commandId, api(Effect.andThen(sessions.stop(threadId), pullRequests.leadStopped({ threadId })))),
      SetTaskResolveConflicts: ({ commandId, taskId, resolveConflicts }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.set_conflicts', { taskId, resolveConflicts }, commandId), (said) =>
              pullRequests.setResolveConflicts({ envelope: said, taskId, resolveConflicts }),
            ),
          ),
        ),
      // The person's Resolve now: asked of its lead whatever stood in the way (ADR-030).
      ResolveConflictsNow: ({ commandId, taskId }) => once(commandId, api(pullRequests.resolveNow({ taskId }, true))),
      LookForConflicts: ({ commandId, projectId }) => once(commandId, api(pullRequests.resolveNow({ projectId }))),
      SetTaskAllowEverything: ({ commandId, taskId, allowEverything }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.set_allow_everything', { taskId, allowEverything }, commandId), (said) =>
              permissions.allowEverything({ envelope: said, taskId, on: allowEverything }),
            ),
          ),
        ),
      StopTask: ({ commandId, taskId }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.stop', { taskId }, commandId), (said) =>
              Effect.andThen(tasks.stop({ envelope: said, taskId }), pullRequests.leadStopped({ taskId })),
            ),
          ),
        ),
      ResumeTask: ({ commandId, taskId, agentId, model, effort }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.resume', { taskId, agentId }, commandId), (said) =>
              tasks.resume({
                envelope: said,
                taskId,
                // The agent the person picked, else its last lead.
                ...(agentId === undefined ? {} : { lead: { agentId, model: model ?? null, effort: effort ?? null } }),
              }),
            ),
          ),
        ),
      LeaveOutCommits: ({ commandId, taskId }) =>
        once(
          commandId,
          api(Effect.flatMap(envelope('task.leave_out', { taskId }, commandId), (said) => tasks.leaveOut({ envelope: said, taskId }))),
        ),
      AbandonTask: ({ commandId, taskId }) =>
        once(
          commandId,
          api(Effect.flatMap(envelope('task.abandon', { taskId }, commandId), (said) => tasks.abandon({ envelope: said, taskId }))),
        ),
      MarkTaskDone: ({ commandId, taskId }) =>
        once(
          commandId,
          api(
            Effect.asVoid(
              Effect.flatMap(envelope('task.mark_done', { taskId }, commandId), (said) => tasks.markDone({ envelope: said, taskId })),
            ),
          ),
        ),
      KeepTaskForLater: ({ commandId, taskId }) =>
        once(
          commandId,
          api(
            Effect.asVoid(Effect.flatMap(envelope('task.keep', { taskId }, commandId), (said) => tasks.keep({ envelope: said, taskId }))),
          ),
        ),
      RenameTask: ({ commandId, taskId, title }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.rename', { taskId, title }, commandId), (said) =>
              Effect.asVoid(tasks.rename({ envelope: said, taskId, title })),
            ),
          ),
        ),
      ReopenTask: ({ commandId, taskId }) =>
        once(
          commandId,
          api(Effect.flatMap(envelope('task.reopen', { taskId }, commandId), (said) => tasks.reopen({ envelope: said, taskId }))),
        ),
      Send: ({ commandId, threadId, body, disposition, images, files, dictated, canvasComments }) =>
        api(
          sessions.accepting(
            threadId,
            Effect.gen(function* () {
              // Its images and files are read, checked and kept first, outside the command's transaction: one that can't be sent refuses the message.
              const kept = images === undefined || images.length === 0 ? [] : yield* keptFor(threadId, images)
              const copied = yield* filesFor(threadId, files)
              const message = {
                // The command says its images by their digests, never their bytes, and how many files, never their paths.
                envelope: yield* envelope(
                  'thread.send',
                  {
                    threadId,
                    body,
                    disposition,
                    ...imagesSaid(kept),
                    ...filesSaid(copied),
                    ...(dictated === true ? { dictated } : {}),
                    ...(canvasComments === undefined || canvasComments.length === 0 ? {} : { canvasComments }),
                  },
                  commandId,
                ),
                threadId,
                body,
                sender,
                disposition,
                ...(kept.length === 0 ? {} : { images: kept }),
                ...(copied.length === 0 ? {} : { files: copied }),
                ...(dictated === true ? { dictated } : {}),
                ...(canvasComments === undefined || canvasComments.length === 0 ? {} : { canvasComments }),
              }
              // What the person says to the coordinator starts it, if it isn't running.
              const [thread] = yield* sql<{ kind: string; taskId: string | null }>`SELECT kind, task_id FROM threads WHERE id = ${threadId}`
              if (thread?.kind === 'coordinator') yield* coordinator.say(message)
              else {
                // Written to again, a task kept for later is back: what its lead does next ends in Needs you.
                if (thread?.kind === 'task' && thread.taskId !== null) yield* tasks.bringBack(thread.taskId)
                yield* sessions.send(message)
              }
              // Links in what the person said unfurl on their message, without holding up the reply.
              yield* Effect.forkDetach(issues.unfurlInput(commandId))
            }),
          ),
        ),
      TakeBack: ({ commandId, itemId }) =>
        api(
          Effect.gen(function* () {
            yield* sessions.takeBack({ envelope: yield* envelope('thread.take_back', { itemId }, commandId), itemId })
          }),
        ),
      GetCoordinator: ({ projectId, before, limit }) =>
        api(queries.coordinator(projectId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      StartTask: ({ commandId, projectId, title, description, steps, issue, end, repositories, chat }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const from = yield* issueFor(projectId, issue)
              const created = yield* projects.createTask({
                envelope: yield* envelope('task.create', { projectId, title, description, issue }, commandId),
                projectId,
                title,
                ...(description === undefined ? {} : { description }),
                draft: true,
                ...(from === undefined ? {} : { issueKey: from.key }),
                ...(repositories === undefined ? {} : { repositories }),
                // An aside's words are the person's, whole: its thread opens with them.
                ...(chat === true ? { plain: true, request: description ?? title } : requestOf(title, description, issue)),
              })
              if (issue !== undefined) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue })
              // An aside sits on Scratch from the start, beside the coordinator's conversation rather than on the board.
              if (chat === true) yield* Effect.provideContext(shelve(created.taskId, 'scratch', instance.personId), folderStore)
              // A task you start yourself is planned like any other, and starts at once; its card shows in the coordinator's thread.
              const planId = yield* plans.propose({
                projectId: projectId as ProjectId,
                taskId: created.taskId,
                steps,
                reason: null,
                actorId: instance.personId,
                startsIn: Duration.zero,
                // An aside, as a chat the coordinator starts: nothing of it goes outside the project when it is done.
                ...(chat === true
                  ? { end: null, here: true, card: false as const }
                  : { end: end === undefined ? yield* pullRequests.endFor(projectId, created.taskId) : end }),
              })
              yield* plans.start(planId, instance.personId)
              return yield* queries.task(created.taskId)
            }),
          ),
        ),
      StartPlan: ({ commandId, planId }) => once(commandId, api(Effect.asVoid(plans.start(planId, instance.personId)))),
      HoldPlan: ({ commandId, planId }) => once(commandId, api(plans.hold(planId, instance.personId))),
      ChangePlan: ({ commandId, planId, steps, end, worksIn, toward }) =>
        once(commandId, api(plans.change(planId, steps, instance.personId, end, worksIn, toward))),
      ApplyPreset: ({ commandId, planId, preset }) => once(commandId, api(plans.applyPreset(planId, preset, instance.personId))),
      ChangeTeam: ({ commandId, taskId, steps }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const changed = yield* runs.changeTeam({ taskId, steps, actorId: instance.personId })
              const named = yield* modelNamer.pipe(Effect.provideService(Agents, agents), Effect.provideService(Models, models))
              const [thread] = yield* sql<{ id: string; projectId: ProjectId }>`
                SELECT id, project_id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
              if (thread === undefined) return
              // Each change, said in the task's thread as the person made it.
              for (const line of teamChanges(changed, named))
                yield* Effect.provideContext(
                  addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
                    source: 'runtime',
                    severity: 'info',
                    title: `You ${teamLine(line)}`,
                  }),
                  folderStore,
                )
            }),
          ),
        ),
      ChangeIssueDraft: ({ commandId, draftId, title, body, labels, priority }) =>
        once(
          commandId,
          api(
            issueDrafts.change(
              draftId,
              { title, body, labels, ...(priority === undefined ? {} : { priority: priority ?? 'none' }) },
              instance.personId,
            ),
          ),
        ),
      FileIssueDraft: ({ commandId, draftId }) => once(commandId, api(Effect.asVoid(issueDrafts.file(draftId, instance.personId)))),
      DiscardIssueDraft: ({ commandId, draftId }) => once(commandId, api(issueDrafts.discard(draftId, instance.personId))),
      ApplyIssueChanges: ({ commandId, changesId }) =>
        once(commandId, api(Effect.asVoid(issueChanges.apply(changesId, instance.personId)))),
      DiscardIssueChanges: ({ commandId, changesId }) => once(commandId, api(issueChanges.discard(changesId, instance.personId))),
      PreferIssueCards: ({ commandId, threadId, atOnce }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              // Said to the coordinator as the person said it, from an issue's card: it keeps it as one of the project's notes.
              const [thread] = yield* sql<{ projectId: string; kind: string; taskId: string | null }>`
                SELECT project_id, kind, task_id FROM threads WHERE id = ${threadId}`
              if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
              const [home] = yield* sql<{ id: string }>`
                SELECT id FROM threads WHERE project_id = ${thread.projectId} AND kind = 'coordinator' LIMIT 1`
              if (home === undefined) return yield* new NotFound({ kind: 'coordinator thread', id: thread.projectId })
              const body = atOnce ? text.issuesAtOnce : text.issuesAskFirst
              yield* coordinator.say({
                envelope: yield* envelope('thread.send', { threadId: home.id, body, disposition: 'after_current' }, commandId),
                threadId: home.id,
                body,
                disposition: 'after_current',
                sender,
              })
              // A task's lead, where it was said on its card, hears it now: its brief had the notes as they were.
              if (thread.kind === 'task' && thread.taskId !== null) {
                const [open] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${thread.taskId} AND state = 'open'`
                if (open !== undefined)
                  yield* sessions.send({
                    envelope: yield* Effect.provideContext(
                      Runtime.envelope('thread.send', { threadId, preferIssueCards: atOnce }, undefined, instance.systemId),
                      context,
                    ),
                    threadId,
                    body: atOnce ? text.leadIssuesAtOnce : text.leadIssuesAskFirst,
                    disposition: 'after_current',
                    quiet: true,
                  })
              }
            }),
          ),
        ),
      SetTaskIssuePart: ({ commandId, taskId, partOf }) => once(commandId, api(issues.setPart(taskId, partOf))),
      ChangeReviewDraft: ({ commandId, draftId, verdict, summary, comments }) =>
        once(
          commandId,
          api(
            reviews.change(
              draftId,
              {
                ...(verdict === undefined ? {} : { verdict }),
                ...(summary === undefined ? {} : { summary }),
                ...(comments === undefined ? {} : { comments }),
              },
              instance.personId,
            ),
          ),
        ),
      PostReviewDraft: ({ commandId, draftId }) => once(commandId, api(Effect.asVoid(reviews.post(draftId, instance.personId)))),
      DiscardReviewDraft: ({ commandId, draftId }) => once(commandId, api(reviews.discard(draftId, instance.personId))),
      AnswerStuck: ({ commandId, attentionId, answer }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              yield* runs.answerStuck({
                envelope: yield* envelope('attention.answer_stuck', { attentionId, answer }, commandId),
                attentionId,
                answer,
                sender,
              })
            }),
          ),
        ),
      MoveTask: ({ commandId, taskId, to, change, consent }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.move', { taskId, to }, commandId), (said) =>
              runs.move({
                envelope: said,
                taskId,
                to,
                ...(change === undefined ? {} : { change }),
                ...(consent === undefined ? {} : { consent }),
              }),
            ),
          ),
        ),
      ListPresets: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const all = yield* presetsIn(projectId ?? null)
            // Each lead as people know its model, where the agents offer it.
            const models = presetModels(yield* usableModels(projectId ?? undefined).pipe(Effect.orElseSucceed(() => [])))
            // The projects they're kept to, or can be, by name, for Settings to say.
            const named = new Map(
              (yield* sql<{ id: string; name: string }>`SELECT id, name FROM projects`).map((one) => [one.id, one.name] as const),
            )
            return all.map(({ fromProjectId, ...one }) => {
              const keptTo = one.projectId === null ? undefined : named.get(one.projectId)
              const from = fromProjectId == null ? undefined : named.get(fromProjectId)
              return {
                ...one,
                about: describePreset(one.parts, models),
                ...(keptTo === undefined ? {} : { keptTo }),
                ...(from === undefined ? {} : { from }),
              }
            })
          }).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
        ),
      EditPreset: ({ commandId, id, name, parts, projectOnly }) =>
        once(
          commandId,
          api(
            editPreset({ id, name, parts, ...(projectOnly === undefined ? {} : { projectOnly }) }).pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
            ),
          ),
        ),
      SavePreset: ({ commandId, name, taskId, parts, projectOnly }) =>
        once(
          commandId,
          api(
            Effect.provideContext(
              Effect.gen(function* () {
                const from = taskId === undefined ? null : yield* partsOfTask(taskId)
                const kept = parts ?? from?.parts
                if (kept === undefined)
                  return yield* new ApiError({ reason: 'Invalid', message: 'Say which task, or what parts, to keep.' })
                return yield* savePreset({
                  name,
                  parts: kept,
                  projectId: projectOnly === true ? (from?.projectId ?? null) : null,
                  fromTaskId: taskId ?? null,
                  actorId: instance.personId,
                })
              }),
              folderStore,
            ),
          ),
        ),
      RemovePreset: ({ commandId, id }) => once(commandId, api(removePreset(id).pipe(Effect.provideService(SqlClient.SqlClient, sql)))),
      ShelveTask: ({ commandId, taskId, shelf }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.shelve', { taskId, shelf }, commandId), (said) =>
              Effect.provideContext(shelve(taskId, shelf, said.actorId), folderStore),
            ),
          ),
        ),
      WorkToward: ({ commandId, taskId, toward }) => once(commandId, api(runs.workToward({ taskId, toward }))),
      JoinChanges: ({ commandId, taskId, change, into }) =>
        once(commandId, api(pullRequests.joinChanges(taskId, change, into ?? null, instance.personId))),
      DropChange: ({ commandId, taskId, change }) => once(commandId, api(pullRequests.dropChange(taskId, change, instance.personId))),
      StopHelper: ({ commandId, taskId, helper }) => once(commandId, api(Effect.asVoid(helpers.stop({ taskId, helper, by: 'person' })))),
      DropMove: ({ commandId, taskId }) =>
        once(
          commandId,
          api(Effect.flatMap(envelope('task.drop_move', { taskId }, commandId), (said) => runs.dropMove({ envelope: said, taskId }))),
        ),
      AnswerCheckout: ({ commandId, attentionId, answer }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('attention.answer_checkout', { attentionId, answer }, commandId), (said) =>
              runs.answerCheckout({ envelope: said, attentionId, answer }),
            ),
          ),
        ),
      HandOverHeld: ({ commandId, taskId, agentId, accountId, model }) => {
        const answer = {
          kind: 'retry' as const,
          agentId,
          ...(accountId === undefined ? {} : { accountId }),
          ...(model === undefined ? {} : { model }),
        }
        return once(
          commandId,
          api(
            Effect.flatMap(envelope('task.hand_over_held', { taskId, answer }, commandId), (said) =>
              runs.handOverHeld({ envelope: said, taskId, answer }),
            ),
          ),
        )
      },
      AnswerQuestion: ({ commandId, attentionId, answers }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('attention.answer_question', { attentionId, answers }, commandId)
              const [on] = yield* sql<{ kind: string | null; automationId: string | null; state: string }>`
                SELECT t.kind, q.state, json_extract(q.payload, '$.automationId') AS automation_id FROM attention_requests q
                LEFT JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
                WHERE q.id = ${attentionId}`
              // A task's lead or reviewer carries on with the answer once it has a place among the agents at work here (Runs).
              const answer =
                on?.kind === 'coordinator'
                  ? Effect.gen(function* () {
                      // Althar asked, not the coordinator: "run it" runs the automation, which takes the question back, and says
                      // why where it still can't; any other answer closes it.
                      if (on.automationId !== null) {
                        // A call already closed, here or by a run that started since, starts nothing. The run that "Run it now"
                        // starts is the record of that answer, and takes the call back; "Leave it" answers it.
                        if (on.state !== 'open') return
                        if (answers.next?.values.includes('run') === true)
                          return yield* automations.runNow(on.automationId, instance.personId)
                        yield* questions.answer({ envelope: said, attentionId, answers })
                        return
                      }
                      const answered = yield* questions.answer({ envelope: said, attentionId, answers })
                      if (answered.told) return
                      // The coordinator that asked has gone: the answer is told to the one on its thread next.
                      yield* coordinator.say({
                        envelope: yield* Effect.provideContext(
                          Runtime.envelope('thread.send', { threadId: answered.threadId, answered: attentionId }),
                          context,
                        ),
                        threadId: answered.threadId,
                        body: answered.body,
                        disposition: 'after_current',
                        quiet: true,
                      })
                    })
                  : runs.answer({ envelope: said, attentionId, answers })
              // A task's question is answered in the task's turn: stopping it comes first, and the question is withdrawn, or
              // after, and the agent the answer started stops.
              const [asked] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM attention_requests WHERE id = ${attentionId}`
              yield* asked === undefined || asked.taskId === null ? answer : tasks.inTurn(asked.taskId, answer)
            }),
          ),
        ),
      Answer: ({ commandId, attentionId, decision, reason, always }) =>
        api(
          Effect.gen(function* () {
            yield* permissions.answer({
              envelope: yield* envelope('attention.answer', { attentionId, decision, reason, always }, commandId),
              attentionId,
              decision,
              ...(reason === undefined ? {} : { reason }),
              ...(always === undefined ? {} : { always }),
            })
          }),
        ),
      ListConnections: () =>
        api(
          Effect.gen(function* () {
            const cursor = yield* queries.cursor
            const list = yield* connections.list
            return {
              cursor,
              connections: list.map(connectionOf),
              products: connections.products
                .filter((info) => info.make !== null)
                .map((info) => ({
                  product: info.product,
                  service: info.service,
                  name: info.name,
                  host: info.host,
                  tracker: info.tracker,
                  hostedUrl: info.hosted?.webUrl ?? null,
                  selfHosted: info.selfHosted,
                  workspaces: info.workspaces === true,
                  browserSignIn: info.browserSignIn,
                  tokenNeeds: info.token.needs,
                  tokenPrefixes: info.token.prefixes,
                  tokenHelpForKey: info.token.helpForKey ?? null,
                  keyChecks: info.token.keyChecks ?? [],
                })),
              places: yield* connections.places,
            }
          }),
        ),
      StartSignIn: ({ commandId, product, webUrl, connectionId }) =>
        once(
          commandId,
          api(
            connections.startSignIn({
              product,
              actorId: instance.personId,
              ...(webUrl === undefined ? {} : { webUrl }),
              ...(connectionId === undefined ? {} : { connectionId }),
            }),
          ),
        ),
      GetSignIn: ({ flowId }) => api(connections.signIn(flowId)),
      CancelSignIn: ({ flowId }) => api(connections.cancelSignIn(flowId)),
      ConnectToken: ({ commandId, product, webUrl, user, key, token, connectionId }) =>
        once(
          commandId,
          api(
            Effect.map(
              connections.connectToken({
                product,
                token,
                actorId: instance.personId,
                ...(webUrl === undefined ? {} : { webUrl }),
                ...(user === undefined ? {} : { user }),
                ...(key === undefined ? {} : { key }),
                ...(connectionId === undefined ? {} : { connectionId }),
              }),
              connectionOf,
            ),
          ),
        ),
      GetConnectGuide: ({ service }) => api(connections.guide(service)),
      FindServer: ({ service, webUrl }) => api(connections.findServer(service, webUrl)),
      ConnectCli: ({ commandId, product, webUrl, connectionId }) =>
        once(
          commandId,
          api(
            Effect.map(
              connections.connectCli({
                product,
                webUrl,
                actorId: instance.personId,
                ...(connectionId === undefined ? {} : { connectionId }),
              }),
              connectionOf,
            ),
          ),
        ),
      CheckConnection: ({ connectionId }) => api(connections.check(connectionId)),
      Disconnect: ({ commandId, connectionId }) => once(commandId, api(connections.remove(connectionId, instance.personId))),
      ListIssues: ({ projectId }) => api(Effect.map(issues.mine(projectId), (found) => ({ issues: found }))),
      MarkReady: ({ commandId, taskId, url }) => once(commandId, api(pullRequests.markReady(taskId, url))),
      PostScreenshots: ({ commandId, taskId, url, leftOut }) => once(commandId, api(screenshots.post({ taskId, url, leftOut }))),
      AddAccount: ({ commandId, agentId, name, grant }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const folder = grant === undefined ? undefined : yield* folders.path(grant)
              const account = yield* accounts.add({ agentId, name, ...(folder === undefined ? {} : { folder }) })
              return yield* accountStatus(account, true)
            }),
          ),
        ),
      RenameAccount: ({ commandId, accountId, name }) => once(commandId, api(accounts.rename(accountId, name))),
      RemoveAccount: ({ commandId, accountId, anyway }) => once(commandId, api(accounts.remove(accountId, { anyway: anyway === true }))),
      OrderAccounts: ({ commandId, agentId, accountIds }) => once(commandId, api(accounts.order(agentId, accountIds))),
      FindAccounts: ({ agentId }) =>
        api(
          Effect.gen(function* () {
            const found = yield* accounts.found(agentId)
            return {
              found: yield* Effect.forEach(found, (place) =>
                Effect.map(folders.allow(place.path), (grant) => ({ grant, name: place.name, path: place.path, tool: place.tool })),
              ),
            }
          }),
        ),
      SignInAccount: ({ commandId, accountId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const line = yield* accounts.login(accountId)
              // Opened where the app can, in Terminal; elsewhere the person runs it.
              return { line, opened: config.openTerminal === undefined ? false : yield* config.openTerminal(line) }
            }),
          ),
        ),
      StartAccountSignIn: ({ commandId, accountId, way }) => once(commandId, api(accountSignIns.start({ accountId, way }))),
      GetAccountSignIn: ({ flowId }) => accountSignIns.get(flowId),
      PasteAccountSignInCode: ({ commandId, flowId, code }) => once(commandId, api(accountSignIns.paste(flowId, code))),
      CancelAccountSignIn: ({ commandId, flowId }) => once(commandId, api(accountSignIns.cancel(flowId))),
      GetProjectRules: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
            if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
            return yield* rulesView(projectId, yield* policies.current(project.id))
          }),
        ),
      GetProjectNotes: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const [project] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${projectId}`
            if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
            return yield* notesOf(projectId)
          }),
        ),
      DropProjectNote: ({ commandId, projectId, noteId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.note.drop', { projectId, noteId }, commandId)
              yield* Effect.provideContext(dropNote({ envelope: said, projectId, noteId }), store)
            }),
          ),
        ),
      EditProjectNote: ({ commandId, projectId, noteId, body }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.note.edit', { projectId, noteId, body }, commandId)
              yield* Effect.provideContext(editNote({ envelope: said, projectId, noteId, body }), store)
            }),
          ),
        ),
      GetVocabulary: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
            if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
            const repositories = yield* sql<{ name: string; path: string; within: string | null }>`
              SELECT b.display_name AS name, l.path, b.folder AS within FROM repository_bindings b
              JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
              WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
            return [...(yield* vocabulary(project.name, repositories))]
          }),
        ),
      SetProjectRules: ({ commandId, projectId, expectedRevision, ...sent }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const kept = yield* applyRules(projectId, sent, instance.personId, expectedRevision).pipe(
                Effect.provideService(Policies, policies),
                Effect.provideService(Permissions, permissions),
                Effect.provideService(Changes, pullRequests),
                Effect.provideService(PullRequestScreenshots, screenshots),
              )
              return yield* rulesView(projectId, kept)
            }),
          ),
        ),
      SetProjectAccounts: ({ commandId, projectId, rotate, only }) =>
        once(commandId, api(policies.setAccounts(projectId, only === null ? { rotate } : { rotate, only }, instance.personId))),
      SetUsageLimit: ({ commandId, projectId, policy }) =>
        once(commandId, api(policies.setUsageLimit(projectId, policy, instance.personId))),
      OpenChange: ({ commandId, taskId }) => once(commandId, api(runs.publish(taskId))),
      SkipReview: ({ commandId, taskId }) =>
        once(
          commandId,
          api(Effect.flatMap(envelope('task.skip_review', { taskId }, commandId), (said) => runs.skipReview({ envelope: said, taskId }))),
        ),
      Ship: ({ commandId, taskId, change }) =>
        once(
          commandId,
          api(
            Effect.flatMap(envelope('task.ship', { taskId, change: change ?? null }, commandId), (said) =>
              runs.ship({ envelope: said, taskId, ...(change === undefined ? {} : { change }) }),
            ),
          ),
        ),
      // Fix it: the findings go to the lead, and once its turn is over its fix ships as the next pull request.
      FixAfterMerge: ({ commandId, taskId, url }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const sent = yield* mergeReviews.fix(taskId, url)
              const said = yield* envelope('task.ship', { taskId, afterMerge: url ?? null }, commandId)
              yield* Effect.forkDetach(
                Effect.andThen(mergeReviews.afterTurnOf(sent.threadId, sent.inputId), runs.ship({ envelope: said, taskId })).pipe(
                  Effect.catchCause((cause) => Effect.logWarning('Could not ship a fix after a merge', cause)),
                ),
              )
            }),
          ),
        ),
      LeaveAfterMerge: ({ commandId, taskId, url }) => once(commandId, api(mergeReviews.leave(taskId, url))),
      Merge: ({ commandId, taskId, head, url, how }) =>
        once(
          commandId,
          api(
            how === undefined
              ? pullRequests.merge(taskId, head, url)
              : Effect.flatMap(envelope('task.merge', { taskId, how }, commandId), (said) =>
                  runs.mergeWaiting({ envelope: said, taskId, how, ...(url === undefined ? {} : { url }) }),
                ),
          ),
        ),
      ClosePullRequest: ({ commandId, taskId, url, deleteBranch }) =>
        once(commandId, api(Effect.map(pullRequests.close(taskId, url, { deleteBranch }), ({ branch }) => ({ branch })))),
      MergeHere: ({ commandId, taskId, heads }) => once(commandId, api(Effect.asVoid(pullRequests.mergeHere(taskId, heads)))),
      Push: ({ commandId, taskId, head, url }) => once(commandId, api(Effect.asVoid(pullRequests.push(taskId, head, url)))),
      ReplacePullRequest: ({ commandId, taskId, head, replaces, url }) =>
        once(commandId, api(Effect.asVoid(pullRequests.replace(taskId, head, replaces, url)))),
      MergeNote: ({ commandId, taskId, url }) =>
        once(commandId, api(Effect.map(pullRequests.mergeNote(taskId, url), ({ note }) => ({ note })))),
      PushHere: ({ commandId, taskId }) => once(commandId, api(Effect.asVoid(pullRequests.pushHere(taskId)))),
      PushBranch: ({ commandId, taskId, heads }) => once(commandId, api(Effect.asVoid(pullRequests.pushBranch(taskId, heads)))),
      ListEditors: () => Effect.succeed(config.editors?.list() ?? []),
      GetLoad: () => api(machine.now),
      GetPlanUsage: ({ refresh }) => api(planUsage.now(refresh === true)),
      GetModelRooms: ({ projectId }) =>
        api(
          modelRooms(projectId).pipe(
            Effect.provideService(Agents, agents),
            Effect.provideService(Models, models),
            Effect.provideService(SignIns, signIns),
            Effect.provideService(Installs, installs),
            Effect.provideService(Limits, limits),
            Effect.provideService(Accounts, accounts),
          ),
        ),
      GetMissedReports: () => api(missedReports),
      // Done once the copy is ready; its version and its models are asked again, as it is a new one.
      InstallAgent: ({ agentId }) =>
        api(
          Effect.gen(function* () {
            const entry = yield* agents.get(agentId)
            yield* installs.install(entry.definition)
            versions.delete(agentId)
            yield* models.forget(agentId)
          }),
        ),
      OpenInEditor: ({ taskId, editor, path, line }) =>
        api(
          Effect.gen(function* () {
            const open = config.editors?.open
            if (open === undefined) return false
            yield* openingFolder(taskId)
            // The task's folder: its worktree, or with several the folder that holds them, which its changes' paths start from.
            const worktrees = yield* sql<{ path: string }>`
              SELECT path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} ORDER BY created_at, rowid`
            const [first] = worktrees
            if (first === undefined) return yield* new NotFound({ kind: 'task worktree', id: taskId })
            const folder = yield* Effect.sync(() => realOf(worktrees.length > 1 ? dirname(first.path) : first.path))
            // A path from the task's changes, never one that leaves its folder, by `..` or by a link.
            const file = path === undefined ? null : yield* Effect.sync(() => realOf(resolve(folder, path)))
            if (file !== null && !isInside(folder, file)) return false
            return yield* open(editor, folder, file, line ?? null)
          }),
        ),
      // A file an agent named: a task's in its folder, as OpenInEditor opens it; the coordinator's in the person's own checkout.
      OpenCode: ({ threadId, editor, path, line }) =>
        api(
          Effect.gen(function* () {
            const open = config.editors?.open
            if (open === undefined) return false
            const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
            if (thread?.taskId != null) yield* openingFolder(thread.taskId)
            const place = yield* queries.codeRoots(threadId)
            const found = codeRootOf(place, path)
            if (found === null) return false
            // A task's folder as OpenInEditor opens it, with several worktrees the one that holds them; else the repository's.
            const whole = place.kind === 'task' && place.roots.length > 1
            const folder = yield* Effect.sync(() => realOf(whole ? dirname(found.root.editor) : found.root.editor))
            // Never a path that leaves the folder, by `..` or by a link; the folder alone where the file isn't there, as on another branch.
            const file = yield* Effect.sync(() => realOf(resolve(folder, whole ? path : found.path)))
            if (!isInside(folder, file)) return false
            return yield* open(editor, folder, isThere(file) ? file : null, isThere(file) ? (line ?? null) : null)
          }),
        ),
      RefreshTask: ({ taskId }) => pullRequests.refresh(taskId),
      StopListening: ({ commandId, taskId, url }) => once(commandId, api(pullRequests.stopListening(taskId, url))),
      AttachPullRequest: ({ commandId, taskId, pullRequest, start }) =>
        once(
          commandId,
          api(
            Effect.map(
              pullRequests.attach({ taskId, pullRequest, start: start === true, actorId: instance.personId }),
              (done): Attachment =>
                done.kind === 'start'
                  ? { kind: 'start', name: done.name, source: done.source, started: false, kept: 0, own: done.own }
                  : {
                      kind: 'attached',
                      name: `${done.change.words.short} ${done.change.words.prefix}${done.change.number}`,
                      source: done.change.source ?? '',
                      started: done.started,
                      kept: done.kept,
                      own: done.kept,
                    },
            ),
          ),
        ),
      StopBackground: ({ commandId, threadId, id }) => once(commandId, api(sessions.stopBackground(threadId, id))),
      ReadBackgroundOutput: ({ threadId, id }) => api(sessions.backgroundOutput(threadId, id)),
      ClearBackground: ({ commandId, threadId, id }) => once(commandId, api(sessions.clearBackground(threadId, id))),
      RunProject: ({ commandId, projectId, taskId, threadId, runnableId, branch, pullRequest, repository }) =>
        once(
          commandId,
          api(
            launches.start({
              projectId,
              taskId,
              threadId,
              ...(runnableId === undefined ? {} : { runnableId }),
              ...(repository === undefined ? {} : { repository }),
              ...(branch !== undefined
                ? { ref: { kind: 'branch' as const, name: branch } }
                : pullRequest !== undefined
                  ? { ref: { kind: 'pull_request' as const, which: pullRequest } }
                  : {}),
            }),
          ),
        ),
      GetRunnableRefs: ({ projectId, text }) => api(fetches.offered(projectId, text)),
      KeepRunnable: ({ commandId, projectId, id, name, command, repository }) =>
        once(
          commandId,
          api(
            Effect.map(
              launches.keepRunnable({
                projectId,
                ...(id === undefined ? {} : { id }),
                name,
                command,
                ...(repository === undefined ? {} : { repository }),
                actorId: instance.personId,
              }),
              (kept) => ({ id: kept.id }),
            ),
          ),
        ),
      DropRunnable: ({ commandId, projectId, id }) =>
        once(commandId, api(launches.dropRunnable({ projectId, id, actorId: instance.personId }))),
      OrderRunnables: ({ commandId, projectId, ids }) =>
        once(commandId, api(launches.orderRunnables({ projectId, ids, actorId: instance.personId }))),
      GetRepositoryScripts: ({ projectId }) => api(launches.scripts(projectId)),
      ListSkills: () =>
        config.skills === undefined ? Effect.succeed({ enabled: false, skills: [] }) : skills((store) => listSkills(store)),
      FindSkills: ({ source, ref }) =>
        skills(() =>
          Effect.gen(function* () {
            const parsed = parseGitHubSource(source)
            if (parsed === null)
              return yield* new SkillRefused({ message: `${source} isn't a GitHub repository; paste its address or owner/name` })
            // A pasted `/tree/` address names its ref and path; GitHub splits them.
            const at =
              parsed.tree === undefined
                ? { ref: ref ?? 'HEAD', sha: yield* resolveRef(github, parsed.repo, ref ?? 'HEAD') }
                : yield* resolveTree(github, parsed.repo, parsed.tree)
            const paths = at.subpath === undefined ? yield* findSkills(github, parsed.repo, at.sha) : [at.subpath]
            return { repo: parsed.repo, ref: at.ref, sha: at.sha, paths }
          }),
        ),
      StageSkill: ({ repo, ref, subpath }) => skills((store) => stageFromGitHub(store.root, github, { repo, ref, subpath })),
      ApproveSkill: ({ commandId, ...approval }) =>
        once(
          commandId,
          skills((store) =>
            Effect.gen(function* () {
              const installed = yield* approve(store.root, approval)
              yield* skillAct(commandId, installed.id, 'approved', {
                ...versionSaid(installed),
                active: installed.active,
                ...(approval.replace === true ? { replaced: true } : {}),
              })
              return yield* describe(store.root, installed)
            }),
          ),
        ),
      // One that can't be checked says why on its own; one that failed for no reason of the person's or GitHub's is reported too.
      CheckSkillUpdates: () =>
        skills((store) =>
          Effect.gen(function* () {
            const checks = []
            for (const check of yield* checkUpdates(store.root, github)) {
              if (check.state !== 'failed') {
                checks.push(check)
                continue
              }
              if (check.unexpected !== undefined) {
                yield* Effect.logWarning('A skill update check did not succeed', check.unexpected)
                yield* failures.report(check.unexpected, 'CheckSkillUpdates')
              }
              checks.push({ id: check.id, state: check.state, error: check.error })
            }
            return checks
          }),
        ),
      RollBackSkill: ({ commandId, id }) =>
        once(
          commandId,
          skills((store) =>
            Effect.gen(function* () {
              const restored = yield* rollBack(store.root, id)
              yield* skillAct(commandId, id, 'rolled_back', versionSaid(restored))
              return yield* describe(store.root, restored)
            }),
          ),
        ),
      UninstallSkill: ({ commandId, id }) =>
        once(
          commandId,
          skills((store) =>
            Effect.gen(function* () {
              const removed = yield* uninstall(store.root, id)
              if (removed !== undefined) {
                yield* forgetSkillRoles(id).pipe(Effect.provideService(SqlClient.SqlClient, sql))
                yield* skillAct(commandId, id, 'removed', versionSaid(removed))
              }
            }),
          ),
        ),
      StopLaunch: ({ commandId, id }) => once(commandId, api(launches.stop(id))),
      ClearLaunch: ({ commandId, id }) => once(commandId, api(launches.clear(id))),
      Watch: ({ since }) => Stream.merge(changes(since), streaming),
    })
  }),
)

/** Whether a file is in a folder, as this system writes paths (`C:\\…` on Windows): not the folder itself, nor out of it by `..`. */
export const isInside = (
  folder: string,
  file: string,
  paths: Pick<typeof posix, 'relative' | 'isAbsolute' | 'sep'> = { relative, isAbsolute, sep },
) => {
  const within = paths.relative(folder, file)
  return within !== '' && within !== '..' && !within.startsWith(`..${paths.sep}`) && !paths.isAbsolute(within)
}

/** The runtime's services: the store, this launch, and everything the API calls. Built once per launch. */
export const services = (options: Runtime.RuntimeLayerOptions) =>
  Layer.mergeAll(Nudges.layer, UsageData.layer, Folders.layer).pipe(
    Layer.provideMerge(Queries.layer),
    Layer.provideMerge(Runtime.layer(options)),
    // Below everything, so a failure kept anywhere is said through the one listener.
    Layer.provideMerge(failuresLayer),
  )

/** One client's connection: the API served over its port, until the port closes. Each window gets one. */
export const connection = (port: PortLike, sender: MessageSender) =>
  RpcServer.layer(Api).pipe(
    Layer.provide(handlers.pipe(Layer.provide(Layer.succeed(ConnectionSender, sender)))),
    Layer.provide(
      Layer.succeed(ClientAuthority, (effect, { rpc, headers }) => {
        const refusal = apiVersionRefusal(headers)
        if (refusal !== undefined) return Effect.fail(refusal)
        return sender.kind === 'socket' && !Context.get(rpc.annotations, SocketAllowed)
          ? Effect.fail(
              new ApiError({ reason: 'PersonRequired', message: 'This call needs the person in the window or on a paired device.' }),
            )
          : effect
      }),
    ),
    Layer.provide(serverProtocol(port)),
  )

/**
 * The runtime serving the API over one port. Closing the layer's scope stops
 * every session and ends the launch.
 */
export const serve = (port: PortLike, options: Runtime.RuntimeLayerOptions, sender: MessageSender) =>
  connection(port, sender).pipe(Layer.provideMerge(services(options)))
