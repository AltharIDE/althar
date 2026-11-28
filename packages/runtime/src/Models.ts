import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type AgentDefinition, type AgentSession, cleanUp, type ConfigOption, connect } from '@althar/provider-adapters'
import { Cause, Clock, Context, type Crypto, Duration, Effect, Exit, Layer, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AgentEntry, Agents, RuntimeConfig } from './Config'
import { UnknownAgent } from './errors'
import { startsAgain } from './startAgain'
import { Installs, isInstalled } from './Installs'
import { Instance } from './Instance'
import { blockedModelsOf, clearDefaultEffort, defaultEffortsOf, setDefaultEffort, setModelBlocked } from './preferences'
import { change, timestamp } from './records'
import { SignIns } from './SignIns'
import { type Account, Accounts } from './Accounts'

/*
 * The models each agent offers, and how hard each can be asked to think, in
 * the agent's own names (docs/architecture/03: an agent's options are its
 * own). An agent says so in its session's settings: a select in the `model`
 * category, and one in `thought_level` for the model the session is on,
 * since each model has levels of its own, and some none. What an agent
 * offers changes with its version and with what its maker offers that day
 * (Codex's list comes from OpenAI, by Codex's version), so Althar asks each
 * agent once a launch: it starts the agent in an empty folder, in its
 * read-only mode, reads the settings, puts the session on each model in turn
 * to read its levels, and stops it, recording nothing, as a sign-in check
 * does. Until it has said, the latest session it had says, for the model it
 * was on, and what it is on is always what that session was last set to.
 * Once it has said, a model a session offered in the day before or offers
 * since is offered too: Codex answers with an older list of its own where
 * OpenAI's doesn't come in time, a restart's asking included.
 * What can't be read is left empty; a picker offers the agent's own default.
 * An agent that couldn't say, as one asked before its sign-in is done, is
 * asked again once it is found signed in, and otherwise at a read a minute
 * on, rather than offer only its default until Althar opens again.
 *
 * Each of an agent's accounts is asked on its own, in its own home, as its
 * maker offers each plan its own models (a Plus account Sol, the usual one
 * not): the agent's models are what any of its accounts offers, and
 * `lacking` says which don't offer one, so a step on it runs on one that
 * does (Limits). An account added is asked at the next read, one signed in again
 * is asked afresh, and one removed counts no more. A session says what its
 * account offers, but for the model it was put on: an agent lists that one
 * whether its account is offered it or not.
 */

