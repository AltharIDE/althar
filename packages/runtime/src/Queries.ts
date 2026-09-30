import {
  type CoordinatorSnapshot,
  PAGE,
  type TaskPhase,
  type ProjectList,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
} from '@charrette/contracts'
import { Context, Effect, Layer, Option } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents } from './Config'
import { Coordinator } from './Coordinator'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { commandIn } from './rules'
import { Sessions } from './Sessions'

/*
 * What screens show, read from the store (docs/architecture/02: queries
 * return projections shaped for screens, not tables). Read-only: nothing here
 * writes or starts anything.
 *
 * Each read says the change-feed cursor it read at, taken before the rows: a
 * client that watches from there sees every change after, and at worst one
 * it already has.
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

const text = (value: unknown, key: string): string => {
  const found = field(value, key)
  return typeof found === 'string' ? found : ''
}

interface ItemRow {
  readonly id: string
  readonly sequence: number
  readonly kind: string
  readonly content: string
  readonly agentId: string | null
  readonly inputState: 'queued' | 'delivered' | 'superseded' | null
  readonly disposition: string | null
  /** For a tool call that asked: what was decided, last. */
  readonly decision: string | null
  readonly createdAt: string
}

/**
 * A stored item as the contract has it: each kind with its own content. A
 * tool call keeps what a screen shows (the command it runs and the files it
 * touches), not its raw input and output. Kinds the contract doesn't have yet,
 * such as a step's result, are left out.
 */
export const itemOf = (row: ItemRow): ThreadItem | undefined => {
  const content = parse(row.content)
  const base = { id: row.id, sequence: row.sequence, agentId: row.agentId, createdAt: row.createdAt }
  switch (row.kind) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        content: { text: text(content, 'text') },
        input: row.inputState === null ? null : { state: row.inputState, interrupting: row.disposition === 'interrupt_and_continue' },
      }
    case 'agent_message':
    case 'agent_thought':
      return { ...base, kind: row.kind, content: { text: text(content, 'text') } }
    case 'tool_call': {
      const locations = field(content, 'locations')
      return {
        ...base,
        kind: 'tool_call',
        content: {
          title: text(content, 'title'),
          toolKind: text(content, 'kind') || 'other',
          status: text(content, 'status') || 'pending',
          command: commandIn(field(content, 'rawInput')) ?? null,
          locations: (Array.isArray(locations) ? locations : []).flatMap((location) => {
            const path = text(location, 'path')
            const line = field(location, 'line')
            return path === '' ? [] : [{ path, ...(typeof line === 'number' ? { line } : {}) }]
          }),
          declined: row.decision === 'reject',
        },
      }
    }
    case 'plan': {
      const entries = field(content, 'entries')
      return {
        ...base,
        kind: 'plan',
        content: {
          entries: (Array.isArray(entries) ? entries : []).map((entry) => ({
            content: text(entry, 'content'),
            status: text(entry, 'status'),
          })),
        },
      }
    }
    case 'notice': {
      const severity = text(content, 'severity')
      const description = text(content, 'description')
      return {
        ...base,
        kind: 'notice',
        content: {
          source: text(content, 'source') === 'runtime' ? 'runtime' : 'agent',
          severity: severity === 'error' || severity === 'warning' ? severity : 'info',
          title: text(content, 'title'),
          description: description === '' ? null : description,
        },
      }
    }
    case 'step_result': {
      const step = text(content, 'step')
      const verdict = text(content, 'verdict')
      const findings = field(content, 'findings')
      const round = field(content, 'round')
      const agentId = text(content, 'agentId')
      return {
        ...base,
        kind: 'step_result',
        content: {
          step: step === 'review' || step === 'settle' ? step : 'implement',
          round: typeof round === 'number' ? round : 0,
          summary: text(content, 'summary'),
          verdict: verdict === 'pass' || verdict === 'changes_requested' ? verdict : null,
          findings: (Array.isArray(findings) ? findings : []).map((finding) => {
            const severity = text(finding, 'severity')
            const line = field(finding, 'line')
            return {
              severity: severity === 'blocking' || severity === 'major' || severity === 'nit' ? severity : 'minor',
              file: text(finding, 'file') || null,
              line: typeof line === 'number' ? line : null,
              claim: text(finding, 'claim'),
            }
          }),
          agentId: agentId === '' ? null : agentId,
        },
      }
    }
    default:
      return undefined
  }
}

