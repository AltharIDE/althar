import { type ActorId, Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { NotFound } from './errors'
import { Instance } from './Instance'
import { fact, timestamp } from './records'
import { type ProjectRuleSet, type RuleId, RULES } from './rules'

/*
 * A project's rules (the glossary's project rules; docs/architecture/05,
 * ADR-013): who answers agents' requests and what the person keeps for
 * themselves, how a task ends, what a usage limit does, and the agents'
 * accounts. Each change is a new revision, recorded as a fact by whoever
 * made it, and a run cites the revision it ran under, so it can always say
 * which way the project was set.
 */

/** What a project does when an agent's account reaches its usage limit: move the work on to the next free agent, or wait for the reset. */
export type UsageLimit = 'move' | 'wait'

export const ProjectRules = Schema.Struct({
  source: Schema.String,
  /** What happens to what no rule keeps (rules.ts): allowed, asked about, or everything allowed. Allowed without it. */
  permissions: Schema.optional(Schema.Literals(['rules', 'ask', 'allow'])),
  /** The kinds of request that always ask the person, by id (rules.ts). The MVP's first revisions held them in words, which read as every kind. */
  alwaysAsk: Schema.Array(Schema.String),
  /** The kinds refused outright, by id. */
  never: Schema.optional(Schema.Array(Schema.String)),
  /** Commands the person named, by how they start: asked about, or refused. */
  commands: Schema.optional(Schema.Array(Schema.Struct({ pattern: Schema.String, decision: Schema.Literals(['ask', 'never']) }))),
  /** How a task ends when its plan doesn't say: a draft pull request, one ready for review, or its branch alone. */
  end: Schema.optional(Schema.Literals(['draft', 'ready', 'none'])),
  /** Without one, it moves on. */
  usageLimit: Schema.optional(Schema.Literals(['move', 'wait'])),
  /**
   * An agent's accounts here (ADR-012): whether work moves on to the agent's
   * next account when one runs out, which the person turns on (off without
   * it), and which accounts each agent may use, by agent (every one without).
   */
  accounts: Schema.optional(
    Schema.Struct({
      rotate: Schema.Boolean,
      only: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
  ),
})
export type ProjectRules = typeof ProjectRules.Type

/** The MVP's rules, a project's first revision: every kind asks, the rest is allowed. */
const FIRST: ProjectRules = { source: 'mvp', alwaysAsk: [...RULES] }

const isRule = (id: string): id is RuleId => (RULES as ReadonlyArray<string>).includes(id)

/** A revision's rules as the rules read them; one the MVP wrote in words asks about every kind, as the MVP did. */
export const ruleSetOf = (rules: ProjectRules): ProjectRuleSet => ({
  mode: rules.permissions ?? 'rules',
  ask: rules.alwaysAsk.every(isRule) ? rules.alwaysAsk.filter(isRule) : RULES,
  never: (rules.never ?? []).filter(isRule),
  commands: rules.commands ?? [],
})

/** What the person may change of a project's rules, at once; an end of null goes back to deciding by the code host. */
export type RulesChange = { readonly [Key in keyof Omit<ProjectRules, 'source' | 'end'>]?: ProjectRules[Key] | undefined } & {
  readonly end?: ProjectRules['end'] | null | undefined
}

/** What a revision's rules say a usage limit does. */
export const usageLimitOf = (rules: ProjectRules): UsageLimit => rules.usageLimit ?? 'move'

/** The project's rule for an agent's accounts: rotation, off unless the person turned it on, and the accounts it may use. */
export type AccountRule = NonNullable<ProjectRules['accounts']>

/** What a revision's rules say of accounts: no rotation, and every account, unless the person said otherwise. */
export const accountsOf = (rules: ProjectRules): AccountRule => rules.accounts ?? { rotate: false }

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
    /** A new revision of the project's rules with what the person changed, recorded as theirs: none where nothing changed. */
    set(
      projectId: string,
      change: RulesChange,
      actorId: ActorId,
    ): Effect.Effect<ProjectRules, SqlError.SqlError | Schema.SchemaError | NotFound>
    /** A new revision of the project's rules for agents' accounts, recorded as the person's. */
    setAccounts(
      projectId: string,
      accounts: AccountRule,
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

      /** A new revision of the project's rules, where the change makes one: none for what it says already. */
      const revise = (projectId: string, actorId: ActorId, change: (rules: ProjectRules) => ProjectRules | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
          const now = yield* current(project.id)
          const next = change(now.rules)
          if (next === undefined) return
          const [last] = yield* sql<{
            revision: number
          }>`SELECT max(revision) AS revision FROM policies WHERE project_id = ${projectId}`
          yield* sql.withTransaction(insert(project.id, (last?.revision ?? 0) + 1, next, actorId))
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
          provide(revise(projectId, actorId, (rules) => (usageLimitOf(rules) === usageLimit ? undefined : { ...rules, usageLimit }))),
        set: (projectId, change, actorId) =>
          provide(
            Effect.gen(function* () {
              const commands = change.commands?.flatMap((rule) => {
                const pattern = rule.pattern.trim().replace(/\s+/g, ' ')
                return pattern === '' ? [] : [{ pattern, decision: rule.decision }]
              })
              let next: ProjectRules | undefined
              const { end, ...given } = change
              // What isn't given stays as it is.
              const rest = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) as Partial<ProjectRules>
              yield* revise(projectId, actorId, (rules) => {
                const { end: before, ...kept } = rules
                const ending = end === undefined ? before : (end ?? undefined)
                const changed: ProjectRules = {
                  ...kept,
                  ...rest,
                  ...(commands === undefined ? {} : { commands }),
                  ...(ending === undefined ? {} : { end: ending }),
                  source: 'person',
                }
                next = changed
                const same = (rule: ProjectRules) => JSON.stringify({ ...rule, source: '' })
                return same(changed) === same(rules) ? undefined : changed
              })
              return next ?? (yield* current(projectId as ProjectId)).rules
            }),
          ),
        setAccounts: (projectId, accounts, actorId) =>
          provide(
            revise(projectId, actorId, (rules) =>
              JSON.stringify(accountsOf(rules)) === JSON.stringify(accounts) ? undefined : { ...rules, accounts },
            ),
          ),
      })
    }),
  )
}