export interface AgentModels {
  readonly agentId: string
  readonly models: ReadonlyArray<OfferedModel>
  /** The model and effort it is on, as last seen: its own default, or what it was last set to. */
  readonly model: string | null
  readonly effort: string | null
  /** The person's default effort for each model they set one for. */
  readonly defaults: ReadonlyArray<{ readonly model: string; readonly effort: string }>
  /** The models the person switched off, by id (ADR-015). */
  readonly blocked: ReadonlyArray<string>
  /** Being asked now, for an agent not seen before. */
  readonly probing: boolean
  /** It takes images in a message, as it said when last asked or started; null until it has said. */
  readonly images: boolean | null
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | Agents | SignIns | Installs | RuntimeConfig | Accounts

export interface OfferedModel {
  readonly id: string
  readonly name: string
  readonly description: string | null
  /** How hard it can be asked to think, in the agent's order; empty where it has no such choice, or it isn't known. */
  readonly efforts: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The effort a session on it starts at, the person's default aside; null where it isn't known. */
  readonly effort: string | null
}

/** What an agent's settings say it offers, and what it is on. */
type Offered = Omit<AgentModels, 'probing' | 'defaults' | 'blocked'>

/** How long starting an agent to ask it its settings may take. */
const PROBE_TIMEOUT = Duration.seconds(30)

/** How long putting it on each model in turn may take: Claude Code takes over a second a model. */
const WALK_TIMEOUT = Duration.seconds(40)

/** How long after an agent couldn't say its models it is asked again, at the next read. */
/**
 * Of one read of an agent's sessions since `from`, those that have said their settings and aren't read yet, and where the
 * next read starts: from the first still starting, or a minute before the latest that said, so the reads stay small. One
 * still starting in this read is never passed, whenever it says its settings after.
 */
export const readsOf = (
  seen: ReadonlyArray<{
    readonly id: string
    readonly startedAt: string
    readonly said: number | boolean
    readonly starting: number | boolean
  }>,
  later: { readonly from: string; readonly read: ReadonlyMap<string, string> },
): { readonly unread: ReadonlyArray<{ readonly id: string; readonly startedAt: string }>; readonly from: string } => {
  const said = seen.filter((row) => Boolean(row.said))
  const unread = said.filter((row) => !later.read.has(row.id))
  if (unread.length === 0) return { unread, from: later.from }
  const margin = new Date(Math.max(...said.map((row) => Date.parse(row.startedAt))) - 60_000).toISOString()
  const pending = seen
    .filter((row) => Boolean(row.starting))
    .map((row) => row.startedAt)
    .reduce<string | undefined>((first, at) => (first === undefined || at < first ? at : first), undefined)
  const next = pending !== undefined && pending < margin ? pending : margin
  return { unread, from: next > later.from ? next : later.from }
}

const ASK_AGAIN = Duration.minutes(1)
/** How long after its sign-in was opened in Terminal an account is asked afresh at each check of its sign-in. */
const SIGNING_IN = 15 * 60 * 1000
/** How far before an agent's asking its sessions still say what it offers, where the asking got an older list. */
const RECENT = 24 * 60 * 60 * 1000
/**
 * How long a model a start found gone from an account's list, after asking it again a while (sessionConnections.ts), stays
 * out of what the account offers, its sessions of the day before included, unless the account lists it again meanwhile.
 */
const GONE_FOR = 60 * 60 * 1000

// Settings kept before names were, by their values alone.
const choices = (option: ConfigOption | undefined) =>
  option === undefined ? [] : (option.choices ?? option.values.map((value) => ({ value, name: value })))

const current = (option: ConfigOption | undefined) => (typeof option?.currentValue === 'string' ? option.currentValue : null)

const modelOption = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>) =>
  options.find((option) => option.id === definition.options.model) ?? options.find((option) => option.category === 'model')

const effortOption = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>) =>
  definition.options.effort === undefined
    ? options.find((option) => option.category === 'thought_level')
    : options.find((option) => option.id === definition.options.effort)

/** The efforts of the model a session is on, and the one it starts at: the model's own, where the agent names it. */
const effortsOn = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>) => {
  const efforts = choices(effortOption(definition, options)).map((choice) => ({ id: choice.value, name: choice.name }))
  const own = definition.options.ownEffort
  return {
    efforts,
    effort: own !== undefined && efforts.some((level) => level.id === own) ? own : current(effortOption(definition, options)),
  }
}

/** An agent's models, from its session's settings: the efforts of the one it is on, and what it is on. */
export const modelsOf = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>, images: boolean | null = null): Offered => {
  const on = current(modelOption(definition, options))
  const { efforts } = effortsOn(definition, options)
  return {
    agentId: definition.id,
    models: choices(modelOption(definition, options)).map((choice) => ({
      id: choice.value,
      name: choice.name,
      description: choice.description ?? null,
      efforts: choice.value === on ? efforts : [],
      // What it starts at isn't known here: the session was set as it started.
      effort: null,
    })),
    model: on,
    effort: current(effortOption(definition, options)),
    images,
  }
}

/**
 * What an agent's accounts offer, as one list: every model any of them offers, in the first's order, then each next
 * one's own; a model's efforts from the first that knows them. What it is on comes from the first, and whether it takes
 * images from the first that said. None where none has said.
 */
export const mergeOffers = (offers: ReadonlyArray<Offered>): Offered | undefined => {
  const [first] = offers
  if (first === undefined) return undefined
  const byId = new Map<string, OfferedModel>()
  for (const offer of offers)
    for (const model of offer.models) {
      const known = byId.get(model.id)
      if (known === undefined || (known.efforts.length === 0 && model.efforts.length > 0)) byId.set(model.id, model)
    }
  return { ...first, models: [...byId.values()], images: offers.find((offer) => offer.images !== null)?.images ?? null }
}

/** Whether a model asked for, by its id or by its id and its name (`gpt-6.2-sol GPT-6.2 Sol`), is the one of this id. */
export const isModel = (asked: string, id: string) => asked === id || asked.startsWith(`${id} `)

