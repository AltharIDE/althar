import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, type ConfigOption, connect } from '@charrette/provider-adapters'
import { Context, Duration, Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AgentEntry, Agents } from './Config'
import { SignIns } from './SignIns'

/*
 * The models each agent offers, and how hard each can be asked to think, in
 * the agent's own names (docs/architecture/03: an agent's options are its
 * own). An agent says so in its session's settings: a select in the `model`
 * category, and one in `thought_level`. Charrette reads them from the latest
 * session an agent had, and what it is on from what that session was last
 * set to. An agent it has never run, or whose latest session was kept before
 * Charrette kept the names, it asks once a launch: it starts the agent in an
 * empty folder, in its read-only mode, reads the settings, and stops it,
 * recording nothing, as a sign-in check does. What can't be read is left
 * empty; a picker offers the agent's own default.
 */

export interface AgentModels {
  readonly agentId: string
  readonly models: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string | null }>
  /** How hard it can be asked to think, lowest first; empty where it has no such choice. */
  readonly efforts: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The model and effort it is on, as last seen: its own default, or what it was last set to. */
  readonly model: string | null
  readonly effort: string | null
  /** Being asked now, for an agent not seen before. */
  readonly probing: boolean
}

/** How long asking an agent its settings may take. */
const PROBE_TIMEOUT = Duration.seconds(30)

/** An agent's models and efforts, from its session's settings. */
export const modelsOf = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>): Omit<AgentModels, 'probing'> => {
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
    /** Every agent's models and efforts, as far as they are known. */
    readonly catalog: Effect.Effect<ReadonlyArray<AgentModels>, SqlError.SqlError>
  }
>()('@charrette/runtime/Models') {
  static readonly layer: Layer.Layer<Models, never, SqlClient.SqlClient | Agents | SignIns> = Layer.effect(
    Models,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const signIns = yield* SignIns
      /* What asking each agent found this launch; an agent being asked has no entry yet. */
      const probed = new Map<string, Omit<AgentModels, 'probing'> | null>()
      const probing = new Set<string>()

      /** Starts the agent in an empty folder, read-only, to read its settings, and stops it. */
      const probe = (entry: AgentEntry) =>
        Effect.scoped(
          Effect.gen(function* () {
            const folder = yield* Effect.acquireRelease(
              Effect.sync(() => mkdtempSync(join(tmpdir(), 'charrette-models-'))),
              (made) => Effect.sync(() => rmSync(made, { recursive: true, force: true })),
            )
            const { definition } = entry
            const connection = yield* connect({
              transport: entry.transport(folder),
              // It is never prompted, so it has nothing to ask.
              onPermission: () => Effect.succeed({ decision: 'reject' as const }),
              permissions: definition.permissions,
            })
            const session = yield* connection.newSession({
              cwd: folder,
              mode: definition.modes.reader,
              modeOptionId: definition.options.mode,
              ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('reader') }),
            })
            return modelsOf(definition, yield* session.options)
          }),
        ).pipe(
          Effect.timeout(PROBE_TIMEOUT),
          Effect.tapCause((cause) => Effect.logWarning(`Could not read ${entry.definition.name}'s models`, cause)),
          Effect.orElseSucceed(() => null),
          Effect.tap((found) => Effect.sync(() => probed.set(entry.definition.id, found))),
          Effect.ensuring(Effect.sync(() => probing.delete(entry.definition.id))),
        )

      const of = (entry: AgentEntry) =>
        Effect.gen(function* () {
          const { definition } = entry
          // Its settings as the session started; what it is on now, as the person last set it.
          const [latest] = yield* sql<{ config: string; model: string | null; effort: string | null }>`
            SELECT config, model, effort FROM provider_sessions WHERE agent_id = ${definition.id} AND config IS NOT NULL
            ORDER BY started_at DESC LIMIT 1`
          const settings = latest === undefined ? [] : settingsIn(latest.config)
          const seen = modelsOf(definition, settings)
          const now = latest === undefined ? {} : { model: latest.model, effort: latest.effort }
          // Settings kept before Charrette kept their names say only ids: the agent is asked for its names.
          const named = settings.some((option) => option.choices !== undefined)
          if (seen.models.length > 0 && named) return { ...seen, ...now, probing: false }
          const asked = probed.get(definition.id)
          if (asked !== undefined) return { ...(asked ?? seen), ...now, probing: false }
          // Not asked yet this launch: asked now, in the background, if it is signed in.
          if (!probing.has(definition.id) && (yield* signIns.of(definition.id)) !== 'signed_out') {
            probing.add(definition.id)
            yield* Effect.forkDetach(probe(entry))
            return { ...seen, ...now, probing: true }
          }
          return { ...seen, ...now, probing: probing.has(definition.id) }
        })

      return Models.of({
        catalog: Effect.forEach(agents.list, of),
      })
    }),
  )
}
