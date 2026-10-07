import { existsSync } from 'node:fs'

import {
  type BoardSnapshot,
  type ChangeSummary,
  ChecksSummary,
  type CoordinatorSnapshot,
  type HomeEvent,
  type HomeSnapshot,
  type IssueSummary,
  PAGE,
  Unfurl,
  type TaskPhase,
  type ProjectList,
  type StuckStep,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
} from '@althar/contracts'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents } from './Config'
import { Changes } from './Changes'
import { Coordinator } from './Coordinator'
import { baseOf, type ChangedFile, changedFiles, fileDiff, type FileDiff } from './diffs'
import { GitFailed, NotFound } from './errors'
import { Instance } from './Instance'
import { commitsAhead, commitsOf, gitOutcome, indexStamp } from './git'
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

/** How many tasks, or cards, a screen reads at once: each may start git. */
const AT_ONCE = 8

/** A worktree on this device, and the task it is for: what is kept of it goes when its task leaves the screens. */
interface Owner {
  readonly path: string
  readonly taskId: string
  readonly projectId: string
}

/**
 * One kind of fact about worktrees, by path, kept with what it follows from
 * (its key): the same key, the same fact, without asking git; another, and it
 * is worked out again. A failure isn't kept.
 */
const keeper = <A>(owners: Map<string, Owner>) => {
  const kept = new Map<string, { readonly key: string; readonly value: A }>()
  return {
    of: <E>(owner: Owner, key: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.suspend(() => {
        // A folder a later task reuses isn't taken for the earlier one's.
        const whole = `${owner.taskId} ${key}`
        const found = kept.get(owner.path)
        if (found !== undefined && found.key === whole) return Effect.succeed(found.value)
        return Effect.tap(work, (value) =>
          Effect.sync(() => {
            owners.set(owner.path, owner)
            kept.set(owner.path, { key: whole, value })
          }),
        )
      }),
    drop: (path: string) => kept.delete(path),
  }
}

export const parse = (json: string | null): unknown => {
  if (json === null) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

export const text = (value: unknown, key: string): string => {
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

/** A step that needs the person, as its call's payload holds it. */
export const stuckOf = (payload: unknown): StuckStep => {
  const step = text(payload, 'step')
  const why = text(payload, 'why')
  const detail = field(payload, 'detail')
  const agentId = field(payload, 'agentId')
  const round = field(payload, 'round')
  const open = field(payload, 'open')
  const tried = field(payload, 'tried')
  return {
    step: step === 'review' || step === 'settle' || step === 'publish' ? step : 'implement',
    why:
      why === 'no_report' ||
      why === 'session_ended' ||
      why === 'restarted' ||
      why === 'round_limit' ||
      why === 'not_connected' ||
      why === 'usage_limit' ||
      why === 'stalled' ||
      why === 'looping' ||
      why === 'over_budget' ||
      why === 'refused'
        ? why
        : 'failed_to_start',
    detail: typeof detail === 'string' ? detail : null,
    agentId: typeof agentId === 'string' ? agentId : null,
    round: typeof round === 'number' ? round : 0,
    open: typeof open === 'number' ? open : 0,
    ...(Array.isArray(tried)
      ? {
          tried: tried.filter(
            (each): each is 'carried_on' | 'restarted' | 'redirected' =>
              each === 'carried_on' || each === 'restarted' || each === 'redirected',
          ),
        }
      : {}),
  }
}

const number = (value: unknown, key: string): number | null => {
  const found = field(value, key)
  return typeof found === 'number' ? found : null
}

/** A call that waits on the person, as a screen shows it: what was asked, why it waits, and, for a step that needs them, which and why. */
const callOf = (request: { readonly id: string; readonly kind: string; readonly payload: string; readonly createdAt: string }) => {
  const payload = parse(request.payload)
  return {
    id: request.id,
    kind: request.kind === 'stuck' ? ('stuck' as const) : ('permission' as const),
    title: text(payload, 'title'),
    reason: text(payload, 'reason'),
    command: text(payload, 'command') || null,
    stuck: request.kind === 'stuck' ? stuckOf(payload) : null,
    createdAt: request.createdAt,
  }
}

/** A pull request as Althar last saw it (its external link's snapshot), in the contract's shape. */
export const changeOf = (value: unknown, product: string, listening: boolean): ChangeSummary | null => {
  const state = text(value, 'state')
  const words = field(value, 'words')
  const repository = field(value, 'repository')
  const checks = field(value, 'checks')
  const productIs = PRODUCTS.find((candidate) => candidate === product)
  const n = number(value, 'number')
  if (n === null || productIs === undefined || (state !== 'open' && state !== 'merged' && state !== 'closed')) return null
  const outcome = text(checks, 'outcome')
  const failing = field(checks, 'failing')
  return {
    product: productIs,
    number: n,
    title: text(value, 'title'),
    url: text(value, 'url'),
    state,
    draft: field(value, 'draft') === true,
    noun: text(words, 'noun') || 'pull request',
    short: text(words, 'short') || 'PR',
    prefix: text(words, 'prefix') || '#',
    repository: Array.isArray(repository) ? repository.filter((part) => typeof part === 'string').join('/') : '',
    slug: null,
    additions: number(value, 'additions'),
    deletions: number(value, 'deletions'),
    changedFiles: number(value, 'changedFiles'),
    checks:
      checks === null || checks === undefined
        ? null
        : {
            outcome: outcome === 'running' || outcome === 'passed' || outcome === 'failed' ? outcome : 'none',
            passed: number(checks, 'passed') ?? 0,
            failed: number(checks, 'failed') ?? 0,
            running: number(checks, 'running') ?? 0,
            total: number(checks, 'total') ?? 0,
            failing: Array.isArray(failing) ? failing.filter((name) => typeof name === 'string') : [],
            list: Option.getOrElse(decodeChecks(field(checks, 'list') ?? []), () => []),
          },
    head: text(value, 'headSha') || null,
    listening,
    localHead: null,
    unpushed: 0,
  }
}

const decodeLinks = Schema.decodeUnknownOption(Schema.Array(Unfurl))
const decodeChecks = Schema.decodeUnknownOption(ChecksSummary.fields.list)

const PRODUCTS = ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello'] as const

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
        content: { text: text(content, 'text'), links: Option.getOrElse(decodeLinks(field(content, 'links') ?? []), () => []) },
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
          step: step === 'review' || step === 'settle' || step === 'publish' ? step : 'implement',
          round: typeof round === 'number' ? round : 0,
          summary: text(content, 'summary'),
          change: changeOf(field(content, 'change'), text(field(content, 'change'), 'product'), false),
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
    case 'arrival': {
      const source = text(content, 'source')
      const kind = text(content, 'kind')
      const verdict = text(content, 'verdict')
      const failing = field(content, 'failing')
      const product = PRODUCTS.find((candidate) => candidate === source)
      const kinds = ['comment', 'review', 'checks', 'merged', 'closed', 'ready'] as const
      const what = kinds.find((candidate) => candidate === kind)
      if (product === undefined || what === undefined) return undefined
      return {
        ...base,
        kind: 'arrival',
        content: {
          source: product,
          kind: what,
          from: text(content, 'from') || null,
          where: text(content, 'where'),
          text: text(content, 'text') || null,
          verdict: verdict === 'approved' || verdict === 'changes_requested' || verdict === 'commented' ? verdict : null,
          path: text(content, 'path') || null,
          line: number(content, 'line'),
          passed: number(content, 'passed'),
          failed: number(content, 'failed'),
          failing: Array.isArray(failing) ? failing.filter((name) => typeof name === 'string') : [],
          url: text(content, 'url') || null,
          outsider: field(content, 'outsider') === true,
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

type Store = SqlClient.SqlClient | Instance | Agents | Sessions | Coordinator | Changes

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
    /** One file a task changed, as a diff from its base to its worktree; only a file it changed. */
    fileDiff(taskId: string, path: string): Effect.Effect<FileDiff, unknown>
    /** A project's board: its tasks, by card, and the calls that wait on the person. */
    board(projectId: string): Effect.Effect<BoardSnapshot, unknown>
    /** The home: every project, and across them what waits on the person, what runs, and what the loop did since `since` or they last left it. */
    home(since?: string): Effect.Effect<HomeSnapshot, unknown>
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
>()('@althar/runtime/Queries') {
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
        const rows = yield* sql<
          Omit<ProjectList['projects'][number], 'rotateAccounts' | 'onlyAccounts' | 'repositories'> & {
            readonly rotateAccounts: number
            readonly onlyAccounts: string | null
            readonly repositories: string
          }
        >`
          SELECT p.id, p.name, p.slug, p.ink,
            (SELECT max(at) FROM (SELECT created_at AS at FROM tasks WHERE project_id = p.id
              UNION ALL SELECT settled_at FROM tasks WHERE project_id = p.id AND settled_at IS NOT NULL)) AS last_work_at,
            coalesce(
              (SELECT f.path FROM project_folders f WHERE f.project_id = p.id AND f.device_id = ${instance.deviceId}),
              (SELECT l.path FROM repository_bindings b JOIN repository_locations l ON l.binding_id = b.id
                WHERE b.project_id = p.id AND l.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid LIMIT 1)
            ) AS repository,
            (SELECT json_group_array(name) FROM (SELECT b.display_name AS name FROM repository_bindings b
              WHERE b.project_id = p.id AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid)) AS repositories,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS tasks,
            (SELECT count(*) FROM provider_sessions s WHERE s.project_id = p.id AND s.state IN (${sql.unsafe(live)})) AS running,
            (SELECT count(*) FROM attention_requests a WHERE a.project_id = p.id AND a.state = 'open') AS waiting,
            -- Its tasks under way and ready, as their cards would say, worked out from the store alone (Nudges reads ready the same way).
            (SELECT count(*) FROM tasks k JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
              WHERE k.project_id = p.id AND k.state NOT IN ('done', 'abandoned') AND r.state = 'running'
                AND EXISTS (SELECT 1 FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                  WHERE e.run_id = r.id AND a.state IN ('admitted', 'running', 'held'))) AS working,
            (SELECT count(*) FROM tasks k JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
              WHERE k.project_id = p.id AND k.state NOT IN ('done', 'abandoned') AND r.state = 'succeeded'
                AND coalesce((SELECT state FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted')
                  ORDER BY proposed_at DESC LIMIT 1), '') <> 'proposed'
                AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')
                AND NOT EXISTS (SELECT 1 FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                  WHERE e.run_id = r.id AND a.state = 'admitted')) AS ready,
            coalesce((SELECT json_extract(r.rules, '$.usageLimit') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 'move') AS usage_limit,
            coalesce((SELECT json_extract(r.rules, '$.accounts.rotate') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 0) AS rotate_accounts,
            (SELECT json_extract(r.rules, '$.accounts.only') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1) AS only_accounts
          FROM projects p WHERE p.archived_at IS NULL ORDER BY p.created_at DESC, p.id DESC`
        return {
          cursor: at,
          projects: rows.map((row) => ({
            ...row,
            rotateAccounts: row.rotateAccounts === 1,
            onlyAccounts:
              row.onlyAccounts === null ? null : (JSON.parse(row.onlyAccounts) as Readonly<Record<string, ReadonlyArray<string>>>),
            repositories: JSON.parse(row.repositories) as ReadonlyArray<string>,
          })),
        }
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
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
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
          const [session] = yield* sql<{
            id: string
            agentId: string
            state: string
            model: string | null
            effort: string | null
            config: string
          }>`
            SELECT id, agent_id, state, model, effort, config FROM provider_sessions
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
            effort: session.effort,
            models: Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [],
            turnRunning: Option.isSome(running) && running.value.sessionId === session.id && running.value.turnRunning,
            context: Option.isSome(running) && running.value.sessionId === session.id ? running.value.context : null,
          }
        })

      /*
       * What git said of each worktree on this device, kept while it looks the
       * same, so a screen read again starts one git process a worktree rather
       * than a dozen. A look is the commits of its head and of the refs it is
       * read against, from one `cat-file`, and its index file's stamp. What
       * follows from commits alone is kept by those commits, so it is never
       * stale: where the branch meets its default branch and how many commits
       * it has since, whether it is in its default branch, how many commits
       * its pull request doesn't have. The files a task changed also hold what
       * isn't committed: they are kept while the head, the index and the
       * lead's tool calls are as they were. A file changed by hand, or by
       * something left running, and not staged shows at the next commit,
       * stage or tool call of the lead's, not before. Nothing that acts goes
       * by what is kept: merging and pushing check again, in git, that the
       * head the person saw is still the branch's.
       */
      const owners = new Map<string, Owner>()
      /** Where a worktree's branch meets its default branch, and how many commits it has since: by its start, its head and the default branch's. */
      const forksKept = keeper<{ readonly base: string; readonly commits: number }>(owners)
      /** The files a task changed in a worktree: by where they are counted from, its head, its index and the lead's tool calls. */
      const filesKept = keeper<ReadonlyArray<ChangedFile>>(owners)
      /** Whether a worktree's head is in its default branch here: by both commits. */
      const mergedKept = keeper<boolean>(owners)
      /** How many commits a worktree's head has that its pull request doesn't: by both commits. */
      const unpushedKept = keeper<number>(owners)

      /** Lets go of what is kept of the worktrees of tasks `gone` says the screens no longer show. */
      const forget = (gone: (owner: Owner) => boolean) => {
        for (const owner of owners.values())
          if (gone(owner)) {
            owners.delete(owner.path)
            for (const facts of [forksKept, filesKept, mergedKept, unpushedKept]) facts.drop(owner.path)
          }
      }

      /** A task's worktrees on this device, one per repository it changes, the project's first first: each with its repository's root here, and whether it has a pull request. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{
            slug: string
            name: string
            defaultBranch: string
            path: string
            baseRef: string | null
            baseCommit: string | null
            root: string | null
            opened: number
            taskId: string
            projectId: string
          }>`
            SELECT b.slug, b.display_name AS name, coalesce(b.default_base_ref, w.base_ref) AS default_branch, w.path, w.base_ref, w.base_commit,
              l.path AS root, w.task_id, w.project_id,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
        })

      const nothingChanged = { files: [], commits: 0 } as const satisfies {
        readonly files: ReadonlyArray<ChangedFile>
        readonly commits: number
      }

      /** A failure of git's that says nothing, so what failed isn't kept. */
      const unclear = (cwd: string, args: ReadonlyArray<string>, code: number) =>
        Effect.fail(new GitFailed({ args: [...args], cwd, stderr: `exit ${code}` }))

      /**
       * Where a task's change starts, as `baseOf` has it: where its head meets
       * its default branch, or where its worktree started when they never
       * meet, or the default branch isn't known here.
       */
      const forkOf = (cwd: string, head: string, base: string | null, started: string) => {
        if (base === null) return Effect.succeed(started)
        const args = ['merge-base', base, head]
        return Effect.flatMap(gitOutcome(cwd, ...args), ({ code, stdout }) =>
          code === 0 ? Effect.succeed(stdout) : code === 1 ? Effect.succeed(started) : unclear(cwd, args, code),
        )
      }

      /** What a task changed in one worktree, committed or not, and in how many commits, from where its change starts; nothing, where git can't tell. */
      const changedIn = (
        owner: Owner,
        look: { readonly head: string; readonly base: string | null; readonly index: string },
        started: string,
        calls: string,
      ) =>
        Effect.gen(function* () {
          const fork = yield* forksKept.of(
            owner,
            `${started} ${look.base} ${look.head}`,
            Effect.gen(function* () {
              const base = yield* forkOf(owner.path, look.head, look.base, started)
              return { base, commits: yield* commitsAhead(owner.path, base, look.head) }
            }),
          )
          const files = yield* filesKept.of(owner, `${fork.base} ${look.head} ${look.index} ${calls}`, changedFiles(owner.path, fork.base))
          return { files, commits: fork.commits }
        }).pipe(Effect.orElseSucceed(() => nothingChanged))

      /** Whether a commit is in a branch's history; failing, so it isn't kept, where git can't tell. */
      const inHistory = (cwd: string, commit: string, tip: string) => {
        const args = ['merge-base', '--is-ancestor', commit, tip]
        return Effect.flatMap(gitOutcome(cwd, ...args), ({ code }) =>
          code === 0 || code === 1 ? Effect.succeed(code === 0) : unclear(cwd, args, code),
        )
      }

      /**
       * What git says of a task's worktrees, as its screens show it: what it
       * changed, committed or not, and in how many commits, from where it
       * meets its default branch; and its repositories that merge here, for
       * its Merge button: those with no pull request whose branch isn't in
       * their default branch here yet, each with its default branch and its
       * branch's head as it stands. In several repositories, each file is
       * named under its repository's, and the commits are all of theirs.
       * Every worktree is read at the same time, and looked at once.
       */
      const gitOf = (taskId: string, wants: { readonly changed: boolean; readonly here: boolean }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const worktrees = yield* worktreesOf(taskId)
          // The lead's tool calls, and how often they changed: how its edits that nobody staged show.
          const [lead] = wants.changed
            ? yield* sql<{ calls: string }>`
                SELECT count(*) || ':' || coalesce(sum(revision), 0) AS calls FROM thread_items
                WHERE thread_id = (SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task') AND kind = 'tool_call'`
            : []
          const each = yield* Effect.forEach(
            worktrees,
            (worktree) =>
              Effect.gen(function* () {
                const owner = { path: worktree.path, taskId: worktree.taskId, projectId: worktree.projectId }
                const there = existsSync(worktree.path)
                const branch = `refs/heads/${worktree.defaultBranch}`
                const [[head = null, base = null, tip = null], index] = there
                  ? yield* Effect.all([commitsOf(worktree.path, ['HEAD', worktree.baseRef ?? '', branch]), indexStamp(worktree.path)], {
                      concurrency: 'unbounded',
                    })
                  : [[], '']
                const merges = wants.here && worktree.opened === 0
                const [changed, merged] = yield* Effect.all(
                  [
                    wants.changed && head !== null && worktree.baseCommit !== null
                      ? changedIn(owner, { head, base, index }, worktree.baseCommit, lead?.calls ?? '')
                      : Effect.succeed(nothingChanged),
                    merges && head !== null && tip !== null && worktree.root !== null
                      ? mergedKept.of(owner, `${head} ${tip}`, inHistory(worktree.root, head, tip)).pipe(Effect.orElseSucceed(() => false))
                      : Effect.succeed(false),
                  ],
                  { concurrency: 'unbounded' },
                )
                return {
                  worktree,
                  changed,
                  here: merges && !merged ? [{ repository: worktree.slug, name: worktree.name, branch: worktree.defaultBranch, head }] : [],
                }
              }),
            { concurrency: 'unbounded' },
          )
          return {
            files: each.flatMap(({ worktree, changed }) =>
              worktrees.length > 1
                ? changed.files.map((file) => ({
                    ...file,
                    path: `${worktree.slug}/${file.path}`,
                    from: file.from === null ? null : `${worktree.slug}/${file.from}`,
                  }))
                : changed.files,
            ),
            commits: each.reduce((sum, { changed }) => sum + changed.commits, 0),
            here: each.flatMap(({ here }) => here),
          }
        })

      /**
       * A worktree's head, and how many commits on it what was pushed doesn't
       * have: what is still the person's to push. What was pushed is the first
       * of `pushed` the worktree knows, such as the pull request's head, else
       * the commit Althar last pushed. None, where it can't be told. The head
       * and which of them it knows are one look; the count is kept by the two
       * commits.
       */
      const unpushedOf = (owner: Owner, pushed: ReadonlyArray<string | null>) =>
        Effect.gen(function* () {
          const [localHead = null, ...known] = yield* commitsOf(owner.path, [
            'HEAD',
            ...pushed.filter((commit): commit is string => commit !== null),
          ])
          const from = known.find((commit): commit is string => commit !== null)
          if (localHead === null || from === undefined) return { localHead, unpushed: 0 }
          // Counted up to the head looked at, not HEAD again: the lead may commit in between.
          const unpushed = yield* unpushedKept
            .of(owner, `${from} ${localHead}`, commitsAhead(owner.path, from, localHead))
            .pipe(Effect.orElseSucceed(() => 0))
          return { localHead, unpushed }
        })

      /** One file a task changed, as a diff from its base to its worktree on this device; in several repositories, named under its repository's. */
      const diffOf = (taskId: string, path: string) =>
        Effect.gen(function* () {
          const worktrees = yield* worktreesOf(taskId)
          const slash = path.indexOf('/')
          const named = worktrees.length > 1 ? worktrees.find((worktree) => worktree.slug === path.slice(0, slash)) : worktrees[0]
          const inside = worktrees.length > 1 ? path.slice(slash + 1) : path
          if (named === undefined || named.baseCommit === null || !existsSync(named.path))
            return yield* new NotFound({ kind: 'task’s worktree', id: taskId })
          const diff = yield* fileDiff(named.path, yield* baseOf(named.path, named.baseRef, named.baseCommit), inside)
          return worktrees.length > 1
            ? {
                ...diff,
                file: {
                  ...diff.file,
                  path: `${named.slug}/${diff.file.path}`,
                  from: diff.file.from === null ? null : `${named.slug}/${diff.file.from}`,
                },
              }
            : diff
        })

      /** A task's issue and pull requests, as their external links last saw them. */
      const linksOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const links = yield* sql<{
            kind: string
            product: string
            ref: string
            key: string
            url: string
            snapshot: string
            listening: number
          }>`
            SELECT kind, product, ref, key, url, snapshot, listening FROM external_links WHERE task_id = ${taskId} ORDER BY created_at`
          const issueRow = links.find((link) => link.kind === 'issue')
          const issue = ((): IssueSummary | null => {
            if (issueRow === undefined) return null
            const kept = parse(issueRow.snapshot)
            const product = PRODUCTS.find((candidate) => candidate === issueRow.product)
            if (product === undefined) return null
            const status = field(kept, 'status')
            const category = text(status, 'category')
            const priority = field(kept, 'priority')
            return {
              product,
              ref: issueRow.ref,
              key: issueRow.key,
              title: text(kept, 'title') || issueRow.key,
              url: issueRow.url,
              status: {
                name: text(status, 'name') || 'Todo',
                category:
                  category === 'triage' ||
                  category === 'backlog' ||
                  category === 'started' ||
                  category === 'done' ||
                  category === 'cancelled'
                    ? category
                    : 'todo',
              },
              priority:
                priority === null || priority === undefined ? null : { level: text(priority, 'level'), name: text(priority, 'name') },
              container: text(kept, 'container') || null,
            }
          })()
          const changes = yield* Effect.forEach(
            links.flatMap((link) => {
              const found = link.kind === 'change' ? changeOf(parse(link.snapshot), link.product, link.listening === 1) : null
              return found === null ? [] : [found]
            }),
            // Each knows its repository's folder here, as the record of its push says; an open one, how far that branch is ahead
            // of it: commits the person hasn't pushed yet.
            (found) =>
              Effect.gen(function* () {
                const [binding] = yield* sql<{ slug: string }>`
                  SELECT b.slug FROM repository_changes c JOIN repository_bindings b ON b.id = c.binding_id
                  WHERE c.pull_request_url = ${found.url} ORDER BY c.updated_at DESC LIMIT 1`
                return { ...found, slug: binding?.slug ?? null }
              }).pipe(
                Effect.flatMap((change) =>
                  change.state !== 'open'
                    ? Effect.succeed(change)
                    : Effect.gen(function* () {
                        // Its repository's worktree, as the record of the push says; the task's first, where it doesn't.
                        const [here] = yield* sql<{ path: string; taskId: string; projectId: string; headCommit: string | null }>`
                      SELECT w.path, w.task_id, w.project_id, (SELECT c.head_commit FROM repository_changes c WHERE c.pull_request_url = ${change.url}
                          ORDER BY c.updated_at DESC LIMIT 1) AS head_commit
                      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
                      ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${change.url} LIMIT 1) DESC,
                        b.created_at, b.rowid
                      LIMIT 1`
                        if (here === undefined || !existsSync(here.path)) return change
                        return { ...change, ...(yield* unpushedOf(here, [change.head, here.headCommit])) }
                      }),
                ),
              ),
            { concurrency: 'unbounded' },
          )
          return { issue, changes }
        })

      /**
       * A task's card in the coordinator's thread: where it stands, worked out
       * from its plan, its run, the calls waiting and the agents working.
       */
      /** A task's card, as its item in the coordinator's thread shows it. */
      const cardOf = (row: ItemRow) =>
        Effect.map(cardFor(text(parse(row.content), 'taskId')), (content): ThreadItem | undefined =>
          content === undefined
            ? undefined
            : { id: row.id, sequence: row.sequence, agentId: null, createdAt: row.createdAt, kind: 'task', content },
        )

      /** Where a task stands, read from it, its plan, its run and its sessions: what its card and its header show. Its links, where they are read already. */
      const cardFor = (taskId: string, links?: { readonly issue: IssueSummary | null; readonly changes: ReadonlyArray<ChangeSummary> }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
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
            lead: string | null
            firstSession: string | null
            starting: number
            held: string | null
          }>`
            SELECT t.id AS thread_id, k.title, k.slug, k.state, w.branch,
              p.id AS plan_id, p.state AS plan_state, p.parameters, p.starts_at,
              r.state AS run_state, r.created_at AS run_at,
              (SELECT n.node_key FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state IN ('admitted', 'running', 'held') ORDER BY a.admitted_at DESC LIMIT 1) AS step,
              -- A step held until an agent's usage limit resets.
              (SELECT a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state = 'held' ORDER BY a.admitted_at DESC LIMIT 1) AS held,
              (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') AS waiting,
              (SELECT s.id FROM threads s WHERE s.task_id = k.id AND s.kind = 'step' LIMIT 1) AS review,
              (SELECT agent_id FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead,
              (SELECT min(started_at) FROM provider_sessions WHERE thread_id = t.id) AS first_session,
              -- A step admitted and not yet running, or a session still starting: its agent is on its way.
              (SELECT count(*) FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state = 'admitted')
              + (SELECT count(*) FROM provider_sessions s JOIN threads h ON h.id = s.thread_id
                WHERE h.task_id = k.id AND s.state = 'starting') AS starting
            FROM tasks k
            JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
            LEFT JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
            WHERE k.id = ${taskId}`
          if (task === undefined) return undefined
          const [latest] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
          const lead = yield* sessions.running(task.threadId)
          const reviewer = task.review === null ? Option.none() : yield* sessions.running(task.review)
          const working = task.starting > 0 || Option.isSome(lead) || Option.isSome(reviewer)
          // An agent mid-turn: work under way, whatever the run that came before it said.
          const busy =
            task.starting > 0 ||
            Option.exists(lead, (session) => session.turnRunning) ||
            Option.exists(reviewer, (session) => session.turnRunning)
          const phase = ((): TaskPhase => {
            if (task.state === 'done' || task.state === 'abandoned') return 'settled'
            if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
            // A call waiting on the person, and work under way, come before being ready: work sent back isn't ready again
            // until its lead is done with the note.
            if (task.waiting > 0) return 'waiting'
            if (task.runState === 'succeeded') return busy ? 'running' : 'ready'
            if (task.runState !== null && task.runState !== 'running') return 'stopped'
            // Held for a reset, it carries on on its own: under way, not stopped.
            return working || task.held !== null ? 'running' : 'stopped'
          })()
          const parameters = parse(task.parameters)
          const steps = field(parameters, 'steps')
          const planned = (Array.isArray(steps) ? steps : []).map((step) => {
            const model = field(step, 'model')
            return {
              key: text(step, 'key') === 'review' ? ('review' as const) : ('implement' as const),
              agentId: text(step, 'agentId'),
              model: typeof model === 'string' ? model : null,
              skipped: field(step, 'skipped') === true,
            }
          })
          const end = text(parameters, 'end')
          const { issue, changes } = links ?? (yield* linksOf(taskId))
          return {
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
                    steps: planned,
                    startsAt: task.planState === 'proposed' ? task.startsAt : null,
                    reason: text(parameters, 'reason') || null,
                    end: end === 'draft' || end === 'ready' || end === 'none' ? end : null,
                  },
            issue: issue === null ? null : { product: issue.product, key: issue.key, title: issue.title, url: issue.url },
            // The first still open, for the person to act on: one merged while another isn't leaves the other.
            change: changes.find((candidate) => candidate.state === 'open') ?? changes[0] ?? null,
            step: task.step,
            summary: latest === undefined ? null : text(parse(latest.content), 'summary') || null,
            lead: task.lead ?? (planned.find((step) => step.key === 'implement')?.agentId || null),
            branch: task.branch,
            startedAt: task.runAt ?? task.firstSession,
            waits: waitsOf(task.held),
          } satisfies Extract<ThreadItem, { kind: 'task' }>['content']
        })

      /** What a held step waits for: the agent out of usage, and when it is back. */
      const waitsOf = (held: string | null) => {
        const output = held === null ? undefined : parse(held)
        const agentId = text(output, 'heldFor')
        const until = text(output, 'until')
        return agentId === '' || until === '' ? null : { agentId, until }
      }

      /** How many settled tasks the board shows: the most recent. */
      const SETTLED_SHOWN = 30
      /** How far back the home reads what the loop did, before the person has ever left it here. */
      const FIRST_LOOK = 24 * 60 * 60 * 1000
      /** The most of what the loop did the home reads. */
      const EVENTS = 50
      /* Settled work doesn't change, so its card is worked out once, by when it settled. */
      const settledCards = new Map<string, BoardSnapshot['tasks'][number]>()

      /** A task as the board shows it: its card, and, ready, what it changed and what of it merges here. None where it has no card. */
      const onBoard = (row: {
        readonly id: string
        readonly state: string
        readonly createdAt: string
        readonly settledAt: string | null
      }) =>
        Effect.gen(function* () {
          const settled = row.settledAt === null ? undefined : settledCards.get(`${row.id}:${row.settledAt}`)
          if (settled !== undefined) return [settled]
          const card = yield* cardFor(row.id)
          if (card === undefined) return []
          // Ready, what merges here is read from git; without a pull request, so is its size: its branch's.
          const said = card.phase === 'ready' ? yield* gitOf(row.id, { changed: card.change === null, here: true }) : null
          const changed =
            said !== null && card.change === null
              ? {
                  files: said.files.length,
                  add: said.files.reduce((sum, file) => sum + file.add, 0),
                  del: said.files.reduce((sum, file) => sum + file.del, 0),
                }
              : null
          const read = { ...card, state: row.state, createdAt: row.createdAt, settledAt: row.settledAt, changed, here: said?.here ?? [] }
          if (row.settledAt !== null && card.phase === 'settled') settledCards.set(`${row.id}:${row.settledAt}`, read)
          return [read]
        })

      /** The calls that wait on the person, in one project or every one, oldest first, each with its task. */
      const callsIn = (projectId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const calls = yield* sql<{
            id: string
            kind: string
            payload: string
            createdAt: string
            projectId: string
            taskId: string
            threadId: string
            taskTitle: string
            taskSlug: string
          }>`
            SELECT a.id, a.kind, a.payload, a.created_at, a.project_id, k.id AS task_id, t.id AS thread_id, k.title AS task_title, k.slug AS task_slug
            FROM attention_requests a JOIN tasks k ON k.id = a.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            JOIN projects p ON p.id = a.project_id
            WHERE ${projectId === null ? sql`p.archived_at IS NULL` : sql`a.project_id = ${projectId}`} AND a.state = 'open'
            ORDER BY a.created_at, a.id`
          return calls.map((call) => ({
            projectId: call.projectId,
            call: {
              ...callOf(call),
              taskId: call.taskId,
              threadId: call.threadId,
              taskTitle: call.taskTitle,
              taskSlug: call.taskSlug,
            },
          }))
        })

      /** A project's board: its tasks, each as its card, and every call that waits on the person. */
      const board = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* cursor
          const rows = yield* sql<{
            id: string
            state: string
            createdAt: string
            settledAt: string | null
            worktree: string | null
            baseRef: string | null
            baseCommit: string | null
          }>`
            SELECT k.id, k.state, k.created_at, k.settled_at, w.path AS worktree, w.base_ref, w.base_commit
            FROM tasks k LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            WHERE k.project_id = ${projectId} AND (k.state NOT IN ('done', 'abandoned') OR k.id IN (
              SELECT id FROM tasks WHERE project_id = ${projectId} AND state IN ('done', 'abandoned')
              ORDER BY settled_at DESC LIMIT ${SETTLED_SHOWN}))
            ORDER BY k.created_at, k.id`
          const tasks = yield* Effect.forEach(rows, onBoard, { concurrency: AT_ONCE })
          // Only what the board still shows is kept.
          const shown = new Set(rows.map((row) => `${row.id}:${row.settledAt}`))
          for (const key of settledCards.keys()) if (!shown.has(key)) settledCards.delete(key)
          const onIt = new Set(rows.map((row) => row.id))
          forget((owner) => owner.projectId === projectId && !onIt.has(owner.taskId))
          const calls = yield* callsIn(projectId)
          return {
            cursor: at,
            tasks: tasks.flat(),
            calls: calls.map((one) => one.call),
          } satisfies BoardSnapshot
        })

      /** The phases the home shows a task in: running, stopped or waiting on a call, and ready to accept. */
      const ON_HOME: ReadonlyArray<TaskPhase> = ['running', 'waiting', 'stopped', 'ready']

      /**
       * The home: every project, and across them what waits on the person,
       * what runs, and what the loop did since `since`, or since they last left
       * the home here, or, before they ever did, over the last day.
       */
      const home = (since?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* cursor
          const [device] = yield* sql<{
            looked: string | null
          }>`SELECT home_looked_at AS looked FROM devices WHERE id = ${instance.deviceId}`
          const looked = device?.looked ?? null
          const from = since ?? looked ?? new Date(Date.now() - FIRST_LOOK).toISOString()
          const rows = yield* sql<{ id: string; projectId: string; state: string; createdAt: string; settledAt: string | null }>`
            SELECT k.id, k.project_id, k.state, k.created_at, k.settled_at FROM tasks k JOIN projects p ON p.id = k.project_id
            WHERE p.archived_at IS NULL AND k.state = 'open' ORDER BY k.created_at, k.id`
          const tasks = yield* Effect.forEach(
            rows,
            (row) =>
              Effect.map(onBoard(row), (read) =>
                read.flatMap((task) => (ON_HOME.includes(task.phase) ? [{ ...task, projectId: row.projectId }] : [])),
              ),
            { concurrency: AT_ONCE },
          )
          // What is kept of a task's worktrees goes once it is settled: the home reads every open one.
          const open = new Set(rows.map((row) => row.id))
          forget((owner) => !open.has(owner.taskId))
          return {
            cursor: at,
            looked,
            since: from,
            tasks: tasks.flat(),
            calls: (yield* callsIn(null)).map((one) => ({ ...one.call, projectId: one.projectId })),
            events: yield* eventsSince(from),
            projects: (yield* projects).projects,
          } satisfies HomeSnapshot
        })

      /**
       * What the loop did since `from`, newest first, never what the person
       * did: each step's result, each usage limit and quiet step it dealt with,
       * and the permission asks the projects' rules answered, counted.
       */
      const eventsSince = (from: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const items = yield* sql<{
            id: string
            sequence: number
            kind: string
            content: string
            createdAt: string
            projectId: string
            taskId: string
            threadId: string
            slug: string
            title: string
          }>`
            SELECT i.id, i.sequence, i.kind, i.content, i.created_at, i.project_id, k.id AS task_id, t.id AS thread_id, k.slug, k.title
            FROM thread_items i JOIN threads t ON t.id = i.thread_id AND t.kind = 'task' JOIN tasks k ON k.id = t.task_id
            JOIN projects p ON p.id = i.project_id
            WHERE p.archived_at IS NULL AND i.created_at > ${from}
              AND (i.kind = 'step_result' OR (i.kind = 'notice' AND json_extract(i.content, '$.about') IN ('limit', 'stall')))
            ORDER BY i.created_at DESC, i.sequence DESC LIMIT ${EVENTS}`
          const events: Array<HomeEvent> = items.flatMap((row): ReadonlyArray<HomeEvent> => {
            const base = {
              id: row.id,
              at: row.createdAt,
              projectId: row.projectId,
              task: { id: row.taskId, threadId: row.threadId, slug: row.slug, title: row.title },
            }
            const item = itemOf({ ...row, agentId: null, inputState: null, disposition: null, decision: null })
            if (item?.kind === 'step_result') return [{ ...base, kind: 'step', result: item.content }]
            if (item?.kind !== 'notice') return []
            const about = text(JSON.parse(row.content), 'about') === 'stall' ? 'stall' : 'limit'
            return [{ ...base, kind: 'dealt', about, title: item.content.title, description: item.content.description }]
          })
          // Answered by the rules, not by the person: counted, from the first.
          const [answered] = yield* sql<{ count: number; first: string | null }>`
            SELECT count(*) AS count, min(d.decided_at) AS first FROM decisions d JOIN projects p ON p.id = d.project_id
            WHERE p.archived_at IS NULL AND d.decided_by_actor_id = ${instance.systemId} AND d.decided_at > ${from}`
          if (answered !== undefined && answered.count > 0 && answered.first !== null)
            events.push({ kind: 'answered', id: `answered:${from}`, at: answered.first, count: answered.count })
          return events
        })

      /** A page of a thread's items, as screens show them. */
      const pageOf = (threadId: string, page: { readonly before?: number; readonly limit?: number }) =>
        Effect.gen(function* () {
          const { items, earlier } = yield* itemRows(threadId, {
            ...(page.before === undefined ? {} : { before: page.before }),
            limit: page.limit ?? PAGE,
          })
          const shown = yield* Effect.forEach(items, (row) => (row.kind === 'task' ? cardOf(row) : Effect.succeed(itemOf(row))), {
            concurrency: AT_ONCE,
          })
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
            baseCommit: string | null
            settledAt: string | null
          }>`
            SELECT t.id AS thread_id, p.id AS project_id, p.name AS project_name, k.id AS task_id, k.title, k.description, k.slug, k.state,
              k.settled_at, w.branch, w.path AS worktree, w.base_ref, w.base_commit
            FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = t.project_id
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })
          // What the store says comes first, together, so it is as of the cursor; git after.
          const { items, earlier } = yield* pageOf(threadId, page)
          const attention = yield* sql<{ id: string; kind: string; payload: string; createdAt: string }>`
            SELECT id, kind, payload, created_at FROM attention_requests WHERE task_id = ${head.taskId} AND state = 'open' ORDER BY created_at`
          // Since when the step it is on has run, or been held.
          const [onStep] = yield* sql<{ admittedAt: string }>`
            SELECT a.admitted_at FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id
            WHERE r.id = (SELECT id FROM runs WHERE task_id = ${head.taskId} ORDER BY created_at DESC LIMIT 1)
              AND a.state IN ('admitted', 'running', 'held') ORDER BY a.admitted_at DESC LIMIT 1`
          // Where it stands, from its card, which shows its links too: the header reads those with git, below.
          const card = yield* cardFor(head.taskId, { issue: null, changes: [] })
          const session = yield* sessionOf(threadId)
          // Its links, whose open pull requests say what isn't pushed, and what git says of its worktrees, read at the same time.
          const [links, said] = yield* Effect.all([linksOf(head.taskId), gitOf(head.taskId, { changed: true, here: true })], {
            concurrency: 'unbounded',
          })
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
              phase: card?.phase ?? null,
              waits: card?.waits ?? null,
              steps: card?.plan?.steps ?? [],
              step: card?.step ?? null,
              startedAt: card?.startedAt ?? null,
              stepAt: onStep?.admittedAt ?? null,
              settledAt: head.settledAt,
              ...links,
              files: said.files,
              commits: said.commits,
              here: said.here,
            },
            session,
            attention: attention.map(callOf),
            items,
            earlier,
          } satisfies ThreadSnapshot
        })

      /**
       * Where a project's repository is hosted, from its remotes: on a
       * connected instance, or on a hosted service Althar knows; null when
       * its remotes name neither, as a local one doesn't.
       */
      const hostOf = (projectId: string) =>
        Effect.gen(function* () {
          const changes = yield* Changes
          return yield* changes.hostFor(projectId)
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
          // Its cards, the agent on it, the one it would start on and the project's host, read at the same time.
          const [{ items, earlier }, session, suggested, host] = yield* Effect.all(
            [pageOf(threadId, page), sessionOf(threadId), coordinators.suggested(projectId), hostOf(projectId)],
            { concurrency: 'unbounded' },
          )
          return {
            threadId,
            cursor: at,
            project: { id: projectId, name: project.name },
            session,
            suggested,
            items,
            earlier,
            host,
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
                WHEN 'external_link' THEN (SELECT t.id FROM external_links x
                  JOIN threads t ON t.task_id = x.task_id AND t.kind = 'task' WHERE x.id = c.aggregate_id)
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
        fileDiff: (taskId, path) => run(diffOf(taskId, path)),
        board: (projectId) => run(board(projectId)),
        home: (since) => run(home(since)),
        item: (threadId, itemId) => run(item(threadId, itemId)),
        coordinator: (projectId, page) => run(coordinator(projectId, page)),
        changesSince: (after, limit) => run(changesSince(after, limit)),
        cursor: run(cursor),
      })
    }),
  )
}
