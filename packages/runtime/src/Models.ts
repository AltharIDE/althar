import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type AgentDefinition, type AgentSession, type ConfigOption, connect } from '@althar/provider-adapters'
import { Context, type Crypto, Duration, Effect, Exit, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AgentEntry, Agents } from './Config'
import { UnknownAgent } from './errors'
import { Instance } from './Instance'
import { defaultEffortsOf, setDefaultEffort } from './preferences'
import { change, timestamp } from './records'
import { SignIns } from './SignIns'

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
 * What can't be read is left empty; a picker offers the agent's own default.
 */

export interface AgentModels {
  readonly agentId: string
  readonly models: ReadonlyArray<OfferedModel>
  /** The model and effort it is on, as last seen: its own default, or what it was last set to. */
  readonly model: string | null
  readonly effort: string | null
  /** The person's default effort for each model they set one for. */
  readonly defaults: ReadonlyArray<{ readonly model: string; readonly effort: string }>
  /** Being asked now, for an agent not seen before. */
  readonly probing: boolean
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | Agents | SignIns

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
type Offered = Omit<AgentModels, 'probing' | 'defaults'>

/** How long starting an agent to ask it its settings may take. */
const PROBE_TIMEOUT = Duration.seconds(30)

/** How long putting it on each model in turn may take: Claude Code takes over a second a model. */
const WALK_TIMEOUT = Duration.seconds(40)

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
export const modelsOf = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>): Offered => {
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
  }
}

/**
 * Every model's efforts, and the one each starts at, from a session that
 * hasn't been set to anything yet: put on each model in turn, then back on
 * the one it started on, in case the agent keeps what it was last put on.
 * A model it can't be put on, or isn't put on in time, keeps what is known
 * of it.
 */
const walk = (definition: AgentDefinition, session: AgentSession) =>
  Effect.gen(function* () {
    const first = yield* session.options
    const offered = modelsOf(definition, first)
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

const settingsIn = (config: string): ReadonlyArray<ConfigOption> => {
  try {
    const parsed: unknown = JSON.parse(config)
    const options = typeof parsed === 'object' && parsed !== null && 'options' in parsed ? parsed.options : []
    return Array.isArray(options) ? (options as ReadonlyArray<ConfigOption>) : []
  } catch {
    return []
  }
}

export class Models extends Context.Service<
  Models,
  {
    /** Every agent's models and efforts, as far as they are known, with the person's default efforts. */
    readonly catalog: Effect.Effect<ReadonlyArray<AgentModels>, SqlError.SqlError>
    /** The person's default effort for one of an agent's models, for every session on it from now. */
    setDefaultEffort(input: {
      readonly agentId: string
      readonly model: string
      readonly effort: string
    }): Effect.Effect<void, SqlError.SqlError | UnknownAgent>
  }
>()('@althar/runtime/Models') {
  static readonly layer: Layer.Layer<Models, never, Store> = Layer.effect(
    Models,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const signIns = yield* SignIns
      const instance = yield* Instance
      const context = yield* Effect.context<Store>()
      // Asking runs in the runtime's scope: it stops, and its agent with it, when the runtime does.
      const scope = yield* Effect.scope
      /* What asking each agent found this launch; an agent being asked has no entry yet. */
      const probed = new Map<string, Offered | null>()
      const probing = new Set<string>()

      /**
       * Starts the agent in an empty folder, read-only, to read its settings,
       * and stops it. Its process is recorded before it is spawned, as any
       * agent's is, so one a crash leaves behind is stopped at the next launch.
       */
      const probe = (entry: AgentEntry) =>
        Effect.acquireUseRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), 'althar-models-'))),
          (folder) =>
            Effect.gen(function* () {
              const { definition } = entry
              const transport = entry.transport(folder)
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
              const read = yield* Effect.exit(
                Effect.scoped(
                  Effect.gen(function* () {
                    const session = yield* Effect.gen(function* () {
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
                      return yield* connection.newSession({
                        cwd: folder,
                        mode: definition.modes.reader,
                        modeOptionId: definition.options.mode,
                        ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('reader') }),
                      })
                    }).pipe(Effect.timeout(PROBE_TIMEOUT))
                    return yield* walk(definition, session)
                  }),
                ),
              )
              // Its scope closed, so its agent has stopped; one that never started, or failed on the way, isn't known to have.
              if (processId !== undefined)
                yield* change('processes', processId, { state: Exit.isSuccess(read) ? 'exited' : 'unknown', endedAt: yield* timestamp })
              if (Exit.isSuccess(read)) return read.value
              yield* Effect.logWarning(`Could not read ${definition.name}'s models`, read.cause)
              return null
            }),
          (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
        ).pipe(
          Effect.orElseSucceed(() => null),
          Effect.tap((found) => Effect.sync(() => probed.set(entry.definition.id, found))),
          Effect.ensuring(Effect.sync(() => probing.delete(entry.definition.id))),
        )

      const of = (entry: AgentEntry) =>
        Effect.gen(function* () {
          const { definition } = entry
          const defaults = yield* defaultEffortsOf(definition.id)
          // Its settings as the session started; what it is on now, as the person last set it.
          const [latest] = yield* sql<{ config: string; model: string | null; effort: string | null }>`
            SELECT config, model, effort FROM provider_sessions WHERE agent_id = ${definition.id} AND config IS NOT NULL
            ORDER BY started_at DESC LIMIT 1`
          const settings = latest === undefined ? [] : settingsIn(latest.config)
          const seen = modelsOf(definition, settings)
          const now = latest === undefined ? {} : { model: latest.model, effort: latest.effort }
          // What it said when asked this launch is newer than any session: a model it offers since then is there.
          const asked = probed.get(definition.id)
          if (asked !== undefined) return { ...(asked ?? seen), ...now, defaults, probing: false }
          // Not asked yet this launch: asked now, in the background, if it is signed in; its latest session says until then.
          if (!probing.has(definition.id) && (yield* signIns.of(definition.id)) !== 'signed_out') {
            probing.add(definition.id)
            yield* Effect.forkIn(probe(entry), scope)
            return { ...seen, ...now, defaults, probing: true }
          }
          return { ...seen, ...now, defaults, probing: probing.has(definition.id) }
        })

      return Models.of({
        catalog: Effect.provide(Effect.forEach(agents.list, of), context),
        setDefaultEffort: (input) =>
          Effect.gen(function* () {
            const entry = yield* agents.get(input.agentId)
            yield* setDefaultEffort(entry.definition.id, input.model, input.effort)
          }).pipe(Effect.provide(context)),
      })
    }),
  )
}
