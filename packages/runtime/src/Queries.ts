import { HOSTED, newPullRequestLink } from '@althar/connectors'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  AllowedBy,
  AttentionRequest,
  type BoardSnapshot,
  type ChangeSummary,
  ChecksSummary,
  type CoordinatorSnapshot,
  type HomeEvent,
  type HomeSnapshot,
  IssueDraftCard,
  ReviewDraftCard,
  type IssueSummary,
  LimitCall,
  PAGE,
  Unfurl,
  type TaskPhase,
  type ProjectList,
  type StuckStep,
  type TaskCard,
  type TaskList,
  type TaskSummary,
  type DocumentText,
  FieldAnswer,
  type OutputText,
  PushRequestItem,
  QuestionField,
  type ThreadItem,
  type ThreadSnapshot,
} from '@althar/contracts'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Busy } from './Busy'
import { planWaits } from './Runs'
import { Agents, RuntimeConfig } from './Config'
import { questionTitle } from './Questions'
import { Changes } from './Changes'
import { Coordinator } from './Coordinator'
import type { PullRequestFacts } from './pullRequestStanding'
import { baseOf, type ChangedFile, changedFiles, fileDiff, type FileDiff } from './diffs'
import { builtIn, evidenceOf, evidencePaths, unverifiedIn } from './evidence'
import { filesOf, outputOf, picturesOf } from './handed'
import { handedOf, kindOf, quickIn } from './kinds'
import { documentText, outputText } from './reading'
import type { Artifacts } from './Artifacts'
import { type DocumentRefused, GitFailed, NotFound } from './errors'
import { Instance } from './Instance'
import { Launches } from './Launches'
import { commitsAhead, commitsOf, git, gitOutcome, indexStamp, namedRemotes, remoteOf } from './git'
import { commandIn, shortCommand } from './rules'
import { reviewBriefOf } from './Reviews'
import { Sessions } from './Sessions'
import { actionsOf, standingOf } from './Tasks'

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

/** A task's branch as its screens show it, from its first worktree `w`: none for a plain task's that has no branch yet (DEV-96). */
const SHOWN_BRANCH = 'CASE WHEN w.branched_at IS NULL THEN NULL ELSE w.branch END AS branch'

/** Whether a project's rules allow everything now (ADR-043): by the switch, or as an earlier revision said it, as a mode. 1 or 0. */
const PROJECT_ALLOWS = (projectId: string) =>
  `(SELECT json_extract(r.rules, '$.allowEverything') IS 1 OR json_extract(r.rules, '$.permissions') IS 'allow'
    FROM policies r WHERE r.project_id = ${projectId} ORDER BY r.revision DESC LIMIT 1)`

/** How many tasks, or cards, a screen reads at once: each may start git. */
const AT_ONCE = 8

/** How many of the lead's reports a thread reads beside its page, newest first: far more than a task's rounds. */
const REPORTS = 200

/** How many items further back, at most, a page of a task's thread reaches for the start of its first round: one enormous round loads in pages. */
const ROUND_REACH = 2_000

/**
 * What starts a round of a task's thread, as SQL over its item `i` and that
 * item's input `u`: an ask the lead's work answers. What the person said,
 * once the lead has it; what Althar says that isn't its own housekeeping
 * (`aside`), such as what the coordinator passed on, a conflict or failed
 * checks; a review's verdict or what publishing found; and what arrived on
 * a pull request.
 */
const ROUND_ASK = `(i.kind = 'user_message' AND coalesce(u.state, 'delivered') = 'delivered')
  OR (i.kind = 'notice' AND json_extract(i.content, '$.source') = 'runtime' AND coalesce(json_extract(i.content, '$.role'), '') <> 'aside')
  OR (i.kind = 'step_result' AND json_extract(i.content, '$.step') IN ('review', 'publish'))
  OR i.kind = 'arrival'`

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
    /** What is kept for `key`, else `work`, kept; `fresh` does the work whatever is kept, and keeps it. */
    of: <E>(owner: Owner, key: string, work: Effect.Effect<A, E>, fresh = false): Effect.Effect<A, E> =>
      Effect.suspend(() => {
        // A folder a later task reuses isn't taken for the earlier one's.
        const whole = `${owner.taskId} ${key}`
        const found = kept.get(owner.path)
        if (!fresh && found !== undefined && found.key === whole) return Effect.succeed(found.value)
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

export const field = (value: unknown, key: string): unknown =>
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
  readonly inputState: 'queued' | 'delivered' | 'superseded' | 'withdrawn' | null
  readonly disposition: string | null
  /** For a tool call that asked: what was decided, last. */
  readonly decision: string | null
  /** For a tool call the project's allow rules let through: the rules, as the decision keeps them (ADR-018). */
  readonly rule?: string | null
  /** For a question: its call's state and payload, where its answer is. */
  readonly questionState?: string | null
  readonly questionPayload?: string | null
  /** For a tool call: the agent asking the person something, which its question stands for. */
  readonly asks?: number | null
  readonly createdAt: string
}

const decodeFields = Schema.decodeUnknownOption(Schema.Array(QuestionField))
const decodeAnswers = Schema.decodeUnknownOption(Schema.Record(Schema.String, FieldAnswer))

/** An agent's question as its call keeps it: what it asks, and once answered, what was said. */
const questionOf = (payload: unknown) => ({
  message: text(payload, 'message'),
  fields: Option.getOrElse(decodeFields(field(payload, 'fields')), () => []),
})

/** An agent's question as a call shows it: what it asks, why, and who asks. */
const askedOf = (payload: unknown, asker: { readonly agentId?: string | null; readonly model?: string | null }) => {
  const why = text(payload, 'why')
  return {
    ...questionOf(payload),
    ...(why === '' ? {} : { why }),
    ...(asker.agentId == null ? {} : { askedBy: { agentId: asker.agentId, model: asker.model ?? null } }),
  }
}

const decodeAllowedBy = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(AllowedBy)))
const decodeLimit = Schema.decodeUnknownOption(LimitCall)
const decodeAlways = Schema.decodeUnknownOption(AttentionRequest.fields.always)

/** The first of the allow rules a decision keeps, or none where it keeps none. */
const allowedByOf = (rule: string | null | undefined) =>
  rule === null || rule === undefined ? undefined : Option.getOrUndefined(decodeAllowedBy(rule))?.[0]

/** A step that needs the person, as its call's payload holds it. */
export const stuckOf = (payload: unknown): StuckStep => {
  const step = text(payload, 'step')
  const why = text(payload, 'why')
  const detail = field(payload, 'detail')
  const agentId = field(payload, 'agentId')
  const round = field(payload, 'round')
  const open = field(payload, 'open')
  const tried = field(payload, 'tried')
  const limit = Option.getOrUndefined(decodeLimit(field(payload, 'limit')))
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
    ...(limit === undefined ? {} : { limit }),
  }
}

const number = (value: unknown, key: string): number | null => {
  const found = field(value, key)
  return typeof found === 'number' ? found : null
}

/** A call that waits on the person, as a screen shows it: what was asked, why it waits, and, for a step that needs them, which and why. */
const callOf = (request: {
  readonly id: string
  readonly kind: string
  readonly payload: string
  readonly createdAt: string
  /** For a question: the agent and model of the session that asked. */
  readonly askerAgentId?: string | null
  readonly askerModel?: string | null
}) => {
  const payload = parse(request.payload)
  const command = text(payload, 'command') || null
  return {
    id: request.id,
    kind: request.kind === 'stuck' ? ('stuck' as const) : request.kind === 'question' ? ('question' as const) : ('permission' as const),
    title: request.kind === 'question' ? questionTitle(questionOf(payload)) : text(payload, 'title'),
    reason: text(payload, 'reason'),
    command,
    ...(command === null ? {} : { label: shortCommand(command) }),
    // A permission the rules keep for the person whatever they let through: no "always allow" can answer it.
    ...(request.kind === 'permission' && field(payload, 'held') === true ? { held: true } : {}),
    stuck: request.kind === 'stuck' ? stuckOf(payload) : null,
    ...(request.kind === 'question'
      ? { question: askedOf(payload, { agentId: request.askerAgentId ?? null, model: request.askerModel ?? null }) }
      : {}),
    // What an "always" would keep, for a permission that says (ADR-018); earlier ones don't.
    ...Option.match(decodeAlways(field(payload, 'always')), {
      onNone: () => ({}),
      onSome: (always) => (always === undefined ? {} : { always }),
    }),
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
  // Where the host said whether it conflicts, and which branch it merges into: absent from a snapshot kept before them.
  const conflicts = field(value, 'conflicts')
  const target = text(value, 'target')
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
    ...(target === '' ? {} : { target }),
    ...(typeof conflicts === 'boolean' ? { conflicts } : {}),
    head: text(value, 'headSha') || null,
    listening,
    localHead: null,
    unpushed: 0,
    diverged: null,
  }
}

