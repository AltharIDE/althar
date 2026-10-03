import {
  type AccountStatus,
  API_VERSION,
  Api,
  ApiError,
  type AgentStatus,
  type PortLike,
  serverProtocol,
  type WatchEvent,
} from '@charrette/contracts'
import type { ProjectId } from '@charrette/domain'
import { Ledger } from '@charrette/persistence-sqlite'
import { Cause, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Changes } from './Changes'
import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import { type ConnectionInfo, Connections } from './Connections'
import { Folders } from './Folders'
import { Instance } from './Instance'
import { Issues } from './Issues'
import { Limits } from './Limits'
import { Live } from './Live'
import { Policies } from './Policies'
import { Models } from './Models'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Nudges } from './Nudges'
import { Queries } from './Queries'
import * as Runtime from './Runtime'
import { Coordinator } from './Coordinator'
import { Plans } from './Plans'
import { Runs } from './Runs'
import { Sessions } from './Sessions'
import { anyOf, SignIns } from './SignIns'
import { expected, words } from './words'

/*
 * The runtime's side of the API (`@charrette/contracts`): each call runs the
 * service that owns it. Commands from the window become the person's commands
 * here, with the window's own command ids, so a retry gets the first one's
 * receipt. Every failure reaches the window as an `ApiError`, in words; what
 * the person can't put right goes to the log whole.
 */

/** How often the change feed is read when nothing says it grew: a fallback, not the way changes arrive. */
const FEED_FALLBACK = '1 second'

/** How many session commands' results are kept for retries, per launch. */
const RECENT_COMMANDS = 1_000

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
    const models = yield* Models
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

    /* An agent, with its accounts: each check starts the agent's own status command, in the account's home. */
    const signIn = (entry: AgentEntry, recheck: boolean) =>
      Effect.gen(function* () {
        const statuses = yield* Effect.forEach(yield* accounts.of(entry.definition.id), (account) => accountStatus(account, recheck), {
          concurrency: 'unbounded',
        })
        return {
          id: entry.definition.id,
          name: entry.definition.name,
          signIn: anyOf(statuses.map((account) => account.signIn)),
          login: entry.definition.signIn.login,
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

    /* An agent's message or thought as far as it has streamed, before the store has all of it. */
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
      OpenProject: ({ commandId, grant }) =>
        api(
          Effect.gen(function* () {
            const path = yield* folders.path(grant)
            const opened = yield* projects.open({ envelope: yield* envelope('project.open', { path }, commandId), path })
            const { projects: all } = yield* queries.projects
            const found = all.find((project) => project.id === opened.projectId)
            return (
              found ?? {
                id: opened.projectId,
                name: opened.name,
                slug: opened.slug,
                repository: opened.repository,
                tasks: 0,
                running: 0,
                waiting: 0,
                usageLimit: 'move' as const,
              }
            )
          }),
        ),
      ListTasks: ({ projectId }) => api(queries.tasks(projectId)),
      CreateTask: ({ commandId, projectId, title, description, issue }) =>
        api(
          Effect.gen(function* () {
            const from = yield* issueFor(projectId, issue)
            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description, issue }, commandId),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
              ...(from === undefined ? {} : { issueKey: from.key }),
            })
            if (issue !== undefined) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue })
            return yield* queries.task(created.taskId)
          }),
        ),
      GetThread: ({ threadId, before, limit }) =>
        api(queries.thread(threadId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      GetThreadItem: ({ threadId, itemId }) => api(queries.item(threadId, itemId)),
      GetFileDiff: ({ taskId, path }) => api(queries.fileDiff(taskId, path)),
      GetBoard: ({ projectId }) => api(queries.board(projectId)),
      StartSession: ({ commandId, threadId, agentId, model, effort }) =>
        once(
          commandId,
          api(
            sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }),
          ),
        ),
      SwitchAgent: ({ commandId, threadId, agentId, model, effort }) =>
        once(
          commandId,
          api(
            sessions.switchAgent({
              threadId,
              agentId,
              ...(model === undefined ? {} : { model }),
              ...(effort === undefined ? {} : { effort }),
            }),
          ),
        ),
      SetModel: ({ commandId, threadId, model }) => once(commandId, api(sessions.setModel({ threadId, model }))),
      SetEffort: ({ commandId, threadId, effort }) => once(commandId, api(sessions.setEffort({ threadId, effort }))),
      GetModels: () => api(models.catalog),
      SetDefaultEffort: ({ commandId, agentId, model, effort }) =>
        once(commandId, api(models.setDefaultEffort({ agentId, model, effort }))),
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
      GetCoordinator: ({ projectId, before, limit }) =>
        api(queries.coordinator(projectId, { ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })),
      StartTask: ({ commandId, projectId, title, description, steps, issue, end }) =>
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
                end: end === undefined ? yield* pullRequests.endFor(projectId) : end,
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
      Answer: ({ commandId, attentionId, decision, reason }) =>
        api(
          Effect.gen(function* () {
            yield* permissions.answer({
              envelope: yield* envelope('attention.answer', { attentionId, decision, reason }, commandId),
              attentionId,
              decision,
              ...(reason === undefined ? {} : { reason }),
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
                  tokenNeedsUser: info.token.user,
                  tokenHelp: info.token.help(info.hosted?.webUrl ?? ''),
                })),
            }
          }),
        ),
      StartSignIn: ({ commandId, product, webUrl }) =>
        once(commandId, api(connections.startSignIn({ product, actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) }))),
      GetSignIn: ({ flowId }) => api(connections.signIn(flowId)),
      CancelSignIn: ({ flowId }) => api(connections.cancelSignIn(flowId)),
      ConnectToken: ({ commandId, product, webUrl, user, token }) =>
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
              }),
              connectionOf,
            ),
          ),
        ),
      Disconnect: ({ commandId, connectionId }) => once(commandId, api(connections.remove(connectionId, instance.personId))),
      ListIssues: ({ projectId }) => api(Effect.map(issues.mine(projectId), (found) => ({ issues: found }))),
      MarkReady: ({ commandId, taskId }) => once(commandId, api(pullRequests.markReady(taskId))),
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
      RemoveAccount: ({ commandId, accountId }) => once(commandId, api(accounts.remove(accountId))),
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
      SetUsageLimit: ({ commandId, projectId, policy }) =>
        once(commandId, api(policies.setUsageLimit(projectId, policy, instance.personId))),
      OpenChange: ({ commandId, taskId }) => once(commandId, api(runs.publish(taskId))),
      Merge: ({ commandId, taskId, head }) => once(commandId, api(pullRequests.merge(taskId, head))),
      RefreshTask: ({ taskId }) => pullRequests.refresh(taskId),
      Watch: ({ since }) => Stream.merge(changes(since), streaming),
    })
  }),
)

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
