import { agentVersion } from '@althar/provider-adapters'
import { lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, type posix, relative, resolve, sep } from 'node:path'

import {
  type AccountStatus,
  API_VERSION,
  Api,
  ApiError,
  type AgentStatus,
  type PortLike,
  serverProtocol,
  type WatchEvent,
  type ProjectRulesView,
} from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Cause, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { AccountSignIns } from './AccountSignIns'
import { Changes } from './Changes'
import { NotFound } from './errors'
import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import { type ConnectionInfo, Connections } from './Connections'
import { coAuthorLine, coAuthorOn, setCoAuthor } from './credit'
import { Folders } from './Folders'
import { conventionsOnBase } from './conventions'
import { Instance } from './Instance'
import { Issues } from './Issues'
import { Limits } from './Limits'
import { Live } from './Live'
import { accountsOf, Policies, type ProjectRules, ruleSetOf, usageLimitOf } from './Policies'
import { Models } from './Models'
import { Installs } from './Installs'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Nudges } from './Nudges'
import { Queries } from './Queries'
import { timestamp } from './records'
import * as Runtime from './Runtime'
import { Coordinator } from './Coordinator'
import { Plans } from './Plans'
import { Runs } from './Runs'
import { Sessions } from './Sessions'
import { anyOf, SignIns } from './SignIns'
import { expected, words } from './words'

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

