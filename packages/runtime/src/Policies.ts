import { type ActorId, Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { NotFound } from './errors'
import { Instance } from './Instance'
import { fact, timestamp } from './records'

/*
 * A project's rules (the glossary's project rules; docs/architecture/05):
 * what the person keeps for themselves, and what a usage limit does. Each
 * change is a new revision, recorded as a fact by whoever made it, and a run
 * cites the revision it ran under, so it can always say which way the
 * project was set.
 */

/** What a project does when an agent's account reaches its usage limit: move the work on to the next free agent, or wait for the reset. */
export type UsageLimit = 'move' | 'wait'

export const ProjectRules = Schema.Struct({
  source: Schema.String,
  /** What the rules always keep for the person. */
  alwaysAsk: Schema.Array(Schema.String),
  /** Without one, it moves on. */
  usageLimit: Schema.optional(Schema.Literals(['move', 'wait'])),
})
export type ProjectRules = typeof ProjectRules.Type

/** The MVP's rules, a project's first revision. */
const FIRST: ProjectRules = {
  source: 'mvp',
  alwaysAsk: ['push to the default branch', 'force push', 'merge', 'deploy', 'write outside the worktree'],
}

/** What a revision's rules say a usage limit does. */
export const usageLimitOf = (rules: ProjectRules): UsageLimit => rules.usageLimit ?? 'move'

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance

export class Policies extends Context.Service<
  Policies,
  {
    /** The project's rules now, by revision: its first, the MVP's, made when it has none. */
    current(
      projectId: ProjectId,
    ): Effect.Effect<{ readonly id: string; readonly rules: ProjectRules }, SqlError.SqlError | Schema.SchemaError>
    /** The rules a revision holds, as a run cites them. */
    rulesOf(policyId: string): Effect.Effect<ProjectRules, SqlError.SqlError | NotFound>
    /** A new revision of the project's rules, with what the person changed, recorded as theirs. */
    setUsageLimit(
      projectId: string,
      usageLimit: UsageLimit,
      actorId: ActorId,
    ): Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | NotFound>
  }
>()('@charrette/runtime/Policies') {
  static readonly layer: Layer.Layer<Policies, never, Store> = Layer.effect(
    Policies,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const decode = (rules: string) => Schema.decodeUnknownSync(Schema.fromJsonString(ProjectRules))(rules)

      const insert = (projectId: ProjectId, revision: number, rules: ProjectRules, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const id = yield* newId(Ids.policy)
          yield* sql`INSERT INTO policies ${sql.insert({
            id,
            projectId,
            revision,
            rules: JSON.stringify(rules),
            createdByActorId: actorId,
            createdAt: yield* timestamp,
          })}`
          yield* fact({
            projectId,
            aggregateType: 'policy',
            aggregateId: id,
            revision: 1,
            type: 'policy.revised',
            payload: { revision, rules },
            actorId,
          })
          return { id, rules }
        })

      const current = (projectId: ProjectId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [known] = yield* sql<{ id: string; rules: string }>`
            SELECT id, rules FROM policies WHERE project_id = ${projectId} ORDER BY revision DESC LIMIT 1`
          if (known !== undefined) return { id: known.id, rules: decode(known.rules) }
          return yield* insert(projectId, 1, FIRST, instance.systemId)
        })

      return Policies.of({
        current: (projectId) => provide(current(projectId)),
        rulesOf: (policyId) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [policy] = yield* sql<{ rules: string }>`SELECT rules FROM policies WHERE id = ${policyId}`
              if (policy === undefined) return yield* new NotFound({ kind: 'policy', id: policyId })
              return decode(policy.rules)
            }),
          ),
        setUsageLimit: (projectId, usageLimit, actorId) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
              if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
              const now = yield* current(project.id)
              if (usageLimitOf(now.rules) === usageLimit) return
              const [last] = yield* sql<{
                revision: number
              }>`SELECT max(revision) AS revision FROM policies WHERE project_id = ${projectId}`
              yield* sql.withTransaction(insert(project.id, (last?.revision ?? 0) + 1, { ...now.rules, usageLimit }, actorId))
            }),
          ),
      })
    }),
  )
}