const decodeLinks = Schema.decodeUnknownOption(Schema.Array(Unfurl))
const decodeDraft = Schema.decodeUnknownOption(IssueDraftCard)
const decodeReviewDraft = Schema.decodeUnknownOption(ReviewDraftCard)
const decodePushRequest = Schema.decodeUnknownOption(PushRequestItem.fields.content)
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
        content: {
          text: text(content, 'text'),
          links: Option.getOrElse(decodeLinks(field(content, 'links') ?? []), () => []),
          pictures: picturesOf(field(content, 'pictures')),
        },
        input: row.inputState === null ? null : { state: row.inputState, interrupting: row.disposition === 'interrupt_and_continue' },
      }
    case 'agent_message':
    case 'agent_thought':
      return {
        ...base,
        kind: row.kind,
        content: { text: text(content, 'text'), pictures: picturesOf(field(content, 'pictures')), files: filesOf(field(content, 'files')) },
      }
    case 'tool_call': {
      const locations = field(content, 'locations')
      const exit = field(content, 'exit')
      const command = commandIn(field(content, 'rawInput')) ?? null
      const label = command === null ? command : shortCommand(command)
      const allowedBy = row.decision === 'allow' ? allowedByOf(row.rule) : undefined
      return {
        ...base,
        kind: 'tool_call',
        content: {
          title: text(content, 'title'),
          toolKind: text(content, 'kind') || 'other',
          status: text(content, 'status') || 'pending',
          command,
          ...(label !== null && label !== command ? { label } : {}),
          locations: (Array.isArray(locations) ? locations : []).flatMap((location) => {
            const path = text(location, 'path')
            const line = field(location, 'line')
            return path === '' ? [] : [{ path, ...(typeof line === 'number' ? { line } : {}) }]
          }),
          declined: row.decision === 'reject',
          ...(row.asks === 1 ? { asks: true } : {}),
          ...(allowedBy === undefined ? {} : { allowedBy }),
          pictures: picturesOf(field(content, 'pictures')),
          files: filesOf(field(content, 'files')),
          output: outputOf(field(content, 'output')),
          exit: typeof exit === 'number' ? exit : null,
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
      const role = text(content, 'role')
      return {
        ...base,
        kind: 'notice',
        content: {
          source: text(content, 'source') === 'runtime' ? 'runtime' : 'agent',
          severity: severity === 'error' || severity === 'warning' ? severity : 'info',
          title: text(content, 'title'),
          description: description === '' ? null : description,
          ...(role === 'aside' || role === 'relayed' ? { role } : {}),
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
          built: builtIn(field(content, 'built')),
          evidence: evidenceOf(field(content, 'evidence')),
          unverified: unverifiedIn(field(content, 'unverified')),
          agentId: agentId === '' ? null : agentId,
        },
      }
    }
    case 'question': {
      const payload = parse(row.questionPayload ?? '{}')
      const state = row.questionState === 'answered' ? 'answered' : row.questionState === 'open' ? 'open' : 'withdrawn'
      const toolCallId = text(content, 'toolCallId')
      return {
        ...base,
        kind: 'question',
        content: {
          attentionId: text(content, 'attentionId'),
          ...questionOf(content),
          toolCallId: toolCallId === '' ? null : toolCallId,
          state,
          answers: state === 'answered' ? Option.getOrNull(decodeAnswers(field(payload, 'answers'))) : null,
          withdrawn: state === 'withdrawn' ? (text(payload, 'withdrawn') === 'turn' ? 'turn' : 'task') : null,
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
    case 'run': {
      const ended = field(content, 'ended')
      const code = field(ended, 'code')
      return {
        ...base,
        kind: 'run',
        content: {
          launchId: text(content, 'launchId'),
          taskId: text(content, 'taskId') || null,
          where: text(content, 'where'),
          command: text(content, 'command'),
          url: text(content, 'url') || null,
          startedAt: text(content, 'startedAt'),
          ended:
            typeof ended === 'object' && ended !== null
              ? {
                  at: text(ended, 'at'),
                  code: typeof code === 'number' ? code : null,
                  stopped: field(ended, 'stopped') === true,
                  last: text(ended, 'last') || null,
                }
              : null,
        },
      }
    }
    // An issue draft's card: Althar writes it whole with each change to the draft.
    case 'issue_draft':
      return Option.match(decodeDraft(content), {
        onNone: () => undefined,
        onSome: (card) => ({ ...base, kind: 'issue_draft' as const, content: card }),
      })
    // A review draft's card, written whole with each change to the draft, as an issue draft's is.
    case 'review_draft':
      return Option.match(decodeReviewDraft(content), {
        onNone: () => undefined,
        onSome: (card): ThreadItem => ({ ...base, kind: 'review_draft', content: card }),
      })
    case 'push_request':
      // Althar writes it whole, as the contract has it; one that doesn't read so is left out.
      return Option.match(decodePushRequest(content), {
        onNone: () => undefined,
        onSome: (asked): ThreadItem => ({ ...base, kind: 'push_request', content: asked }),
      })
    case 'setup': {
      const ended = field(content, 'ended')
      const code = field(ended, 'code')
      return {
        ...base,
        kind: 'setup',
        content: {
          repository: text(content, 'repository'),
          command: text(content, 'command'),
          kept: field(content, 'kept') === true,
          startedAt: text(content, 'startedAt'),
          ended:
            typeof ended === 'object' && ended !== null
              ? {
                  at: text(ended, 'at'),
                  code: typeof code === 'number' ? code : null,
                  timedOut: field(ended, 'timedOut') === true,
                  stopped: field(ended, 'stopped') === true,
                  last: text(ended, 'last') || null,
                }
              : null,
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

type Store = SqlClient.SqlClient | Instance | Agents | Sessions | Coordinator | Changes | RuntimeConfig | Artifacts | Launches | Busy

export class Queries extends Context.Service<
  Queries,
  {
    projects: Effect.Effect<ProjectList, SqlError.SqlError>
    tasks(projectId: string): Effect.Effect<TaskList, SqlError.SqlError>
    task(taskId: string): Effect.Effect<TaskSummary, SqlError.SqlError | NotFound>
    /** The thread, with the newest `limit` items before `before`; `fresh` reads the files its task changed from git, whatever is kept. */
    thread(
      threadId: string,
      page?: { readonly before?: number; readonly limit?: number; readonly fresh?: boolean },
    ): Effect.Effect<ThreadSnapshot, SqlError.SqlError | NotFound>
    item(threadId: string, itemId: string): Effect.Effect<ThreadItem, SqlError.SqlError | NotFound>
    /** What a command in a thread printed, as kept when it ended. */
    output(threadId: string, itemId: string): Effect.Effect<OutputText, SqlError.SqlError | NotFound>
    /** A markdown document an agent in a thread wrote, as it is now in the task's worktrees. */
    document(threadId: string, path: string): Effect.Effect<DocumentText, SqlError.SqlError | NotFound | DocumentRefused>
    /** One file a task changed, as a diff from its base to its worktree; only a file it changed. */
    fileDiff(taskId: string, path: string): Effect.Effect<FileDiff, unknown>
    /** A task's card, as its board shows it: where it stands and what it makes. */
    card(taskId: string): Effect.Effect<TaskCard, unknown>
    /** The plain tasks that finished and wait to be seen, by id: nothing counts them as waiting on the person. */
    readonly finished: Effect.Effect<ReadonlySet<string>, unknown>
    /** A project's board: its tasks, by card, and the calls that wait on the person. */
    board(projectId: string): Effect.Effect<BoardSnapshot, unknown>
    /** The next page of a project's settled tasks, as cards: the ones settled before `before` (`taskId` breaking a tie), most recent first. */
    olderSettled(projectId: string, before: string, taskId: string): Effect.Effect<ReadonlyArray<BoardSnapshot['tasks'][number]>, unknown>
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
      const config = yield* RuntimeConfig
      const launches = yield* Launches
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
          Omit<ProjectList['projects'][number], 'rotateAccounts' | 'onlyAccounts' | 'repositories' | 'worktrees' | 'ready'> & {
            readonly rotateAccounts: number
            readonly onlyAccounts: string | null
            readonly repositories: string
            readonly ready: string
            readonly drafted: string
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
            (SELECT json_group_array(k.id) FROM tasks k JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
              WHERE k.project_id = p.id AND k.state NOT IN ('done', 'abandoned') AND r.state = 'succeeded'
                AND coalesce((SELECT state FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted')
                  ORDER BY proposed_at DESC LIMIT 1), '') <> 'proposed'
                AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')
                AND NOT EXISTS (SELECT 1 FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                  WHERE e.run_id = r.id AND a.state = 'admitted')) AS ready,
            -- A review has no run: drafted, it is the person's to post, as its card says, unless a call on it waits on them first.
            (SELECT json_group_array(k.id) FROM tasks k WHERE k.project_id = p.id AND k.state = 'open'
                AND EXISTS (SELECT 1 FROM review_drafts d WHERE d.task_id = k.id AND d.state IN ('pending', 'failed', 'uncertain'))
                AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')) AS drafted,
            coalesce((SELECT json_extract(r.rules, '$.usageLimit') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 'move') AS usage_limit,
            coalesce((SELECT json_extract(r.rules, '$.accounts.rotate') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 0) AS rotate_accounts,
            (SELECT json_extract(r.rules, '$.accounts.only') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1) AS only_accounts,
            (SELECT t.id FROM threads t WHERE t.project_id = p.id AND t.kind = 'coordinator' AND t.owner_actor_id = ${instance.personId}) AS coordinator_thread_id
          FROM projects p WHERE p.archived_at IS NULL ORDER BY p.created_at DESC, p.id DESC`
        // A plain task that finished waits on its board, but asks nothing of the person: no count says it (DEV-96).
        const finished = yield* finishedPlain
        return {
          cursor: at,
          projects: rows.map(({ drafted, ...row }) => ({
            ...row,
            // Each task once: one ready and drafted both, as a review taken over might be, counts once.
            ready: [
              ...new Set([...(JSON.parse(row.ready) as ReadonlyArray<string>), ...(JSON.parse(drafted) as ReadonlyArray<string>)]),
            ].filter((id) => !finished.has(id)).length,
            rotateAccounts: row.rotateAccounts === 1,
            onlyAccounts:
              row.onlyAccounts === null ? null : (JSON.parse(row.onlyAccounts) as Readonly<Record<string, ReadonlyArray<string>>>),
            repositories: JSON.parse(row.repositories) as ReadonlyArray<string>,
            // Where its tasks' worktrees are, once it has had a task (ADR-006).
            worktrees: row.tasks > 0 ? join(config.worktreeRoot, row.slug) : null,
          })),
        }
      })

      const taskRows = (where: { readonly projectId?: string; readonly taskId?: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<TaskSummary>`
            SELECT k.id, k.project_id, k.title, k.slug, t.id AS thread_id, k.state, ${sql.unsafe(SHOWN_BRANCH)},
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

      const itemRows = (
        threadId: string,
        where: {
          readonly before?: number
          /** The first sequence read, where the page starts at a given item. */
          readonly from?: number
          readonly itemId?: string
          readonly limit: number
          readonly reports?: boolean
        },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<ItemRow>`
            SELECT i.id, i.sequence, i.kind, i.content, s.agent_id, u.state AS input_state, u.disposition, i.created_at,
              (SELECT d.outcome FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS decision,
              (SELECT d.rule FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS rule,
              q.state AS question_state, q.payload AS question_payload,
              -- An agent's tool call that asks the person is the question it asks, which stands in its place.
              (x.tool_call_id IS NOT NULL) AS asks
            FROM thread_items i
            LEFT JOIN (SELECT provider_session_id, json_extract(content, '$.toolCallId') AS tool_call_id FROM thread_items
              WHERE thread_id = ${threadId} AND kind = 'question') x
              ON i.kind = 'tool_call' AND x.provider_session_id = i.provider_session_id AND x.tool_call_id = i.tool_call_id
            LEFT JOIN attention_requests q ON i.kind = 'question' AND q.id = json_extract(i.content, '$.attentionId')
            LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            LEFT JOIN user_inputs u ON u.id = i.user_input_id
            WHERE i.thread_id = ${threadId}
              -- A message taken back takes no place on a page; read by id, it says it was taken back.
              AND ${where.itemId === undefined ? sql`(u.state IS NULL OR u.state <> 'withdrawn')` : sql`i.id = ${where.itemId}`}
              AND ${where.before === undefined ? sql`1 = 1` : sql`i.sequence < ${where.before}`}
              AND ${where.from === undefined ? sql`1 = 1` : sql`i.sequence >= ${where.from}`}
              AND ${where.reports === true ? sql`i.kind = 'step_result' AND json_extract(i.content, '$.step') IN ('implement', 'settle')` : sql`1 = 1`}
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
            account: string | null
          }>`
            SELECT s.id, s.agent_id, s.state, s.model, s.effort, s.config, a.name AS account FROM provider_sessions s
            LEFT JOIN agent_accounts a ON a.id = s.account_id
            WHERE s.thread_id = ${threadId} AND s.state IN (${sql.unsafe(live)}) ORDER BY s.started_at DESC LIMIT 1`
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
            account: session.account,
            effort: session.effort,
            models: Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [],
            turnRunning: Option.isSome(running) && running.value.sessionId === session.id && running.value.turnRunning,
            context: Option.isSome(running) && running.value.sessionId === session.id ? running.value.context : null,
            background: Option.isSome(running) && running.value.sessionId === session.id ? running.value.background : [],
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
       * stage or tool call of the lead's, or when the person looks at the
       * task's changes: its screen reads them fresh as it opens, and as its
       * outputs or changes are shown (`fresh`). Nothing that acts goes
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
      /** How a worktree's head stands against its pull request's (`againstPullRequest`): by the commits it follows from. */
      const unpushedKept = keeper<{
        readonly localHead: string
        readonly unpushed: number
        readonly diverged: ChangeSummary['diverged']
      }>(owners)

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
            branch: string
            baseRef: string | null
            baseCommit: string | null
            branched: number
            root: string | null
            opened: number
            taskId: string
            projectId: string
          }>`
            SELECT b.slug, b.display_name AS name, coalesce(b.default_base_ref, w.base_ref) AS default_branch, w.path, w.branch, w.base_ref, w.base_commit,
              w.branched_at IS NOT NULL AS branched, l.path AS root, w.task_id, w.project_id,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' ORDER BY b.created_at, b.rowid`
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
       * meet, or the default branch isn't known here. Where it started after
       * they meet, as a branch for its next pull request starts from the
       * default branch as its host has it, newer than here (ADR-034), from
       * there.
       */
      const forkOf = (cwd: string, head: string, base: string | null, started: string) => {
        if (base === null) return Effect.succeed(started)
        const args = ['merge-base', base, head]
        return Effect.flatMap(gitOutcome(cwd, ...args), ({ code, stdout }) => {
          if (code === 1) return Effect.succeed(started)
          if (code !== 0) return unclear(cwd, args, code)
          if (stdout === started) return Effect.succeed(stdout)
          return Effect.map(
            Effect.all([
              gitOutcome(cwd, 'merge-base', '--is-ancestor', stdout, started),
              gitOutcome(cwd, 'merge-base', '--is-ancestor', started, head),
            ]),
            ([before, on]) => (before.code === 0 && on.code === 0 ? started : stdout),
          )
        })
      }

      /** What a task changed in one worktree, committed or not, and in how many commits, from where its change starts; nothing, where git can't tell. */
      const changedIn = (
        owner: Owner,
        look: { readonly head: string; readonly base: string | null; readonly index: string },
        started: string,
        calls: string,
        fresh: boolean,
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
          const files = yield* filesKept.of(
            owner,
            `${fork.base} ${look.head} ${look.index} ${calls}`,
            changedFiles(owner.path, fork.base),
            fresh,
          )
          return { files, commits: fork.commits }
        }).pipe(Effect.orElseSucceed(() => nothingChanged))

      /** Whether a commit is in a branch's history; failing, so it isn't kept, where git can't tell. */
      const inHistory = (cwd: string, commit: string, tip: string) => {
        const args = ['merge-base', '--is-ancestor', commit, tip]
        return Effect.flatMap(gitOutcome(cwd, ...args), ({ code }) =>
          code === 0 || code === 1 ? Effect.succeed(code === 0) : unclear(cwd, args, code),
        )
      }

      /** The branch a default branch follows on its remote (origin/main), and how many commits the remote doesn't have; none without one. */
      const aheadOf = (root: string, branch: string) =>
        Effect.gen(function* () {
          const followed = yield* gitOutcome(root, 'for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`)
          const remote = followed.code === 0 && followed.stdout !== '' ? followed.stdout : null
          if (remote === null) return { remote, ahead: 0 }
          const counted = yield* gitOutcome(root, 'rev-list', '--count', `${remote}..refs/heads/${branch}`)
          return { remote, ahead: counted.code === 0 ? Number(counted.stdout) || 0 : 0 }
        })

      /**
       * Where a task's branch stands on its repository's remote, for pushing
       * it without a connection: the remote it goes to, whether that has the
       * branch, how many commits of it it doesn't have, and the host's page
       * for a new pull request from it. None without a remote.
       */
      const branchRemoteOf = (root: string, worktree: string, branch: string, base: string, head: string, baseCommit: string | null) =>
        Effect.gen(function* () {
          const remote = yield* remoteOf(root, base)
          if (remote === null) return null
          const [there = null] = yield* commitsOf(root, [`refs/remotes/${remote}/${branch}`])
          const from = there ?? baseCommit
          const ahead = from === null || from === head ? 0 : yield* commitsAhead(worktree, from, head).pipe(Effect.orElseSucceed(() => 0))
          // Where the branch goes: the remote's push URL, which can be a fork of the one it fetches from.
          const url = (yield* namedRemotes(root, 'push').pipe(Effect.orElseSucceed(() => []))).find((one) => one.name === remote)?.url
          return {
            name: remote,
            branch,
            pushed: there !== null,
            ahead,
            newPullRequest: url === undefined ? null : newPullRequestLink(url, branch, base, HOSTED),
          }
        }).pipe(Effect.orElseSucceed(() => null))

      /**
       * What git says of a task's worktrees, as its screens show it: what it
       * changed, committed or not, and in how many commits, from where it
       * meets its default branch; and its repositories that merge here, for
       * its Merge button: those with no pull request whose branch isn't in
       * their default branch here yet, each with its default branch and its
       * branch's head as it stands. In several repositories, each file is
       * named under its repository's, and the commits are all of theirs.
       * Every worktree is read at the same time, and looked at once. A plain
       * task's worktree with no branch yet has nothing of its own: what its
       * lead writes there is a change once Althar makes its branch.
       */
      const gitOf = (taskId: string, wants: { readonly changed: boolean; readonly here: boolean; readonly fresh?: boolean }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const worktrees = yield* worktreesOf(taskId)
          // The lead's tool calls, and how often they changed: how its edits that nobody staged show.
          const [lead] = wants.changed
            ? yield* sql<{ calls: string }>`
                SELECT count(*) || ':' || coalesce(sum(revision), 0) AS calls FROM thread_items
                WHERE thread_id = (SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task') AND kind = 'tool_call'`
            : []
          // A screenshot the lead handed as evidence, left uncommitted, isn't part of what it changed.
          const pictures = wants.changed ? yield* evidencePaths(taskId) : () => false
          const shown = (worktree: string) => (file: ChangedFile) =>
            !(file.uncommitted && file.status === 'added' && pictures(worktree, file.path))
          const each = yield* Effect.forEach(
            worktrees.filter((worktree) => worktree.branched === 1),
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
                      ? changedIn(owner, { head, base, index }, worktree.baseCommit, lead?.calls ?? '', wants.fresh === true)
                      : Effect.succeed(nothingChanged),
                    merges && head !== null && tip !== null && worktree.root !== null
                      ? mergedKept.of(owner, `${head} ${tip}`, inHistory(worktree.root, head, tip)).pipe(Effect.orElseSucceed(() => false))
                      : Effect.succeed(false),
                  ],
                  { concurrency: 'unbounded' },
                )
                // Merged here, once it holds work of its own: whether its default branch is on its remote yet.
                const mergedHere = merges && merged && head !== worktree.baseCommit && worktree.root !== null
                const remote = mergedHere && worktree.root !== null ? yield* aheadOf(worktree.root, worktree.defaultBranch) : null
                return {
                  worktree,
                  changed,
                  here:
                    merges && !merged
                      ? [
                          {
                            repository: worktree.slug,
                            name: worktree.name,
                            branch: worktree.defaultBranch,
                            head,
                            remote:
                              head === null || worktree.root === null
                                ? null
                                : yield* branchRemoteOf(
                                    worktree.root,
                                    worktree.path,
                                    worktree.branch,
                                    worktree.defaultBranch,
                                    head,
                                    worktree.baseCommit,
                                  ),
                          },
                        ]
                      : [],
                  merged:
                    remote === null ? [] : [{ repository: worktree.slug, name: worktree.name, branch: worktree.defaultBranch, ...remote }],
                }
              }),
            { concurrency: 'unbounded' },
          )
          return {
            files: each.flatMap(({ worktree, changed }) =>
              worktrees.length > 1
                ? changed.files.filter(shown(worktree.path)).map((file) => ({
                    ...file,
                    path: `${worktree.slug}/${file.path}`,
                    from: file.from === null ? null : `${worktree.slug}/${file.from}`,
                  }))
                : changed.files.filter(shown(worktree.path)),
            ),
            commits: each.reduce((sum, { changed }) => sum + changed.commits, 0),
            here: each.flatMap(({ here }) => here),
            merged: each.flatMap(({ merged }) => merged),
          }
        })

      /** How many commits `from` has that none of `not` has; failing, so it isn't kept, where git can't tell. */
      const countOnly = (cwd: string, from: string, not: ReadonlyArray<string>) =>
        Effect.map(git(cwd, 'rev-list', '--count', from, '--not', ...not), Number)

      /**
       * A worktree's head against its pull request: how many commits on it the
       * pull request doesn't have, what is still the person's to push; or,
       * where the branch no longer adds to it, how they parted. The pull
       * request's head is what it was pushed from, else the commit Althar last
       * pushed (`sent`). Where its head isn't under the branch's, but what
       * crediting made it from is, the branch is still on its commits as the
       * lead made them, and counts from there. Otherwise either Althar pushed
       * it and the branch was rewritten since (counted without the default
       * branch's commits, which a rebase brings in), or it came from
       * elsewhere, counted where it is here. A plain push of either would be
       * refused, so neither has anything to push. One look at the commits;
       * what follows from them is kept by them.
       */
      const againstPullRequest = (owner: Owner, pullRequestHead: string | null, sent: string | null, base: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // One not known, as an empty revision, is null.
          const [localHead = null, there = null, ours = null, tip = null] = yield* commitsOf(owner.path, [
            'HEAD',
            ...[pullRequestHead, sent, base].map((commit) => commit ?? ''),
          ])
          const none = { localHead, unpushed: 0, diverged: null }
          if (localHead === null) return none
          const from = there ?? ours
          // Its head a commit unknown here, and not what Althar pushed: someone else pushed to it.
          if (pullRequestHead !== null && /^[0-9a-f]{40,64}$/.test(pullRequestHead) && there === null && pullRequestHead !== sent)
            return { localHead, unpushed: 0, diverged: { kind: 'moved' as const, local: 0, onPullRequest: null } }
          if (from === null) return none
          // What crediting made the head from (credit.ts): a push sends the branch's commits made again, and the branch stays on
          // them as the lead made them where it couldn't be moved onto what went, such as mid-merge. A push credits them again.
          const madeFrom = yield* sql<{ original: string }>`
            SELECT original FROM credited_commits WHERE credited = ${from} AND original != credited`.pipe(Effect.orElseSucceed(() => []))
          // Counted up to the head looked at, not HEAD again: the lead may commit in between.
          return yield* unpushedKept
            .of(
              owner,
              `${from} ${ours} ${tip} ${localHead}`,
              Effect.gen(function* () {
                for (const counted of [from, ...madeFrom.map((row) => row.original)])
                  if (yield* inHistory(owner.path, counted, localHead))
                    return { localHead, unpushed: yield* commitsAhead(owner.path, counted, localHead), diverged: null }
                const others = [tip].filter((commit): commit is string => commit !== null)
                return {
                  localHead,
                  unpushed: 0,
                  diverged: {
                    kind: from === ours ? ('rewritten' as const) : ('moved' as const),
                    local: yield* countOnly(owner.path, localHead, [from, ...others]),
                    onPullRequest: yield* countOnly(owner.path, from, [localHead, ...others]),
                  },
                }
              }),
            )
            .pipe(Effect.orElseSucceed(() => none))
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
                        const [here] = yield* sql<{
                          path: string
                          taskId: string
                          projectId: string
                          headCommit: string | null
                          base: string | null
                        }>`
                      SELECT w.path, w.task_id, w.project_id, (SELECT c.head_commit FROM repository_changes c WHERE c.pull_request_url = ${change.url}
                          ORDER BY c.updated_at DESC LIMIT 1) AS head_commit, coalesce(b.default_base_ref, w.base_ref) AS base
                      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
                      ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${change.url} LIMIT 1) DESC,
                        b.created_at, b.rowid
                      LIMIT 1`
                        if (here === undefined || !existsSync(here.path)) return change
                        return { ...change, ...(yield* againstPullRequest(here, change.head, here.headCommit, here.base)) }
                      }),
                ),
              ),
            { concurrency: 'unbounded' },
          )
          return { issue, changes }
        })

      /** A task's pull requests as its card reads them, and the repositories it merged here: what the coordinator is told of them. */
      const pullRequestsOf = (taskId: string): Effect.Effect<PullRequestFacts, SqlError.SqlError, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
          if (task === undefined) return { changes: [], merged: [], unmerged: 0 }
          const [links, said, host, seen] = yield* Effect.all(
            [
              linksOf(taskId),
              gitOf(taskId, { changed: false, here: true }),
              Effect.flatMap(Changes, (changes) => changes.hostsFor(task.projectId, taskId)),
              sql<{
                url: string
                updatedAt: string
              }>`SELECT url, updated_at FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`,
            ],
            { concurrency: 'unbounded' },
          )
          const known = host.flatMap((one) => (one === null ? [] : [one]))
          // Each pull request's own host: the one whose address it is at, else the only one of its product; none where that can't be told.
          const hostOfChange = (change: ChangeSummary) => {
            const there = known.find((one) => change.url.startsWith(one.webUrl.replace(/\/$/, '') + '/'))
            if (there !== undefined) return there
            const same = known.filter((one) => one.product === change.product)
            return same.length === 1 ? same[0] : undefined
          }
          return {
            changes: links.changes.map((change) => {
              const one = hostOfChange(change)
              return {
                change,
                seenAt: seen.find((link) => link.url === change.url)?.updatedAt ?? null,
                host: one === undefined ? null : { name: one.name, connected: one.connected },
              }
            }),
            merged: said.merged.map(({ name, branch, remote, ahead }) => ({ name, branch, remote, ahead })),
            unmerged: said.here.length,
            // Commits after its last pull request merged or closed, in none yet (ADR-034).
            unshipped:
              links.changes.length === 0
                ? 0
                : (yield* Effect.flatMap(Changes, (changes) => changes.unshipped(taskId)).pipe(Effect.orElseSucceed(() => []))).reduce(
                    (sum, one) => sum + one.commits.length,
                    0,
                  ),
          }
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

      /** Why work waits for a place: how many are busy, and who holds them. What a holder left running is listed where it alone keeps the place, to stop it from here. */
      const queuedNow = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        const { busy, atOnce, holders } = yield* (yield* Busy).now
        return {
          busy,
          atOnce,
          holders: yield* Effect.forEach(holders, (holder) =>
            Effect.gen(function* () {
              const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${holder.taskId}`
              const live = holder.kept && holder.threadId !== null ? yield* sessions.running(holder.threadId) : Option.none()
              return {
                taskId: holder.taskId,
                title: task?.title ?? '',
                threadId: holder.threadId,
                kept: holder.kept,
                running: Option.isSome(live) ? live.value.background.filter((left) => left.ended === null) : [],
              }
            }),
          ),
        }
      })

      /* A settled task's kind, by the task and when it settled: it is read from git once, not each time its card is. */
      const settledKinds = new Map<string, TaskCard['kind']>()

      /** Whether a task has made something on its branch: commits, or changes not committed yet, its evidence aside. */
      const madeOf = (taskId: string) =>
        Effect.map(gitOf(taskId, { changed: true, here: false }), (said) => said.commits > 0 || said.files.length > 0).pipe(
          Effect.orElseSucceed(() => false),
        )

      /**
       * The plain tasks that finished and wait to be seen (DEV-96), by id:
       * their latest run passed, and they are quick tasks still (their plan
       * stays on this Mac and ends in nothing, and they have no pull request),
       * whatever they committed. One stays in its project's Needs you, but
       * asks nothing of the person, so nothing counts it: not the tabs, the
       * home, the edge or the Dock.
       */
      const finishedPlain = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          SELECT k.id FROM tasks k
          JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
          JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          WHERE k.state = 'open' AND r.state = 'succeeded' AND ${sql.unsafe(quickIn('k'))}`
        return new Set(rows.map((row) => row.id))
      })

      /**
       * What a plain task's lead handed back: the pictures in its latest
       * report's evidence, and the files it named in what it said since its
       * latest run began (since it began, without one).
       */
      const handedFor = (threadId: string, report: string | null, since: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const said = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'agent_message'
              AND created_at >= ${since ?? ''} AND json_array_length(json_extract(content, '$.files')) > 0
            ORDER BY sequence`
          return handedOf(
            parse(report),
            said.map((message) => parse(message.content)),
          )
        })

      /** Where a task stands, read from it, its plan, its run and its sessions: what its card and its header show. Its links, where they are read already. */
      const cardFor = (taskId: string, links?: { readonly issue: IssueSummary | null; readonly changes: ReadonlyArray<ChangeSummary> }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          // Commits after its last pull request merged or closed, in none yet: something for the person to ship (ADR-034). Read
          // from git before the store, so a round of work that opens meanwhile shows as it is, not a settled task with its commit.
          // By repository: one whose pull request is still open takes pushes instead.
          const [shipping] = yield* sql<{ state: string; changes: number }>`
            SELECT k.state, (SELECT count(*) FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change') AS changes
            FROM tasks k WHERE k.id = ${taskId}`
          const after =
            shipping !== undefined && shipping.changes > 0 && shipping.state !== 'abandoned'
              ? yield* (yield* Changes).unshipped(taskId).pipe(Effect.orElseSucceed(() => []))
              : []
          const [task] = yield* sql<{
            threadId: string
            title: string
            slug: string
            state: string
            settledAt: string | null
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
            leadModel: string | null
            leadEffort: string | null
            firstSession: string | null
            starting: number
            held: string | null
            heldFor: string | null
            roundWaits: number
            answersWait: number
            turnWaits: number
            runPlan: string | null
          }>`
            SELECT t.id AS thread_id, k.title, k.slug, k.state, k.settled_at, ${sql.unsafe(SHOWN_BRANCH)},
              p.id AS plan_id, p.state AS plan_state, p.parameters, p.starts_at,
              r.state AS run_state, r.created_at AS run_at, r.plan_id AS run_plan,
              (SELECT n.node_key FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state IN ('admitted', 'running', 'held') ORDER BY a.admitted_at DESC LIMIT 1) AS step,
              -- A step held until an agent's usage limit resets, or until a place among the agents at work here frees.
              (SELECT a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state = 'held' ORDER BY a.admitted_at DESC LIMIT 1) AS held,
              (SELECT a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                WHERE e.run_id = r.id AND a.state = 'held' ORDER BY a.admitted_at DESC LIMIT 1) AS held_for,
              -- A conflict, or the checks on one, its lead is to be asked about once it has a place.
              (SELECT count(*) FROM conflict_resolutions c WHERE c.task_id = k.id AND c.state = 'resolving' AND c.waiting IS NOT NULL)
                AS round_waits,
              -- An answer kept until its agent has a place to carry on.
              (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.kind = 'question' AND x.state = 'answered'
                AND json_extract(x.payload, '$.waitsForPlace') IS NOT NULL) AS answers_wait,
              -- A turn of its lead or reviewer that waits for a place.
              (SELECT count(*) FROM threads h WHERE h.task_id = k.id AND h.waits_for_place IS NOT NULL) AS turn_waits,
              (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') AS waiting,
              (SELECT s.id FROM threads s WHERE s.task_id = k.id AND s.kind = 'step' LIMIT 1) AS review,
              (SELECT agent_id FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead,
              (SELECT model FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead_model,
              (SELECT effort FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead_effort,
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
          // A conflict round: its lead is at work on it, though between turns, or it is the person's now.
          const round = yield* (yield* Changes).conflictStanding(taskId)
          // A change in Althar's hands is under way while its checks run, and while its lead fixes them (ADR-040).
          const hands =
            task.runState === 'succeeded' ? yield* (yield* Changes).inHands(taskId).pipe(Effect.orElseSucceed(() => null)) : null
          const seeing = hands !== null && !hands.given
          const resolving = round?.state === 'resolving' ? round : undefined
          const lead = yield* sessions.running(task.threadId)
          const reviewer = task.review === null ? Option.none() : yield* sessions.running(task.review)
          const working = task.starting > 0 || Option.isSome(lead) || Option.isSome(reviewer)
          // An agent mid-turn: work under way, whatever the run that came before it said.
          const busy =
            task.starting > 0 ||
            Option.exists(lead, (session) => session.turnRunning) ||
            Option.exists(reviewer, (session) => session.turnRunning)
          // Waiting for a place among the agents at work on this machine: under way, and it starts on its own.
          const queued = task.heldFor === 'machine_busy' || task.roundWaits > 0 || task.answersWait > 0 || task.turnWaits > 0
          const unshipped =
            after.length === 0
              ? null
              : {
                  commits: after.reduce((sum, one) => sum + one.commits.length, 0),
                  add: after.reduce((sum, one) => sum + one.add, 0),
                  del: after.reduce((sum, one) => sum + one.del, 0),
                }
          // Someone else's pull request it reviews (DEV-96); and whether a draft of its review waits for the person.
          const reviewing = yield* reviewBriefOf(taskId)
          const [draftWaits] =
            reviewing === null
              ? []
              : yield* sql<{ id: string }>`
                  SELECT id FROM review_drafts WHERE task_id = ${taskId} AND state IN ('pending', 'failed', 'uncertain') LIMIT 1`
          const phase = ((): TaskPhase => {
            if (task.state === 'abandoned') return 'settled'
            if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
            // A call waiting on the person, and work under way, come before anything else (ADR-034): work sent back isn't ready
            // again until its lead is done with the note, and a merged task whose lead works on it again is running.
            if (task.waiting > 0) return 'waiting'
            if (busy || queued || resolving !== undefined) return 'running'
            // A review has no run: drafted, it is the person's to post, as a change is to accept.
            if (draftWaits !== undefined && task.state === 'open') return 'ready'
            // Merged, it is settled, unless commits after its pull requests are in none yet.
            if (task.state === 'done') return unshipped === null ? 'settled' : 'ready'
            if (task.runState === 'succeeded') return seeing && hands.running ? 'running' : 'ready'
            if (task.runState !== null && task.runState !== 'running') return 'stopped'
            // Held for a reset, it carries on on its own: under way, not stopped.
            return working || task.held !== null ? 'running' : 'stopped'
          })()
          const parameters = parse(task.parameters)
          const steps = field(parameters, 'steps')
          const planned = (Array.isArray(steps) ? steps : []).map((step) => {
            const model = field(step, 'model')
            // Its effort, whoever chose it, so the card shows it and a change made there keeps it.
            const effort = field(step, 'effort')
            return {
              key: text(step, 'key') === 'review' ? ('review' as const) : ('implement' as const),
              agentId: text(step, 'agentId'),
              model: typeof model === 'string' ? model : null,
              ...(typeof effort === 'string' ? { effort } : {}),
              skipped: field(step, 'skipped') === true,
            }
          })
          const end = text(parameters, 'end')
          // How hard its lead thinks: what its session is on, which it says once started; until then the plan's, while its lead is the plan's.
          const implement = planned.find((step) => step.key === 'implement')
          const onPlan = task.lead === null || (task.lead === implement?.agentId && task.leadModel === implement.model)
          const leadEffort = task.leadEffort ?? (onPlan ? (implement?.effort ?? null) : null)
          const { issue, changes } = links ?? (yield* linksOf(taskId))
          const shown = changes.find((candidate) => candidate.state === 'open') ?? changes.at(-1) ?? null
          // What it makes: its plan and its pull requests say so, whatever it wrote (a quick task stays plain until it is made a
          // change); for a review, git does too, by what is on its branch; for a task that settled, once, as nothing changes it
          // until it opens again.
          const quick = field(parameters, 'here') === true
          const reads = reviewing !== null && changes.length === 0
          // By its plan too: a quick task made a change in a round that was given up settles again at the same time, a change now.
          const settledAs = task.state === 'done' || task.state === 'abandoned' ? `${taskId}:${task.settledAt}:${quick}` : null
          const kept = settledAs === null ? undefined : settledKinds.get(settledAs)
          const kind = kept ?? kindOf({ reviewing, end, changes: changes.length, quick, made: reads ? yield* madeOf(taskId) : false })
          if (settledAs !== null) settledKinds.set(settledAs, kind)
          return {
            taskId,
            threadId: task.threadId,
            title: task.title,
            slug: task.slug,
            phase,
            kind,
            // What a plain task handed back, small on its card while it waits for the person.
            handed: kind === 'plain' ? yield* handedFor(task.threadId, latest?.content ?? null, task.runAt) : null,
            reviewing,
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
            // The first still open, for the person to act on: one merged while another isn't leaves the other. Else its latest.
            change: shown,
            earlier: changes.filter((candidate) => candidate !== shown).toReversed(),
            unshipped,
            // Resolving a conflict, or fixing the checks on the merge, is a step of its own while it lasts.
            step:
              task.step ??
              (phase !== 'running'
                ? null
                : resolving !== undefined
                  ? resolving.checks
                    ? 'checks'
                    : 'conflict'
                  : seeing
                    ? busy || !hands.running
                      ? 'checks'
                      : 'checks_running'
                    : null),
            followUp: task.runState === 'running' && task.runPlan === null,
            summary: latest === undefined ? null : text(parse(latest.content), 'summary') || null,
            lead: task.lead ?? (implement?.agentId || null),
            // Its session's model once one started; the plan's until then.
            leadModel: task.lead === null ? (implement?.model ?? null) : task.leadModel,
            leadEffort,
            branch: task.branch,
            startedAt: task.runAt ?? task.firstSession,
            waits: task.heldFor === 'usage_limit' ? waitsOf(task.held) : null,
            // A merged task whose lead goes back to work waits its turn too (ADR-034).
            queued: queued && task.state !== 'abandoned' ? yield* queuedNow : null,
            ...(queued && (yield* planWaits(taskId)) ? { planWaits: true } : {}),
            ...(round?.state === 'handed_back' && phase === 'ready' ? { handedBack: round.why } : {}),
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
          // A settled task whose lead works on it again isn't as it settled (ADR-034).
          const working = (yield* (yield* Sessions).onTasks).some((session) => session.taskId === row.id)
          const settled = row.settledAt === null || working ? undefined : settledCards.get(`${row.id}:${row.settledAt}`)
          if (settled !== undefined) return [settled]
          const card = yield* cardFor(row.id)
          if (card === undefined) return []
          // Ready, what merges here is read from git; without a pull request, so is its size: its branch's. A change at work
          // without one shows its branch's size so far.
          const atWork = (card.phase === 'running' || card.phase === 'stopped') && card.kind === 'change' && card.change === null
          // A plain task with no branch yet has nothing of its own in git to size.
          const said =
            (card.phase === 'ready' || atWork) && card.branch !== null
              ? yield* gitOf(row.id, { changed: card.change === null, here: card.phase === 'ready' })
              : null
          const changed =
            said !== null && card.change === null
              ? {
                  files: said.files.length,
                  add: said.files.reduce((sum, file) => sum + file.add, 0),
                  del: said.files.reduce((sum, file) => sum + file.del, 0),
                }
              : null
          // Not settled, whether nothing it asks waits for the person: by its own switch, or its project's (ADR-043).
          const sql = yield* SqlClient.SqlClient
          const [allows] =
            card.phase === 'settled'
              ? []
              : yield* sql<{ allows: number | null }>`
                  SELECT k.allow_everything = 1 OR ${sql.unsafe(PROJECT_ALLOWS('k.project_id'))} AS allows FROM tasks k WHERE k.id = ${row.id}`
          const read = {
            ...card,
            state: row.state,
            createdAt: row.createdAt,
            settledAt: row.settledAt,
            changed,
            here: said?.here ?? [],
            ...(allows?.allows === 1 ? { allowEverything: true } : {}),
          }
          if (row.settledAt !== null && card.phase === 'settled') settledCards.set(`${row.id}:${row.settledAt}`, read)
          // Back at work, what was kept of it as it settled goes: settled again, at the same time, it may say more.
          else for (const key of settledCards.keys()) if (key.startsWith(`${row.id}:`)) settledCards.delete(key)
          return [read]
        })

      /** The calls that wait on the person, in one project or every one, oldest first, each with its task. */
      const callsIn = (projectId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const where = projectId === null ? sql`p.archived_at IS NULL` : sql`a.project_id = ${projectId}`
          // A task's calls, and the questions a project's coordinator asks in its conversation.
          const calls = yield* sql<{
            id: string
            kind: string
            payload: string
            createdAt: string
            projectId: string
            taskId: string | null
            threadId: string
            taskTitle: string | null
            taskSlug: string | null
            askerAgentId: string | null
            askerModel: string | null
          }>`
            SELECT id, kind, payload, created_at, project_id, task_id, thread_id, task_title, task_slug,
              (SELECT agent_id FROM provider_sessions WHERE id = json_extract(payload, '$.sessionId')) AS asker_agent_id,
              (SELECT model FROM provider_sessions WHERE id = json_extract(payload, '$.sessionId')) AS asker_model
            FROM (
              SELECT a.id, a.kind, a.payload, a.created_at, a.project_id, k.id AS task_id, t.id AS thread_id, k.title AS task_title, k.slug AS task_slug
              FROM attention_requests a JOIN tasks k ON k.id = a.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
              JOIN projects p ON p.id = a.project_id
              WHERE ${where} AND a.state = 'open'
              UNION ALL
              SELECT a.id, a.kind, a.payload, a.created_at, a.project_id, NULL, t.id, NULL, NULL
              FROM attention_requests a JOIN threads t ON t.id = json_extract(a.payload, '$.threadId') AND t.kind = 'coordinator'
              JOIN projects p ON p.id = a.project_id
              WHERE ${where} AND a.state = 'open' AND a.task_id IS NULL AND a.kind = 'question')
            ORDER BY created_at, id`
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
              ORDER BY settled_at DESC, id DESC LIMIT ${SETTLED_SHOWN}))
            ORDER BY k.created_at, k.id`
          const [counted] = yield* sql<{
            total: number
          }>`SELECT COUNT(*) AS total FROM tasks WHERE project_id = ${projectId} AND state IN ('done', 'abandoned')`
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
            settledTotal: counted?.total ?? 0,
          } satisfies BoardSnapshot
        })

      /** The next page of a project's settled tasks, older than the one settled at `before` (`taskId` breaking a tie), most recent first. */
      const olderSettled = (projectId: string, before: string, taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{
            id: string
            state: string
            createdAt: string
            settledAt: string | null
          }>`
            SELECT id, state, created_at, settled_at FROM tasks
            WHERE project_id = ${projectId} AND state IN ('done', 'abandoned')
              AND (settled_at < ${before} OR (settled_at = ${before} AND id < ${taskId}))
            ORDER BY settled_at DESC, id DESC LIMIT ${SETTLED_SHOWN}`
          const tasks = yield* Effect.forEach(rows, onBoard, { concurrency: AT_ONCE })
          return tasks.flat()
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
                read.flatMap((task) =>
                  // A plain task that finished waits on its board, not here (DEV-96).
                  ON_HOME.includes(task.phase) && !(task.kind === 'plain' && task.phase === 'ready')
                    ? [{ ...task, projectId: row.projectId }]
                    : [],
                ),
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
          // Each automatic answer counted under whoever made it, never the person's own answers.
          const answered = yield* sql<{ actorId: string; count: number; first: string }>`
            SELECT d.decided_by_actor_id AS actor_id, count(*) AS count, min(d.decided_at) AS first
            FROM decisions d JOIN projects p ON p.id = d.project_id
            WHERE p.archived_at IS NULL AND d.permission_request_id IS NOT NULL
              AND d.decided_by_actor_id IN (${instance.systemId}, ${instance.coordinatorId}) AND d.decided_at > ${from}
            GROUP BY d.decided_by_actor_id`
          for (const group of answered) {
            const by = group.actorId === instance.coordinatorId ? 'coordinator' : 'rules'
            events.push({ kind: 'answered', id: `answered:${by}:${from}`, by, at: group.first, count: group.count })
          }
          return events
        })

      /**
       * A page of a task's thread reaches back to the start of the round its
       * first item is in, so it never opens partway through the lead's work
       * on one ask: to the latest ask at or before that item, or to the
       * thread's start where there is none, at most ROUND_REACH items further.
       * `earlier` then says whether anything comes before its new first item.
       */
      const fromRound = (threadId: string, page: { readonly items: ReadonlyArray<ItemRow>; readonly earlier: boolean }) =>
        Effect.gen(function* () {
          const [first] = page.items
          if (first === undefined || !page.earlier) return page
          const sql = yield* SqlClient.SqlClient
          const [ask] = yield* sql<{ sequence: number }>`
            SELECT i.sequence FROM thread_items i LEFT JOIN user_inputs u ON u.id = i.user_input_id
            WHERE i.thread_id = ${threadId} AND i.sequence <= ${first.sequence} AND (${sql.unsafe(ROUND_ASK)})
            ORDER BY i.sequence DESC LIMIT 1`
          if (ask?.sequence === first.sequence) return page
          const back = yield* itemRows(threadId, {
            before: first.sequence,
            ...(ask === undefined ? {} : { from: ask.sequence }),
            limit: ROUND_REACH,
          })
          const items = [...back.items, ...page.items]
          const { earlier } = yield* itemRows(threadId, { before: items[0]?.sequence ?? first.sequence, limit: 0 })
          return { items, earlier }
        })

      /** A page of a thread's items, as screens show them; a task's starts at a round (`fromRound`). */
      const pageOf = (threadId: string, page: { readonly before?: number; readonly limit?: number }, rounds = false) =>
        Effect.gen(function* () {
          const read = yield* itemRows(threadId, {
            ...(page.before === undefined ? {} : { before: page.before }),
            limit: page.limit ?? PAGE,
          })
          const { items, earlier } = rounds ? yield* fromRound(threadId, read) : read
          const shown = yield* Effect.forEach(items, (row) => (row.kind === 'task' ? cardOf(row) : Effect.succeed(itemOf(row))), {
            concurrency: AT_ONCE,
          })
          return { items: shown.flatMap((item) => (item === undefined ? [] : [item])), earlier }
        })

      /** A task's thread: its head, and a page of its items; `fresh` reads the files it changed from git, whatever is kept. */
      const thread = (threadId: string, page: { readonly before?: number; readonly limit?: number; readonly fresh?: boolean } = {}) =>
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
            request: string | null
            slug: string
            state: string
            branch: string | null
            worktree: string | null
            baseRef: string | null
            baseCommit: string | null
            settledAt: string | null
            resolveConflicts: number | null
            projectResolves: number | null
            allowEverything: number
            projectAllows: number | null
          }>`
            SELECT t.id AS thread_id, p.id AS project_id, p.name AS project_name, k.id AS task_id, k.title, k.description, k.request, k.slug, k.state,
              k.settled_at, ${sql.unsafe(SHOWN_BRANCH)}, w.path AS worktree, w.base_ref, w.base_commit, k.resolve_conflicts,
              (SELECT json_extract(r.rules, '$.resolveConflicts') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1) AS project_resolves,
              k.allow_everything, ${sql.unsafe(PROJECT_ALLOWS('p.id'))} AS project_allows
            FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = t.project_id
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })
          // What the store says comes first, together, so it is as of the cursor; git after.
          const { items, earlier } = yield* pageOf(threadId, page, true)
          // The lead's reports, whatever page they're on: the task's finished view is read from them.
          const reports = (yield* itemRows(threadId, { reports: true, limit: REPORTS })).items.map(itemOf)
          const attention = yield* sql<{
            id: string
            kind: string
            payload: string
            createdAt: string
            askerAgentId: string | null
            askerModel: string | null
          }>`
            SELECT a.id, a.kind, a.payload, a.created_at, (SELECT agent_id FROM provider_sessions WHERE id = json_extract(a.payload, '$.sessionId')) AS asker_agent_id,
              (SELECT model FROM provider_sessions WHERE id = json_extract(a.payload, '$.sessionId')) AS asker_model
            FROM attention_requests a WHERE a.task_id = ${head.taskId} AND a.state = 'open' ORDER BY a.created_at`
          // Since when the step it is on has run, or been held.
          const [onStep] = yield* sql<{ admittedAt: string }>`
            SELECT a.admitted_at FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id
            WHERE r.id = (SELECT id FROM runs WHERE task_id = ${head.taskId} ORDER BY created_at DESC LIMIT 1)
              AND a.state IN ('admitted', 'running', 'held') ORDER BY a.admitted_at DESC LIMIT 1`
          // Where it stands, from its card, which shows its links too: the header reads those with git, below.
          // Its links are read first and given to it: its kind, and where it opens, depend on its pull requests.
          const links = yield* linksOf(head.taskId)
          const card = yield* cardFor(head.taskId, links)
          const session = yield* sessionOf(threadId)
          // Who leads it when no lead runs: the last on its thread, else its plan's.
          const [last] = yield* sql<{ agentId: string; model: string | null; account: string | null }>`
            SELECT s.agent_id, s.model, a.name AS account FROM provider_sessions s LEFT JOIN agent_accounts a ON a.id = s.account_id
            WHERE s.thread_id = ${threadId} ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
          const planned = card?.plan?.steps.find((step) => step.key === 'implement')
          // What the person can do to it as a whole, from where it stands.
          const standing = yield* standingOf(head.taskId)
          // Whether its run under way still has a review to come or under way, which the person can skip (ADR-034).
          const [reviewing] = yield* sql<{ left: number }>`
            SELECT count(*) AS left FROM runs r, json_each(r.parameters, '$.steps') s
            WHERE r.id = (SELECT id FROM runs WHERE task_id = ${head.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1)
              AND r.state = 'running' AND json_extract(s.value, '$.key') = 'review' AND NOT json_extract(s.value, '$.skipped')`
          // What git says of its worktrees, and its host, read at the same time.
          const [said, host] = yield* Effect.all(
            [gitOf(head.taskId, { changed: true, here: true, fresh: page.fresh === true }), hostOf(head.projectId)],
            {
              concurrency: 'unbounded',
            },
          )
          return {
            threadId,
            cursor: at,
            project: { id: head.projectId, name: head.projectName },
            host,
            task: {
              id: head.taskId,
              title: head.title,
              description: head.description,
              request: head.request,
              slug: head.slug,
              state: head.state,
              branch: head.branch,
              worktree: head.worktree,
              baseRef: head.baseRef,
              phase: card?.phase ?? null,
              kind: card?.kind,
              handedBack: card?.handedBack ?? null,
              waits: card?.waits ?? null,
              queued: card?.queued ?? null,
              steps: card?.plan?.steps ?? [],
              lead: last ?? (planned === undefined ? null : { agentId: planned.agentId, model: planned.model, account: null }),
              step: card?.step ?? null,
              startedAt: card?.startedAt ?? null,
              stepAt: onStep?.admittedAt ?? null,
              settledAt: head.settledAt,
              ...links,
              unshipped: card?.unshipped ?? null,
              skipReview: (reviewing?.left ?? 0) > 0 && card?.step !== 'publish',
              followUp: card?.followUp === true,
              files: said.files,
              commits: said.commits,
              here: said.here,
              merged: said.merged,
              // With commits after its last pull request in none yet, a merged task abandons them, leaving them out, and stays merged:
              // an open one only where every repository of it is merged, as settling it asks, else leaving out wouldn't settle it.
              actions: [
                ...actionsOf({
                  ...standing,
                  unshipped: card?.unshipped != null,
                  merged:
                    head.state === 'open' &&
                    card?.unshipped != null &&
                    (yield* (yield* Changes).merged(head.taskId).pipe(Effect.orElseSucceed(() => false))),
                }),
              ],
              planId: standing.planId,
              runCommand: yield* launches.commandFor(head.projectId, head.taskId).pipe(Effect.orElseSucceed(() => null)),
              launches: (yield* launches.ofProject(head.projectId)).filter((launch) => launch.taskId === head.taskId),
              resolveConflicts: {
                task: head.resolveConflicts === null ? null : head.resolveConflicts === 1,
                project: head.projectResolves === 1,
              },
              allowEverything: { task: head.allowEverything === 1, project: head.projectAllows === 1 },
              review: yield* reviewBriefOf(head.taskId),
            },
            session,
            attention: attention.map(callOf),
            items,
            earlier,
            reports: reports.flatMap((item) => (item === undefined ? [] : [item])),
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
            runCommand: yield* launches.commandFor(projectId, null).pipe(Effect.orElseSucceed(() => null)),
            // Every run in the project, the tasks' too: the coordinator's screen is the project's.
            launches: yield* launches.ofProject(projectId),
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
                WHEN 'issue_draft' THEN (SELECT thread_id FROM issue_drafts WHERE id = c.aggregate_id)
                WHEN 'review_draft' THEN (SELECT thread_id FROM review_drafts WHERE id = c.aggregate_id)
              END AS thread_id
            FROM change_log c WHERE c.cursor > ${after} ORDER BY c.cursor LIMIT ${limit}`
        })

      // The coordinator's list_tasks and read_task say how each task's pull request stands, from the same reads as the card.
      yield* (yield* Coordinator).reading((taskId) => run(pullRequestsOf(taskId)).pipe(Effect.orElseSucceed(() => undefined)))

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
        card: (taskId) =>
          run(
            Effect.flatMap(cardFor(taskId), (found) =>
              found === undefined ? Effect.fail(new NotFound({ kind: 'task', id: taskId })) : Effect.succeed(found),
            ),
          ),
        finished: run(finishedPlain),
        board: (projectId) => run(board(projectId)),
        olderSettled: (projectId, before, taskId) => run(olderSettled(projectId, before, taskId)),
        home: (since) => run(home(since)),
        item: (threadId, itemId) => run(item(threadId, itemId)),
        // A command still running is read from what it has printed so far; one that ended, from what was kept.
        output: (threadId, itemId) =>
          run(
            Effect.gen(function* () {
              const soFar = yield* (yield* Sessions).outputSoFar(threadId, itemId)
              return Option.isSome(soFar) ? { text: soFar.value.text, dropped: soFar.value.dropped } : yield* outputText(threadId, itemId)
            }),
          ),
        document: (threadId, path) =>
          run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              // A task's documents are in its worktrees here; the coordinator writes none.
              const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
              if (thread?.taskId == null) return yield* new NotFound({ kind: 'document', id: path })
              const worktrees = yield* worktreesOf(thread.taskId)
              return yield* documentText(
                path,
                worktrees.map((worktree) => worktree.path),
              )
            }),
          ),
        coordinator: (projectId, page) => run(coordinator(projectId, page)),
        changesSince: (after, limit) => run(changesSince(after, limit)),
        cursor: run(cursor),
      })
    }),
  )
}