/** A change from the store's feed, with the thread it belongs to, when it belongs to one. */
export interface ThreadChange {
  readonly cursor: number
  readonly aggregateType: string
  readonly aggregateId: string
  readonly projectId: string | null
  readonly threadId: string | null
}

type Store = SqlClient.SqlClient | Instance | Agents | Sessions | Coordinator

export class Queries extends Context.Service<
  Queries,
  {
    projects: Effect.Effect<ProjectList, SqlError.SqlError>
    tasks(projectId: string): Effect.Effect<TaskList, SqlError.SqlError>
    task(taskId: string): Effect.Effect<TaskSummary, SqlError.SqlError | NotFound>
    /** The thread, with the newest `limit` items before `before`. */
    thread(
      threadId: string,
      page?: { readonly before?: number; readonly limit?: number },
    ): Effect.Effect<ThreadSnapshot, SqlError.SqlError | NotFound>
    item(threadId: string, itemId: string): Effect.Effect<ThreadItem, SqlError.SqlError | NotFound>
    /** The project's coordinator thread, with the newest `limit` items before `before`. */
    coordinator(
      projectId: string,
      page?: { readonly before?: number; readonly limit?: number },
    ): Effect.Effect<CoordinatorSnapshot, unknown>
    /** Changes after `cursor`, oldest first, each with its thread. */
    changesSince(cursor: number, limit: number): Effect.Effect<ReadonlyArray<ThreadChange>, SqlError.SqlError>
    /** The newest cursor in the feed. */
    readonly cursor: Effect.Effect<number, SqlError.SqlError>
  }
