import { Ledger } from '@althar/persistence-sqlite'
import { Context, Duration, Effect, Layer, Option, PubSub, Schema, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from './Instance'
import { PlanParameters } from './Runs'
import { SignIns } from './SignIns'

/*
 * What anonymous usage data says happened (Linear DEV-76): a project made,
 * the first one too, an agent signed in, a task started and settled, an ask
 * answered, an agent's usage limit reached. The desktop app's main process
 * sends them, only while the person allows it, and keeps only what it names
 * (apps/desktop/src/main/usageData.ts). Each says as little as it can: a
 * count, a word from a short list, or an agent's or a model family's id;
 * never a name, a path, a title or anything written.
 *
 * Read from the record as it grows, the way the facts were recorded, so no
 * workflow says it itself; what was recorded before this launch is never
 * said. An agent signing in isn't recorded, so SignIns says it.
 */

/** How long new records are gathered, so a burst is read once. */
const GATHER = Duration.millis(500)

/** How long an account that reached its usage limit is taken as out where the agent gave no reset, so each time it is out is said once. */
const OUT = Duration.hours(1)

/** How a task settled. */
export type Settled = 'merged_here' | 'pull_request' | 'abandoned' | 'reviewed' | 'seen'

/** How long a task took, as a bucket. */
export type Took = 'under_10m' | '10m_to_1h' | '1h_to_1d' | 'over_1d'

export type UsageEvent =
  | { readonly name: 'project_made'; readonly properties: { readonly repositories: number } }
  /** The first project, made where there were none: the first screen's. */
  | { readonly name: 'first_screen_done'; readonly properties: { readonly repositories: number } }
  | { readonly name: 'agent_signed_in'; readonly properties: { readonly agent: string; readonly how: 'found' | 'signed_in' } }
  /** Planned, as a mini task the coordinator started at once, by writing to a lead with no plan, or as a review of a pull request. */
  | {
      readonly name: 'task_started'
      readonly properties: { readonly as: 'planned' | 'mini' | 'direct' | 'review'; readonly agent: string; readonly family: string }
    }
  /** Merged here, as its first pull request, abandoned, its review posted, or, a plain task, done once the person saw it. */
  | {
      readonly name: 'task_settled'
      readonly properties: { readonly as: Settled; readonly took: Took; readonly steps: number }
    }
  | {
      readonly name: 'ask_answered'
      readonly properties: { readonly ask: 'permission' | 'question' | 'stuck'; readonly by: 'person' | 'coordinator' }
    }
  | { readonly name: 'usage_limit_hit'; readonly properties: { readonly agent: string } }

/** The records usage data reads. */
const HEARD = [
  'project.opened',
  'run.admitted',
  'turn_delivery.delivered',
  'task.done',
  'task.abandoned',
  'external_link.change_opened',
  'attention_request.answered',
  'permission_request.judged',
  'account_status.limited',
] as const

/** Model families, as their ids name them; any other is `other`, so a model of someone's own is never named. */
const FAMILIES = [
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'gpt',
  'codex',
  'o3',
  'o4',
  'glm',
  'kimi',
  'qwen',
  'deepseek',
  'gemini',
  'grok',
  'llama',
  'mistral',
  'minimax',
] as const

/** A model's family by its id (`claude-opus-5`, `gpt-6-astra`, `opencode-go/glm-5.3`); `default` for the agent's own. */
export const familyOf = (model: string | null): string => {
  if (model === null || model === '' || model === 'default') return 'default'
  // Its name without the provider OpenCode puts before it.
  const words = model
    .toLowerCase()
    .replace(/^.*\//, '')
    .split(/[^a-z0-9]+/)
  return FAMILIES.find((family) => words.some((word) => word === family || word.startsWith(family))) ?? 'other'
}

/** How long, from `from` to `to`, as a bucket. */
export const tookBetween = (from: string, to: string): Took => {
  const minutes = (Date.parse(to) - Date.parse(from)) / 60_000
  return minutes < 10 ? 'under_10m' : minutes < 60 ? '10m_to_1h' : minutes < 24 * 60 ? '1h_to_1d' : 'over_1d'
}

/** A record's payload: every fact's is an object. */
const payloadOf = (payload: string) => JSON.parse(payload) as Readonly<Record<string, unknown>>

interface Heard {
  readonly sequence: number
  readonly type: (typeof HEARD)[number]
  readonly aggregateId: string
  readonly actorId: string
  readonly payload: string
  readonly occurredAt: string
}

export class UsageData extends Context.Service<
  UsageData,
  {
    /** Each usage event, as it happens from now on. */
    readonly events: Stream.Stream<UsageEvent>
  }
>()('@althar/runtime/UsageData') {
  static readonly layer: Layer.Layer<UsageData, never, SqlClient.SqlClient | Ledger | Instance | SignIns> = Layer.effect(
    UsageData,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ledger = yield* Ledger
      const instance = yield* Instance
      const signIns = yield* SignIns
      const published = yield* PubSub.unbounded<UsageEvent>()
      const decodePlan = Schema.decodeUnknownOption(Schema.fromJsonString(PlanParameters))

      /**
       * A task's settling, how long since it was made and how many steps its
       * runs took: once, the first way it settled (merged here, its first
       * pull request, abandoned, its review posted, done on sight), until it
       * is reopened.
       */
      const settled = (as: Settled, taskId: string, heard: Heard) =>
        Effect.map(
          sql<{ createdAt: string; steps: number }>`
            SELECT k.created_at, (SELECT count(*) FROM nodes n JOIN workflow_executions x ON x.id = n.execution_id
              JOIN runs r ON r.id = x.run_id WHERE r.task_id = k.id) AS steps
            FROM tasks k WHERE k.id = ${taskId} AND NOT EXISTS (
              SELECT 1 FROM record_events e LEFT JOIN external_links x ON x.id = e.aggregate_id
              WHERE e.project_id = k.project_id AND e.sequence < ${heard.sequence}
                AND e.sequence > coalesce((SELECT max(o.sequence) FROM record_events o WHERE o.aggregate_type = 'task'
                  AND o.aggregate_id = k.id AND o.type = 'task.reopened' AND o.sequence < ${heard.sequence}), 0)
                AND ((e.aggregate_type = 'task' AND e.aggregate_id = k.id
                    AND (e.type = 'task.abandoned' OR (e.type = 'task.done' AND (json_type(e.payload, '$.here') = 'array'
                      OR json_type(e.payload, '$.reviewed') = 'text' OR json_extract(e.payload, '$.seen') = 1))))
                  OR (e.type = 'external_link.change_opened' AND x.task_id = k.id)))`,
          (tasks) =>
            tasks.map(
              (task) =>
                ({
                  name: 'task_settled',
                  properties: { as, took: tookBetween(task.createdAt, heard.occurredAt), steps: task.steps },
                }) as const,
            ),
        )

      /** What a record says happened, as usage events: none for most. */
      const eventsOf = (heard: Heard): Effect.Effect<ReadonlyArray<UsageEvent>, unknown> =>
        Effect.gen(function* () {
          const payload = payloadOf(heard.payload)
          switch (heard.type) {
            case 'project.opened': {
              // The first project is made where there were none, as there are on the first screen.
              const projects = yield* sql<{ repositories: number; others: number }>`
                SELECT (SELECT count(*) FROM repository_bindings b WHERE b.project_id = p.id AND b.detached_at IS NULL) AS repositories,
                  (SELECT count(*) FROM projects o WHERE o.id <> p.id AND o.created_at <= p.created_at
                    AND (o.archived_at IS NULL OR o.archived_at > p.created_at)) AS others
                FROM projects p WHERE p.id = ${heard.aggregateId}`
              return projects.flatMap(({ repositories, others }) => [
                { name: 'project_made', properties: { repositories } } as const,
                ...(others === 0 ? [{ name: 'first_screen_done', properties: { repositories } } as const] : []),
              ])
            }
            case 'run.admitted': {
              // A round of a task that went back to work after it finished (ADR-034) isn't a task starting.
              if (payload.round === true) return []
              const runs = yield* sql<{ parameters: string; acceptedBy: string | null }>`
                SELECT r.parameters, (SELECT actor_id FROM record_events WHERE aggregate_type = 'task_plan' AND aggregate_id = r.plan_id
                  AND type = 'task_plan.accepted' ORDER BY sequence DESC LIMIT 1) AS accepted_by
                FROM runs r WHERE r.id = ${heard.aggregateId}`
              // Its lead: the plan's implement step. Only the coordinator's start_task accepts a plan as the coordinator: a mini task.
              return runs.flatMap((run) =>
                Option.toArray(decodePlan(run.parameters)).flatMap((plan) =>
                  plan.steps
                    .filter((step) => step.key === 'implement')
                    .slice(0, 1)
                    .map(
                      (lead) =>
                        ({
                          name: 'task_started',
                          properties: {
                            as: run.acceptedBy === instance.coordinatorId ? 'mini' : 'planned',
                            agent: lead.agentId,
                            family: familyOf(lead.model),
                          },
                        }) as const,
                    ),
                ),
              )
            }
            case 'turn_delivery.delivered': {
              // What was written reached a lead on a task's own thread, before any run, for the first time: the person started the
              // task by writing to it, or the lead of a review was told to start. Picking an agent alone starts a session, and says
              // nothing.
              const sessions = yield* sql<{ agentId: string; model: string | null; review: number; person: number }>`
                SELECT s.agent_id, d.model,
                  EXISTS (SELECT 1 FROM record_events c WHERE c.aggregate_type = 'task' AND c.aggregate_id = t.task_id
                    AND c.type = 'task.created' AND json_extract(c.payload, '$.reviews') IS NOT NULL) AS review,
                  EXISTS (SELECT 1 FROM turn_delivery_inputs i JOIN user_inputs u ON u.id = i.user_input_id
                    WHERE i.delivery_id = d.id AND u.author_actor_id = ${instance.personId}) AS person
                FROM turn_deliveries d
                JOIN threads t ON t.id = d.thread_id AND t.kind = 'task'
                JOIN provider_sessions s ON s.id = d.provider_session_id
                WHERE d.id = ${heard.aggregateId} AND NOT EXISTS (SELECT 1 FROM runs WHERE task_id = t.task_id)
                  AND EXISTS (SELECT 1 FROM turn_delivery_inputs i JOIN user_inputs u ON u.id = i.user_input_id
                    WHERE i.delivery_id = d.id AND u.author_actor_id IN (${instance.personId}, ${instance.coordinatorId}))
                  AND NOT EXISTS (SELECT 1 FROM record_events e JOIN turn_deliveries o ON o.id = e.aggregate_id
                    JOIN turn_delivery_inputs oi ON oi.delivery_id = o.id JOIN user_inputs ou ON ou.id = oi.user_input_id
                    WHERE e.type = 'turn_delivery.delivered' AND o.thread_id = d.thread_id
                      AND ou.author_actor_id IN (${instance.personId}, ${instance.coordinatorId}) AND e.sequence < ${heard.sequence})`
              return sessions.flatMap((session) =>
                session.review === 1 || session.person === 1
                  ? [
                      {
                        name: 'task_started',
                        properties: {
                          as: session.review === 1 ? 'review' : 'direct',
                          agent: session.agentId,
                          family: familyOf(session.model),
                        },
                      } as const,
                    ]
                  : [],
              )
            }
            case 'task.done':
              // Merged here, its review posted, or done on sight; one whose pull request merged on its host settled as that pull
              // request when it opened, and one a round left as it was (`back`) had settled already.
              return Array.isArray(payload.here)
                ? yield* settled('merged_here', heard.aggregateId, heard)
                : typeof payload.reviewed === 'string'
                  ? yield* settled('reviewed', heard.aggregateId, heard)
                  : payload.seen === true
                    ? yield* settled('seen', heard.aggregateId, heard)
                    : []
            case 'task.abandoned':
              return yield* settled('abandoned', heard.aggregateId, heard)
            case 'external_link.change_opened': {
              // A task's first pull request settles it; another of its repositories', or one taken up again, doesn't.
              const links = yield* sql<{ taskId: string }>`SELECT task_id FROM external_links WHERE id = ${heard.aggregateId}`
              return (yield* Effect.forEach(links, (link) => settled('pull_request', link.taskId, heard))).flat()
            }
            case 'attention_request.answered': {
              // By the person, or the coordinator; one the rules settled was answered by no one.
              const asks = yield* sql<{ kind: 'permission' | 'question' | 'stuck'; by: 'person' | 'coordinator' }>`
                SELECT kind, CASE ${heard.actorId} WHEN ${instance.personId} THEN 'person' ELSE 'coordinator' END AS by
                FROM attention_requests WHERE id = ${heard.aggregateId} AND kind IN ('permission', 'question', 'stuck')
                  AND ${heard.actorId} IN (${instance.personId}, ${instance.coordinatorId})`
              return asks.map((ask) => ({ name: 'ask_answered', properties: { ask: ask.kind, by: ask.by } }) as const)
            }
            case 'permission_request.judged':
              // The coordinator answered it in the person's place (ADR-019); one it didn't apply goes on to them.
              return payload.applied === true ? [{ name: 'ask_answered', properties: { ask: 'permission', by: 'coordinator' } }] : []
            case 'account_status.limited': {
              // Each time an account is out is said once: not again before the last time it was out ends, at its reset, or an
              // hour after where the agent gave none.
              const before = yield* sql<{ payload: string; occurredAt: string }>`
                SELECT payload, occurred_at FROM record_events WHERE type = 'account_status.limited'
                  AND json_extract(payload, '$.accountId') = ${String(payload.accountId)} AND sequence < ${heard.sequence}
                ORDER BY sequence DESC LIMIT 1`
              const outUntil = before.map((was) => {
                const resets = payloadOf(was.payload).resetsAt
                return typeof resets === 'string' ? Date.parse(resets) : Date.parse(was.occurredAt) + Duration.toMillis(OUT)
              })
              return outUntil.every((until) => Date.parse(heard.occurredAt) >= until)
                ? [{ name: 'usage_limit_hit', properties: { agent: String(payload.agentId) } }]
                : []
            }
          }
        })

      // The record is read as it grows, from where it stood as this launch began.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const grown = yield* ledger.listen
          const latest = Effect.map(sql<{ sequence: number }>`SELECT coalesce(max(sequence), 0) AS sequence FROM record_events`, (rows) =>
            Math.max(0, ...rows.map((row) => row.sequence)),
          )
          let cursor = yield* latest
          const round = Effect.gen(function* () {
            yield* grown
            yield* Effect.sleep(GATHER)
            const to = yield* latest
            const heard = yield* sql<Heard>`
              SELECT sequence, type, aggregate_id, actor_id, payload, occurred_at FROM record_events
              WHERE sequence > ${cursor} AND sequence <= ${to} AND type IN ${sql.in(HEARD)} ORDER BY sequence`
            cursor = to
            for (const one of heard) {
              const events = yield* eventsOf(one).pipe(
                Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what usage data says', cause), [])),
              )
              for (const event of events) yield* PubSub.publish(published, event)
            }
          })
          yield* Effect.forever(
            round.pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read the record for usage data', cause))),
          )
        }),
      )

      // An agent signing in is never recorded: SignIns says it.
      yield* Effect.forkScoped(
        Stream.runForEach(signIns.signedIn, ({ agentId, how }) =>
          PubSub.publish(published, { name: 'agent_signed_in', properties: { agent: agentId, how } }),
        ),
      )

      return UsageData.of({ events: Stream.fromPubSub(published) })
    }),
  )
}