/**
 * Every model's efforts, and the one each starts at, from a session that
 * hasn't been set to anything yet: put on each model in turn, then back on
 * the one it started on, in case the agent keeps what it was last put on.
 * A model it can't be put on, or isn't put on in time, keeps what is known
 * of it.
 */
const walk = (definition: AgentDefinition, session: AgentSession, images: boolean) =>
  Effect.gen(function* () {
    const first = yield* session.options
    const offered = modelsOf(definition, first, images)
    // The model it is on has said already.
    const read = new Map(
      offered.models
        .filter((model) => model.id === offered.model)
        .map((model) => [model.id, { ...model, ...effortsOn(definition, first) }]),
    )
    yield* Effect.forEach(
      offered.models.filter((model) => !read.has(model.id)),
      (model) =>
        session.setOption(definition.options.model, model.id).pipe(
          // Claude Code checks each model with Anthropic as it is put on it, which fails now and then, and says to try again.
          Effect.retry({ times: 1 }),
          Effect.tap((options) => Effect.sync(() => read.set(model.id, { ...model, ...effortsOn(definition, options) }))),
          Effect.ignore,
        ),
      { discard: true },
    ).pipe(Effect.timeoutOption(WALK_TIMEOUT))
    if (offered.model !== null)
      yield* session.setOption(definition.options.model, offered.model).pipe(Effect.timeoutOption(Duration.seconds(5)), Effect.ignore)
    return { ...offered, models: offered.models.map((model): OfferedModel => read.get(model.id) ?? model) }
  })

/**
 * Removes the folder an agent was asked in, as best it can (`cleanUp`): what asking found is kept all the same, where a
 * folder Windows still holds failing it would lose it, and have the agent asked again at the next read of the catalog.
 */
const removeFolder = (folder: string) => cleanUp(folder, 'where an agent was asked its models')

const settingsIn = (config: string): ReadonlyArray<ConfigOption> => {
  try {
    const parsed: unknown = JSON.parse(config)
    const options = typeof parsed === 'object' && parsed !== null && 'options' in parsed ? parsed.options : []
    return Array.isArray(options) ? (options as ReadonlyArray<ConfigOption>) : []
  } catch {
    return []
  }
}

/** Whether a session's agent said it takes images, as its settings kept what it said of itself; null for one from before that was kept. */
const imagesIn = (config: string): boolean | null => {
  try {
    const parsed: unknown = JSON.parse(config)
    const agent = typeof parsed === 'object' && parsed !== null && 'agent' in parsed ? parsed.agent : undefined
    const images = typeof agent === 'object' && agent !== null && 'images' in agent ? agent.images : undefined
    return typeof images === 'boolean' ? images : null
  } catch {
    return null
  }
}

export class Models extends Context.Service<
  Models,
  {
    /** Every agent's models and efforts, as far as they are known, with the person's default efforts. */
    readonly catalog: Effect.Effect<ReadonlyArray<AgentModels>, SqlError.SqlError>
    /** The person's default effort for one of an agent's models, for every session on it from now; none takes theirs away. */
    setDefaultEffort(input: {
      readonly agentId: string
      readonly model: string
      readonly effort: string | null
    }): Effect.Effect<void, SqlError.SqlError | UnknownAgent>
    /** Switches one of an agent's models off, or on again (ADR-015). */
    setModelBlocked(input: {
      readonly agentId: string
      readonly model: string
      readonly blocked: boolean
    }): Effect.Effect<void, SqlError.SqlError | UnknownAgent>
    /** Forgets what asking an agent found, as when it is newly installed: it is asked again, and an asking still under way counts for nothing. */
    forget(agentId: string): Effect.Effect<void>
    /** Forgets what asking one account found, as when it is signed in again or removed: it is asked again at the next read. */
    forgetAccount(accountId: string): Effect.Effect<void>
    /**
     * An account being signed in in Terminal, where Althar can't see the sign-in end: for a while (`SIGNING_IN`), each time its
     * sign-in is checked again, as the window does coming back to the front, it is asked afresh, so the new sign-in's models
     * take the place of the old one's, even where it was signed in all along.
     */
    signingIn(accountId: string): Effect.Effect<void>
    /** The account's sign-in was checked again: asked afresh, where it is being signed in in Terminal. */
    signInChecked(accountId: string): Effect.Effect<void>
    /**
     * The accounts of the agent known not to offer a model, by its id, or its id and name (`gpt-6.2-sol GPT-6.2 Sol`): those
     * that said what they offer this launch, without it. One not asked yet, or that couldn't say, isn't known not to.
     */
    lacking(agentId: string, model: string): Effect.Effect<ReadonlyArray<string>>
    /**
     * Asks an agent again, as after a start that failed: its sign-in is checked afresh and its models asked again, in the
     * background. What it said last stays until it answers, so its models keep their names meanwhile.
     */
    refresh(agentId: string): Effect.Effect<void>
    /**
     * A start found the account no longer lists the model, after asking it again a while: it is left out of what the account
     * offers, its sessions' lists included, until the account lists it again or a while passes (`GONE_FOR`).
     */
    gone(accountId: string, model: string): Effect.Effect<void>
  }
