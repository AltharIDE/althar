import { NEW_PROJECT_DEFAULTS, type ApiHandlers, type ProjectRulesView } from '@althar/contracts'
import { parseRemote } from '@althar/connectors'
import type { ProjectId } from '@althar/domain'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { Clock, type Crypto, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../Changes'
import { CloneRefused, NotFound, ProjectRefused } from '../errors'
import { cloneFolderOf, cloneRepository, prepareFolder } from '../folderSetup'
import { publishRepository } from '../publish'
import { refreshRemotes } from '../recordedRemotes'
import { Connections } from '../Connections'
import { Folders } from '../Folders'
import { homeFolders } from '../homeFolders'
import { vocabulary } from '../vocabulary'
import { conventionsOnBase } from '../conventions'
import { Instance } from '../Instance'
import { Launches } from '../Launches'
import { Terminals } from '../Terminals'
import { LeftBehind } from '../LeftBehind'
import { localTasksIn } from '../local'
import { PARENT_KEPT, tellOf, toldOf } from '../forks'
import { namedRemotes } from '../git'
import { PullRequestScreenshots } from '../PullRequestScreenshots'
import {
  accountsOf,
  accountStrategyOf,
  allowsEverything,
  modeOf,
  movesIssues,
  linksIssues,
  Policies,
  type ProjectRules,
  repositoryFilesOf,
  resolvesConflicts,
  worksInOf,
  pushesCommits,
  postsScreenshots,
  ruleSetOf,
  trustedBotsOf,
  usageLimitOf,
  afterMergeReviewOf,
} from '../Policies'
import { botLogin, botName } from '../reviewerBots'
import { Permissions } from '../Permissions'
import { dropNote, editNote, notesOf } from '../notes'
import { type ProjectRepository, Projects } from '../Projects'
import { projectTracker } from '../projectTracker'
import { applyRules } from '../rulesChange'
import { Queries } from '../Queries'
import { withEdits, workedOutReach } from '../sandboxReach'
import { tallyOf } from '../tally'
import { Runs } from '../Runs'
import { Sessions } from '../Sessions'
import { makeRepository, placeRepository } from '../newRepository'
import { makeBranch } from '../newBranch'
import { Elsewhere } from '../Elsewhere'
import type { ApiKit } from './kit'

/** How long what a host said about who can push to a repository is kept: opening a project again soon after doesn't ask again. */
const PUSHABLE_KEPT = 5 * 60_000

/** How long a repository's page waits for a host to say who can push: it reads on without. */
const PUSHABLE_WAIT = Duration.seconds(5)

/** How long a host that didn't say whether a repository is a fork (it failed, took too long, or doesn't say) isn't asked again. */
const PARENT_RETRY = 5 * 60_000

/**
 * Making, opening and removing a project, and what it is made of: folders, repositories, its mark and tracker.
 * Its rules, notes and vocabulary; what other tools left there; the code host's repositories and owners to clone or publish.
 */
export const projectsHandlers = ({ actorId, api, envelope, personHome }: ApiKit) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const launches = yield* Launches
    const terminals = yield* Terminals
    const leftBehind = yield* LeftBehind
    const permissions = yield* Permissions
    const queries = yield* Queries
    const folders = yield* Folders
    const policies = yield* Policies
    const runs = yield* Runs
    const elsewhere = yield* Elsewhere
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    // What writes a project's notes needs, as the services have it.
    const store = yield* Effect.context<SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto>()
    // What bringing a task's removed folder back needs (ADR-056).
    const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
    /** A folder the person chose, by its grant, or a path inside it, as the runtime read one there: never a path elsewhere. */
    const within = (grant: string, path?: string) => folders.inside(grant, path)
    /** A connection's code host, signed in through it; refused where it is a tracker's, or gone. */
    const codeHostOf = (connectionId: string) =>
      Effect.flatMap(connections.adapters(connectionId), ({ host }) =>
        host === undefined ? Effect.fail(new NotFound({ kind: 'connection', id: connectionId })) : Effect.succeed(host),
      )
    /**
     * Where a clone comes from, and how git signs in to it: a connection's
     * host, by the repository's path there; or a URL, through the connection
     * whose host it is on where one is, else with the person's own sign-in.
     */
    const cloneSource = (from: { readonly connectionId: string; readonly path: ReadonlyArray<string> } | { readonly url: string }) =>
      Effect.gen(function* () {
        if ('connectionId' in from) {
          const { host, info } = yield* connections.adapters(from.connectionId)
          if (host === undefined) return yield* new NotFound({ kind: 'connection', id: from.connectionId })
          const remote = from.path.join('/')
          const repository = yield* host
            .repository(from.path)
            .pipe(Effect.mapError(() => new CloneRefused({ reason: 'not_found', remote, host: info.name })))
          return { remote, host: info.name, folder: cloneFolderOf(from.path), target: yield* host.pushTarget(repository) }
        }
        const url = from.url.trim()
        const ref = parseRemote(url)
        if (ref === null) return yield* new CloneRefused({ reason: 'not_found', remote: url, host: '' })
        const remote = ref.path.join('/')
        const found = yield* connections.hostOf([url]).pipe(Effect.orElseSucceed(() => null))
        if (found === null) return { remote, host: ref.host, folder: cloneFolderOf(ref.path), target: { url, header: null } }
        const repository = yield* found.host
          .repository(found.path)
          .pipe(Effect.mapError(() => new CloneRefused({ reason: 'not_found', remote, host: ref.host })))
        return { remote, host: ref.host, folder: cloneFolderOf(ref.path), target: yield* found.host.pushTarget(repository) }
      })
    const onHome = homeFolders((path, kind) => folders.allow(path, kind), personHome)
    const connections = yield* Connections
    const pullRequests = yield* Changes
    const screenshots = yield* PullRequestScreenshots
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
    /** When each `origin` last had no answer from its host, by its address: asked again only after PARENT_RETRY. */
    const unanswered = new Map<string, number>()
    /**
     * Asks the host of a repository's `origin` whether it is a fork, and of
     * which repository, through the connection that reaches it, and keeps the
     * answer (forks.ts) for PARENT_KEPT, so reading the project again doesn't
     * ask again. A host that can't be reached, or doesn't say, leaves what was
     * known: the remotes' names, or what a host said before; and isn't asked
     * again for PARENT_RETRY, so one that hangs holds up reading a project's
     * repositories once, not every time. True where the answer is new.
     */
    const askParent = (path: string | null) =>
      Effect.gen(function* () {
        if (path === null) return false
        const origin = (yield* namedRemotes(path).pipe(Effect.orElseSucceed(() => []))).find((remote) => remote.name === 'origin')
        if (origin === undefined) return false
        const now = yield* Clock.currentTimeMillis
        const kept = toldOf(origin.url)
        if (kept !== undefined && now - kept.at < PARENT_KEPT) return false
        const missed = unanswered.get(origin.url)
        if (missed !== undefined && now - missed < PARENT_RETRY) return false
        const found = yield* Effect.orElseSucceed(connections.hostOf([origin.url]), () => null)
        if (found === null) return false
        const read = yield* found.host.repository(found.path).pipe(
          Effect.timeout(PUSHABLE_WAIT),
          Effect.orElseSucceed(() => null),
        )
        const changed = read !== null && tellOf(origin.url, read, now, found.host.product)
        if (toldOf(origin.url)?.at === now) unanswered.delete(origin.url)
        else unanswered.set(origin.url, now)
        return changed
      })
    /**
     * A project's repositories as its page shows them, each fork as its host says, asked first, all at once: where a host's answer
     * is new, they are read again with it.
     */
    const repositoriesShown = (projectId: string) =>
      Effect.gen(function* () {
        const first = yield* projects.repositories(projectId)
        const asked = yield* Effect.forEach(first, (repository) => askParent(repository.path), { concurrency: 'unbounded' })
        const list = asked.some(Boolean) ? yield* projects.repositories(projectId) : first
        return yield* Effect.forEach(list, repositoryOf, { concurrency: 'unbounded' })
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
                remote: forked.upstreamRemote,
                by: forked.by,
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
        // The review and triage bots that spoke on its tasks' pull requests, the latest first, but those it trusts (code-hosts § Review and triage bots).
        const spoke = yield* sql<{ login: string | null; name: string | null }>`
          SELECT json_extract(payload, '$.login') AS login, json_extract(payload, '$.name') AS name FROM observations
          WHERE project_id = ${projectId} AND kind = 'bot_spoke' ORDER BY observed_at DESC, rowid DESC`
        const trusted = new Set(trustedBotsOf(rules).map(botLogin))
        const suggested = new Map<string, { readonly login: string; readonly name: string }>()
        for (const one of spoke)
          if (one.login !== null && !trusted.has(one.login) && !suggested.has(one.login))
            suggested.set(one.login, { login: one.login, name: one.name ?? botName(one.login) })
        const suggestedBots = [...suggested.values()]
        return { ...rulesFields(projectId, rules), suggestedBots, revision, conventions, sandbox, tally }
      })
    const rulesFields = (
      projectId: string,
      rules: ProjectRules,
    ): Omit<ProjectRulesView, 'conventions' | 'revision' | 'sandbox' | 'tally' | 'suggestedBots'> => {
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
        trustedBots: trustedBotsOf(rules).map((login) => ({ login, name: botName(login) })),
        leadsReachWeb: rules.leadsReachWeb ?? true,
        usageLimit: usageLimitOf(rules),
        rotateAccounts: accounts.rotate,
        accountStrategy: accountStrategyOf(rules),
        onlyAccounts: accounts.only ?? null,
        branchPattern: rules.branchPattern ?? null,
        titlePattern: rules.titlePattern ?? null,
        moveIssues: movesIssues(rules),
        linkIssues: linksIssues(rules),
        afterMergeReview: afterMergeReviewOf(rules),
        repositoryFiles: repositoryFilesOf(rules),
      }
    }
    return {
      ListProjects: () => api(queries.projects),
      LookElsewhere: ({ projectId, grant }) =>
        api(
          Effect.map(
            grant !== undefined ? Effect.flatMap(folders.path(grant), (path) => elsewhere.lookIn(path)) : elsewhere.look(projectId ?? ''),
            (found) => ({
              worktrees: [...found.worktrees],
              setups: [...found.setups],
              conversations: [...found.conversations],
            }),
          ),
        ),
      BringIn: ({ commandId, projectId, worktrees, setups, conversations, steps }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.bring_in', { projectId, worktrees, setups, conversations }, commandId)
            const brought = yield* elsewhere.bringIn({ envelope: said, projectId, worktrees, setups, conversations, steps })
            return { ...brought, tasks: [...brought.tasks], asides: [...brought.asides], failed: [...brought.failed] }
          }),
        ),
      ReadFolder: ({ grant }) =>
        api(
          Effect.gen(function* () {
            const reading = yield* projects.read(yield* folders.path(grant))
            return { ...reading, repositories: [...reading.repositories] }
          }),
        ),
      FindHomeFolders: () => api(onHome),
      PlaceRepository: ({ grant, name }) => api(Effect.flatMap(folders.place(grant), (parent) => placeRepository(parent, name))),
      MakeRepository: ({ grant, name }) =>
        api(
          Effect.gen(function* () {
            const made = yield* makeRepository(yield* folders.place(grant), name)
            return { grant: yield* folders.allow(made.path, 'repository'), path: made.path }
          }),
        ),
      PrepareFolder: ({ grant, path }) => api(Effect.flatMap(within(grant, path), (root) => prepareFolder(root))),
      ListHostRepositories: ({ connectionId }) =>
        api(
          Effect.gen(function* () {
            const host = yield* codeHostOf(connectionId)
            return (yield* host.repositories()).map((repository) => ({ ...repository, path: [...repository.path] }))
          }),
        ),
      ListRepositoryOwners: ({ connectionId }) => api(Effect.flatMap(codeHostOf(connectionId), (host) => host.owners())),
      CloneRepository: ({ grant, from }) =>
        api(
          Effect.gen(function* () {
            const parent = yield* folders.place(grant)
            const source = yield* cloneSource(from)
            const path = yield* cloneRepository({ parent, ...source })
            return { grant: yield* folders.allow(path, 'repository'), path }
          }),
        ),
      PublishRepository: ({ at, connectionId, owner, name, private: hidden }) =>
        api(
          Effect.gen(function* () {
            // A project's repository, by its id, or by its slug, as a task's names it.
            const bySlug =
              'grant' in at
                ? []
                : yield* sql<{
                    id: string
                  }>`SELECT id FROM repository_bindings WHERE project_id = ${at.projectId} AND slug = ${at.repositoryId} AND detached_at IS NULL`
            const root =
              'grant' in at
                ? yield* within(at.grant, at.path)
                : (yield* projects.repositories(at.projectId)).find((one) => one.id === at.repositoryId || one.id === bySlug[0]?.id)?.path
            if (root === undefined || root === null)
              return yield* new NotFound({ kind: 'repository', id: 'repositoryId' in at ? at.repositoryId : '' })
            const { host, info } = yield* connections.adapters(connectionId)
            if (host === undefined) return yield* new NotFound({ kind: 'connection', id: connectionId })
            const published = yield* publishRepository({
              root,
              host,
              hostName: info.name,
              owner,
              name,
              private: hidden,
              originOf: (url) =>
                connections.hostOf([url]).pipe(
                  Effect.map((found) => (found !== null && found.connectionId === connectionId ? found.path : null)),
                  Effect.orElseSucceed(() => null),
                ),
            })
            // A project's: its host is found by its remote from now on, as any repository's is.
            if ('projectId' in at)
              yield* refreshRemotes(instance.deviceId, { projectId: at.projectId }).pipe(Effect.provideService(SqlClient.SqlClient, sql))
            return published
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
                : yield* Effect.forEach(repositories, (repository) => within(repository.grant, repository.path))
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
                yours: 0,
                working: 0,
                usageLimit: 'move' as const,
                rotateAccounts: NEW_PROJECT_DEFAULTS.rotateAccounts,
                onlyAccounts: null,
              }
            )
          }),
        ),
      RenameProject: ({ commandId, projectId, name }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.rename', { projectId, name }, commandId)
            yield* projects.rename(projectId, name, said.commandId)
          }),
        ),
      SetProjectInk: ({ commandId, projectId, ink }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.set_ink', { projectId, ink }, commandId)
            yield* projects.setInk(projectId, ink, said.commandId)
          }),
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
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.set_tracker', { projectId, tracker }, commandId)
            yield* projects.setTracker(projectId, tracker, said.commandId)
          }),
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
              yield* terminals.closeAll(projectId)
              // What its Local tasks' agents left running in their checkouts, as a server outside their group, stops as a settled task's does.
              yield* Effect.forEach(local, (taskId) => leftBehind.settled(taskId), { discard: true })
            })
            yield* local.reduce((inner, taskId) => leftBehind.stoppingWhile(taskId, inner), removing)
            if (local.length > 0) yield* runs.checkoutsMoved
          }),
        ),
      GetRepositories: ({ projectId }) => api(repositoriesShown(projectId)),
      AddRepositories: ({ commandId, projectId, grant }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.add_repositories', { projectId }, commandId)
            yield* projects.addRepositories(projectId, yield* folders.path(grant), said.commandId)
          }),
        ),
      LeaveOutRepository: ({ commandId, projectId, repositoryId }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.leave_out_repository', { projectId, repositoryId }, commandId)
            yield* projects.leaveOut(projectId, repositoryId, said.commandId)
          }),
        ),
      SetRepository: ({ commandId, projectId, repositoryId, role, changeTarget, notNow, setup, workToward }) =>
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
      AddParentRemote: ({ commandId, projectId, repositoryId }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.add_parent_remote', { projectId, repositoryId }, commandId)
            yield* projects.addParentRemote(projectId, repositoryId, said.commandId)
          }),
        ),
      CreateBranch: ({ commandId, projectId, repositoryId, branch }) =>
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
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.note.drop', { projectId, noteId }, commandId)
            yield* Effect.provideContext(dropNote({ envelope: said, projectId, noteId }), store)
          }),
        ),
      EditProjectNote: ({ commandId, projectId, noteId, body }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('project.note.edit', { projectId, noteId, body }, commandId)
            yield* Effect.provideContext(editNote({ envelope: said, projectId, noteId, body }), store)
          }),
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
      SetProjectRules: ({ commandId: _commandId, projectId, expectedRevision, ...sent }) =>
        api(
          Effect.gen(function* () {
            const kept = yield* applyRules(projectId, sent, actorId, expectedRevision).pipe(
              Effect.provideService(Policies, policies),
              Effect.provideService(Permissions, permissions),
              Effect.provideService(Changes, pullRequests),
              Effect.provideService(PullRequestScreenshots, screenshots),
            )
            return yield* rulesView(projectId, kept)
          }),
        ),
    } satisfies Partial<ApiHandlers>
  })