/** A path as the file system has it, without symbolic links; as given, where it can't be read. */
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
export const handlers = Api.toLayer(
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const projects = yield* Projects
    const sessions = yield* Sessions
    const permissions = yield* Permissions
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
    const runs = yield* Runs
    const coordinator = yield* Coordinator
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const agents = yield* Agents
    const config = yield* RuntimeConfig
    const connections = yield* Connections
    const issues = yield* Issues
    const pullRequests = yield* Changes
    const envelope = (type: string, payload: unknown, commandId: string) =>
      Effect.provideContext(Runtime.envelope(type, payload, commandId), context)
    const agentName = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

    /** A call's failure as the window gets it: in words, and in the log when it isn't the person's to put right. */
    const api = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiError, R> =>
      Effect.catchCause(effect, (cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
        const error = Cause.findErrorOption(cause)
        const said = words(Option.getOrUndefined(error), agentName)
        const log =
          Option.isSome(error) && expected.has(said.reason)
            ? Effect.void
            : Effect.logWarning('A call from the window did not succeed', cause)
        return Effect.andThen(log, Effect.fail(new ApiError(said)))
      })

    /*
     * Session commands have no receipts in the store yet (they start and stop
     * processes, outside any transaction), so a retry within the launch gets
     * the first one's result from here. One interrupted before it finished
     * may run again.
     */
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
    })

    /** The issue a task comes from, read before the task is made, so its key can go in the task's branch. */
    const issueFor = (projectId: string, issue: string | undefined) =>
      issue === undefined ? Effect.succeed(undefined) : issues.read(issue, projectId)

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
        return { ...rulesFields(projectId, rules), revision, conventions }
      })

    const rulesFields = (projectId: string, rules: ProjectRules): Omit<ProjectRulesView, 'conventions' | 'revision'> => {
      const set = ruleSetOf(rules)
      const accounts = accountsOf(rules)
      return {
        projectId,
        permissions: set.mode,
        alwaysAsk: set.ask,
        never: set.never,
        alwaysAllow: set.allow,
        commands: set.commands,
        end: rules.end ?? null,
        usageLimit: usageLimitOf(rules),
        rotateAccounts: accounts.rotate,
        onlyAccounts: accounts.only ?? null,
        branchPattern: rules.branchPattern ?? null,
        titlePattern: rules.titlePattern ?? null,
      }
    }

    /* An account as the window shows it: signed in, checked at most once a minute, paid for how, and out until when. */
    const accountStatus = (account: Account, recheck: boolean) =>
      Effect.gen(function* () {
        const check = yield* signIns.account(account, recheck)
        const out = yield* limits.outAccount(account.id)
        return {
          id: account.id,
          name: account.name,
          home: account.home,
          signIn: check.status,
          paidBy: check.paidBy,
          outUntil: Option.getOrNull(Option.map(out, (each) => each.until)),
          adoptedFrom: account.adoptedFrom,
        } satisfies AccountStatus
      })

    /* Each agent's version, asked of its CLI once a launch. */
    const versions = new Map<string, string | null>()
    const versionOf = (entry: AgentEntry) =>
      versions.has(entry.definition.id)
        ? Effect.succeed(versions.get(entry.definition.id) ?? null)
        : agentVersion(entry.definition).pipe(Effect.tap((found) => Effect.sync(() => versions.set(entry.definition.id, found))))

    /* An agent, with its accounts: each check starts the agent's own status command, in the account's home. */
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
          download: install.downloadable && install.size !== null ? { size: install.size, installing: install.installing } : null,
          signIn: anyOf(statuses.map((account) => account.signIn)),
          login: entry.definition.signIn.login,
          version: yield* versionOf(entry),
          ways: entry.definition.signIn.inApp?.ways ?? [],
          accounts: statuses,
        } satisfies AgentStatus
      })

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
                  kind: event.kind,
                  agentId: event.agentId,
                  text: event.text,
                })
              : event._tag === 'Agent' && event.event._tag === 'ContextUsage'
                ? Stream.make({ _tag: 'Context', threadId: event.threadId, used: event.event.used, size: event.event.size })
                : Stream.empty,
          ),
        ),
      ),
    )

    return Api.of({
      Status: ({ recheck }) =>
        Effect.map(
          api(Effect.forEach(agents.list, (entry) => signIn(entry, recheck === true), { concurrency: 'unbounded' })),
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
      OpenProject: ({ commandId, grant, name, repositories }) =>
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
              envelope: yield* envelope('project.open', { path }, commandId),
              path,
              ...(name === undefined ? {} : { name }),
              ...(roots === undefined ? {} : { repositories: roots }),
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
      RemoveProject: ({ commandId, projectId }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.remove', { projectId }, commandId)
              const threads = yield* projects.remove(projectId, said.commandId)
              // Its runs are over, so no step answers an agent going: each one still on it stops, the coordinator too.
              yield* Effect.forEach(threads, (threadId) => Effect.ignore(sessions.stop(threadId)), { discard: true })
            }),
          ),
        ),
      GetRepositories: ({ projectId }) => api(Effect.map(projects.repositories(projectId), (list) => [...list])),
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
      SetRepository: ({ commandId, projectId, repositoryId, role, changeTarget }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const said = yield* envelope('project.set_repository', { projectId, repositoryId, role, changeTarget }, commandId)
              yield* projects.setRepository({
                projectId,
                repositoryId,
                ...(role === undefined ? {} : { role }),
                ...(changeTarget === undefined ? {} : { changeTarget }),
                commandId: said.commandId,
              })
            }),
          ),
        ),
      ListTasks: ({ projectId }) => api(queries.tasks(projectId)),
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
      GetFileDiff: ({ taskId, path }) => api(queries.fileDiff(taskId, path)),
      GetBoard: ({ projectId }) => api(queries.board(projectId)),
      GetHome: ({ since }) => api(queries.home(since)),
      LeftHome: () =>
        api(
          Effect.gen(function* () {
            yield* sql`UPDATE devices SET home_looked_at = ${yield* timestamp} WHERE id = ${instance.deviceId}`
          }),
        ),
      StartSession: ({ commandId, threadId, agentId, model, effort }) =>
        once(
          commandId,
          api(
            sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }),
          ),
        ),
      SwitchAgent: ({ commandId, threadId, agentId, model, effort, body }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              // What the person said with it is said to the thread, under a command of its own.
              const message =
                body === undefined
                  ? undefined
                  : {
                      // Its own command id, made from the switch's, so a retry of the switch is a retry of it too.
                      envelope: yield* envelope(
                        'thread.send',
                        { threadId, body, disposition: 'after_current' },
                        `cmd_${createHash('sha256').update(`${commandId}\u0000said`).digest('hex').slice(0, 32)}`,
                      ),
                      body,
                    }
              const sessionId = yield* sessions.switchAgent({
                threadId,
                agentId,
                ...(model === undefined ? {} : { model }),
                ...(effort === undefined ? {} : { effort }),
                ...(message === undefined ? {} : { message }),
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
        api(Effect.map(coAuthorOn, (on) => ({ coAuthor: { on, line: coAuthorLine } }))).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        ),
      SetCoAuthor: ({ commandId, on }) => once(commandId, api(setCoAuthor(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
      Interrupt: ({ commandId, threadId }) => once(commandId, api(sessions.interrupt(threadId))),
      StopSession: ({ commandId, threadId }) => once(commandId, api(sessions.stop(threadId))),
      Send: ({ commandId, threadId, body, disposition }) =>
        api(
          Effect.gen(function* () {
            const message = {
              envelope: yield* envelope('thread.send', { threadId, body, disposition }, commandId),
              threadId,
              body,
              disposition,
            }
            // What the person says to the coordinator starts it, if it isn't running.
            const [thread] = yield* sql<{ kind: string }>`SELECT kind FROM threads WHERE id = ${threadId}`
            if (thread?.kind === 'coordinator') yield* coordinator.say(message)
            else yield* sessions.send(message)
            // Links in what the person said unfurl on their message, without holding up the reply.
            yield* Effect.forkDetach(issues.unfurlInput(commandId))
          }),
        ),
      TakeBack: ({ commandId, itemId }) =>
        api(
          Effect.gen(function* () {
            yield* sessions.takeBack({ envelope: yield* envelope('thread.take_back', { itemId }, commandId), itemId })
          }),
        ),
      GetCoordinator: ({ projectId, before, limit }) =>
        api(queries.coordinator(projectId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      StartTask: ({ commandId, projectId, title, description, steps, issue, end, repositories }) =>
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
                ...requestOf(title, description, issue),
              })
              if (issue !== undefined) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue })
              // A task you start yourself is planned like any other, and starts at once; its card shows in the coordinator's thread.
              const planId = yield* plans.propose({
                projectId: projectId as ProjectId,
                taskId: created.taskId,
                steps,
                reason: null,
                actorId: instance.personId,
                startsIn: Duration.zero,
                end: end === undefined ? yield* pullRequests.endFor(projectId, created.taskId) : end,
              })
              yield* plans.start(planId, instance.personId)
              return yield* queries.task(created.taskId)
            }),
          ),
        ),
      StartPlan: ({ commandId, planId }) => once(commandId, api(plans.start(planId, instance.personId))),
      HoldPlan: ({ commandId, planId }) => once(commandId, api(plans.hold(planId, instance.personId))),
      ChangePlan: ({ commandId, planId, steps, end }) => once(commandId, api(plans.change(planId, steps, instance.personId, end))),
      AnswerStuck: ({ commandId, attentionId, answer }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              yield* runs.answerStuck({
                envelope: yield* envelope('attention.answer_stuck', { attentionId, answer }, commandId),
                attentionId,
                answer,
              })
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
                  name: info.name,
                  host: info.host,
                  tracker: info.tracker,
                  hostedUrl: info.hosted?.webUrl ?? null,
                  selfHosted: info.selfHosted,
                  browserSignIn: info.browserSignIn,
                  tokenNeeds: info.token.needs,
                  tokenHelp: info.token.help(info.hosted?.webUrl ?? ''),
                  tokenHelpForKey: info.token.helpForKey ?? null,
                  keyChecks: info.token.keyChecks ?? [],
                })),
            }
          }),
        ),
      StartSignIn: ({ commandId, product, webUrl }) =>
        once(commandId, api(connections.startSignIn({ product, actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) }))),
      GetSignIn: ({ flowId }) => api(connections.signIn(flowId)),
      CancelSignIn: ({ flowId }) => api(connections.cancelSignIn(flowId)),
      ConnectToken: ({ commandId, product, webUrl, user, key, token }) =>
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
              }),
              connectionOf,
            ),
          ),
        ),
      Disconnect: ({ commandId, connectionId }) => once(commandId, api(connections.remove(connectionId, instance.personId))),
      ListIssues: ({ projectId }) => api(Effect.map(issues.mine(projectId), (found) => ({ issues: found }))),
      MarkReady: ({ commandId, taskId, url }) => once(commandId, api(pullRequests.markReady(taskId, url))),
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
      SetProjectRules: ({ commandId, projectId, rotateAccounts, onlyAccounts, expectedRevision, ...change }) =>
        once(
          commandId,
          api(
            Effect.gen(function* () {
              const now = accountsOf((yield* policies.current(projectId as ProjectId)).rules)
              const accounts =
                rotateAccounts === undefined && onlyAccounts === undefined
                  ? {}
                  : {
                      accounts: {
                        rotate: rotateAccounts ?? now.rotate,
                        ...((onlyAccounts === undefined ? now.only : onlyAccounts) == null
                          ? {}
                          : { only: (onlyAccounts === undefined ? now.only : onlyAccounts) ?? {} }),
                      },
                    }
              yield* policies.set(projectId, { ...change, ...accounts }, instance.personId, expectedRevision)
              // A call still waiting that the rules no longer keep for the person is answered by them.
              yield* permissions.reconsider(projectId)
              return yield* rulesView(projectId, yield* policies.current(projectId as ProjectId))
            }),
          ),
        ),
      SetProjectAccounts: ({ commandId, projectId, rotate, only }) =>
        once(commandId, api(policies.setAccounts(projectId, only === null ? { rotate } : { rotate, only }, instance.personId))),
      SetUsageLimit: ({ commandId, projectId, policy }) =>
        once(commandId, api(policies.setUsageLimit(projectId, policy, instance.personId))),
      OpenChange: ({ commandId, taskId }) => once(commandId, api(runs.publish(taskId))),
      Merge: ({ commandId, taskId, head, url }) => once(commandId, api(pullRequests.merge(taskId, head, url))),
      MergeHere: ({ commandId, taskId, heads }) => once(commandId, api(Effect.asVoid(pullRequests.mergeHere(taskId, heads)))),
      Push: ({ commandId, taskId, head, url }) => once(commandId, api(Effect.asVoid(pullRequests.push(taskId, head, url)))),
      PushHere: ({ commandId, taskId }) => once(commandId, api(Effect.asVoid(pullRequests.pushHere(taskId)))),
      PushBranch: ({ commandId, taskId, heads }) => once(commandId, api(Effect.asVoid(pullRequests.pushBranch(taskId, heads)))),
      ListEditors: () => Effect.succeed(config.editors?.list() ?? []),
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
      RefreshTask: ({ taskId }) => pullRequests.refresh(taskId),
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
  Layer.mergeAll(Nudges.layer, Folders.layer).pipe(Layer.provideMerge(Queries.layer), Layer.provideMerge(Runtime.layer(options)))

/** One client's connection: the API served over its port, until the port closes. Each window gets one. */
export const connection = (port: PortLike) => RpcServer.layer(Api).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(port)))

/**
 * The runtime serving the API over one port. Closing the layer's scope stops
 * every session and ends the launch.
 */
export const serve = (port: PortLike, options: Runtime.RuntimeLayerOptions) => connection(port).pipe(Layer.provideMerge(services(options)))
