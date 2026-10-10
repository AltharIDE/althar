import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { NotFound } from './errors'
import { Instance } from './Instance'
import { fact, timestamp } from './records'
import { type AlwaysRule, type ProjectRuleSet, type RuleId, RULES } from './rules'

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
  /** The kinds let through without asking, by id (ADR-017): what Allow always kept by kind. */
  alwaysAllow: Schema.optional(Schema.Array(Schema.String)),
  /** Commands the person named, by how they start or exactly: asked about, refused, or let through (ADR-017). */
  commands: Schema.optional(
    Schema.Array(
      Schema.Struct({
        pattern: Schema.String,
        decision: Schema.Literals(['ask', 'never', 'allow']),
        /** By the whole line; by how it starts without it. */
        match: Schema.optional(Schema.Literals(['prefix', 'exact'])),
      }),
    ),
  ),
  /** How a task ends when its plan doesn't say: a draft pull request, one ready for review, or its branch alone. */
  end: Schema.optional(Schema.Literals(['draft', 'ready', 'none'])),
  /**
   * How a task's branch and its pull request's title are named, by a pattern
   * (`@althar/contracts`' names): the person's own, over what each
   * repository's docs say. Without one, the docs', else Althar's own.
   */
  branchPattern: Schema.optional(Schema.String),
  titlePattern: Schema.optional(Schema.String),
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
  allow: (rules.alwaysAllow ?? []).filter(isRule),
  commands: rules.commands ?? [],
})

/** A rule an "always" answer keeps (ADR-017): a kind, or a command by how it starts or exactly, let through or never allowed. */
export type Remembered = AlwaysRule

/**
 * The rules with one kept: a never in place of an allow for the same words,
 * an allow only where nothing is kept for them, and a kind on its list (a
 * never takes it off the allowed).
 */
export const withRemembered = (rules: ProjectRules, rule: Remembered): ProjectRules => {
  if ('kind' in rule) {
    const allow = rules.alwaysAllow ?? []
    const never = rules.never ?? []
    return rule.decision === 'allow'
      ? { ...rules, alwaysAllow: allow.includes(rule.kind) ? allow : [...allow, rule.kind] }
      : {
          ...rules,
          never: never.includes(rule.kind) ? never : [...never, rule.kind],
          alwaysAllow: allow.filter((kind) => kind !== rule.kind),
        }
  }
  const same = (each: NonNullable<ProjectRules['commands']>[number]) =>
    each.pattern === rule.pattern && (each.match ?? 'prefix') === rule.match
  // Kept already; or an allow over the same words that always ask or are never allowed, which a card can't loosen.
  if ((rules.commands ?? []).some((each) => same(each) && (each.decision === rule.decision || rule.decision === 'allow'))) return rules
  return {
    ...rules,
    commands: [
      ...(rules.commands ?? []).filter((each) => !same(each)),
      { pattern: rule.pattern, decision: rule.decision, ...(rule.match === 'exact' ? { match: 'exact' as const } : {}) },
    ],
  }
}

/** What of a project's rules can be taken back with null: to deciding by the code host, or to what the repositories say. */
type Clearable = 'end' | 'branchPattern' | 'titlePattern'
const CLEARABLE: ReadonlyArray<Clearable> = ['end', 'branchPattern', 'titlePattern']

/** What the person may change of a project's rules, at once; null takes back what can be. */
export type RulesChange = { readonly [Key in keyof Omit<ProjectRules, 'source' | Clearable>]?: ProjectRules[Key] | undefined } & {
  readonly [Key in Clearable]?: ProjectRules[Key] | null | undefined
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
    /** A new revision of the project's rules with a rule an "always" answer keeps, recorded as whoever answered: none where it holds already. */
    remember(projectId: string, rule: Remembered, actorId: ActorId): Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | NotFound>
    /** A new revision of the project's rules for agents' accounts, recorded as the person's. */
    setAccounts(
      projectId: string,
      accounts: AccountRule,
      actorId: ActorId,
    ): Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | NotFound>
  }
>()('@althar/runtime/Policies') {
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
          const latest = Effect.map(
            sql<{ id: string; rules: string }>`
              SELECT id, rules FROM policies WHERE project_id = ${projectId} ORDER BY revision DESC LIMIT 1`,
            ([row]) => (row === undefined ? undefined : { id: row.id, rules: decode(row.rules) }),
          )
          const known = yield* latest
          if (known !== undefined) return known
          // The first revision, once: read again in the transaction, so readers at the same moment make one between them.
          return yield* sql.withTransaction(
            Effect.flatMap(latest, (again) =>
              again === undefined ? insert(projectId, 1, FIRST, instance.systemId) : Effect.succeed(again),
            ),
          )
        })

      /** A new revision of the project's rules, where the change makes one: none for what it says already. */
      // Read, changed and written together, so two changes made at once each build on the other.
      const revise = (projectId: string, actorId: ActorId, change: (rules: ProjectRules) => ProjectRules | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
              if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
              const now = yield* current(project.id)
              const next = change(now.rules)
              if (next === undefined) return
              const [last] = yield* sql<{
                revision: number
              }>`SELECT max(revision) AS revision FROM policies WHERE project_id = ${projectId}`
              yield* insert(project.id, (last?.revision ?? 0) + 1, next, actorId)
            }),
          )
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
              // A rule by how a command starts reads its words; an exact one keeps the line as it is, quotes and all.
              const commands = change.commands?.flatMap((rule) => {
                const exact = rule.match === 'exact'
                const pattern = exact ? rule.pattern.trim() : rule.pattern.trim().replace(/\s+/g, ' ')
                return pattern === '' ? [] : [{ pattern, decision: rule.decision, ...(exact ? { match: 'exact' as const } : {}) }]
              })
              let next: ProjectRules | undefined
              // What isn't given stays as it is; what can be taken back goes with null.
              const rest = Object.fromEntries(
                Object.entries(change).filter(([key, value]) => value !== undefined && !CLEARABLE.includes(key as Clearable)),
              ) as Partial<ProjectRules>
              yield* revise(projectId, actorId, (rules) => {
                const kept: Record<string, unknown> = { ...rules }
                for (const key of CLEARABLE) {
                  const value = change[key]
                  if (value === null || (typeof value === 'string' && value.trim() === '')) delete kept[key]
                  else if (value !== undefined) kept[key] = value.trim()
                }
                const changed: ProjectRules = {
                  ...(kept as ProjectRules),
                  ...rest,
                  ...(commands === undefined ? {} : { commands }),
                  source: 'person',
                }
                next = changed
                const same = (rule: ProjectRules) => JSON.stringify({ ...rule, source: '' })
                return same(changed) === same(rules) ? undefined : changed
              })
              return next ?? (yield* current(projectId as ProjectId)).rules
            }),
          ),
        remember: (projectId, rule, actorId) =>
          provide(
            revise(projectId, actorId, (rules) => {
              const next = withRemembered(rules, rule)
              return JSON.stringify(next) === JSON.stringify(rules) ? undefined : { ...next, source: 'person' }
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
