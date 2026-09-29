import type { ProjectSummary, TaskSummary, ThreadSnapshot } from '@charrette/contracts'
import { Context, Effect, Layer, Option, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents } from './Config'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { Sessions } from './Sessions'

/*
 * What screens show, read from the store (docs/architecture/02: queries
 * return projections shaped for screens, not tables). Read-only: nothing here
 * writes or starts anything.
 */

/** Session states in which a session is working on its thread. */
const LIVE = ['starting', 'active', 'waiting_approval', 'cancelling']

const parse = (json: string | null): unknown => {
  if (json === null) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

type Store = SqlClient.SqlClient | Instance | Agents | Sessions

export class Queries extends Context.Service<
  Queries,
  {
    projects: Effect.Effect<ReadonlyArray<ProjectSummary>, SqlError.SqlError>
    tasks(projectId: string): Effect.Effect<ReadonlyArray<TaskSummary>, SqlError.SqlError>
    task(taskId: string): Effect.Effect<TaskSummary, SqlError.SqlError | NotFound>
    thread(threadId: string): Effect.Effect<ThreadSnapshot, SqlError.SqlError | NotFound | Schema.SchemaError>
  }
>()('@charrette/runtime/Queries') {
  static readonly layer: Layer.Layer<Queries, never, Store> = Layer.effect(
    Queries,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const live = LIVE.map((state) => `'${state}'`).join(', ')

      const projects = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<ProjectSummary>`
          SELECT p.id, p.name, p.slug,
            (SELECT l.path FROM repository_bindings b JOIN repository_locations l ON l.binding_id = b.id
              WHERE b.project_id = p.id AND l.device_id = ${instance.deviceId} ORDER BY b.created_at LIMIT 1) AS repository,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS tasks,
            (SELECT count(*) FROM provider_sessions s WHERE s.project_id = p.id AND s.state IN (${sql.unsafe(live)})) AS running,
            (SELECT count(*) FROM attention_requests a WHERE a.project_id = p.id AND a.state = 'open') AS waiting
          FROM projects p WHERE p.archived_at IS NULL ORDER BY p.created_at DESC, p.id DESC`
      })

      const taskRows = (where: { readonly projectId?: string; readonly taskId?: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<TaskSummary>`
            SELECT k.id, k.project_id, k.title, k.slug, t.id AS thread_id, k.state, w.branch,
              (SELECT s.agent_id FROM provider_sessions s WHERE s.thread_id = t.id AND s.state IN (${sql.unsafe(live)})
                ORDER BY s.started_at DESC LIMIT 1) AS agent_id,
              (SELECT count(*) FROM attention_requests a WHERE a.task_id = k.id AND a.state = 'open') AS waiting,
              k.created_at
            FROM tasks k
            JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            LEFT JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId}
            WHERE ${where.taskId === undefined ? sql`k.project_id = ${where.projectId ?? ''}` : sql`k.id = ${where.taskId}`}
            ORDER BY k.created_at DESC, k.id DESC`
        })

      const thread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const agents = yield* Agents
          const [head] = yield* sql<{
            threadId: string
            projectId: string
            projectName: string
            taskId: string
            title: string
            description: string
            slug: string
            state: string
            branch: string | null
            worktree: string | null
            baseRef: string | null
          }>`
            SELECT t.id AS thread_id, p.id AS project_id, p.name AS project_name, k.id AS task_id, k.title, k.description, k.slug, k.state,
              w.branch, w.path AS worktree, w.base_ref
            FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = t.project_id
            LEFT JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId}
            WHERE t.id = ${threadId}`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })

          const [session] = yield* sql<{ id: string; agentId: string; state: string; model: string | null; config: string }>`
            SELECT id, agent_id, state, model, config FROM provider_sessions
            WHERE thread_id = ${threadId} AND state IN (${sql.unsafe(live)}) ORDER BY started_at DESC LIMIT 1`
          const running = yield* sessions.running(threadId)
          const definition = session === undefined ? undefined : Option.getOrUndefined(yield* Effect.option(agents.get(session.agentId)))
          const options = field(parse(session?.config ?? null), 'options')
          const modelOption = Array.isArray(options)
            ? options.find((option) => field(option, 'id') === definition?.definition.options.model)
            : undefined
          const values = field(modelOption, 'values')

          const items = yield* sql<{
            id: string
            sequence: number
            kind: string
            content: string
            agentId: string | null
            toolCallId: string | null
            inputState: 'queued' | 'delivered' | 'superseded' | null
            disposition: string | null
            createdAt: string
          }>`
            SELECT i.id, i.sequence, i.kind, i.content, s.agent_id, i.tool_call_id, u.state AS input_state, u.disposition, i.created_at
            FROM thread_items i
            LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            LEFT JOIN user_inputs u ON u.id = i.user_input_id
            WHERE i.thread_id = ${threadId} ORDER BY i.sequence`
          const attention = yield* sql<{ id: string; payload: string; createdAt: string }>`
            SELECT id, payload, created_at FROM attention_requests WHERE task_id = ${head.taskId} AND state = 'open' ORDER BY created_at`
          const turns = yield* sql<{ id: string; state: string; errorClass: string | null; requestedAt: string; endedAt: string | null }>`
            SELECT id, state, error_class, requested_at, ended_at FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, id`

          return {
            threadId,
            project: { id: head.projectId, name: head.projectName },
            task: {
              id: head.taskId,
              title: head.title,
              description: head.description,
              slug: head.slug,
              state: head.state,
              branch: head.branch,
              worktree: head.worktree,
              baseRef: head.baseRef,
            },
            session:
              session === undefined
                ? null
                : {
                    id: session.id,
                    agentId: session.agentId,
                    agentName: definition?.definition.name ?? session.agentId,
                    state: session.state,
                    model: session.model,
                    models: Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [],
                    turnRunning: Option.isSome(running) && running.value.sessionId === session.id && running.value.turnRunning,
                  },
            items: items.map(({ inputState, disposition, ...item }) => ({
              ...item,
              kind: item.kind as ThreadSnapshot['items'][number]['kind'],
              content: parse(item.content),
              input: inputState === null ? null : { state: inputState, interrupting: disposition === 'interrupt_and_continue' },
            })),
            attention: attention.map((request) => {
              const payload = parse(request.payload)
              const text = (key: string) => {
                const value = field(payload, key)
                return typeof value === 'string' ? value : null
              }
              return {
                id: request.id,
                title: text('title') ?? '',
                reason: text('reason') ?? '',
                command: text('command'),
                createdAt: request.createdAt,
              }
            }),
            turns,
          } satisfies ThreadSnapshot
        })

      return Queries.of({
        projects: run(projects),
        tasks: (projectId) => run(taskRows({ projectId })),
        task: (taskId) =>
          run(
            Effect.flatMap(taskRows({ taskId }), ([row]) =>
              row === undefined ? Effect.fail(new NotFound({ kind: 'task', id: taskId })) : Effect.succeed(row),
            ),
          ),
        thread: (threadId) => run(thread(threadId)),
      })
    }),
  )
}
