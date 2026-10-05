import { existsSync } from 'node:fs'

import {
  type BoardSnapshot,
  type ChangeSummary,
  ChecksSummary,
  type CoordinatorSnapshot,
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
import { baseOf, changedFiles, fileDiff, type FileDiff } from './diffs'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { git, unpushedOf } from './git'
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
          SELECT p.id, p.name, p.slug,
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
          }
        })

      /** What a task's branch changed since it started, file by file, read from git in its worktree; nothing without one. */
      /** What a task changed, committed or not, and in how many commits, from where it meets its default branch; nothing without its worktree here. */
      const changedOf = (worktree: string | null, baseRef: string | null, started: string | null) =>
        worktree === null || started === null || !existsSync(worktree)
          ? Effect.succeed({ files: [], commits: 0 })
          : Effect.gen(function* () {
              const base = yield* baseOf(worktree, baseRef, started)
              const files = yield* changedFiles(worktree, base)
              const commits = yield* git(worktree, 'rev-list', '--count', `${base}..HEAD`)
              return { files, commits: Number(commits) || 0 }
            }).pipe(Effect.orElseSucceed(() => ({ files: [], commits: 0 })))

      /** A task's worktrees on this device, one per repository it changes, the project's first first. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ slug: string; path: string; baseRef: string | null; baseCommit: string | null }>`
            SELECT b.slug, w.path, w.base_ref, w.base_commit FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
        })

      /**
       * What a task changed across its repositories: in one, as `changedOf`
       * reads it; in several, each file under its repository's name, and the
       * commits of all of them.
       */
      const changedOfTask = (taskId: string) =>
        Effect.gen(function* () {
          const worktrees = yield* worktreesOf(taskId)
          const each = yield* Effect.forEach(worktrees, (worktree) =>
            Effect.map(changedOf(worktree.path, worktree.baseRef, worktree.baseCommit), (changed) => ({ worktree, changed })),
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
          }
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
            // An open one says how far its repository's branch here is ahead of it: commits the person hasn't pushed yet.
            (change) =>
              change.state !== 'open'
                ? Effect.succeed(change)
                : Effect.gen(function* () {
                    // Its repository's worktree, as the record of the push says; the task's first, where it doesn't.
                    const [here] = yield* sql<{ path: string; headCommit: string | null }>`
                      SELECT w.path, (SELECT c.head_commit FROM repository_changes c WHERE c.pull_request_url = ${change.url}
                          ORDER BY c.updated_at DESC LIMIT 1) AS head_commit
                      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
                      ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${change.url} LIMIT 1) DESC,
                        b.created_at, b.rowid
                      LIMIT 1`
                    if (here === undefined || !existsSync(here.path)) return change
                    return { ...change, ...(yield* unpushedOf(here.path, [change.head, here.headCommit])) }
                  }),
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

      /** Where a task stands, read from it, its plan, its run and its sessions: what its card and its header show. */
      const cardFor = (taskId: string) =>
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
          const { issue, changes } = yield* linksOf(taskId)
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
      /* Settled work doesn't change, so its card is worked out once, by when it settled. */
      const settledCards = new Map<string, BoardSnapshot['tasks'][number]>()

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
          const tasks = yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const settled = row.settledAt === null ? undefined : settledCards.get(`${row.id}:${row.settledAt}`)
              if (settled !== undefined) return [settled]
              const card = yield* cardFor(row.id)
              if (card === undefined) return []
              // Ready without a pull request, its size is its branch's, read from git.
              const changed =
                card.phase === 'ready' && card.change === null
                  ? yield* Effect.map(changedOfTask(row.id), ({ files }) => ({
                      files: files.length,
                      add: files.reduce((sum, file) => sum + file.add, 0),
                      del: files.reduce((sum, file) => sum + file.del, 0),
                    }))
                  : null
              const read = { ...card, state: row.state, createdAt: row.createdAt, settledAt: row.settledAt, changed }
              if (row.settledAt !== null && card.phase === 'settled') settledCards.set(`${row.id}:${row.settledAt}`, read)
              return [read]
            }),
          )
          // Only what the board still shows is kept.
          const shown = new Set(rows.map((row) => `${row.id}:${row.settledAt}`))
          for (const key of settledCards.keys()) if (!shown.has(key)) settledCards.delete(key)
          const calls = yield* sql<{
            id: string
            kind: string
            payload: string
            createdAt: string
            taskId: string
            threadId: string
            taskTitle: string
            taskSlug: string
          }>`
            SELECT a.id, a.kind, a.payload, a.created_at, k.id AS task_id, t.id AS thread_id, k.title AS task_title, k.slug AS task_slug
            FROM attention_requests a JOIN tasks k ON k.id = a.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE a.project_id = ${projectId} AND a.state = 'open' ORDER BY a.created_at, a.id`
          return {
            cursor: at,
            tasks: tasks.flat(),
            calls: calls.map((call) => ({
              ...callOf(call),
              taskId: call.taskId,
              threadId: call.threadId,
              taskTitle: call.taskTitle,
              taskSlug: call.taskSlug,
            })),
          } satisfies BoardSnapshot
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
            baseCommit: string | null
          }>`
            SELECT t.id AS thread_id, p.id AS project_id, p.name AS project_name, k.id AS task_id, k.title, k.description, k.slug, k.state,
              w.branch, w.path AS worktree, w.base_ref, w.base_commit
            FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = t.project_id
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })
          const { items, earlier } = yield* pageOf(threadId, page)
          const attention = yield* sql<{ id: string; kind: string; payload: string; createdAt: string }>`
            SELECT id, kind, payload, created_at FROM attention_requests WHERE task_id = ${head.taskId} AND state = 'open' ORDER BY created_at`
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
              ...(yield* Effect.map(cardFor(head.taskId), (card) => ({ phase: card?.phase ?? null, waits: card?.waits ?? null }))),
              ...(yield* linksOf(head.taskId)),
              ...(yield* changedOfTask(head.taskId)),
            },
            session: yield* sessionOf(threadId),
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
          const { items, earlier } = yield* pageOf(threadId, page)
          return {
            threadId,
            cursor: at,
            project: { id: projectId, name: project.name },
            session: yield* sessionOf(threadId),
            suggested: yield* coordinators.suggested(projectId),
            items,
            earlier,
            host: yield* hostOf(projectId),
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
        item: (threadId, itemId) => run(item(threadId, itemId)),
        coordinator: (projectId, page) => run(coordinator(projectId, page)),
        changesSince: (after, limit) => run(changesSince(after, limit)),
        cursor: run(cursor),
      })
    }),
  )
}