>()('@althar/runtime/Models') {
  static readonly layer: Layer.Layer<Models, never, Store> = Layer.effect(
    Models,
    Effect.gen(function* () {
      const config = yield* RuntimeConfig
      // Where the probe starts: an agent whose copy lives outside the sandbox (a Flatpak) needs a folder the device sees too.
      const probeBase = config.probeRoot ?? tmpdir()
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const signIns = yield* SignIns
      const accounts = yield* Accounts
      const installs = yield* Installs
      const instance = yield* Instance
      const context = yield* Effect.context<Store>()
      // Asking runs in the runtime's scope: it stops, and its agent with it, when the runtime does.
      const scope = yield* Effect.scope
      /*
       * What asking each account found this launch, by the account; one being asked has no entry yet. `owners` says whose
       * agent each account is, so what is kept of an agent's accounts goes with the agent.
       */
      const probed = new Map<string, Offered | null>()
      const owners = new Map<string, string>()
      /* What an account asked again after a start that failed said last, until it answers anew. */
      const stale = new Map<string, Offered>()
      /*
       * The models each account's sessions offered around its asking. An agent that can't reach its maker as it is asked
       * answers with an older list of its own (Codex, where OpenAI's doesn't come in time), which mustn't hide a model its
       * sessions offer: those of the day before it was asked (a restart's asking may get the older list where the last
       * sessions didn't) and those since. Sessions are read by id once they have said their settings, which is as they start,
       * not in the order they were made: `from` passes only those that can't say anything any more. The model a session was
       * put on is kept aside in `own`, and counts only once a turn on it went through since `start`: an agent lists the model
       * it is on whether the account is offered it or not, as Codex does.
       */
      const since = new Map<
        string,
        {
          from: string
          readonly start: string
          readonly read: Map<string, string>
          readonly models: Map<string, OfferedModel>
          readonly own: Map<string, OfferedModel>
        }
      >()
      const lastEntries = new Map<string, AgentEntry>()
      /* The models a start found gone from each account's list, by the account, with when. */
      const goneFrom = new Map<string, Map<string, number>>()
      /** Whether a start found the model gone from the account's list lately. */
      const isGone = (accountId: string, id: string, now: number) => {
        const at = goneFrom.get(accountId)?.get(id)
        return at !== undefined && now - at < GONE_FOR
      }
      /** What the account offers, less what a start found gone from its list lately. */
      const lessGone = (accountId: string, offer: Offered | null) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          offer === null || goneFrom.get(accountId) === undefined
            ? offer
            : { ...offer, models: offer.models.filter((model) => !isGone(accountId, model.id, now)) },
        )
      /* When each account's sign-in was opened in Terminal. */
      const terminal = new Map<string, number>()
      /* When each account that couldn't say was asked, so it is asked again a while on. */
      const failedAt = new Map<string, number>()
      const askAgain = Duration.toMillis(config.modelsAgain ?? ASK_AGAIN)
      /* Which asking owns each account's reservation, so forgetting it cannot let stale work affect a newer asking. */
      const probing = new Map<string, symbol>()
      const ownsProbe = (accountId: string, reservation: symbol) => probing.get(accountId) === reservation
      const releaseProbe = (accountId: string, reservation: symbol) => {
        if (ownsProbe(accountId, reservation)) probing.delete(accountId)
      }
      const accountsOf = (agentId: string) => [...owners].flatMap(([accountId, owner]) => (owner === agentId ? [accountId] : []))
      /** Lets an account that couldn't say be asked again; what one did say, or an asking under way, stays. */
      const forgetFailure = (accountId: string) => {
        if (probed.get(accountId) !== null) return
        probed.delete(accountId)
        failedAt.delete(accountId)
      }
      /** Forgets what asking an account found, and what its sessions offered since. */
      const forgetOne = (accountId: string) => {
        goneFrom.delete(accountId)
        stale.delete(accountId)
        probed.delete(accountId)
        since.delete(accountId)
        failedAt.delete(accountId)
        probing.delete(accountId)
        owners.delete(accountId)
      }
      /** Forgets what asking each of an agent's accounts found. */
      const forgetAsked = (agentId: string) => {
        for (const accountId of accountsOf(agentId)) forgetOne(accountId)
      }
      /** The sessions of an account, as SQL: those from before accounts were kept ran in the usual folder. */
      const ofAccount = (account: Account, column = 'account_id') =>
        account.home === null
          ? sql`(${sql.unsafe(column)} = ${account.id} OR ${sql.unsafe(column)} IS NULL)`
          : sql`${sql.unsafe(column)} = ${account.id}`
      /** Of the models sessions of an account were put on, since `from`, those a turn on went through. */
      const ranOn = (definition: AgentDefinition, account: Account, from: string, sessionId?: string) =>
        Effect.map(
          sql<{ model: string | null }>`
            SELECT DISTINCT COALESCE(d.model, s.model) AS model FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
            WHERE s.agent_id = ${definition.id} AND ${ofAccount(account, 's.account_id')} AND s.started_at >= ${from} AND d.state = 'completed'
              ${sessionId === undefined ? sql`` : sql`AND s.id = ${sessionId}`}`,
          (rows) => new Set(rows.flatMap((row) => (row.model === null ? [] : [row.model]))),
        )
      /**
       * What an account offered when asked, and before those, any model one of its sessions offered around the asking that the
       * asking didn't: the one a session was put on only once a turn on it went through.
       */
      const withLater = (definition: AgentDefinition, account: Account, asked: Offered) =>
        Effect.gen(function* () {
          const later = since.get(account.id)
          if (later === undefined) return asked.models
          // Settings are '{}' until the session has started: those that said them, each read once, and those still starting,
          // all in one statement, so one that says them as this reads is in it one way or the other, never passed between two.
          const seen = yield* sql<{ id: string; startedAt: string; said: number; starting: number }>`
            SELECT id, started_at, config <> '{}' AS said, (config = '{}' AND ended_at IS NULL) AS starting
            FROM provider_sessions
            WHERE agent_id = ${definition.id} AND ${ofAccount(account)} AND started_at >= ${later.from}`
          const { unread, from } = readsOf(seen, later)
          for (const row of unread) {
            const [one] = yield* sql<{ config: string; model: string | null }>`
              SELECT config, model FROM provider_sessions WHERE id = ${row.id}`
            later.read.set(row.id, row.startedAt)
            if (one === undefined) continue
            const said = modelsOf(definition, settingsIn(one.config))
            for (const model of said.models) {
              // A session that started listing it since a start found it gone: the account lists it again.
              const gone = goneFrom.get(account.id)?.get(model.id)
              if (gone !== undefined && Date.parse(row.startedAt) > gone) goneFrom.get(account.id)?.delete(model.id)
              const kept = model.id === one.model || model.id === said.model ? later.own : later.models
              if (model.efforts.length > 0 || !kept.has(model.id)) kept.set(model.id, model)
            }
          }
          if (later.own.size > 0)
            for (const id of yield* ranOn(definition, account, later.start)) {
              const model = later.own.get(id)
              if (model !== undefined && !later.models.has(id)) later.models.set(id, model)
            }
          if (from > later.from) {
            later.from = from
            for (const [id, at] of later.read) if (at < from) later.read.delete(id)
          }
          const offered = new Set(asked.models.map((model) => model.id))
          const extra = [...later.models.values()].filter((model) => !offered.has(model.id))
          return extra.length === 0 ? asked.models : [...extra, ...asked.models]
        })
      // Found signed in: an account asked before its sign-in was done said nothing, and is asked again at the next read; one
      // signed in again may be someone else's sign-in now, offered other models, and is asked afresh.
      yield* Effect.forkIn(
        Stream.runForEach(signIns.signedIn, ({ agentId, accountId, how }) =>
          Effect.sync(() => {
            if (accountId !== undefined && how === 'signed_in') forgetOne(accountId)
            else for (const one of accountsOf(agentId)) forgetFailure(one)
          }),
        ),
        scope,
      )

      /**
       * Starts the agent in an empty folder, read-only, signed in as the
       * account, to read its settings, and stops it. Its process is recorded
       * before it is spawned, as any agent's is, so one a crash leaves
       * behind is stopped at the next launch.
       */
      const probe = (entry: AgentEntry, account: Account, reservation: symbol, askedAt: string) =>
        Effect.acquireUseRelease(
          // A folder it can't make fails the asking, as a throw would have it asked again at every read.
          Effect.try(() => {
            mkdirSync(probeBase, { recursive: true })
            return mkdtempSync(join(probeBase, 'althar-models-'))
          }),
          (folder) =>
            Effect.gen(function* () {
              const { definition } = entry
              // The account's own home, as its sessions get it: Copilot CLI's account host among it.
              yield* accounts.prepare(account)
              const transport = entry.transport(folder, accounts.env(account))
              const processId = transport._tag === 'Process' ? yield* newId(Ids.process) : undefined
              if (transport._tag === 'Process' && processId !== undefined)
                yield* sql`INSERT INTO processes ${sql.insert({
                  id: processId,
                  deviceId: instance.deviceId,
                  runtimeInstanceId: instance.id,
                  purpose: 'probe',
                  executable: transport.spec.command,
                  argsRedacted: JSON.stringify(transport.spec.args),
                  controllerGeneration: 1,
                  state: 'launching',
                  launchedAt: yield* timestamp,
                })}`
              // One start of the asking, in a scope of its own: closing it stops its adapter, whatever it did.
              const attempt = Effect.scoped(
                Effect.gen(function* () {
                  const { session, images } = yield* Effect.gen(function* () {
                    const connection = yield* connect({
                      transport,
                      // It is never prompted, so it has nothing to ask.
                      onPermission: () => Effect.succeed({ decision: 'reject' as const }),
                      permissions: definition.permissions,
                    })
                    if (processId !== undefined && connection.process !== undefined)
                      yield* change('processes', processId, {
                        pid: connection.process.pid,
                        processGroupId: connection.process.pid,
                        osStartedAt: connection.process.osStartedAt ?? null,
                        environmentDigest: connection.process.environmentDigest,
                        state: 'running',
                      })
                    const session = yield* connection.newSession({
                      cwd: folder,
                      mode: definition.modes.reader,
                      modeOptionId: definition.options.mode,
                      ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('reader') }),
                    })
                    return { session, images: connection.info.images }
                  }).pipe(Effect.timeout(PROBE_TIMEOUT))
                  return yield* walk(definition, session, images)
                }),
              )
              // A start that may pass is made once more, afresh, as a session's is (startAgain.ts): the failed one's adapter has
              // stopped with its scope, and the agent's sign-in is read again, before a new process of its adapter starts.
              const read = yield* Effect.exit(
                attempt.pipe(
                  Effect.catchIf(
                    (error) => startsAgain(Cause.fail(error)),
                    () => Effect.andThen(signIns.forget(definition.id), attempt),
                  ),
                ),
              )
              // Its scope closed, so its agent has stopped; one that never started, or failed on the way, isn't known to have.
              if (processId !== undefined)
                yield* change('processes', processId, { state: Exit.isSuccess(read) ? 'exited' : 'unknown', endedAt: yield* timestamp })
              if (Exit.isSuccess(read)) return read.value
              yield* Effect.logWarning(`Could not read ${definition.name}'s models (${account.name})`, read.cause)
              return null
            }),
          removeFolder,
        ).pipe(
          Effect.orElseSucceed(() => null),
          Effect.tap((found) =>
            Effect.gen(function* () {
              if (!ownsProbe(account.id, reservation)) return
              probed.set(account.id, found)
              if (found !== null) stale.delete(account.id)
              // A model it lists again is no longer gone.
              for (const model of found?.models ?? []) goneFrom.get(account.id)?.delete(model.id)
              if (found === null) failedAt.set(account.id, yield* Clock.currentTimeMillis)
              else {
                failedAt.delete(account.id)
                // Sessions of the day before it was asked count too, and those since: one may have reached the maker the asking couldn't.
                const from = new Date(Date.parse(askedAt) - RECENT).toISOString()
                since.set(account.id, { from, start: from, read: new Map(), models: new Map(), own: new Map() })
              }
            }),
          ),
          Effect.ensuring(Effect.sync(() => releaseProbe(account.id, reservation))),
        )

      /**
       * What an account's latest session offered, for one that couldn't say when asked: the model it was put on only where a
       * turn on it went through. None where it has had no session.
       */
      const sessionOffer = (definition: AgentDefinition, account: Account) =>
        Effect.gen(function* () {
          const [latest] = yield* sql<{ id: string; config: string; model: string | null; startedAt: string }>`
            SELECT id, config, model, started_at FROM provider_sessions
            WHERE agent_id = ${definition.id} AND ${ofAccount(account)} AND config IS NOT NULL AND config <> '{}'
            ORDER BY started_at DESC LIMIT 1`
          if (latest === undefined) return null
          const said = modelsOf(definition, settingsIn(latest.config), imagesIn(latest.config))
          const own = new Set([latest.model, said.model])
          const ran = yield* ranOn(definition, account, latest.startedAt, latest.id)
          const models = said.models.filter((model) => !own.has(model.id) || ran.has(model.id))
          return models.length === 0 ? null : { ...said, models }
        })

      /**
       * What one account offers, as far as it has said: what it said when asked this launch, with what its sessions offered
       * since; where it couldn't say, what its latest session offered; null where it hasn't yet, or has nothing to say. Not asked yet this launch, it is asked now, in the background, if
       * the agent is installed and the account signed in. Whether it is signed in is its own command's to say, which takes
       * seconds with the computer busy, so that is asked behind too: the read never waits on it (foundations.md, The UI is
       * instant). One signed out counts as one that couldn't say, asked again a while on or once it is found signed in.
       */
      const offerOf = (entry: AgentEntry, account: Account) =>
        Effect.flatMap(saidOf(entry, account), (offer) => lessGone(account.id, offer))

      const saidOf = (entry: AgentEntry, account: Account) =>
        Effect.gen(function* () {
          const { definition } = entry
          owners.set(account.id, definition.id)
          // One that couldn't say is asked again once a while has passed.
          const failed = failedAt.get(account.id)
          if (probed.get(account.id) === null && failed !== undefined && (yield* Clock.currentTimeMillis) - failed >= askAgain)
            forgetFailure(account.id)
          const asked = probed.get(account.id)
          // Asked again after a start that failed: what it said last, until it answers anew.
          const last = stale.get(account.id)
          // One that couldn't say: what its latest session offered, rather than nothing, as one account's failing mustn't hide
          // a model only it offers while another's list shows as complete.
          if (asked === null) return last ?? (yield* sessionOffer(definition, account))
          if (asked !== undefined) return { ...asked, models: yield* withLater(definition, account, asked) }
          if (!probing.has(account.id) && isInstalled(installs, definition)) {
            const reservation = Symbol()
            probing.set(account.id, reservation)
            yield* Effect.forkIn(
              signIns.account(account).pipe(
                Effect.flatMap(({ status }) => {
                  if (!ownsProbe(account.id, reservation)) return Effect.void
                  if (status !== 'signed_out')
                    return Effect.asVoid(Effect.flatMap(timestamp, (at) => probe(entry, account, reservation, at)))
                  return Effect.gen(function* () {
                    probed.set(account.id, null)
                    failedAt.set(account.id, yield* Clock.currentTimeMillis)
                  })
                }),
                Effect.ensuring(Effect.sync(() => releaseProbe(account.id, reservation))),
              ),
              scope,
            )
          }
          return last ?? null
        })

      const of = (entry: AgentEntry) =>
        Effect.gen(function* () {
          const { definition } = entry
          const previous = lastEntries.get(definition.id)
          if (previous !== undefined && previous !== entry) forgetAsked(definition.id)
          lastEntries.set(definition.id, entry)
          const defaults = yield* defaultEffortsOf(definition.id)
          const blocked = yield* blockedModelsOf(definition.id)
          // Its settings as the session started; what it is on now, as the person last set it.
          const [latest] = yield* sql<{ config: string; model: string | null; effort: string | null }>`
            SELECT config, model, effort FROM provider_sessions WHERE agent_id = ${definition.id} AND config IS NOT NULL
            ORDER BY started_at DESC LIMIT 1`
          const settings = latest === undefined ? [] : settingsIn(latest.config)
          const seen = modelsOf(definition, settings, latest === undefined ? null : imagesIn(latest.config))
          // Each of its accounts, in the person's order; one removed counts no more.
          const list = yield* accounts.of(definition.id)
          const kept = new Set(list.map((account) => account.id))
          for (const accountId of accountsOf(definition.id)) if (!kept.has(accountId)) forgetOne(accountId)
          const offers: Array<Offered> = []
          for (const account of list) {
            const offer = yield* offerOf(entry, account)
            if (offer !== null) offers.push(offer)
          }
          const asking = list.some((account) => probing.has(account.id))
          // What its accounts said when asked this launch is newer than any session before it.
          const merged = mergeOffers(offers)
          if (merged === undefined) {
            // None has said yet: its latest session says until one does.
            const now = latest === undefined ? {} : { model: latest.model, effort: latest.effort }
            return { ...seen, ...now, defaults, blocked, probing: asking }
          }
          // What it is on, where an account still offers it; otherwise what the first account starts on.
          const now =
            latest?.model != null && merged.models.some((model) => model.id === latest.model)
              ? { model: latest.model, effort: latest.effort }
              : {}
          return { ...merged, ...now, defaults, blocked, probing: asking }
        })

      return Models.of({
        catalog: Effect.provide(
          Effect.suspend(() => Effect.forEach(agents.list, of)),
          context,
        ),
        setDefaultEffort: (input) =>
          Effect.gen(function* () {
            const entry = yield* agents.get(input.agentId)
            if (input.effort === null) yield* clearDefaultEffort(entry.definition.id, input.model)
            else yield* setDefaultEffort(entry.definition.id, input.model, input.effort)
          }).pipe(Effect.provide(context)),
        setModelBlocked: (input) =>
          Effect.gen(function* () {
            const entry = yield* agents.get(input.agentId)
            yield* setModelBlocked(entry.definition.id, input.model, input.blocked)
          }).pipe(Effect.provide(context)),
        forget: (agentId) => signIns.forget(agentId).pipe(Effect.andThen(Effect.sync(() => forgetAsked(agentId)))),
        refresh: (agentId) =>
          signIns.forget(agentId).pipe(
            Effect.andThen(
              Effect.sync(() => {
                for (const accountId of accountsOf(agentId)) {
                  const last = probed.get(accountId) ?? stale.get(accountId)
                  const gone = goneFrom.get(accountId)
                  forgetOne(accountId)
                  if (last !== undefined && last !== null) stale.set(accountId, last)
                  if (gone !== undefined) goneFrom.set(accountId, gone)
                }
              }),
            ),
          ),
        forgetAccount: (accountId) => Effect.sync(() => forgetOne(accountId)),
        signingIn: (accountId) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.sync(() => {
              terminal.set(accountId, now)
              forgetOne(accountId)
            }),
          ),
        signInChecked: (accountId) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.sync(() => {
              const opened = terminal.get(accountId)
              if (opened === undefined) return
              if (now - opened > SIGNING_IN) terminal.delete(accountId)
              // Not while it is being asked: that asking reads the sign-in as it is now.
              else if (!probing.has(accountId)) forgetOne(accountId)
            }),
          ),
        lacking: (agentId, model) =>
          Effect.map(Clock.currentTimeMillis, (now) =>
            accountsOf(agentId).filter((accountId) => {
              const ids = [...(goneFrom.get(accountId)?.keys() ?? [])]
              if (ids.some((id) => isModel(model, id) && isGone(accountId, id, now))) return true
              const asked = probed.get(accountId)
              if (asked == null) return false
              const offered = [...asked.models.map((one) => one.id), ...(since.get(accountId)?.models.keys() ?? [])]
              return !offered.some((id) => isModel(model, id))
            }),
          ),
        gone: (accountId, model) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.sync(() => {
              const gone = goneFrom.get(accountId) ?? new Map<string, number>()
              gone.set(model, now)
              goneFrom.set(accountId, gone)
            }),
          ),
      })
    }),
  )
}