>()('@charrette/runtime/Queries') {
  static readonly layer: Layer.Layer<Queries, never, Store> = Layer.effect(
    Queries,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const live = LIVE.map((state) => `'${state}'`).join(', ')

      const cursor = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [latest] = yield* sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`
        return latest?.cursor ?? 0
      })

      const projects = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = yield* cursor
        const rows = yield* sql<ProjectList['projects'][number]>`
          SELECT p.id, p.name, p.slug,
            (SELECT l.path FROM repository_bindings b JOIN repository_locations l ON l.binding_id = b.id
              WHERE b.project_id = p.id AND l.device_id = ${instance.deviceId} ORDER BY b.created_at LIMIT 1) AS repository,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS tasks,
            (SELECT count(*) FROM provider_sessions s WHERE s.project_id = p.id AND s.state IN (${sql.unsafe(live)})) AS running,
            (SELECT count(*) FROM attention_requests a WHERE a.project_id = p.id AND a.state = 'open') AS waiting
          FROM projects p WHERE p.archived_at IS NULL ORDER BY p.created_at DESC, p.id DESC`
        return { cursor: at, projects: rows }
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

      const itemRows = (threadId: string, where: { readonly before?: number; readonly itemId?: string; readonly limit: number }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<ItemRow>`
            SELECT i.id, i.sequence, i.kind, i.content, s.agent_id, u.state AS input_state, u.disposition, i.created_at,
              (SELECT d.outcome FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS decision
            FROM thread_items i
            LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            LEFT JOIN user_inputs u ON u.id = i.user_input_id
            WHERE i.thread_id = ${threadId}
              AND ${where.itemId === undefined ? sql`1 = 1` : sql`i.id = ${where.itemId}`}
              AND ${where.before === undefined ? sql`1 = 1` : sql`i.sequence < ${where.before}`}
            ORDER BY i.sequence DESC LIMIT ${where.limit + 1}`
          // One more than asked for says whether there are earlier ones.
          return { items: rows.slice(0, where.limit).toReversed(), earlier: rows.length > where.limit }
        })

      /** The session working on a thread now, as a screen shows it. */
      const sessionOf = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const agents = yield* Agents
          const [session] = yield* sql<{ id: string; agentId: string; state: string; model: string | null; config: string }>`
            SELECT id, agent_id, state, model, config FROM provider_sessions
            WHERE thread_id = ${threadId} AND state IN (${sql.unsafe(live)}) ORDER BY started_at DESC LIMIT 1`
          if (session === undefined) return null
          const running = yield* sessions.running(threadId)
          const definition = Option.getOrUndefined(yield* Effect.option(agents.get(session.agentId)))
          const options = field(parse(session.config), 'options')
          const modelOption = Array.isArray(options)
            ? options.find((option) => field(option, 'id') === definition?.definition.options.model)
            : undefined
          const values = field(modelOption, 'values')
          return {
            id: session.id,
            agentId: session.agentId,
            agentName: definition?.definition.name ?? session.agentId,
            state: session.state,
            model: session.model,
            models: Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [],
            turnRunning: Option.isSome(running) && running.value.sessionId === session.id && running.value.turnRunning,
          }
        })

      /**
       * A task's card in the coordinator's thread: where it stands, worked out
       * from its plan, its run, the calls waiting and the agents working.
       */
      const cardOf = (row: ItemRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const taskId = text(parse(row.content), 'taskId')
          const [task] = yield* sql<{
            threadId: string
            title: string
            slug: string
            state: string
            branch: string | null
            planId: string | null
            planState: string | null
            parameters: string | null
            startsAt: string | null
            runState: string | null
            runAt: string | null
            step: string | null
            waiting: number
            review: string | null
          }>`
            SELECT t.id AS thread_id, k.title, k.slug, k.state, w.branch,
              p.id AS plan_id, p.state AS plan_state, p.parameters, p.starts_at,
              r.state AS run_state, r.created_at AS run_at,
              (SELECT n.node_key FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state IN ('admitted', 'running') ORDER BY a.admitted_at DESC LIMIT 1) AS step,
              (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') AS waiting,
              (SELECT s.id FROM threads s WHERE s.task_id = k.id AND s.kind = 'step' LIMIT 1) AS review
            FROM tasks k
            JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            LEFT JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId}
            LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
            LEFT JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
            WHERE k.id = ${taskId}`
          if (task === undefined) return undefined
          const [latest] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
          const working =
            Option.isSome(yield* sessions.running(task.threadId)) ||
            (task.review !== null && Option.isSome(yield* sessions.running(task.review)))
          const phase = ((): TaskPhase => {
            if (task.state === 'done' || task.state === 'abandoned') return 'settled'
            if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
            if (task.runState === 'succeeded') return 'ready'
            if (task.runState !== null && task.runState !== 'running') return 'stopped'
            if (task.waiting > 0) return 'waiting'
            return working ? 'running' : 'stopped'
          })()
          const parameters = parse(task.parameters)
          const steps = field(parameters, 'steps')
          return {
            id: row.id,
            sequence: row.sequence,
            agentId: null,
            createdAt: row.createdAt,
            kind: 'task',
            content: {
              taskId,
              threadId: task.threadId,
              title: task.title,
              slug: task.slug,
              phase,
              plan:
                task.planId === null
                  ? null
                  : {
                      id: task.planId,
                      steps: (Array.isArray(steps) ? steps : []).map((step) => {
                        const model = field(step, 'model')
                        return {
                          key: text(step, 'key') === 'review' ? 'review' : 'implement',
                          agentId: text(step, 'agentId'),
                          model: typeof model === 'string' ? model : null,
                          skipped: field(step, 'skipped') === true,
                        }
                      }),
                      startsAt: task.planState === 'proposed' ? task.startsAt : null,
                      reason: text(parameters, 'reason') || null,
                    },
              step: task.step,
              summary: latest === undefined ? null : text(parse(latest.content), 'summary') || null,
              branch: task.branch,
              startedAt: task.runAt,
            },
          } satisfies ThreadItem
        })

      /** A page of a thread's items, as screens show them. */
      const pageOf = (threadId: string, page: { readonly before?: number; readonly limit?: number }) =>
        Effect.gen(function* () {
          const { items, earlier } = yield* itemRows(threadId, {
            ...(page.before === undefined ? {} : { before: page.before }),
            limit: page.limit ?? PAGE,
          })
          const shown = yield* Effect.forEach(items, (row) => (row.kind === 'task' ? cardOf(row) : Effect.succeed(itemOf(row))))
          return { items: shown.flatMap((item) => (item === undefined ? [] : [item])), earlier }
        })

      const thread = (threadId: string, page: { readonly before?: number; readonly limit?: number } = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* cursor
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
            WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })
          const { items, earlier } = yield* pageOf(threadId, page)
          const attention = yield* sql<{ id: string; payload: string; createdAt: string }>`
            SELECT id, payload, created_at FROM attention_requests WHERE task_id = ${head.taskId} AND state = 'open' ORDER BY created_at`
          return {
            threadId,
            cursor: at,
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
            session: yield* sessionOf(threadId),
            attention: attention.map((request) => {
              const payload = parse(request.payload)
              return {
                id: request.id,
                title: text(payload, 'title'),
                reason: text(payload, 'reason'),
                command: text(payload, 'command') || null,
                createdAt: request.createdAt,
              }
            }),
            items,
            earlier,
          } satisfies ThreadSnapshot
        })

      /** The project's coordinator thread: the agent on it, the one it would start on, and a page of its items. */
      const coordinator = (projectId: string, page: { readonly before?: number; readonly limit?: number } = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const coordinators = yield* Coordinator
          const at = yield* cursor
          const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
          const threadId = yield* coordinators.thread(projectId)
          const { items, earlier } = yield* pageOf(threadId, page)
          return {
            threadId,
            cursor: at,
            project: { id: projectId, name: project.name },
            session: yield* sessionOf(threadId),
            suggested: yield* coordinators.suggested(projectId),
            items,
            earlier,
          } satisfies CoordinatorSnapshot
        })

      const item = (threadId: string, itemId: string) =>
        Effect.gen(function* () {
          const { items } = yield* itemRows(threadId, { itemId, limit: 1 })
          const row = items[0]
          const found = row === undefined ? undefined : row.kind === 'task' ? yield* cardOf(row) : itemOf(row)
          return found === undefined ? yield* new NotFound({ kind: 'thread item', id: itemId }) : found
        })

      const changesSince = (after: number, limit: number) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<ThreadChange>`
            SELECT c.cursor, c.aggregate_type, c.aggregate_id, c.project_id,
              CASE c.aggregate_type
                WHEN 'thread_item' THEN (SELECT thread_id FROM thread_items WHERE id = c.aggregate_id)
                WHEN 'turn_delivery' THEN (SELECT thread_id FROM turn_deliveries WHERE id = c.aggregate_id)
                WHEN 'provider_session' THEN (SELECT thread_id FROM provider_sessions WHERE id = c.aggregate_id)
                WHEN 'user_input' THEN (SELECT thread_id FROM user_inputs WHERE id = c.aggregate_id)
                WHEN 'permission_request' THEN (SELECT s.thread_id FROM permission_requests r
                  JOIN provider_sessions s ON s.id = r.provider_session_id WHERE r.id = c.aggregate_id)
                WHEN 'attention_request' THEN (SELECT t.id FROM attention_requests a
                  JOIN threads t ON t.task_id = a.task_id AND t.kind = 'task' WHERE a.id = c.aggregate_id)
                WHEN 'workspace' THEN (SELECT t.id FROM workspaces w
                  JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task' WHERE w.id = c.aggregate_id)
                WHEN 'task' THEN (SELECT id FROM threads WHERE task_id = c.aggregate_id AND kind = 'task')
              END AS thread_id
            FROM change_log c WHERE c.cursor > ${after} ORDER BY c.cursor LIMIT ${limit}`
        })

      return Queries.of({
        projects: run(projects),
        tasks: (projectId) =>
          run(
            Effect.gen(function* () {
              const at = yield* cursor
              return { cursor: at, tasks: yield* taskRows({ projectId }) }
            }),
          ),
        task: (taskId) =>
          run(
            Effect.flatMap(taskRows({ taskId }), ([row]) =>
              row === undefined ? Effect.fail(new NotFound({ kind: 'task', id: taskId })) : Effect.succeed(row),
            ),
          ),
        thread: (threadId, page) => run(thread(threadId, page)),
        item: (threadId, itemId) => run(item(threadId, itemId)),
        coordinator: (projectId, page) => run(coordinator(projectId, page)),
        changesSince: (after, limit) => run(changesSince(after, limit)),
        cursor: run(cursor),
      })
    }),
  )
}
