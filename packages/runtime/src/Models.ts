import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { type AgentDefinition, type ConfigOption, connect } from '@althar/provider-adapters'
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
 * category, and one in `thought_level`. What an agent offers changes with
 * its version and with what its maker offers that day (Codex's list comes
 * from OpenAI, by Codex's version), so Althar asks each agent once a launch:
 * it starts the agent in an empty folder, in its read-only mode, reads the
 * settings, and stops it, recording nothing, as a sign-in check does. Until
 * it has said, the latest session it had says, and what it is on is always
 * what that session was last set to. What can't be read is left empty; a
 * picker offers the agent's own default.
 */

export interface AgentModels {
  readonly agentId: string
  readonly models: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string | null }>
  /** How hard it can be asked to think, lowest first; empty where it has no such choice. */
  readonly efforts: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The model and effort it is on, as last seen: its own default, or what it was last set to. */
  readonly model: string | null
  readonly effort: string | null
  /** The person's default effort for each model they set one for. */
  readonly defaults: ReadonlyArray<{ readonly model: string; readonly effort: string }>
  /** Being asked now, for an agent not seen before. */
  readonly probing: boolean
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | Agents | SignIns

/** What an agent's settings say it offers, and what it is on. */
type Offered = Omit<AgentModels, 'probing' | 'defaults'>

/** How long asking an agent its settings may take. */
const PROBE_TIMEOUT = Duration.seconds(30)

/** An agent's models and efforts, from its session's settings. */
export const modelsOf = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>): Offered => {
  const model = options.find((option) => option.id === definition.options.model) ?? options.find((option) => option.category === 'model')
  const effort =
    definition.options.effort === undefined
      ? options.find((option) => option.category === 'thought_level')
      : options.find((option) => option.id === definition.options.effort)
  // Settings kept before names were, by their values alone.
  const choices = (option: ConfigOption | undefined) =>
    option === undefined ? [] : (option.choices ?? option.values.map((value) => ({ value, name: value })))
  return {
    agentId: definition.id,
    models: choices(model).map((choice) => ({ id: choice.value, name: choice.name, description: choice.description ?? null })),
    efforts: choices(effort).map((choice) => ({ id: choice.value, name: choice.name })),
    model: typeof model?.currentValue === 'string' ? model.currentValue : null,
    effort: typeof effort?.currentValue === 'string' ? effort.currentValue : null,
  }
}

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
                    return modelsOf(definition, yield* session.options)
                  }),
                ).pipe(Effect.timeout(PROBE_TIMEOUT)),
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
