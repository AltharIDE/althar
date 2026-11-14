import {
  AcpCatalog as CatalogSchema,
  AcpConnection as ConnectionSchema,
  AcpSavedConnection,
  type AcpCatalogItem,
  type AcpConnection,
  ApiError,
  AcpApi,
} from '@althar/contracts'
import {
  ACP_PROFILES,
  ACP_REGISTRY_URL,
  externalDefinition,
  qualifyAcp,
  registryCommand,
  registryIn,
  usingLocated,
} from '@althar/provider-adapters'
import { Cause, Context, Crypto, Deferred, Effect, Exit, Fiber, Layer, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import { Ids, newId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { adapterNode } from '@althar/provider-adapters'

import { Agents, RuntimeConfig, type AgentEntry } from './Config'
import { Instance } from './Instance'
import { Installs } from './Installs'
import { change, timestamp } from './records'
import { redact } from './diagnostics'

const refused = (message: string) => new ApiError({ reason: 'AcpConnectionRefused', message })
const keyOf = (device: string, id: string) => `acp:${device}:${id}`
const profiles: ReadonlyArray<AcpCatalogItem> = ACP_PROFILES.map((profile) => ({
  ...profile,
  description: 'Use an existing installation and sign-in.',
  version: null,
  source: 'profile',
  ...('env' in profile ? { env: profile.env } : {}),
  ...('modeOption' in profile ? { modeOption: profile.modeOption } : {}),
}))

export class AgentCatalog extends Context.Service<
  AgentCatalog,
  {
    read(refresh?: boolean): Effect.Effect<typeof CatalogSchema.Type>
    save(connection: AcpConnection): Effect.Effect<number, ApiError>
    check(id: string): Effect.Effect<number, ApiError>
    remove(id: string): Effect.Effect<number, ApiError>
  }
>()('@althar/runtime/AgentCatalog') {
  static readonly layer = Layer.effect(
    AgentCatalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const installs = yield* Installs
      const config = yield* RuntimeConfig
      const instance = yield* Instance
      const scope = yield* Effect.scope
      const crypto = yield* Crypto.Crypto
      const ledger = yield* Ledger
      const lock = Semaphore.makeUnsafe(1)
      const saved = new Map<string, typeof AcpSavedConnection.Type>()
      const running = new Map<string, Fiber.Fiber<void, never>>()
      let items = profiles
      let problem: string | null = null
      let refreshing = false
      const prefix = `acp:${instance.deviceId}:`
      const cachedKey = `acp-registry:${instance.deviceId}`
      const revisionKey = `acp-revision:${instance.deviceId}`
      const [keptRevision] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${revisionKey}`
      let revision = Number(keptRevision?.value ?? '0')
      if (!Number.isSafeInteger(revision) || revision < 0) revision = 0
      const bump = Effect.gen(function* () {
        const next = revision + 1
        const at = yield* timestamp
        yield* sql`INSERT INTO settings ${sql.insert({ key: revisionKey, value: String(next), updatedAt: at })}
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        yield* ledger.notify({ aggregateType: 'setting', aggregateId: `acp-catalog:${instance.deviceId}`, aggregateRevision: next })
        return next
      })
      const decode = Schema.decodeUnknownSync(Schema.fromJsonString(AcpSavedConnection))
      const asDefinition = (connection: AcpConnection) => externalDefinition({ ...connection, id: connection.id as `acp-${string}` })
      const entryOf = (connection: AcpConnection, version?: string): AgentEntry => {
        const definition = asDefinition(connection)
        const [entry] = Agents.fromRegistry(
          (one) => usingLocated(one, () => installs.locate(one), process.env.FLATPAK_ID),
          config.agentStderr,
          [definition],
        ).list
        if (entry === undefined) throw new Error('The ACP connection has no transport')
        return {
          definition: entry.definition,
          transport: (...args) => {
            const transport = entry.transport(...args)
            return transport._tag === 'Process' && version !== undefined ? { ...transport, expectedVersion: version } : transport
          },
        }
      }
      const persist = (value: typeof AcpSavedConnection.Type) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              yield* sql`INSERT INTO settings ${sql.insert({ key: keyOf(instance.deviceId, value.connection.id), value: JSON.stringify(value), updatedAt: at })}
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
              return yield* bump
            }),
          )
          .pipe(
            Effect.tap((next) =>
              Effect.sync(() => {
                revision = next
                saved.set(value.connection.id, value)
              }),
            ),
          )
      const rows = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key LIKE ${`${prefix}%`} ORDER BY key`
      for (const row of rows) {
        try {
          const value = decode(row.value)
          const kept =
            value.state === 'checking'
              ? { ...value, state: 'unchecked' as const, reason: 'The compatibility check was interrupted. Check again.' }
              : value
          saved.set(kept.connection.id, kept)
          if (kept.state === 'ready' && kept.version !== null) agents.register?.(entryOf(kept.connection, kept.version))
        } catch {
          problem = 'One saved ACP connection could not be read. The other connections are available.'
        }
      }
      const [cache] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${cachedKey}`
      if (cache !== undefined) {
        try {
          items = Schema.decodeUnknownSync(Schema.fromJsonString(CatalogSchema.fields.items))(cache.value)
        } catch {
          problem = 'The saved agent catalog could not be read. Refresh the registry to replace it.'
        }
      }
      const inactive = (id: string) =>
        Effect.gen(function* () {
          const active = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE agent_id = ${id} AND ended_at IS NULL LIMIT 1`
          if (active.length > 0) return yield* refused('Close this agent’s active conversations before changing its connection.')
        })
      const failure = (cause: Cause.Cause<unknown>) => {
        let error = Cause.squash(cause)
        for (let depth = 0; depth < 4 && Cause.isUnknownError(error); depth += 1) error = error.cause
        if (typeof error === 'object' && error !== null && 'available' in error && Array.isArray(error.available))
          return `The configured mode or option is unavailable. This agent offers: ${error.available.join(', ') || 'no modes'}. Edit the connection and check again.`
        return redact(error instanceof Error ? error.message : String(error))
      }
      const refresh = Effect.gen(function* () {
        const fetch = config.fetch ?? globalThis.fetch
        const remote = yield* Effect.tryPromise(async (signal) => {
          const response = await fetch(ACP_REGISTRY_URL, { signal, headers: { Accept: 'application/json' } })
          if (!response.ok) throw new Error(`The agent registry returned ${response.status}.`)
          if (Number(response.headers.get('content-length') ?? '0') > 2_000_000) throw new Error('The agent registry is too large.')
          const reader = response.body?.getReader()
          if (reader === undefined) throw new Error('The agent registry returned no content.')
          const chunks: Uint8Array[] = []
          let length = 0
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              length += chunk.value.byteLength
              if (length > 2_000_000) throw new Error('The agent registry is too large.')
              chunks.push(chunk.value)
            }
          } finally {
            await reader.cancel()
          }
          return registryIn(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
        }).pipe(Effect.timeout('30 seconds'))
        const next = new Map(profiles.map((profile) => [profile.id, profile]))
        for (const agent of remote) {
          const launch = registryCommand(agent)
          const profile = ACP_PROFILES.find((one) => one.id === agent.id)
          next.set(agent.id, {
            id: agent.id,
            name: agent.name,
            description: agent.description ?? '',
            version: agent.version,
            guide: agent.website ?? agent.repository ?? null,
            command: launch?.command ?? null,
            args: launch?.args ?? [],
            env: { ...('env' in (profile ?? {}) ? (profile as { env: Record<string, string> }).env : {}), ...launch?.env },
            modeOption: profile !== undefined && 'modeOption' in profile ? profile.modeOption : 'mode',
            mode: profile === undefined ? 'default' : profile.mode,
            readerMode: profile === undefined ? 'default' : profile.readerMode,
            source: 'registry',
          })
        }
        const updated = [...next.values()]
        yield* lock.withPermit(
          Effect.gen(function* () {
            const nextRevision = yield* sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                yield* sql`INSERT INTO settings ${sql.insert({ key: cachedKey, value: JSON.stringify(updated), updatedAt: at })}
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
                return yield* bump
              }),
            )
            revision = nextRevision
            items = updated
            problem = null
          }),
        )
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            problem = `${failure(cause)} The last available catalog is still shown.`
          }),
        ),
        Effect.ensuring(
          lock
            .withPermit(
              Effect.gen(function* () {
                refreshing = false
                revision = yield* bump
              }),
            )
            .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep the ACP catalog revision', cause))),
        ),
      )
      const write = <A, E>(effect: Effect.Effect<A, E>) =>
        lock
          .withPermit(effect)
          .pipe(Effect.mapError((error) => (error instanceof ApiError ? error : refused('The connection could not be saved. Try again.'))))
      return AgentCatalog.of({
        read: (again = false) =>
          Effect.gen(function* () {
            if (again && !refreshing) {
              refreshing = true
              yield* Effect.forkIn(refresh, scope)
            }
            return { items, connections: [...saved.values()], problem, refreshing, revision }
          }),
        save: (input) =>
          write(
            Effect.gen(function* () {
              if (agents.register === undefined) return yield* refused('This runtime does not support adding agents.')
              const connection = yield* Schema.decodeUnknownEffect(ConnectionSchema)(input).pipe(
                Effect.mapError(() => refused('Check the connection’s name, executable and arguments.')),
              )
              if (/\0/.test(connection.command) || connection.command.trim() !== connection.command)
                return yield* refused('Use the executable’s path without a shell command or surrounding spaces.')
              if (
                [connection.mode, connection.readerMode].some(
                  (mode) =>
                    mode !== null && /yolo|bypass|auto.?approve|auto.?edit|full.?access|always.?allow|unrestricted|brave/i.test(mode),
                )
              )
                return yield* refused('Choose modes that ask before commands and prevent a reader from editing.')
              if (saved.get(connection.id)?.state === 'checking')
                return yield* refused('Cancel the compatibility check before editing this connection.')
              yield* inactive(connection.id)
              const changed = yield* persist({ connection, state: 'unchecked', reason: null, version: null })
              agents.remove?.(connection.id)
              return changed
            }),
          ),
        check: (id) =>
          write(
            Effect.gen(function* () {
              const value = saved.get(id)
              if (value === undefined) return yield* refused('Save the connection before checking it.')
              if (value.state === 'checking') return revision
              yield* inactive(id)
              const checking = { ...value, state: 'checking' as const, reason: null, version: null }
              const changed = yield* persist(checking)
              agents.remove?.(id)
              const entry = entryOf(value.connection)
              const liveCheck = Effect.gen(function* () {
                const processId = yield* newId(Ids.process)
                const spec = entry.definition.launch(adapterNode())
                yield* sql`INSERT INTO processes ${sql.insert({ id: processId, deviceId: instance.deviceId, runtimeInstanceId: instance.id, purpose: 'probe', executable: spec.command, argsRedacted: redact(JSON.stringify(spec.args)), controllerGeneration: 1, state: 'launching', launchedAt: yield* timestamp })}`
                return yield* qualifyAcp(entry.definition, entry.transport, config.probeRoot, (process) =>
                  change('processes', processId, {
                    pid: process.pid,
                    processGroupId: process.pid,
                    osStartedAt: process.osStartedAt ?? null,
                    environmentDigest: process.environmentDigest,
                    state: 'running',
                  }).pipe(Effect.asVoid, Effect.provideService(SqlClient.SqlClient, sql)),
                ).pipe(
                  Effect.onExit((exit) =>
                    Effect.gen(function* () {
                      yield* change('processes', processId, {
                        state: Exit.isSuccess(exit) ? 'exited' : 'unknown',
                        endedAt: yield* timestamp,
                      })
                    }).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
                  ),
                )
              })
              const check = liveCheck.pipe(
                Effect.provideService(Crypto.Crypto, crypto),
                Effect.exit,
                Effect.flatMap((exit) =>
                  lock.withPermit(
                    Effect.gen(function* () {
                      if (saved.get(id) !== checking) return
                      const result = Exit.isSuccess(exit)
                        ? { ...checking, state: 'ready' as const, version: exit.value }
                        : { ...checking, state: 'failed' as const, reason: failure(exit.cause) }
                      yield* persist(result)
                      if (result.state === 'ready' && result.version !== null) agents.register?.(entryOf(value.connection, result.version))
                      running.delete(id)
                    }),
                  ),
                ),
                Effect.catchCause((cause) => Effect.logWarning('Could not keep an ACP compatibility result', cause)),
              )
              running.set(id, yield* Effect.forkIn(check, scope))
              return changed
            }),
          ),
        remove: (id) =>
          write(
            Effect.gen(function* () {
              if (!saved.has(id)) return revision
              yield* inactive(id)
              const next = yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM settings WHERE key = ${keyOf(instance.deviceId, id)}`
                  return yield* bump
                }),
              )
              revision = next
              saved.delete(id)
              agents.remove?.(id)
              const fiber = running.get(id)
              running.delete(id)
              if (fiber !== undefined) yield* Effect.forkIn(Fiber.interrupt(fiber), scope)
              return next
            }),
          ),
      })
    }),
  )
}

export const agentCatalogHandlers = AcpApi.toLayer(
  Effect.gen(function* () {
    const catalog = yield* AgentCatalog
    const recent = new Map<string, Deferred.Deferred<number, ApiError>>()
    const once = (id: string, work: Effect.Effect<number, ApiError>) =>
      Effect.suspend(() => {
        const seen = recent.get(id)
        if (seen !== undefined) return Deferred.await(seen)
        const result = Deferred.makeUnsafe<number, ApiError>()
        recent.set(id, result)
        const oldest = recent.keys().next().value
        if (recent.size > 1000 && oldest !== undefined) recent.delete(oldest)
        return Effect.onExit(work, (exit) =>
          Exit.hasInterrupts(exit) ? Effect.sync(() => recent.delete(id)) : Deferred.done(result, exit),
        )
      })
    return AcpApi.of({
      GetAgentCatalog: ({ refresh }) => catalog.read(refresh),
      SaveAcpConnection: ({ commandId, connection }) => once(commandId, catalog.save(connection)),
      CheckAcpConnection: ({ commandId, agentId }) => once(commandId, catalog.check(agentId)),
      RemoveAcpConnection: ({ commandId, agentId }) => once(commandId, catalog.remove(agentId)),
    })
  }),
)
