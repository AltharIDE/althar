import { errandRecords } from './Errands'
import { errandCardLines } from './errandWords'
import { HOSTED, MergeRules, newPullRequestLink } from '@althar/connectors'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

import {
  type AfterMergeRule,
  CheckoutAsk,
  AllowedBy,
  AttachedFile,
  AttentionRequest,
  AutomationCard,
  Irreversible,
  type BoardSnapshot,
  type ChangeSummary,
  CheckLogShown,
  ChecksSummary,
  type CoordinatorSnapshot,
  type HomeEvent,
  type HomeSnapshot,
  IssueChangesCard,
  IssueDraftCard,
  ReviewDraftCard,
  SettingChangeCard,
  type IssueSummary,
  type HeldForConnection,
  type HeldForLimit,
  LimitCall,
  LimitChoice,
  PAGE,
  Unfurl,
  type TaskPhase,
  type ProjectList,
  type StuckStep,
  type TaskCard,
  type TaskList,
  type TaskSummary,
  type CodeFound,
  type CodePlace,
  type CodeText,
  type DocumentText,
  FieldAnswer,
  type OutputText,
  PushRequestItem,
  TaskAskItem,
  QuestionField,
  type ThreadItem,
  MergeLineItem,
  ModelMoveItem,
  NoticeItem,
  type ThreadSnapshot,
  type TurnTime,
  type ScreenshotsOnChange,
  type TaskFindings,
  plainTitle,
  toolPhrase,
} from '@althar/contracts'
import { Cause, Clock, Context, Deferred, Duration, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Ledger } from '@althar/persistence-sqlite'
import { Busy, type Line } from './Busy'
import { taskOfChange } from './taskOf'
import { markOf, openItem, viewOf } from './chatView'
import { ModelFacts } from './ModelFacts'
import { PlanUsage } from './PlanUsage'
import { beforeFirstStep, checkoutWaitOf, PlanParameters, planWaits, reviewerChange } from './Runs'
import { localTakenFor } from './local'
import { towardChoicesOf } from './towards'
import { Agents, RuntimeConfig } from './Config'
import { backgroundOf, questionTitle } from './Questions'
import { Changes, STUCK_AFTER } from './Changes'
import { Coordinator } from './Coordinator'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import type { PullRequestFacts } from './pullRequestStanding'
import { baseOf, changedBetween, type ChangedFile, changedFiles, fileDiff, type FileDiff, unchangedFileDiff } from './diffs'
import { changedWords, smallChangeOf, smallChangeSkips } from './smallChange'
import { afterMergeNow } from './afterMergeReview'
import { builtIn, descriptionsIn, evidenceOf, evidencePaths, keptViewsIn, shownOf, unverifiedIn } from './evidence'
import { graphOf, type RunRows, type StepRow } from './graph'
import { taskFindingsOf } from './taskFindings'
import { filesOf, outputOf, picturesOf } from './handed'
import { answeredIn, handedOf, issueCardsWaiting, kindOf } from './kinds'
import { reviewOfferOf } from './reviewOffer'
import { repliedAt } from './replied'
import { BETWEEN_AGENTS_MS, betweenAgents, byItself, DRAFTING_MS, isMergeable, stillAsked, stillDrafting } from './needsYou'
import { mergeNeedsOf, withPushed } from './mergeNeeds'
import { documentKept, documentText, outputText } from './reading'
import { type CodeRoot, type CodeRoots, findCode, readCode } from './code'
import type { Artifacts } from './Artifacts'
import { type DocumentRefused, GitFailed, NotFound } from './errors'
import { folderOf, KEPT } from './bringBack'
import { Instance } from './Instance'
import { Launches } from './Launches'
import type { ChangeTarget } from '@althar/domain'
import { commitOf, commitsAhead, commitsOf, git, gitOutcome, indexStamp, namedRemotes, PUSHED, branchRemoteIn } from './git'
import { reachedRemote } from './sshHosts'
import { commandIn, shortCommand } from './rules'
import { reviewBriefOf } from './Reviews'
import { partsOfPlan, presetOf, presetsIn } from './presets'
import { Sessions } from './Sessions'
import { spendingOf } from './Spending'
import { timingsFrom } from './turnTimes'
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

/** How long changes are gathered before the cards they moved are worked out again: a burst works each out once. */
const CARDS_GATHER = Duration.millis(50)

/** How many changes are read at once as the cards they moved are found. */
const CARD_CHANGES = 1000

/** How many of its steps' reports a thread reads beside its page, newest first: far more than a task's rounds have. */
const REPORTS = 200

/** How many of a task's rounds of work its graph reads, newest: far more than a task has. */
const GRAPH_ROUNDS = 100

/** What a revision of a run's graph keeps of its steps, by key. */
const GraphSteps = Schema.fromJsonString(
  Schema.Struct({ steps: Schema.optional(Schema.Array(Schema.Struct({ key: Schema.String, skipped: Schema.optional(Schema.Boolean) }))) }),
)

/** A step of a run, as `nodes` names it. */
const NodeKey = Schema.Literals(['implement', 'review', 'settle', 'publish'])

/** What a follow-up's message or relayed notice says, from its stored content. */
const SaidContent = Schema.fromJsonString(
  Schema.Struct({
    text: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)

/** What started a follow-up, in the words its thread shows: the person's message, or what the coordinator passed on. */
const saidOf = (item: { readonly id: string; readonly kind: string; readonly content: string }) =>
  Option.match(Schema.decodeUnknownOption(SaidContent)(item.content), {
    onNone: () => null,
    onSome: (content) => {
      const relayed = item.kind === 'notice'
      const text = relayed ? (content.description ?? content.title) : content.text
      return text === undefined ? null : { itemId: item.id, text, relayed }
    },
  })

/** How many open items, at most, a cleared view carries in from before its mark. */
const CARRIED = 200

/** How many items further back, at most, a page of a task's thread reaches for the start of its first round: one enormous round loads in pages. */
const ROUND_REACH = 2_000

/**
 * What starts a round of a task's thread, as SQL over its item `i` and that
 * item's input `u`: an ask the lead's work answers. What the person said,
 * once the lead has it; what Althar says that isn't its own housekeeping
 * (`aside`, or its folder going or coming back), such as what the coordinator passed on, a conflict or failed
 * checks; a review's verdict or what publishing found; and what arrived on
 * a pull request.
 */
const ROUND_ASK = `(i.kind = 'user_message' AND coalesce(u.state, 'delivered') = 'delivered')
  OR (i.kind = 'notice' AND json_extract(i.content, '$.source') = 'runtime' AND coalesce(json_extract(i.content, '$.role'), '') NOT IN ('aside', 'folder', 'skills')
    AND json_extract(i.content, '$.situation') IS NULL)
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

/** A tool call's skills, as `threads.ts` keeps them. */
/** What a call to one of the person's MCP servers did, as its item keeps it (ADR-097); nothing for any other call. */
const mcpOf = (kept: unknown) => {
  const server = text(kept, 'server')
  const tool = text(kept, 'tool')
  if (server === '' || tool === '') return {}
  const words = text(kept, 'words')
  const link = text(kept, 'link')
  return {
    mcp: {
      server,
      tool,
      acts: field(kept, 'acts') === true,
      // What it did, in words: a read kept only the tool's own name, which reads as a phrase here.
      did: text(kept, 'did') !== tool && text(kept, 'did') !== '' ? text(kept, 'did') : toolPhrase(server, tool),
      ...(words === '' ? {} : { words }),
      ...(link.startsWith('https://') ? { link } : {}),
    },
  }
}

const skillOf = (skill: unknown) => {
  const names = field(skill, 'names')
  return Array.isArray(names) && names.length > 0
    ? { skill: { names: names.filter((name): name is string => typeof name === 'string'), reported: field(skill, 'reported') === true } }
    : {}
}

interface ItemRow {
  readonly id: string
  readonly sequence: number
  readonly kind: string
  readonly content: string
  readonly agentId: string | null
  /** The model its turn ran on, as the turn was given; null where no agent wrote it or it wasn't recorded. */
  readonly model?: string | null
  readonly inputState: 'queued' | 'delivered' | 'superseded' | 'withdrawn' | null
  readonly disposition: string | null
  /** For a message the person said: some of it was dictated. */
  readonly dictated?: number | null
  /** For a tool call that asked: what was decided, last. */
  readonly decision: string | null
  /** For a tool call the project's allow rules let through: the rules, as the decision keeps them (ADR-018). */
  readonly rule?: string | null
  /** For a refused tool call: why it was, and who decided: Althar's rules, the lead or the person. */
  readonly reason?: string | null
  readonly decidedBy?: 'rules' | 'coordinator' | 'person' | null
  /** For a question: its call's state and payload, where its answer is. */
  readonly questionState?: string | null
  readonly questionPayload?: string | null
  /** For a tool call: the agent asking the person something, which its question stands for. */
  readonly asks?: number | null
  readonly createdAt: string
  /** The turn it came in, where an agent's turn wrote it. */
  readonly deliveryId?: string | null
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
  const asked = questionOf(payload)
  // What the agent said before, else what its question says past its headline.
  const why = text(payload, 'why') || backgroundOf(asked.fields[0]?.question ?? asked.message)
  return {
    ...asked,
    ...(why === '' ? {} : { why }),
    ...(asker.agentId == null ? {} : { askedBy: { agentId: asker.agentId, model: asker.model ?? null } }),
  }
}

const decodeAllowedBy = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(AllowedBy)))
const decodeLimit = Schema.decodeUnknownOption(LimitCall)
const decodeChoice = Schema.decodeUnknownOption(LimitChoice)
/**
 * What a plan card offers to work toward (ADR-093). Only a proposed plan,
 * which a hold stops, can have a branch made for it: one accepted and waiting
 * for a free agent could start while the host makes it, toward the old one,
 * so it is pointed only at a branch the remote has, which changes at once.
 */
const choicesOf = (taskId: string, proposed: boolean) =>
  Effect.map(towardChoicesOf(taskId), (choices) => {
    if (choices === null) return {}
    if (proposed) return choices
    const { repositoryId: _made, ...rest } = choices
    return rest
  })

/** One who could take a held step over, as its hold kept it; one that doesn't read is left out. */
const choiceOf = (value: unknown) => Option.toArray(decodeChoice(value))
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
  const service = field(payload, 'service')
  const model = field(payload, 'model')
  const provider = field(payload, 'provider')
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
      why === 'refused' ||
      why === 'transient' ||
      why === 'signed_out' ||
      why === 'sign_in_ended' ||
      why === 'not_installed' ||
      why === 'waiting_on_person'
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
    ...(typeof service === 'string' ? { service } : {}),
    ...(typeof model === 'string' ? { model } : {}),
    ...(typeof provider === 'string' ? { provider } : {}),
  }
}

const number = (value: unknown, key: string): number | null => {
  const found = field(value, key)
  return typeof found === 'number' ? found : null
}

/** Failed checks' logs as an arrival kept them; one not of that shape, or from before they were kept, is left out. */
const logsShown = (value: unknown): ReadonlyArray<CheckLogShown> =>
  Array.isArray(value) ? value.flatMap((one) => Option.toArray(Schema.decodeUnknownOption(CheckLogShown)(one))) : []

/** What a checkout's ask says at a glance, as a card's headline: on another branch, or with changes not committed (ADR-091). */
const checkoutTitle = (payload: unknown) =>
  text(payload, 'holdup') === 'branch'
    ? `${text(payload, 'repository') || 'Local'} is on another branch`
    : `${text(payload, 'repository') || 'Local'} has uncommitted changes`

/** Where a call that waited reached the person besides the window, and whether its lead was set aside to go on (docs/decisions/097). */
const reachedOf = (payload: unknown) => {
  const reached = field(payload, 'reached')
  const device = text(reached, 'device')
  const at = text(reached, 'at')
  return {
    ...(device === '' || at === '' ? {} : { reached: { device, at } }),
    ...(field(payload, 'setAside') === true ? { setAside: true } : {}),
  }
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
    kind:
      request.kind === 'stuck'
        ? ('stuck' as const)
        : request.kind === 'question'
          ? ('question' as const)
          : request.kind === 'checkout'
            ? ('checkout' as const)
            : ('permission' as const),
    title:
      request.kind === 'question'
        ? questionTitle(questionOf(payload))
        : request.kind === 'checkout'
          ? checkoutTitle(payload)
          : plainTitle(text(payload, 'title')),
    reason: text(payload, 'reason'),
    command,
    ...(command === null ? {} : { label: shortCommand(command) }),
    // A permission the rules keep for the person whatever they let through: no "always allow" can answer it.
    ...(request.kind === 'permission' && field(payload, 'held') === true ? { held: true } : {}),
    // What a permission that can't be undone says on its card (ADR-097).
    ...Option.match(
      request.kind === 'permission' ? Schema.decodeUnknownOption(Irreversible)(field(payload, 'irreversible')) : Option.none(),
      { onNone: () => ({}), onSome: (irreversible) => ({ irreversible }) },
    ),
    ...reachedOf(payload),
    stuck: request.kind === 'stuck' ? stuckOf(payload) : null,
    // What Althar asks before a Local task takes a checkout (ADR-091).
    ...Option.match(request.kind === 'checkout' ? Schema.decodeUnknownOption(CheckoutAsk)(payload) : Option.none(), {
      onNone: () => ({}),
      onSome: (checkout) => ({ checkout }),
    }),
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
  const seen: ChangeSummary = {
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
    ...(field(value, 'queued') === true ? { queued: true } : {}),
    head: text(value, 'headSha') || null,
    listening,
    localHead: null,
    unpushed: 0,
    diverged: null,
  }
  // What merging it needs, as its host last said, with what Althar knows of it (DEV-204); what is left to push is counted later.
  const needs = mergeNeedsOf(seen, Option.getOrNull(decodeRules(field(value, 'rules'))))
  return needs === undefined ? seen : { ...seen, needs }
}

const decodeLinks = Schema.decodeUnknownOption(Schema.Array(Unfurl))
const decodeAttached = Schema.decodeUnknownOption(Schema.Array(AttachedFile))
const decodeDraft = Schema.decodeUnknownOption(IssueDraftCard)
const decodeIssueChanges = Schema.decodeUnknownOption(IssueChangesCard)
const decodeReviewDraft = Schema.decodeUnknownOption(ReviewDraftCard)
const decodeAutomation = Schema.decodeUnknownOption(AutomationCard)
const decodePushRequest = Schema.decodeUnknownOption(PushRequestItem.fields.content)
const decodeTaskAsk = Schema.decodeUnknownOption(TaskAskItem.fields.content)
const decodeSettingChange = Schema.decodeUnknownOption(SettingChangeCard)
const decodeModelMove = Schema.decodeUnknownOption(ModelMoveItem.fields.content)
const decodeMergeLine = Schema.decodeUnknownOption(MergeLineItem.fields.content)
/** The task a notice is about, which the thread links to: one its lead started (ADR-097), in one line. */
const decodeNoticeTask = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, slug: Schema.String, title: Schema.String, threadId: Schema.String }),
)
/** What a notice offers: parts kept as a preset, or a review a lead or the coordinator offered a task, which its buttons answer. */
const decodeNoticeOffer = Schema.decodeUnknownOption(NoticeItem.fields.content.fields.offer)
const decodeChecks = Schema.decodeUnknownOption(ChecksSummary.fields.list)
const decodeRules = Schema.decodeUnknownOption(MergeRules)

const PRODUCTS = ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello'] as const

/**
 * A stored item as the contract has it: each kind with its own content. A
 * tool call keeps what a screen shows (the command it runs and the files it
 * touches), not its raw input and output. Kinds the contract doesn't have yet,
 * such as a step's result, are left out.
 */
export const itemOf = (row: ItemRow): ThreadItem | undefined => {
  const content = parse(row.content)
  const base = {
    id: row.id,
    sequence: row.sequence,
    agentId: row.agentId,
    ...(row.model == null ? {} : { model: row.model }),
    createdAt: row.createdAt,
    ...(row.deliveryId == null ? {} : { turn: row.deliveryId }),
  }
  switch (row.kind) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        content: {
          text: text(content, 'text'),
          links: Option.getOrElse(decodeLinks(field(content, 'links') ?? []), () => []),
          pictures: picturesOf(field(content, 'pictures')),
          files: Option.getOrElse(decodeAttached(field(content, 'files') ?? []), () => []),
        },
        input:
          row.inputState === null
            ? null
            : {
                state: row.inputState,
                interrupting: row.disposition === 'interrupt_and_continue',
                ...(row.dictated === 1 ? { dictated: true } : {}),
              },
      }
    case 'agent_message':
    case 'agent_thought': {
      const answer = field(content, 'answer')
      return {
        ...base,
        kind: row.kind,
        content: {
          text: text(content, 'text'),
          pictures: picturesOf(field(content, 'pictures')),
          files: filesOf(field(content, 'files')),
          ...(typeof answer === 'boolean' ? { answer } : {}),
        },
      }
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
          ...(row.decision === 'reject' && row.decidedBy ? { declinedBy: row.decidedBy } : {}),
          ...(row.decision === 'reject' && row.reason ? { declinedWhy: row.reason } : {}),
          ...(row.asks === 1 ? { asks: true } : {}),
          ...(allowedBy === undefined ? {} : { allowedBy }),
          ...skillOf(field(content, 'skill')),
          ...mcpOf(field(content, 'mcp')),
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
      // Why an agent's turn failed, so the thread offers the way out that fits.
      const failure = text(content, 'failure')
      // Older threads kept the agent's explanation of a refusal as a notice; the refused call's own row says it now.
      const title = text(content, 'title')
      if (title === 'Resumed after a rejection.') return undefined
      // What a lead's agent could see is kept for `skillsRead`, not for a chat: a line for it never reaches the window.
      if (role === 'skills') return undefined
      // What older threads said of another task (one that ended, or one changing the same files): news for the lead, not for the chat.
      if (field(content, 'situation') !== undefined) return undefined
      // Likewise the coordinator's receipt of a denial, kept by older threads.
      if (title?.startsWith('Denied ') && description?.startsWith('By the coordinator:') && text(content, 'about') === 'permission')
        return undefined
      return {
        ...base,
        kind: 'notice',
        content: {
          source: text(content, 'source') === 'runtime' ? 'runtime' : 'agent',
          severity: severity === 'error' || severity === 'warning' ? severity : 'info',
          title: text(content, 'title'),
          description: description === '' ? null : description,
          ...(role === 'aside' || role === 'relayed' || role === 'folder' ? { role } : {}),
          ...(failure === undefined || failure === '' ? {} : { failure }),
          ...Option.match(decodeNoticeTask(field(content, 'task')), { onNone: () => ({}), onSome: (task) => ({ task }) }),
          ...Option.match(decodeNoticeOffer(field(content, 'offer')), {
            onNone: () => ({}),
            onSome: (offer) => (offer === undefined ? {} : { offer }),
          }),
        },
      }
    }
    case 'step_result': {
      const step = text(content, 'step')
      const verdict = text(content, 'verdict')
      const findings = field(content, 'findings')
      const round = field(content, 'round')
      const agentId = text(content, 'agentId')
      const model = text(content, 'model')
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
            const title = text(finding, 'title')
            return {
              severity: severity === 'blocking' || severity === 'major' || severity === 'nit' ? severity : 'minor',
              file: text(finding, 'file') || null,
              line: typeof line === 'number' ? line : null,
              claim: text(finding, 'claim'),
              ...(title === '' ? {} : { title }),
            }
          }),
          built: builtIn(field(content, 'built')),
          evidence: evidenceOf(field(content, 'evidence')),
          unverified: unverifiedIn(field(content, 'unverified')),
          ...descriptionsIn(field(content, 'descriptions')),
          ...keptViewsIn(field(content, 'keptViews')),
          // A review after a merge says which pull request it read.
          ...(text(field(content, 'afterMerge'), 'url') === ''
            ? {}
            : {
                afterMerge: {
                  url: text(field(content, 'afterMerge'), 'url'),
                  words: text(field(content, 'afterMerge'), 'words'),
                  ...(field(field(content, 'afterMerge'), 'kept') === true ? { kept: true } : {}),
                },
              }),
          agentId: agentId === '' ? null : agentId,
          ...(model === '' ? {} : { model }),
        },
      }
    }
    case 'pictures':
      return { ...base, kind: 'pictures', content: { pictures: shownOf(field(content, 'pictures')) } }
    case 'canvas': {
      const canvasKind = text(content, 'canvasKind')
      const version = field(content, 'version')
      const note = text(content, 'note')
      return {
        ...base,
        kind: 'canvas',
        content: {
          canvasId: text(content, 'canvasId'),
          name: text(content, 'name'),
          title: text(content, 'title'),
          canvasKind:
            canvasKind === 'markdown' || canvasKind === 'mermaid' || canvasKind === 'svg' || canvasKind === 'picture' ? canvasKind : 'html',
          version: typeof version === 'number' ? version : 1,
          note: note === '' ? null : note,
          action: text(content, 'action') === 'opened' ? 'opened' : 'published',
          open: field(content, 'open') === true,
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
          logs: logsShown(field(content, 'logs')),
          url: text(content, 'url') || null,
          outsider: field(content, 'outsider') === true,
        },
      }
    }
    case 'run': {
      const ended = field(content, 'ended')
      const code = field(ended, 'code')
      const ref = field(content, 'ref')
      const kind = field(ref, 'kind')
      return {
        ...base,
        kind: 'run',
        content: {
          launchId: text(content, 'launchId'),
          taskId: text(content, 'taskId') || null,
          runnableId: text(content, 'runnableId') || null,
          name: text(content, 'name') || null,
          where: text(content, 'where'),
          // A branch's or a pull request's run (ADR-066): what it is at a glance, and what was asked for, to run it again.
          branch: text(content, 'branch') || null,
          ref: kind === 'branch' || kind === 'pull_request' ? { kind, which: text(ref, 'which') } : null,
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
    // An automation's card, written whole as the coordinator proposes or changes it, and kept current with where it stands.
    case 'automation':
      return Option.match(decodeAutomation(content), {
        onNone: () => undefined,
        onSome: (card): ThreadItem => ({ ...base, kind: 'automation', content: card }),
      })
    // Changes to issues, written whole with each change, as an issue draft's card is.
    case 'issue_changes':
      return Option.match(decodeIssueChanges(content), {
        onNone: () => undefined,
        onSome: (card): ThreadItem => ({ ...base, kind: 'issue_changes', content: card }),
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
    // The coordinator asking the person to move a task on, written whole as it is asked and answered.
    case 'task_ask':
      return Option.match(decodeTaskAsk(content), {
        onNone: () => undefined,
        onSome: (asked): ThreadItem => ({ ...base, kind: 'task_ask', content: asked }),
      })
    // A setting changed, or a change that loosens what asks waiting on the person's card (SettingsTools.ts).
    case 'setting':
      return Option.match(decodeSettingChange(content), {
        onNone: () => undefined,
        onSome: (card): ThreadItem => ({ ...base, kind: 'setting', content: card }),
      })
    // Auto's line on moving the lead to a lighter model (modelMoves.ts), written whole, and kept current with the person's keep.
    case 'model_move':
      return Option.match(decodeModelMove(content), {
        onNone: () => undefined,
        onSome: (move): ThreadItem => ({ ...base, kind: 'model_move', content: move }),
      })
    // The merge line for a branch (MergeLine.ts), kept current in place.
    case 'merge_line':
      return Option.match(decodeMergeLine(content), {
        onNone: () => undefined,
        onSome: (card): ThreadItem => ({ ...base, kind: 'merge_line', content: card }),
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

type Store =
  | SqlClient.SqlClient
  | Ledger
  | Instance
  | Agents
  | ModelFacts
  | PlanUsage
  | Sessions
  | Coordinator
  | Changes
  | PullRequestScreenshots
  | RuntimeConfig
  | Artifacts
  | Launches
  | Busy

/** The lines of what waits one read has read, by project: a board of queued cards reads its line once, not once a card. */
const LinesRead = Context.Reference<Map<string, Deferred.Deferred<Line>> | null>('@althar/runtime/Queries/LinesRead', {
  defaultValue: () => null,
})

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
    /** One item as a window reads it, by id: null for one the thread keeps for Althar and never shows. */
    shown(threadId: string, itemId: string): Effect.Effect<ThreadItem | null, SqlError.SqlError | NotFound>
    /** What a command in a thread printed, as kept when it ended. */
    output(threadId: string, itemId: string): Effect.Effect<OutputText, SqlError.SqlError | NotFound>
    /** A markdown document an agent in a thread wrote, as it is now in the task's worktrees. */
    document(threadId: string, path: string): Effect.Effect<DocumentText, SqlError.SqlError | NotFound | DocumentRefused>
    /** One file a task changed, as a diff from its base to its worktree; with `untouched`, one it left as it was, as a finding may name. */
    fileDiff(taskId: string, path: string, untouched?: boolean): Effect.Effect<FileDiff, unknown>
    /** What the reviews of a task's latest run found, each where it is in the change now and what became of it. */
    findings(taskId: string, review?: string): Effect.Effect<TaskFindings, unknown>
    /** Where a thread's agent works, for the code it names: its task's worktrees here, or the project's repositories at their default branches. */
    codeRoots(threadId: string): Effect.Effect<CodeRoots, SqlError.SqlError | NotFound>
    /** What the names in a thread's messages name there, each message as it was when said where it is an item of the thread. */
    findCode(
      threadId: string,
      messages: ReadonlyArray<{ readonly itemId?: string | undefined; readonly names: ReadonlyArray<string> }>,
    ): Effect.Effect<
      { readonly place: CodePlace; readonly messages: ReadonlyArray<{ readonly found: ReadonlyArray<CodeFound> }> },
      SqlError.SqlError | NotFound
    >
    /** A file there, as findCode named it: as it is now, or at a commit its default branch was at when a message was said. */
    readCode(threadId: string, path: string, commit?: string, line?: number): Effect.Effect<CodeText, SqlError.SqlError | NotFound>
    /** A task's card, as its board shows it: where it stands and what it makes. */
    card(taskId: string): Effect.Effect<TaskCard, unknown>
    /** The tasks the person kept for later, by id: out of Needs you, so nothing counts them as waiting on the person. */
    readonly kept: Effect.Effect<ReadonlySet<string>, unknown>
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
      // How long a draft waits for its plan before it is the person's (DRAFTING_MS unless a test says otherwise).
      const draftingMs = Duration.toMillis(config.drafting ?? Duration.millis(DRAFTING_MS))
      const launches = yield* Launches
      // Each read reads a project's line once, however many of its cards wait in it.
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) =>
        Effect.provideContext(
          Effect.suspend(() => Effect.provideService(effect, LinesRead, new Map())),
          context,
        )
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
            readonly answered: string
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
            (SELECT count(*) FROM attention_requests a WHERE a.project_id = p.id AND a.state = 'open')
              + (SELECT coalesce(sum(${sql.unsafe(issueCardsWaiting('wk'))}), 0) FROM tasks wk WHERE wk.project_id = p.id AND wk.state = 'open') AS waiting,
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
                AND ${sql.unsafe(issueCardsWaiting('k'))} = 0
                AND NOT EXISTS (SELECT 1 FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                  WHERE e.run_id = r.id AND a.state = 'admitted')) AS ready,
            -- A review has no run: drafted, it is the person's to post, as its card says, unless a call on it waits on them first.
            (SELECT json_group_array(k.id) FROM tasks k WHERE k.project_id = p.id AND k.state = 'open'
                AND EXISTS (SELECT 1 FROM review_drafts d WHERE d.task_id = k.id AND d.state IN ('pending', 'failed', 'uncertain'))
                AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')
                AND ${sql.unsafe(issueCardsWaiting('k'))} = 0) AS drafted,
            -- Or posted, written to again and answered: finished, the person's to settle, once its lead's turn is over (read below).
            (SELECT json_group_array(json_object('task', k.id, 'thread', t.id)) FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
              WHERE k.project_id = p.id AND k.state = 'open' AND ${sql.unsafe(answeredIn('k'))}
                AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')
                AND ${sql.unsafe(issueCardsWaiting('k'))} = 0) AS answered,
            coalesce((SELECT json_extract(r.rules, '$.usageLimit') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 'move') AS usage_limit,
            coalesce((SELECT json_extract(r.rules, '$.accounts.rotate') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1), 0) AS rotate_accounts,
            (SELECT json_extract(r.rules, '$.accounts.only') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1) AS only_accounts,
            (SELECT t.id FROM threads t WHERE t.project_id = p.id AND t.kind = 'coordinator' AND t.owner_actor_id = ${instance.personId}) AS coordinator_thread_id
          FROM projects p WHERE p.archived_at IS NULL ORDER BY p.created_at DESC, p.id DESC`
        // A task kept for later waits behind its board's Settled, out of Needs you: no count says it.
        const kept = yield* keptForLater
        // A review answered is finished once its lead's turn is over, as its card says: not while it answers.
        const sessions = yield* Sessions
        const answered = new Map<string, ReadonlyArray<string>>()
        for (const row of rows) {
          const finished: Array<string> = []
          for (const one of JSON.parse(row.answered) as ReadonlyArray<{ task: string; thread: string }>)
            if (!Option.exists(yield* sessions.running(one.thread), (session) => session.turnRunning)) finished.push(one.task)
          answered.set(row.id, finished)
        }
        return {
          cursor: at,
          projects: rows.map(({ drafted, answered: _answered, ...row }) => ({
            ...row,
            // Each task once: one ready and drafted both, as a review taken over might be, counts once.
            ready: [
              ...new Set([
                ...(JSON.parse(row.ready) as ReadonlyArray<string>),
                ...(JSON.parse(drafted) as ReadonlyArray<string>),
                ...(answered.get(row.id) ?? []),
              ]),
            ].filter((id) => !kept.has(id)).length,
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
              (SELECT count(*) FROM attention_requests a WHERE a.task_id = k.id AND a.state = 'open') + ${sql.unsafe(issueCardsWaiting('k'))} AS waiting,
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
          /** Only items that are still open: what a cleared view carries into the thread (`openItem`). */
          readonly open?: boolean
          readonly itemId?: string
          readonly limit: number
          readonly reports?: boolean
        },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<ItemRow>`
            SELECT i.id, i.sequence, i.kind, i.content, s.agent_id, i.delivery_id,
              -- The model the item's turn ran on, as its delivery recorded it; a session's own is what it is on now,
              -- so an earlier round would take the name of the model it moved to. Else the session's, as before.
              COALESCE(d.model, s.model) AS model,
              u.state AS input_state, u.disposition, u.dictated, i.created_at,
              (SELECT d.outcome FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS decision,
              (SELECT d.rule FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS rule,
              (SELECT d.reason FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS reason,
              (SELECT CASE d.decided_by_actor_id WHEN ${instance.systemId} THEN 'rules' WHEN ${instance.coordinatorId} THEN 'coordinator' ELSE 'person' END
                FROM permission_requests r JOIN decisions d ON d.permission_request_id = r.id
                WHERE r.provider_session_id = i.provider_session_id AND r.tool_call_id = i.tool_call_id
                ORDER BY d.decided_at DESC, d.id DESC LIMIT 1) AS decided_by,
              q.state AS question_state, q.payload AS question_payload,
              -- An agent's tool call that asks the person is the question it asks, which stands in its place.
              (x.tool_call_id IS NOT NULL) AS asks
            FROM thread_items i
            LEFT JOIN (SELECT provider_session_id, json_extract(content, '$.toolCallId') AS tool_call_id FROM thread_items
              WHERE thread_id = ${threadId} AND kind = 'question') x
              ON i.kind = 'tool_call' AND x.provider_session_id = i.provider_session_id AND x.tool_call_id = i.tool_call_id
            LEFT JOIN attention_requests q ON i.kind = 'question' AND q.id = json_extract(i.content, '$.attentionId')
            LEFT JOIN turn_deliveries d ON d.id = i.delivery_id
            LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
            LEFT JOIN user_inputs u ON u.id = i.user_input_id
            WHERE i.thread_id = ${threadId}
              -- A message taken back takes no place on a page; read by id, it says it was taken back.
              AND ${where.itemId === undefined ? sql`(u.state IS NULL OR u.state <> 'withdrawn')` : sql`i.id = ${where.itemId}`}
              AND ${where.before === undefined ? sql`1 = 1` : sql`i.sequence < ${where.before}`}
              AND ${where.from === undefined ? sql`1 = 1` : sql`i.sequence >= ${where.from}`}
              AND ${where.open === true ? sql.unsafe(openItem) : sql`1 = 1`}
              AND ${where.reports === true ? sql`i.kind = 'step_result'` : sql`1 = 1`}
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
          const rows = yield* sql<{
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
            WHERE s.thread_id = ${threadId} AND s.state IN (${sql.unsafe(live)}) ORDER BY s.started_at DESC`
          const running = yield* sessions.running(threadId)
          // The runtime's own session when it holds one, which a switch's newer, still-starting row is not; else the newest recorded one.
          const session = Option.isSome(running) ? (rows.find((row) => row.id === running.value.sessionId) ?? rows[0]) : rows[0]
          if (session === undefined) return null
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
            turnStartedAt:
              Option.isSome(running) && running.value.sessionId === session.id && running.value.turnStartedAt !== null
                ? new Date(running.value.turnStartedAt).toISOString()
                : null,
            turnEndedAt:
              Option.isSome(running) && running.value.sessionId === session.id && running.value.turnEndedAt !== null
                ? new Date(running.value.turnEndedAt).toISOString()
                : null,
            // Whether the runtime holds a session on this thread, which takes a note and makes a start refuse. The summary describes that held
            // session, not a newer row a switch is still starting, so a model or effort pick is compared with what the runtime runs.
            held: Option.isSome(running),
            nextLead:
              Option.isSome(running) && running.value.nextLead !== undefined
                ? {
                    agentId: running.value.nextLead.agentId,
                    model: running.value.nextLead.model ?? null,
                    effort: running.value.nextLead.effort ?? null,
                  }
                : null,
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
            workspaceId: string
            state: string
            changeTarget: ChangeTarget | null
          }>`
            SELECT b.slug, b.display_name AS name, coalesce(w.toward, b.default_base_ref, w.base_ref) AS default_branch, b.change_target, w.path, w.branch, w.base_ref, w.base_commit,
              w.branched_at IS NOT NULL AS branched, l.path AS root, w.task_id, w.project_id, w.id AS workspace_id, w.state,
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
       * for a new pull request from it. None without a remote. What it has
       * is what it said when last asked at this commit (`askRemotes`); not
       * asked, only what git or Althar's own push noted here, which can miss
       * a push made elsewhere: so then a count above none isn't known.
       */
      const branchRemoteOf = (
        root: string,
        worktree: string,
        branch: string,
        base: string,
        head: string,
        baseCommit: string | null,
        target: ChangeTarget | null,
      ) =>
        Effect.gen(function* () {
          const remote = yield* branchRemoteIn(root, base, target)
          if (remote === null) return null
          const asked = (yield* (yield* Changes).askedAt(worktree, branch)) === head
          const [there = null, pushed = null] = yield* commitsOf(root, [
            `refs/remotes/${remote}/${branch}`,
            ...(asked ? [] : [`${PUSHED}${branch}`]),
          ])
          // Its own commits, since it started, on nothing the remote is known to have: what a default branch merged in
          // brought, the remote has already, and the branch where it pushed it, Althar noted.
          const counted =
            head === there || head === pushed
              ? 0
              : yield* gitOutcome(
                  worktree,
                  'rev-list',
                  '--count',
                  head,
                  '--not',
                  ...(baseCommit === null ? [] : [baseCommit]),
                  `--remotes=${remote}`,
                  ...(pushed === null ? [] : [pushed]),
                ).pipe(Effect.map(({ code, stdout }) => (code === 0 ? Number(stdout) || 0 : null)))
          const ahead = asked || counted === 0 ? counted : null
          // Where the branch goes: the remote's push URL, which can be a fork of the one it fetches from.
          const url = (yield* namedRemotes(root, 'push').pipe(Effect.orElseSucceed(() => []))).find((one) => one.name === remote)?.url
          return {
            name: remote,
            branch,
            pushed: there !== null || pushed !== null,
            ahead,
            // An SSH alias of a known host (github.com-work) opens its page on that host.
            newPullRequest:
              url === undefined ? null : newPullRequestLink(yield* reachedRemote(url, (host) => HOSTED.has(host)), branch, base, HOSTED),
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
                // Its folder removed once it finished, what it changed is read in its repository, from the commit kept as it went (ADR-056).
                if (!there && worktree.state === 'cleaned')
                  return { worktree, changed: wants.changed ? yield* removedChanges(worktree) : nothingChanged, here: [], merged: [] }
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
                                    worktree.changeTarget,
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

      /**
       * What a task whose folder was removed changed, read in its repository:
       * from where it met its default branch to the commit kept as its folder
       * went, or its branch; nothing where git can't tell.
       */
      const removedChanges = (worktree: {
        readonly root: string | null
        readonly workspaceId: string
        readonly branch: string
        readonly baseRef: string | null
        readonly baseCommit: string | null
      }) =>
        Effect.gen(function* () {
          if (worktree.root === null || worktree.baseCommit === null) return nothingChanged
          const root = worktree.root
          const [kept = null, branch = null, base = null] = yield* commitsOf(root, [
            `${KEPT}${worktree.workspaceId}`,
            `refs/heads/${worktree.branch}`,
            worktree.baseRef ?? '',
          ])
          const head = kept ?? branch
          if (head === null) return nothingChanged
          const fork = yield* forkOf(root, head, base, worktree.baseCommit)
          return { files: yield* changedBetween(root, fork, head), commits: yield* commitsAhead(root, fork, head) }
        }).pipe(Effect.orElseSucceed(() => nothingChanged))

      /** One file's diff for a task whose folder was removed, read in its repository as `removedChanges` reads its files (ADR-056). */
      const removedDiff = (
        worktree: {
          readonly root: string | null
          readonly workspaceId: string
          readonly branch: string
          readonly baseRef: string | null
          readonly baseCommit: string | null
          readonly state: string
        },
        path: string,
      ) =>
        Effect.gen(function* () {
          if (worktree.state !== 'cleaned' || worktree.root === null || worktree.baseCommit === null)
            return yield* new NotFound({ kind: 'task’s worktree', id: worktree.workspaceId })
          const root = worktree.root
          const [kept = null, branch = null, base = null] = yield* commitsOf(root, [
            `${KEPT}${worktree.workspaceId}`,
            `refs/heads/${worktree.branch}`,
            worktree.baseRef ?? '',
          ])
          const head = kept ?? branch
          if (head === null) return yield* new NotFound({ kind: 'task’s worktree', id: worktree.workspaceId })
          return yield* fileDiff(root, yield* forkOf(root, head, base, worktree.baseCommit), path, head)
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
      const diffOf = (taskId: string, path: string, untouched = false) =>
        Effect.gen(function* () {
          const worktrees = yield* worktreesOf(taskId)
          const slash = path.indexOf('/')
          const named = worktrees.length > 1 ? worktrees.find((worktree) => worktree.slug === path.slice(0, slash)) : worktrees[0]
          const inside = worktrees.length > 1 ? path.slice(slash + 1) : path
          if (named === undefined || named.baseCommit === null) return yield* new NotFound({ kind: 'task’s worktree', id: taskId })
          const diff = !existsSync(named.path)
            ? yield* removedDiff(named, inside)
            : untouched
              ? yield* unchangedFileDiff(named.path, inside)
              : yield* fileDiff(named.path, yield* baseOf(named.path, named.baseRef, named.baseCommit), inside)
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

      /** What a task's reviews found, placed in its worktrees here as they are now. */
      const findingsOf = (taskId: string, review?: string) =>
        Effect.gen(function* () {
          const worktrees = (yield* worktreesOf(taskId)).filter((worktree) => worktree.baseCommit !== null && existsSync(worktree.path))
          const placed = yield* Effect.forEach(
            worktrees,
            (worktree) =>
              Effect.gen(function* () {
                const base = yield* baseOf(worktree.path, worktree.baseRef, worktree.baseCommit ?? '')
                const changed = yield* changedFiles(worktree.path, base).pipe(Effect.orElseSucceed(() => []))
                return {
                  slug: worktree.slug,
                  path: worktree.path,
                  workspaceId: worktree.workspaceId,
                  changed: new Set(changed.map((file) => file.path)),
                }
              }),
            { concurrency: 'unbounded' },
          )
          return yield* taskFindingsOf(taskId, placed, review)
        })

      /** Where a folder really is, as an agent may write it: its links followed. */
      const realOrNot = (path: string) => {
        try {
          return [realpathSync(path)].filter((real) => real !== path)
        } catch {
          return []
        }
      }

      /**
       * Where a thread's agent works, for the code it names (code.ts): its
       * task's worktrees on this device, as they are; or for the coordinator,
       * each of the project's repositories here at its default branch, as this
       * device last fetched it (the coordinator's own copy is made from it), or
       * as the branch is here when it never was.
       */
      const codeRoots = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string | null; projectId: string; project: string }>`
            SELECT t.task_id, t.project_id, p.slug AS project FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ${threadId}`
          if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
          if (thread.taskId !== null) {
            const worktrees = (yield* worktreesOf(thread.taskId)).filter((worktree) => existsSync(worktree.path))
            const roots = yield* Effect.forEach(worktrees, (worktree) =>
              Effect.map(
                worktree.baseCommit === null ? Effect.succeed(null) : baseOf(worktree.path, worktree.baseRef, worktree.baseCommit),
                (base): CodeRoot => ({
                  slug: worktree.slug,
                  name: worktree.name,
                  branch: worktree.branch,
                  path: worktree.path,
                  commit: null,
                  base,
                  within: null,
                  seen: realOrNot(worktree.path),
                  editor: worktree.path,
                }),
              ),
            )
            return { kind: 'task', roots } satisfies CodeRoots
          }
          const bindings = yield* sql<{ slug: string; name: string; base: string | null; within: string | null; repository: string }>`
            SELECT b.slug, b.display_name AS name, b.default_base_ref AS base, b.folder AS within, l.path AS repository
            FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${thread.projectId} AND b.detached_at IS NULL
            ORDER BY b.created_at, b.rowid`
          const roots = yield* Effect.forEach(bindings, (binding) =>
            Effect.gen(function* () {
              const branch = binding.base ?? 'main'
              const commit = yield* commitOf(binding.repository, `origin/${branch}`).pipe(
                Effect.catch(() => commitOf(binding.repository, branch)),
                Effect.option,
              )
              if (Option.isNone(commit)) return []
              const copy = join(config.worktreeRoot, thread.project, '.coordinator', binding.slug)
              const root: CodeRoot = {
                slug: binding.slug,
                name: binding.name,
                branch,
                path: binding.repository,
                commit: commit.value,
                base: null,
                within: binding.within,
                seen: [copy, ...realOrNot(copy), ...realOrNot(binding.repository)],
                editor: binding.repository,
              }
              return [root]
            }),
          )
          return { kind: 'default', roots: roots.flat() } satisfies CodeRoots
        })

      /** What the names in a thread's messages name, where its agent works; a coordinator's message, from its default branch as it was when said. */
      const codeFound = (
        threadId: string,
        messages: ReadonlyArray<{ readonly itemId?: string | undefined; readonly names: ReadonlyArray<string> }>,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const place = yield* codeRoots(threadId)
          const ids = [...new Set(messages.flatMap((message) => (message.itemId === undefined ? [] : [message.itemId])))]
          const said =
            place.kind === 'default' && ids.length > 0
              ? new Map(
                  (yield* sql<{ id: string; createdAt: string }>`
                    SELECT id, created_at FROM thread_items WHERE thread_id = ${threadId} AND id IN ${sql.in(ids)}`).map((row) => [
                    row.id,
                    row.createdAt,
                  ]),
                )
              : new Map<string, string>()
          const found = yield* findCode(
            place,
            messages.map((message) => ({
              at: message.itemId === undefined ? null : (said.get(message.itemId) ?? null),
              names: message.names,
            })),
          )
          return {
            place: { kind: place.kind, repositories: place.roots.map(({ slug, name, branch }) => ({ slug, name, branch })) },
            messages: found.map((one) => ({ found: one })),
          }
        })

      /** A task's issue and pull requests, as their external links last saw them, and the connection its issue is read through. */
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
            connectionId: string | null
            partOf: number
          }>`
            SELECT kind, product, ref, key, url, snapshot, listening, connection_id, part_of FROM external_links WHERE task_id = ${taskId}
            ORDER BY created_at`
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
          // Where the project's rules push its leads' commits on their own, whether those here wait for the person, and why (ADR-072).
          const pushing = links.some((link) => link.kind === 'change') ? yield* Effect.flatMap(Changes, (all) => all.pushing(taskId)) : null
          // How its screenshots stand on each open pull request whose host takes them (ADR-077).
          const screenshots = links.some((link) => link.kind === 'change')
            ? yield* Effect.flatMap(PullRequestScreenshots, (all) => all.onChanges(taskId))
            : new Map<string, ScreenshotsOnChange>()
          const changes = yield* Effect.forEach(
            links.flatMap((link) => {
              const found = link.kind === 'change' ? changeOf(parse(link.snapshot), link.product, link.listening === 1) : null
              return found === null ? [] : [found]
            }),
            // Each knows its repository's folder here, as the record of its push says; an open one, how far that branch is ahead
            // of it: commits the person hasn't pushed yet.
            (found) =>
              Effect.gen(function* () {
                const [binding] = yield* sql<{
                  slug: string
                  workspaceId: string | null
                  name: string | null
                  below: string | null
                  waitsFor: string | null
                }>`
                  SELECT b.slug, c.workspace_id, w.name,
                    (SELECT coalesce(o.name, o.branch) FROM workspaces o WHERE o.id = w.waits_for) AS waits_for,
                    (SELECT json_extract(l.snapshot, '$.words.short') || ' ' || json_extract(l.snapshot, '$.words.prefix') ||
                        json_extract(l.snapshot, '$.number')
                      FROM external_links l
                      WHERE l.task_id = w.task_id AND l.kind = 'change' AND json_extract(l.snapshot, '$.source') = w.toward
                        AND json_extract(l.snapshot, '$.state') = 'open'
                      ORDER BY l.created_at DESC LIMIT 1) AS below
                  FROM repository_changes c JOIN repository_bindings b ON b.id = c.binding_id
                  LEFT JOIN workspaces w ON w.id = c.workspace_id
                  WHERE c.pull_request_url = ${found.url} ORDER BY c.updated_at DESC LIMIT 1`
                return {
                  ...found,
                  slug: binding?.slug ?? null,
                  // The change it belongs to: everything hangs on the change, never on a folder.
                  ...(binding?.workspaceId == null
                    ? {}
                    : {
                        change: {
                          id: binding.workspaceId,
                          name: binding.name,
                          ...(binding.below === null || found.state !== 'open' ? {} : { below: binding.below }),
                          ...(binding.waitsFor === null || found.state !== 'open' ? {} : { waitsFor: binding.waitsFor }),
                        },
                      }),
                }
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
                          ORDER BY c.updated_at DESC LIMIT 1) AS head_commit, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base
                      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
                      ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${change.url} LIMIT 1) DESC,
                        b.created_at, b.rowid
                      LIMIT 1`
                        const held = pushing?.get(change.url)
                        const pictures = screenshots.get(change.url)
                        const shown = {
                          ...change,
                          ...(held === undefined ? {} : { pushing: held }),
                          ...(pictures === undefined ? {} : { screenshots: pictures }),
                        }
                        if (here === undefined || !existsSync(here.path)) return withPushed(shown)
                        return withPushed({ ...shown, ...(yield* againstPullRequest(here, change.head, here.headCommit, here.base)) })
                      }),
                ),
              ),
            { concurrency: 'unbounded' },
          )
          return {
            issue,
            issueConnection: issueRow?.connectionId ?? null,
            // It does only part of its issue: its merge comments rather than closing it.
            ...(issueRow?.partOf === 1 ? { issuePartOf: true } : {}),
            changes,
          }
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
                : (yield* Effect.flatMap(Changes, (changes) => changes.unshipped(taskId, { kept: true })).pipe(
                    Effect.orElseSucceed(() => []),
                  )).reduce((sum, one) => sum + one.commits.length, 0),
          }
        })

      /**
       * A task's card in the coordinator's thread: where it stands, worked out
       * from its plan, its run, the calls waiting and the agents working.
       */
      /** A task's card, as its item in the coordinator's thread shows it. */
      /**
       * What waits on a task's branch for Ship (a task is a conversation plus parts, "A tweak waits for Ship"): since its first
       * hold, and how many commits, those ahead of its open pull requests and `after`, those after its last merged or closed or
       * in none yet. Undefined while nothing is held: read only then, so a board of tasks holding nothing asks git nothing more.
       */
      const heldOf = (taskId: string, after: number) =>
        Effect.gen(function* () {
          const changes = yield* Changes
          const [first] = yield* changes.holds(taskId).pipe(Effect.orElseSucceed(() => []))
          if (first === undefined) return undefined
          const open = yield* changes.aheadOfOpen(taskId).pipe(Effect.orElseSucceed(() => []))
          const commits = open.reduce((sum, one) => sum + one.count, 0) + after
          // Held with nothing left to send, as where the person pushed it by hand, it waits on nothing: Ship lets go of it.
          return commits === 0 ? undefined : { since: first.heldAt, commits }
        })

      const cardOf = (row: ItemRow) =>
        Effect.map(cardFor(text(parse(row.content), 'taskId')), (content): ThreadItem | undefined =>
          content === undefined
            ? undefined
            : { id: row.id, sequence: row.sequence, agentId: null, createdAt: row.createdAt, kind: 'task', content },
        )

      /**
       * Why a task's work waits for a place: how many are busy, and who holds them, the task itself left out: it never
       * waits behind itself. What a holder left running is listed where it alone keeps the place, to stop it from here.
       */
      const queuedNow = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const now = yield* (yield* Busy).now
          const holders = now.holders.filter((holder) => holder.taskId !== taskId)
          return {
            busy: now.busy - (now.holders.length - holders.length),
            atOnce: now.atOnce,
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

      /** A project's line, read once in a read: the cards that read it at once share it. */
      const lineIn = (projectId: string) =>
        Effect.gen(function* () {
          const busy = yield* Busy
          const read = yield* LinesRead
          if (read === null) return yield* busy.line(projectId)
          const known = read.get(projectId)
          if (known !== undefined) return yield* Deferred.await(known)
          const line = Deferred.makeUnsafe<Line>()
          read.set(projectId, line)
          return yield* busy.line(projectId).pipe(Effect.onExit((exit) => Deferred.done(line, exit)))
        })

      /**
       * A waiting task's place in its project's Up next (ADR-065), in the order it gets one (1 first): its tasks under way,
       * none of whose agents is at work, which continue, and its line, the tasks no agent has worked on yet, in one order;
       * whether it continues, whether it stands behind another, and whether the person put them in an order of their own.
       * Null where it is in neither: an agent of its is at work.
       */
      const placeOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
          if (task === undefined) return null
          const line = yield* lineIn(task.projectId)
          const at = line.order.indexOf(taskId)
          if (at < 0) return null
          return { place: at + 1, continues: !line.tasks.includes(taskId), behind: at > 0, reordered: line.reordered }
        })

      /*
       * A settled task's kind, by the task, with when it settled: it is read
       * from git once, not each time its card is. One entry a task, for the
       * tasks whose cards were read last: settling again replaces it, and
       * one long unread is read from git again.
       */
      const settledKinds = new Map<string, { readonly as: string; readonly kind: TaskCard['kind'] }>()

      /** How long a task is between agents, or its lead's commits on their way up, before it is the person's (`betweenAgents`). */
      const betweenMs = config.betweenAgents === undefined ? BETWEEN_AGENTS_MS : Duration.toMillis(config.betweenAgents)

      /**
       * Whether Althar no longer sees the checks on a task's pull request's head through: they have run longer than it waits for
       * them, or it gave up on them so, or its host won't show them (ADR-041), when what it last read of them never changes.
       */
      const ranTooLong = (taskId: string, head: string | null) =>
        Effect.gen(function* () {
          if (head === null) return false
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ since: string | null; stuck: number }>`
            SELECT
              (SELECT min(o.observed_at) FROM observations o JOIN external_links l ON l.id = o.subject_id
                WHERE o.subject_type = 'external_link' AND l.task_id = ${taskId} AND l.kind = 'change' AND o.kind = 'checks_running'
                AND json_extract(o.payload, '$.id') = ${`running:${head}`}) AS since,
              EXISTS (SELECT 1 FROM observations o JOIN external_links l ON l.id = o.subject_id
                WHERE o.subject_type = 'external_link' AND l.task_id = ${taskId} AND l.kind = 'change'
                AND json_extract(o.payload, '$.id') IN (${`stuck:${head}`}, ${`unreadable:${head}`})
                AND o.kind IN ('checks_stuck', 'checks_unreadable')) AS stuck`
          if (row === undefined) return false
          const limit = Duration.toMillis(config.checksStuck ?? STUCK_AFTER)
          return row.stuck === 1 || (row.since !== null && (yield* Clock.currentTimeMillis) - Date.parse(row.since) >= limit)
        })
      const SETTLED_KEPT = 1_000

      /** Whether a task has made something on its branch: commits, or changes not committed yet, its evidence aside. */
      const madeOf = (taskId: string) =>
        Effect.map(gitOf(taskId, { changed: true, here: false }), (said) => said.commits > 0 || said.files.length > 0).pipe(
          Effect.orElseSucceed(() => false),
        )

      /**
       * The tasks the person kept for later, by id: finished tasks that
       * aren't changes, taken out of Needs you as they are. They wait behind
       * their board's Settled, so nothing counts them: not the tabs, the
       * home, the edge or the Dock.
       */
      const keptForLater = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          SELECT k.id FROM tasks k JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          WHERE k.state = 'open' AND k.kept_at IS NOT NULL`
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
      const cardFor = (
        taskId: string,
        links?: {
          readonly issue: IssueSummary | null
          readonly issueConnection: string | null
          readonly changes: ReadonlyArray<ChangeSummary>
        },
      ) =>
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
              ? yield* (yield* Changes).unshipped(taskId, { kept: true }).pipe(Effect.orElseSucceed(() => []))
              : []
          const [task] = yield* sql<{
            projectId: string
            threadId: string
            title: string
            slug: string
            state: string
            settledAt: string | null
            keptAt: string | null
            createdAt: string
            branch: string | null
            planId: string | null
            planState: string | null
            parameters: string | null
            startsAt: string | null
            proposedAt: string | null
            runState: string | null
            runAt: string | null
            attemptAt: string | null
            step: string | null
            waiting: number
            review: string | null
            lead: string | null
            leadModel: string | null
            leadEffort: string | null
            firstSession: string | null
            lastEnded: string | null
            turns: number
            settingUp: number | null
            starting: number
            held: string | null
            heldFor: string | null
            roundWaits: number
            answersWait: number
            turnWaits: number
            runPlan: string | null
            local: number
            shelf: string | null
            toward: string | null
            parentId: string | null
            parentSlug: string | null
            parentTitle: string | null
            parentThread: string | null
          }>`
            SELECT k.project_id, t.id AS thread_id, k.title, k.slug, k.state, k.settled_at, k.kept_at, k.created_at,
              ${sql.unsafe(SHOWN_BRANCH)},
              p.id AS plan_id, p.state AS plan_state, p.parameters, p.starts_at, p.proposed_at,
              r.state AS run_state, r.created_at AS run_at, r.plan_id AS run_plan,
              -- Its latest attempt: carried on after a stop, the run is timed from there, not across the time it stood still.
              (SELECT max(started_at) FROM run_attempts WHERE run_id = r.id) AS attempt_at,
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
              -- Whether it works Local, in its repositories' own checkouts here (ADR-091).
              (SELECT count(*) FROM workspaces lw WHERE lw.task_id = k.id AND lw.device_id = ${instance.deviceId} AND lw.kind = 'checkout')
                AS local,
              k.shelf,
              -- The branch its work goes into, where it isn't the default (ADR-093): its first repository's that says one.
              (SELECT tw.toward FROM workspaces tw JOIN repository_bindings tb ON tb.id = tw.binding_id
                WHERE tw.task_id = k.id AND tw.device_id = ${instance.deviceId} AND tw.toward IS NOT NULL
                ORDER BY tb.created_at, tb.rowid LIMIT 1) AS toward,
              -- The task a lead started it from, where one did (ADR-097): its card says "started by" it.
              k.parent_task_id AS parent_id,
              (SELECT pk.slug FROM tasks pk WHERE pk.id = k.parent_task_id) AS parent_slug,
              (SELECT pk.title FROM tasks pk WHERE pk.id = k.parent_task_id) AS parent_title,
              (SELECT pt.id FROM threads pt WHERE pt.task_id = k.parent_task_id AND pt.kind = 'task') AS parent_thread,
              (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') + ${sql.unsafe(issueCardsWaiting('k'))} AS waiting,
              (SELECT s.id FROM threads s WHERE s.task_id = k.id AND s.kind = 'step' AND s.node_key = 'review' LIMIT 1) AS review,
              (SELECT agent_id FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead,
              (SELECT model FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead_model,
              (SELECT effort FROM provider_sessions WHERE thread_id = t.id ORDER BY started_at DESC LIMIT 1) AS lead_effort,
              (SELECT min(started_at) FROM provider_sessions WHERE thread_id = t.id) AS first_session,
              -- When its last agent went: for a moment after, with nothing that says why, the next is on its way (DEV-173).
              (SELECT max(s.ended_at) FROM provider_sessions s JOIN threads h ON h.id = s.thread_id WHERE h.task_id = k.id)
                AS last_ended,
              -- Whether its lead has had a turn yet: before its first, no agent has worked on it.
              (SELECT count(*) FROM turn_deliveries d WHERE d.thread_id = t.id) AS turns,
              -- Its folder being set up (Setups.ts): whether by the setup kept for its repository (1), else the install its
              -- lockfile names (0); null for none under way.
              (SELECT json_extract(i.content, '$.kept') FROM thread_items i WHERE i.thread_id = t.id AND i.kind = 'setup'
                AND json_extract(i.content, '$.ended') IS NULL ORDER BY i.sequence DESC LIMIT 1) AS setting_up,
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
          // The coordinator's turn that made it, where one covers its making: still open, or over. A draft's plan comes in
          // that turn, and once it is over without one the draft is the person's. Only the coordinator drafts: a lead's turn
          // on another task, open or over, says nothing of this draft's plan. Read by thread and time, so each uses an index.
          const [madeIn] = yield* sql<{ madeInTurn: number; madeInOpenTurn: number }>`
            SELECT
              EXISTS (SELECT 1 FROM turn_deliveries d
                WHERE d.thread_id = h.id AND d.requested_at <= ${task.createdAt}
                  AND coalesce(d.ended_at, '9999') >= ${task.createdAt}) AS madeInTurn,
              EXISTS (SELECT 1 FROM turn_deliveries d
                WHERE d.thread_id = h.id AND d.requested_at <= ${task.createdAt} AND d.ended_at IS NULL) AS madeInOpenTurn
            FROM threads h WHERE h.project_id = ${task.projectId} AND h.kind = 'coordinator' LIMIT 1`
          const madeInTurn = madeIn?.madeInTurn ?? 0
          const madeInOpenTurn = madeIn?.madeInOpenTurn ?? 0
          const [latest] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
          // A conflict round: its lead is at work on it, though between turns, or it is the person's now.
          const round = yield* (yield* Changes).conflictStanding(taskId)
          // A change in Althar's hands is under way while its checks run, and while its lead fixes them (ADR-040).
          const hands =
            task.runState === 'succeeded' ? yield* (yield* Changes).inHands(taskId).pipe(Effect.orElseSucceed(() => null)) : null
          const seeing = hands !== null && !hands.given
          // Checks that failed, whoever has looked, are its lead's to see through: under way while the checks on its fix run, and
          // why they are the person's where they are (ADR-070).
          const fixing = task.state === 'open' ? yield* (yield* Changes).fixing(taskId).pipe(Effect.orElseSucceed(() => null)) : null
          const checksRun = (seeing && hands.running) || fixing?.running === true
          const resolving = round?.state === 'resolving' ? round : undefined
          // Waiting on the checks of the merge a round pushed: under way, the lead asked again should they fail.
          const roundChecks = round?.state === 'checking'
          // Conflicting, and about to go to its lead as Althar next looks at it: on its way back to work, not the person's.
          const due = round?.state === 'due'
          const lead = yield* sessions.running(task.threadId)
          const reviewer = task.review === null ? Option.none() : yield* sessions.running(task.review)
          const working = task.starting > 0 || Option.isSome(lead) || Option.isSome(reviewer)
          // An agent mid-turn: work under way, whatever the run that came before it said.
          const busy =
            task.starting > 0 ||
            Option.exists(lead, (session) => session.turnRunning) ||
            Option.exists(reviewer, (session) => session.turnRunning)
          // What the person asked of its lead, its turn not begun yet: Fix it on a review after a merge, which says so from the
          // moment it is answered until the turn that takes it is over (its folder coming back, its lead starting, are on the
          // way meanwhile); or a message waiting for a lead that holds a session. Under way, as the turn is, so a merged task
          // is never settled, nor stopped, in the moment between the asking and the turn.
          const [askedOf] = yield* sql<{ fixSince: string | null; told: number; takenSince: string | null }>`
            SELECT
              (SELECT r.updated_at FROM merge_reviews r WHERE r.task_id = ${taskId} AND r.state = 'fixing'
                AND NOT EXISTS (SELECT 1 FROM turn_deliveries d WHERE d.thread_id = ${task.threadId}
                  AND d.ended_at IS NOT NULL AND d.ended_at >= r.updated_at)
                ORDER BY r.updated_at DESC LIMIT 1) AS fix_since,
              EXISTS (SELECT 1 FROM user_inputs i WHERE i.thread_id = ${task.threadId} AND i.state = 'queued'
                AND i.sender_kind IN ('window', 'paired_device')) AS told,
              (SELECT d.requested_at FROM turn_deliveries d WHERE d.thread_id = ${task.threadId} AND d.origin = 'person'
                AND d.state IN ('pending', 'delivered') AND d.ended_at IS NULL
                ORDER BY d.requested_at DESC LIMIT 1) AS taken_since
            FROM tasks t WHERE t.id = ${taskId}`
          const asked =
            !busy &&
            task.state !== 'abandoned' &&
            ((askedOf?.fixSince != null && stillAsked(askedOf.fixSince, yield* Clock.currentTimeMillis)) ||
              // The turn taking it is claimed, then its input delivered, and only after that is the session busy: none of those
              // moments leaves the task settled.
              ((askedOf?.told === 1 || (askedOf?.takenSince != null && stillAsked(askedOf.takenSince, yield* Clock.currentTimeMillis))) &&
                Option.isSome(lead)))
          // Waiting for a place among the agents at work on this machine: under way, and it starts on its own.
          const queued = task.heldFor === 'machine_busy' || task.roundWaits > 0 || task.answersWait > 0 || task.turnWaits > 0
          // Waiting so with none of its agents at work, it is up next (ADR-065): under way, it continues first; before any agent
          // has worked on it, whatever its kind, it is in its project's line.
          const line = queued && task.state !== 'abandoned' ? yield* placeOf(taskId) : null
          // Local, its first step held for its checkout: what it waits for, where it isn't the person's answer (ADR-091).
          const waitsForCheckout = task.heldFor === 'checkout' ? checkoutWaitOf(task.held) : null
          // Held for a usage limit or the connection, or for its checkout, none of its agents in a turn, it goes on by itself:
          // up next too.
          const paused =
            !queued && !busy && (task.heldFor === 'usage_limit' || task.heldFor === 'agent_unavailable' || waitsForCheckout !== null)
          const unshipped =
            after.length === 0
              ? null
              : {
                  commits: after.reduce((sum, one) => sum + one.commits.length, 0),
                  add: after.reduce((sum, one) => sum + one.add, 0),
                  del: after.reduce((sum, one) => sum + one.del, 0),
                }
          // Held for Ship (a task is a conversation plus parts, "A tweak waits for Ship"): what the person's turns with its lead
          // committed after its plan waits on its branch, on its open pull requests or after the last, and only Ship sends it up.
          const held = yield* heldOf(taskId, unshipped?.commits ?? 0)
          // A reply the person hasn't seen (a task is a conversation plus parts): its lead answered a turn their words began after
          // its plan, since they last had the task open. It waits in Needs you until they open it, settled or not.
          const replied = yield* repliedAt(taskId)
          // Its review after a merge (a task is a conversation plus parts): under way beside its other work, or what it found,
          // which brings it back to Needs you, settled or not, until the person says Fix it or Leave it.
          const afterMerge = yield* afterMergeOf(taskId)
          // How many changes it holds: its own worktrees, each a change's, those whose folder went included.
          const [counted] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM workspaces WHERE task_id = ${taskId} AND access = 'write' AND reviewing IS NULL
              AND state NOT IN ('failed', 'preparing')`
          const changeCount = counted?.n ?? 0
          // Someone else's pull request it reviews (DEV-96); and whether a draft of its review waits for the person.
          const reviewing = yield* reviewBriefOf(taskId)
          const [draftWaits] =
            reviewing === null
              ? []
              : yield* sql<{ id: string }>`
                  SELECT id FROM review_drafts WHERE task_id = ${taskId} AND state IN ('pending', 'failed', 'uncertain') LIMIT 1`
          // Its lead's last turn was cut short (the person interrupted it, or declined a call) and nothing took it up again: the
          // session stays attached, but no agent is on it, so it is stopped, not under way.
          const [lastTurn] =
            busy || queued || Option.isNone(lead)
              ? []
              : yield* sql<{ state: string }>`
                  SELECT state FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
          const cutShort = lastTurn?.state === 'interrupted' && task.held === null
          // Before its lead's first turn no agent has worked on it: its folder still being set up, or its plan started, it is
          // under way, its lead on its way, never stopped. Its first turn waits for the setup.
          const settingUp = task.turns === 0 && task.settingUp !== null
          const unstarted = task.turns === 0 && (task.planState === 'accepted' || task.runState === 'running')
          const { issue, issueConnection, changes } = links ?? (yield* linksOf(taskId))
          // The first still open, for the person to act on: one merged while another isn't leaves the other. Else its latest.
          const shown = changes.find((candidate) => candidate.state === 'open') ?? changes.at(-1) ?? null
          // A chat's latest exchange, as Scratch lists it: who said it, when, and its first line.
          const [lastSaid] =
            task.shelf === 'scratch'
              ? yield* sql<{ kind: string; text: string | null; createdAt: string }>`
                  SELECT kind, json_extract(content, '$.text') AS text, created_at FROM thread_items
                  WHERE thread_id = ${task.threadId} AND kind IN ('agent_message', 'user_message') ORDER BY sequence DESC LIMIT 1`
              : []
          const exchange =
            lastSaid === undefined
              ? undefined
              : {
                  at: lastSaid.createdAt,
                  by: lastSaid.kind === 'user_message' ? ('person' as const) : ('lead' as const),
                  said: (lastSaid.text ?? '').trim().split('\n')[0]?.slice(0, 200) ?? '',
                }
          // An aside opened with + whose person hasn't said anything in it yet: its lead waits for their first words.
          const [unsaid] =
            task.shelf === 'scratch' && exchange === undefined
              ? yield* sql<{ unsaid: number }>`
                  SELECT (k.request IS NULL OR trim(k.request) = '')
                    AND NOT EXISTS (SELECT 1 FROM user_inputs u WHERE u.thread_id = ${task.threadId})
                    AND EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = k.id AND p.state != 'replaced'
                      AND json_extract(p.parameters, '$.aside') = 1) AS unsaid
                  FROM tasks k WHERE k.id = ${taskId}`
              : []
          // Where each stands, by its latest pull request, for the card's one sentence and its marks: none yet, not shipped.
          const named = yield* sql<{ id: string; name: string | null; branch: string }>`
            SELECT id, name, branch FROM workspaces WHERE task_id = ${taskId} AND access = 'write' AND reviewing IS NULL
              AND state NOT IN ('failed', 'preparing') ORDER BY created_at, rowid`
          const marks =
            new Set(named.map((one) => one.name ?? '')).size < 2
              ? []
              : named.map((one) => {
                  const pull = changes.findLast((candidate) => candidate.change?.id === one.id)
                  const stands =
                    pull === undefined
                      ? ('unshipped' as const)
                      : pull.state === 'merged'
                        ? ('merged' as const)
                        : pull.state === 'closed'
                          ? ('closed' as const)
                          : pull.checks?.outcome === 'failed'
                            ? ('failing' as const)
                            : pull.draft
                              ? ('draft' as const)
                              : pull.checks?.outcome === 'running'
                                ? ('checking' as const)
                                : ('ready' as const)
                  return { name: one.name ?? one.branch, stands }
                })
          // Its commits going up on their own, or its checks running with nothing of the person's before them: under way (DEV-173).
          // Some failed while the rest still run, they go to its lead once they end, unless its tries are spent, the lead brought
          // them to the person, or the person stopped it since (ADR-070).
          const going = task.runState === 'succeeded' ? byItself(shown, { failuresGo: fixing?.failuresGo === true }) : null
          // Not checks that ran too long, that Althar gave up on as so, or that it can't read (ADR-041): those are the person's. Commits made outside
          // a turn, which nothing pushes, aren't going up (`Changes.pushing`): those are the person's too.
          const goes = going === 'checks_running' && (yield* ranTooLong(taskId, shown?.head ?? null)) ? null : going
          // Its last agent gone a moment ago, no turn of its cut short and nothing that says why: the next is on its way, as a step
          // is started again or the call that says why comes, not stopped. Sessions reads its card again once the moment is over.
          const between =
            !busy &&
            !queued &&
            Option.isNone(lead) &&
            (task.runState === null || task.runState === 'running') &&
            betweenAgents(task.lastEnded, yield* Clock.currentTimeMillis, betweenMs) &&
            (yield* sql<{ state: string }>`
              SELECT state FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`)[0]
              ?.state !== 'interrupted'
          // Its round over, Althar opening its next pull request by itself: under way until it opens or can't (ADR-034).
          const opening = yield* (yield* Changes).openingNext(taskId)
          // A task only drafted, before its plan: no plan proposed or accepted, no run, no turn, never an agent. It is off the
          // board until its plan is proposed, as its card in the coordinator's thread is. While the turn that made it runs its
          // plan is on its way; once that turn is over without one, or after a time, it is the person's, as stopped.
          const drafting =
            task.state === 'draft' &&
            task.planState === null &&
            task.runState === null &&
            task.turns === 0 &&
            task.firstSession === null &&
            stillDrafting(task.createdAt, yield* Clock.currentTimeMillis, draftingMs) &&
            (madeInOpenTurn === 1 || madeInTurn === 0)
          const ready = ((): TaskPhase => {
            if (task.state === 'abandoned') return 'settled'
            if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
            // A call waiting on the person, and work under way, come before anything else (ADR-034): work sent back isn't ready
            // again until its lead is done with the note, and a merged task whose lead works on it again is running.
            if (task.waiting > 0) return 'waiting'
            if (busy || queued || resolving !== undefined || opening || asked) return 'running'
            // Drafted, its plan not yet proposed: nowhere on the board yet.
            if (drafting) return 'drafting'
            // A review has no run: drafted, it is the person's to post, as a change is to accept. Posted, and written to again, it
            // is open once more: its lead answered, it is finished as a quick task is, the person's to settle (ADR-051).
            if (task.state === 'open' && (draftWaits !== undefined || reviewing?.posted != null)) return 'ready'
            // A review after one of its merges found something: the person's, Fix it or Leave it, whatever else of it stands.
            if (afterMerge?.state === 'found') return 'ready'
            // Held for Ship, it waits on the person's word, whatever its pushed head's checks say: Ship replaces that head. Not while
            // a run is under way, as Ship's own is as it reviews and sends what waited.
            if (held !== undefined && task.runState !== 'running') return 'ready'
            // Merged, it is settled, unless commits after its pull requests are in none yet, or its lead answered the person since
            // they last had it open.
            if (task.state === 'done') return unshipped === null && replied === undefined ? 'settled' : 'ready'
            // Failing checks its lead is told or at are its lead's, not the person's, while they are (ADR-070, DEV-173): not once a
            // conflict round whose merge they fail on handed them back, its lead not told again.
            const withLead = fixing?.withLead === true && round?.state !== 'handed_back'
            if (task.runState === 'succeeded') return checksRun || withLead || roundChecks || due || goes !== null ? 'running' : 'ready'
            if (task.runState !== null && task.runState !== 'running') return 'stopped'
            // Held for a reset, it carries on on its own: under way, not stopped.
            return (working && !cutShort) || task.held !== null || settingUp || unstarted || between ? 'running' : 'stopped'
          })()
          // Finished and kept for later by the person: out of Needs you as it is, until they write to it or settle it.
          const phase: TaskPhase = ready === 'ready' && task.keptAt !== null ? 'kept' : ready
          // Stopped with no agent on it: what stopped its lead (the person declining a call, or interrupting; else Althar, or
          // nothing says), and when, so the board puts it among what waits on the person and says so.
          const stopped =
            phase !== 'stopped'
              ? undefined
              : yield* Effect.gen(function* () {
                  // Suspended, its run stopped when its latest attempt ended: what stopped it is the turn that attempt ended in, not
                  // one its lead was sent after without the run carried on, so a later turn doesn't make it stopped "just now".
                  // Who suspended it is on record: Althar, as an automation's run out of time, or the coordinator, is no one's call.
                  const [suspended] =
                    task.runState === 'suspended'
                      ? yield* sql<{ endedAt: string | null; actorId: string | null }>`
                          SELECT
                            (SELECT a.ended_at FROM run_attempts a WHERE a.run_id = r.id ORDER BY a.attempt_number DESC LIMIT 1) AS ended_at,
                            (SELECT e.actor_id FROM record_events e WHERE e.aggregate_type = 'run' AND e.aggregate_id = r.id AND e.type = 'run.suspended'
                              ORDER BY e.sequence DESC LIMIT 1) AS actor_id
                          FROM runs r WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
                      : []
                  const until = suspended?.endedAt ?? null
                  if (suspended?.actorId === instance.systemId || suspended?.actorId === instance.coordinatorId)
                    return { by: 'althar' as const, at: until ?? task.runAt }
                  const [turn] = yield* sql<{ state: string; startedAt: string; endedAt: string | null }>`
                    SELECT state, requested_at AS startedAt, ended_at AS endedAt FROM turn_deliveries
                    WHERE thread_id = ${task.threadId} AND (${until} IS NULL OR requested_at <= ${until})
                    ORDER BY requested_at DESC, rowid DESC LIMIT 1`
                  const [run] = yield* sql<{ endedAt: string | null }>`
                    SELECT ended_at AS endedAt FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC LIMIT 1`
                  // Null where nothing says when: the card then shows no time.
                  const at = until ?? turn?.endedAt ?? run?.endedAt ?? task.runAt ?? task.firstSession ?? task.createdAt
                  if (turn === undefined || turn.state !== 'interrupted')
                    return { by: run?.endedAt == null ? null : ('althar' as const), at }
                  // Interrupted in a turn in which the person refused a call: they declined it; else they interrupted.
                  const [refused] = yield* sql<{ id: string }>`
                    SELECT d.id FROM decisions d JOIN permission_requests r ON r.id = d.permission_request_id
                      JOIN provider_sessions s ON s.id = r.provider_session_id
                    WHERE s.thread_id = ${task.threadId} AND d.outcome = 'reject'
                      AND d.decided_by_actor_id NOT IN (${instance.systemId}, ${instance.coordinatorId})
                      AND d.decided_at >= ${turn.startedAt} AND d.decided_at <= ${turn.endedAt ?? at}
                    LIMIT 1`
                  return { by: refused === undefined ? ('interrupted' as const) : ('declined' as const), at }
                })
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
          // What it makes: its plan and its pull requests say so, whatever it wrote (a quick task stays plain until it is made a
          // change); for a review, git does too, by what is on its branch; for a task that settled, once, as nothing changes it
          // until it opens again.
          const quick = field(parameters, 'here') === true
          const reads = reviewing !== null && changes.length === 0
          // By its plan too: a quick task made a change in a round that was given up settles again at the same time, a change now.
          const settledAs = task.state === 'done' || task.state === 'abandoned' ? `${taskId}:${task.settledAt}:${quick}` : null
          const known = settledKinds.get(taskId)
          const kept = settledAs !== null && known?.as === settledAs ? known.kind : undefined
          const kind = kept ?? kindOf({ reviewing, end, changes: changes.length, quick, made: reads ? yield* madeOf(taskId) : false })
          settledKinds.delete(taskId)
          if (settledAs !== null) settledKinds.set(taskId, { as: settledAs, kind })
          for (const oldest of settledKinds.keys()) if (settledKinds.size > SETTLED_KEPT) settledKinds.delete(oldest)
          return {
            taskId,
            // In plain words from what Althar knows, and nothing the card's word, chip or checks say already: a ready task's queued
            // pull request is "In the merge queue" by its word.
            errands: errandCardLines(yield* errandRecords(task.projectId, { taskId }), shown, { queueShown: phase === 'ready' }),
            threadId: task.threadId,
            title: task.title,
            slug: task.slug,
            phase,
            ...(stopped === undefined ? {} : { stopped }),
            // Stopped, with its pull request ready to merge as it is: still the person's to accept, next to Carry on.
            ...(phase === 'stopped' && isMergeable(shown) ? { mergeable: true } : {}),
            // Its folder being set up before its lead's first turn: the install its lockfile names, or the setup kept for it.
            ...(settingUp ? { settingUp: task.settingUp === 1 ? ('kept' as const) : ('install' as const) } : {}),
            kind,
            // Started by another task's lead: that task, which the card names.
            ...(task.parentId === null || task.parentSlug === null || task.parentTitle === null || task.parentThread === null
              ? {}
              : { startedBy: { taskId: task.parentId, slug: task.parentSlug, title: task.parentTitle, threadId: task.parentThread } }),
            // What a plain task handed back, small on its card while it waits for the person.
            handed: kind === 'plain' ? yield* handedFor(task.threadId, latest?.content ?? null, task.runAt) : null,
            reviewing,
            // Once its plan has begun, when a change of its reviewer would take effect: the person's dialog reads it.
            ...(task.planState === 'accepted' && task.state === 'open' ? { reviewerChange: yield* reviewerChange(taskId) } : {}),
            // The review its lead or the coordinator offered it, while the offer stands: its line in the thread reads it.
            ...(yield* Effect.map(
              reviewOfferOf({
                taskId,
                open: task.planState === 'accepted' && task.state === 'open',
                steps: planned,
                reviewsAfterMerge: field(parameters, 'reviewAfterMerge') === true,
                reads: field(parameters, 'reads') === true,
                pulls: changes,
              }),
              (offer) => (offer === undefined ? {} : { reviewOffer: offer }),
            )),
            plan:
              task.planId === null
                ? null
                : {
                    id: task.planId,
                    steps: planned,
                    startsAt: task.planState === 'proposed' ? task.startsAt : null,
                    ...(task.planState === 'proposed' && task.startsAt !== null && task.proposedAt !== null
                      ? { startsAfter: Math.max(0, Math.round((Date.parse(task.startsAt) - Date.parse(task.proposedAt)) / 1000)) }
                      : {}),
                    reason: text(parameters, 'reason') || null,
                    end: end === 'draft' || end === 'ready' || end === 'none' ? end : null,
                    // The preset its parts are, which the card's kicker names first (a task is a conversation plus parts).
                    preset: presetOf(
                      yield* presetsIn(task.projectId),
                      partsOfPlan(
                        {
                          steps: planned,
                          end: end ?? null,
                          here: field(parameters, 'here') === true,
                          reads: field(parameters, 'reads') === true,
                          reviewAfterMerge: field(parameters, 'reviewAfterMerge') === true,
                          worksIn: text(parameters, 'worksIn'),
                        },
                        task.shelf,
                        '',
                      ),
                    ),
                    // Any agent may lead a review: the card offers them all.
                    ...(field(parameters, 'reads') === true
                      ? {}
                      : {
                          // Where it works (ADR-091), why where the coordinator said, and who works Local now, while it can change.
                          worksIn: text(parameters, 'worksIn') === 'checkout' ? ('checkout' as const) : ('worktree' as const),
                          worksInWhy: text(parameters, 'worksInWhy') || null,
                          ...(task.planState === 'proposed' || (yield* planWaits(taskId))
                            ? { localTaken: yield* localTakenFor(taskId), ...(yield* choicesOf(taskId, task.planState === 'proposed')) }
                            : { toward: task.toward }),
                        }),
                  },
            issue:
              issue === null
                ? null
                : {
                    product: issue.product,
                    key: issue.key,
                    title: issue.title,
                    url: issue.url,
                    ...(issueConnection === null ? {} : { connectionId: issueConnection }),
                  },
            // The first still open, for the person to act on: one merged while another isn't leaves the other. Else its latest.
            change: shown,
            earlier: changes.filter((candidate) => candidate !== shown).toReversed(),
            unshipped,
            ...(held === undefined ? {} : { held }),
            ...(replied === undefined ? {} : { replied }),
            ...(afterMerge === undefined ? {} : { afterMerge }),
            ...(changeCount > 1 ? { changeCount, changeMarks: marks } : {}),
            ...(task.shelf === 'scratch' ? { scratch: true } : {}),
            ...(exchange === undefined ? {} : { latest: exchange }),
            ...(unsaid?.unsaid === 1 ? { unsaid: true } : {}),
            // Resolving a conflict, or fixing the checks on the merge, is a step of its own while it lasts.
            step:
              task.step ??
              (phase !== 'running'
                ? null
                : resolving !== undefined
                  ? resolving.checks
                    ? 'checks'
                    : 'conflict'
                  : due
                    ? 'conflict'
                    : roundChecks && !busy
                      ? 'checks_running'
                      : seeing || fixing?.open === true
                        ? busy || !checksRun
                          ? 'checks'
                          : 'checks_running'
                        : asked
                          ? 'implement'
                          : goes),
            followUp: (task.runState === 'running' && task.runPlan === null) || asked,
            summary: latest === undefined ? null : text(parse(latest.content), 'summary') || null,
            lead: task.lead ?? (implement?.agentId || null),
            // Its session's model once one started; the plan's until then.
            leadModel: task.lead === null ? (implement?.model ?? null) : task.leadModel,
            leadEffort,
            branch: task.branch,
            startedAt: task.attemptAt ?? task.runAt ?? task.firstSession,
            ...(task.local > 0 ? { local: true } : {}),
            ...(waitsForCheckout === null ? {} : { waitsForCheckout }),
            ...(task.toward === null ? {} : { toward: task.toward }),
            waits: task.heldFor === 'usage_limit' ? waitsOf(task.held) : null,
            ...(task.heldFor === 'agent_unavailable' ? { reconnects: reconnectsOf(task.held) } : {}),
            // A merged task whose lead goes back to work waits its turn too (ADR-034).
            queued: queued && task.state !== 'abandoned' ? yield* queuedNow(taskId) : null,
            // Its plan's first step waits for a place, or Local for its checkout, nothing of it begun: its plan can still change.
            ...((queued || waitsForCheckout !== null) && (yield* planWaits(taskId)) ? { planWaits: true } : {}),
            // And it can be held, out of the line, until the person starts it: nothing of it begun.
            ...((queued || waitsForCheckout !== null) && (yield* beforeFirstStep(taskId)) ? { holdable: true } : {}),
            // A turn Althar asked of its lead or reviewer waits for a place, none of its agents at work: it can be let go.
            ...(task.turnWaits > 0 && !busy && task.state !== 'abandoned' ? { turnWaits: true } : {}),
            ...(line === null
              ? paused
                ? { continues: true }
                : {}
              : line.continues
                ? { continues: true, place: line.place }
                : { inLine: true, place: line.place, ...(line.reordered ? { reordered: true } : {}) }),
            ...(round?.state === 'handed_back' && phase === 'ready' ? { handedBack: round.why } : {}),
            // Its checks fail, and its lead brought them to the person, or spent its tries: why, on its card.
            ...(fixing?.why != null && phase === 'ready' ? { checksBack: fixing.why } : {}),
            // Conflicting, and not asked of its lead: why, beside Resolve now (ADR-030).
            ...(round?.state === 'unsent' ? { conflictUnsent: round.why } : {}),
            // Not looked at for a conflict, whatever its host says: why, beside Look again.
            ...(round?.state === 'unchecked' ? { conflictUnchecked: round.why } : {}),
            ...(phase === 'kept' ? { keptAt: task.keptAt } : {}),
            automation: yield* fromAutomation(taskId),
          } satisfies Extract<ThreadItem, { kind: 'task' }>['content']
        })

      /** The automation whose run a task is, by its name now; null where none started it. */
      const fromAutomation = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ id: string; name: string }>`
            SELECT a.id, d.name FROM automation_occurrences o JOIN automations a ON a.id = o.automation_id
            JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            WHERE o.task_id = ${taskId} LIMIT 1`
          return row === undefined ? null : { id: row.id, name: row.name }
        })

      /** What a held step waits for: the agent and account out of usage, when it is back, why it waits, and who could take it over now. */
      const waitsOf = (held: string | null): HeldForLimit | null => {
        const output = held === null ? undefined : parse(held)
        const agentId = text(output, 'heldFor')
        const until = text(output, 'until')
        if (agentId === '' || until === '') return null
        const account = field(output, 'account')
        const why = field(output, 'why')
        const choices = field(output, 'choices')
        const left = field(output, 'left')
        return {
          agentId,
          until,
          ...(typeof account === 'string' ? { accountId: account } : {}),
          ...(why === 'waits' || why === 'nothing_free' || why === 'asked' ? { why } : {}),
          ...(Array.isArray(choices) ? { choices: choices.flatMap(choiceOf) } : {}),
          ...(typeof left === 'number' ? { left } : {}),
        }
      }

      /** What a step held for the connection waits for: its agent and service, and whether it waits for the connection or a try again. */
      const reconnectsOf = (held: string | null): HeldForConnection | null => {
        const output = held === null ? undefined : parse(held)
        const agentId = text(output, 'heldFor')
        if (agentId === '') return null
        const offline = field(output, 'offline') === true
        const failure = field(output, 'failure')
        return {
          agentId,
          service: text(output, 'service') || agentId,
          offline,
          next: offline ? null : text(output, 'until') || null,
          failure: typeof failure === 'string' ? failure : null,
        }
      }

      /** How many settled tasks the board shows: the most recent. */
      const SETTLED_SHOWN = 30
      /** How far back the home reads what the loop did, before the person has ever left it here. */
      const FIRST_LOOK = 24 * 60 * 60 * 1000
      /** The most of what the loop did the home reads. */
      const EVENTS = 50
      /*
       * Settled work doesn't change, so its card is worked out once, by when it settled: but for its pull requests, which its host
       * may close or merge after (an abandoned task's left open), and its worktrees, where the person may commit after it merged
       * with no agent on it (LeftBehind.ts), so it is worked out again once what was seen of them moves on.
       */
      const settledCards = new Map<string, { readonly seen: string; readonly card: BoardSnapshot['tasks'][number] }>()

      /** When a worktree's head last moved, as its reflog was last written: a commit there writes it. Nothing where it can't be read. */
      const committedAt = (path: string) => {
        if (path === '') return ''
        try {
          // A worktree's `.git` is a file naming its folder in the repository's; a repository's own, that folder.
          const dotGit = join(path, '.git')
          const pointer = statSync(dotGit).isFile() ? /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1] : undefined
          const gitDir = pointer === undefined ? dotGit : resolve(path, pointer.trim())
          return String(statSync(join(gitDir, 'logs', 'HEAD')).mtimeMs)
        } catch {
          return ''
        }
      }

      /*
       * What the card watcher last worked out of each task's card (below), its card and its calls, and of its card alone. A read
       * can give out a card the watcher never saw: from what moves with no change recorded, as a commit made in a task's
       * worktree by hand, or the time. Where one does, the watcher's is dropped, so the task's next change is said whatever
       * its card comes to: back to what the watcher saw, a window holding the other would otherwise never hear of it.
       */
      const shownCards = new Map<string, { readonly whole: string; readonly card: string }>()

      /** A task as the board shows it: its card, and, ready, what it changed and what of it merges here. None where it has no card. */
      const onBoard = (row: {
        readonly id: string
        readonly state: string
        readonly createdAt: string
        readonly settledAt: string | null
      }) =>
        Effect.tap(cardOnBoard(row), (read) =>
          Effect.sync(() => {
            const watched = shownCards.get(row.id)
            if (watched !== undefined && watched.card !== JSON.stringify(read)) shownCards.delete(row.id)
          }),
        )

      const cardOnBoard = (row: {
        readonly id: string
        readonly state: string
        readonly createdAt: string
        readonly settledAt: string | null
      }) =>
        Effect.gen(function* () {
          // A settled task whose lead works on it again isn't as it settled (ADR-034).
          const working = (yield* (yield* Sessions).onTasks).some((session) => session.taskId === row.id)
          const [links] = yield* (yield* SqlClient.SqlClient)<{ seen: string | null; paths: string | null }>`
            SELECT (SELECT max(updated_at) FROM external_links WHERE task_id = ${row.id} AND kind = 'change') AS seen,
              (SELECT group_concat(path, char(10)) FROM workspaces
                WHERE task_id = ${row.id} AND device_id = ${instance.deviceId} AND state = 'ready') AS paths`
          const seen = `${links?.seen ?? ''} ${(links?.paths ?? '').split('\n').map(committedAt).join(' ')}`
          const settled = row.settledAt === null || working ? undefined : settledCards.get(`${row.id}:${row.settledAt}`)
          if (settled !== undefined && settled.seen === seen) return [settled.card]
          const card = yield* cardFor(row.id)
          if (card === undefined) return []
          // Ready, what merges here is read from git; without a pull request, so is its size: its branch's. A change at work
          // without one shows its branch's size so far.
          const atWork = (card.phase === 'running' || card.phase === 'stopped') && card.kind === 'change' && card.change === null
          // A plain task with no branch yet has nothing of its own in git to size.
          const said =
            (card.phase === 'ready' || atWork) && card.branch !== null
              ? yield* gitOf(row.id, { changed: card.change === null || card.change.state === 'closed', here: card.phase === 'ready' })
              : null
          const changed =
            said !== null && card.change === null
              ? {
                  files: said.files.length,
                  add: said.files.reduce((sum, file) => sum + file.add, 0),
                  del: said.files.reduce((sum, file) => sum + file.del, 0),
                }
              : null
          // A change ready with nothing on its branch and no pull request open or merged: nothing to accept.
          const nothingBuilt =
            card.phase === 'ready' &&
            card.kind === 'change' &&
            card.unshipped == null &&
            (card.change === null || card.change.state === 'closed') &&
            (said === null || (said.commits === 0 && said.files.length === 0)) &&
            // What Done would settle: the same reading, from git, so the card never offers what Done refuses.
            (yield* Effect.flatMap(Changes, (changes) => changes.nothingBuilt(row.id)).pipe(Effect.orElseSucceed(() => false)))
          const read = {
            ...card,
            ...(nothingBuilt ? { nothingBuilt } : {}),
            state: row.state,
            createdAt: row.createdAt,
            settledAt: row.settledAt,
            changed,
            here: said?.here ?? [],
          }
          if (row.settledAt !== null && card.phase === 'settled') settledCards.set(`${row.id}:${row.settledAt}`, { seen, card: read })
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
          const from = since ?? looked ?? new Date((yield* Clock.currentTimeMillis) - FIRST_LOOK).toISOString()
          const rows = yield* sql<{ id: string; projectId: string; state: string; createdAt: string; settledAt: string | null }>`
            SELECT k.id, k.project_id, k.state, k.created_at, k.settled_at FROM tasks k JOIN projects p ON p.id = k.project_id
            WHERE p.archived_at IS NULL AND (k.state IN ('open', 'draft') OR k.id IN (
              -- A merged task the board still shows can be ready again, with commits after its pull request in none yet.
              SELECT id FROM (
                SELECT id, state, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY settled_at DESC, id DESC) AS place
                FROM tasks WHERE state IN ('done', 'abandoned'))
              WHERE state = 'done' AND place <= ${SETTLED_SHOWN}))
            ORDER BY k.created_at, k.id`
          const tasks = yield* Effect.forEach(
            rows,
            (row) =>
              Effect.map(onBoard(row), (read) =>
                read.flatMap((task) =>
                  // A task kept for later waits on its board, not here.
                  ON_HOME.includes(task.phase) ? [{ ...task, projectId: row.projectId }] : [],
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

      /**
       * A small change's card, read from the task as it stands (the fast lane,
       * README section 6): its plan's start, the lead's report, the pull
       * request's checks and merge, and the review its merge started. Nothing
       * is stored for it, so it never goes stale; null where the thread isn't
       * a task's, or the task is no small change.
       */
      const smallChangeOfThread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{
            id: string
            title: string
            slug: string
            projectId: string
            createdAt: string
            startedAt: string | null
          }>`
            SELECT k.id, k.title, k.slug, k.project_id AS projectId, k.created_at AS createdAt,
              (SELECT min(r.created_at) FROM runs r WHERE r.task_id = k.id) AS startedAt
            FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (task === undefined) return undefined
          const [plan] = yield* sql<{ parameters: string; proposedAt: string }>`
            SELECT parameters, proposed_at AS proposedAt FROM task_plans WHERE task_id = ${task.id}
            ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
          const small = smallChangeOf(plan?.parameters ?? null)
          if (small === undefined) return undefined
          const [changeRow] = yield* sql<{ product: string; snapshot: string; listening: number }>`
            SELECT product, snapshot, listening FROM external_links WHERE task_id = ${task.id} AND kind = 'change'
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          const change = changeRow === undefined ? null : changeOf(parse(changeRow.snapshot), changeRow.product, changeRow.listening === 1)
          const [reviewed] = yield* sql<{ taskId: string; slug: string; title: string; threadId: string }>`
            SELECT k.id AS taskId, k.slug, k.title, t.id AS threadId
            FROM external_links x JOIN tasks k ON k.id = x.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE x.kind = 'review' AND x.url = ${change?.url ?? ''}
            ORDER BY k.created_at DESC, k.rowid DESC LIMIT 1`
          const [review] = yield* sql<{
            state: string
            findings: number
            verdict: string | null
            bringsBack: string | null
            updatedAt: string
          }>`
            SELECT state, json_array_length(findings) AS findings, verdict, json_extract(reviewer, '$.bringsBack') AS bringsBack,
              updated_at AS updatedAt FROM merge_reviews
            WHERE url = ${change?.url ?? ''}`
          // What its review after the merge brings back: as the rule and its own word say now, and once owed, as it was kept then.
          const rule = yield* afterMergeNow(task.id)
          const holds: AfterMergeRule = review === undefined ? rule.holds : review.bringsBack === 'all' ? 'all' : 'major'
          const [reported] = yield* sql<{ at: string }>`
            SELECT created_at AS at FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') = 'implement' ORDER BY sequence LIMIT 1`
          const [checks] = yield* sql<{ at: string }>`
            SELECT created_at AS at FROM thread_items WHERE thread_id = ${threadId} AND kind = 'arrival'
              AND json_extract(content, '$.kind') = 'checks' AND coalesce(json_extract(content, '$.failed'), 0) = 0
            ORDER BY sequence DESC LIMIT 1`
          const [merged] = yield* sql<{ at: string }>`
            SELECT created_at AS at FROM thread_items WHERE thread_id = ${threadId} AND kind = 'arrival'
              AND json_extract(content, '$.kind') = 'merged' ORDER BY sequence DESC LIMIT 1`
          // One file's line count where the lead left one: read from its worktree, or the pull request's numbers.
          const files =
            change !== null && change.changedFiles === 1
              ? yield* Effect.gen(function* () {
                  const [worktree] = yield* worktreesOf(task.id)
                  if (worktree?.baseCommit === null || worktree?.baseCommit === undefined) return []
                  return yield* changedFiles(worktree.path, worktree.baseCommit).pipe(Effect.orElseSucceed(() => []))
                })
              : []
          const words = changedWords({
            files,
            additions: change?.additions ?? null,
            deletions: change?.deletions ?? null,
            changedFiles: change?.changedFiles ?? null,
          })
          const passed = change?.checks !== null && change?.checks !== undefined && change.checks.outcome === 'passed'
          const failed = change?.checks !== null && change?.checks !== undefined && change.checks.outcome === 'failed'
          const afterMerge = change !== null && change.state === 'merged'
          const at = task.startedAt ?? plan?.proposedAt ?? task.createdAt
          const reviewBefore = reviewed !== undefined && !afterMerge
          const card: ThreadItem = {
            id: `small-change:${task.id}`,
            sequence: 0,
            agentId: null,
            createdAt: at,
            kind: 'small_change',
            content: {
              taskId: task.id,
              threadId,
              slug: task.slug,
              title: task.title,
              lead: {
                agentId: small.implement.agentId,
                model: small.implement.model,
                ...(small.implement.effort === undefined ? {} : { effort: small.implement.effort }),
              },
              skips: smallChangeSkips(reviewBefore ? null : small.review, holds),
              steps: [
                { key: 'started', what: 'Started', at, done: true },
                {
                  key: 'changed',
                  what: reported === undefined ? 'Changing the code' : `Changed ${words}`,
                  at: reported?.at ?? null,
                  done: reported !== undefined,
                },
                {
                  key: 'checks',
                  what: failed ? 'Checks failed' : passed ? 'Checks pass' : 'Checks',
                  at: checks?.at ?? null,
                  done: passed,
                },
                { key: 'merged', what: 'Merged', at: merged?.at ?? null, done: afterMerge },
                // Its review after the merge, in the task itself (MergeReviews.ts).
                ...(review === undefined
                  ? []
                  : [
                      {
                        key: 'review' as const,
                        what:
                          review.state === 'found'
                            ? `Review found ${review.findings}`
                            : review.state === 'owed' || review.state === 'running'
                              ? 'Reviewing'
                              : review.state === 'stopped'
                                ? 'Review stopped'
                                : review.state === 'clear' && review.verdict === 'changes_requested' && review.findings > 0
                                  ? 'Reviewed, nothing major'
                                  : 'Reviewed',
                        at: review.state === 'owed' || review.state === 'running' ? null : review.updatedAt,
                        done: review.state !== 'owed' && review.state !== 'running',
                      },
                    ]),
              ],
              change,
              ...(reviewed === undefined || !afterMerge
                ? {}
                : { review: { taskId: reviewed.taskId, slug: reviewed.slug, threadId: reviewed.threadId, title: reviewed.title } }),
              ...(reviewBefore
                ? { fullTask: { taskId: reviewed.taskId, slug: reviewed.slug, threadId: reviewed.threadId, title: reviewed.title } }
                : {}),
              afterMerge: { project: rule.project, task: rule.task, holds },
            },
          }
          return card
        })

      /** A page of a thread's items, as screens show them; a task's starts at a round (`fromRound`). */
      const pageOf = (
        threadId: string,
        page: {
          readonly before?: number
          readonly limit?: number
          readonly from?: number
          readonly until?: number
          readonly open?: boolean
        },
        rounds = false,
      ) =>
        Effect.gen(function* () {
          // A page ends before `until`, and before the one asked for, whichever is first.
          const before = page.until === undefined ? page.before : Math.min(page.before ?? page.until, page.until)
          const read = yield* itemRows(threadId, {
            ...(before === undefined ? {} : { before }),
            ...(page.from === undefined ? {} : { from: page.from }),
            ...(page.open === true ? { open: true } : {}),
            limit: page.limit ?? PAGE,
          })
          const { items, earlier } = rounds ? yield* fromRound(threadId, read) : read
          const shown = yield* Effect.forEach(items, (row) => (row.kind === 'task' ? cardOf(row) : Effect.succeed(itemOf(row))), {
            concurrency: AT_ONCE,
          })
          // A small change's card opens its thread, where the person meets it first: read from the task, so it is current.
          const card = page.before === undefined ? yield* smallChangeOfThread(threadId) : undefined
          const all = [...(card === undefined ? [] : [card]), ...shown.flatMap((item) => (item === undefined ? [] : [item]))]
          return { items: all, earlier, turns: yield* turnsOf(all) }
        })

      /**
       * A task's review after a merge that the card says: one whose findings wait on the person first, else one under way or
       * owed; undefined where none is.
       */
      const afterMergeOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ url: string; number: number | null; state: string; findings: number; prefix: string | null }>`
            SELECT r.url, r.number, r.state, json_array_length(r.findings) AS findings,
              (SELECT json_extract(l.snapshot, '$.words.prefix') FROM external_links l WHERE l.url = r.url AND l.task_id = r.task_id LIMIT 1) AS prefix
            FROM merge_reviews r WHERE r.task_id = ${taskId} AND r.state IN ('owed', 'running', 'found')
            ORDER BY r.state = 'found' DESC, r.updated_at DESC LIMIT 1`
          if (row === undefined) return undefined
          return {
            url: row.url,
            words: row.number === null ? 'the pull request' : `${row.prefix ?? '#'}${row.number}`,
            state: row.state === 'found' ? ('found' as const) : ('running' as const),
            findings: row.state === 'found' ? row.findings : 0,
          }
        })

      /** Where the time went of each turn the items came in, that kept it (turnTimes.ts). */
      const turnsOf = (items: ReadonlyArray<ThreadItem>) =>
        Effect.gen(function* () {
          const ids = [...new Set(items.flatMap((item) => (item.turn === undefined ? [] : [item.turn])))]
          if (ids.length === 0) return []
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ id: string; timings: string | null }>`
            SELECT id, timings FROM turn_deliveries WHERE id IN ${sql.in(ids)} AND timings IS NOT NULL`
          return rows.flatMap((row): Array<TurnTime> => {
            const timings = timingsFrom(row.timings)
            return timings === null ? [] : [{ id: row.id, ...timings }]
          })
        })

      /**
       * A task's rounds of work as its graph had them (`graph.ts`): its newest runs, their steps and each step's tries with the
       * agent each ran on, what each began with and when a change added to it, what started each follow-up, and whether the
       * run under way ends in publishing, as `conclude` would decide it now.
       */
      const graphFor = (projectId: string, taskId: string, threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const runs = yield* sql<{
            id: string
            planId: string | null
            createdAt: string
            endedAt: string | null
            parameters: string
            executionId: string
          }>`
            SELECT * FROM (
              SELECT r.id, r.plan_id, r.created_at, r.ended_at, r.parameters, e.id AS execution_id, r.rowid AS n
              FROM runs r JOIN workflow_executions e ON e.run_id = r.id WHERE r.task_id = ${taskId}
              ORDER BY r.created_at DESC, r.rowid DESC LIMIT ${GRAPH_ROUNDS}
            ) ORDER BY created_at, n`
          if (runs.length === 0) return []
          const executions = runs.map((one) => one.executionId)
          const [tries, revisions] = yield* Effect.all(
            [
              sql<{
                id: string
                executionId: string
                nodeKey: string
                iteration: number
                state: string
                tryState: string | null
                holdReason: string | null
                agentId: string | null
                model: string | null
                startedAt: string | null
                endedAt: string | null
              }>`
                SELECT n.id, n.execution_id, n.node_key, n.iteration, n.state, a.state AS try_state, a.hold_reason, s.agent_id,
                  -- The model it ran on, as its session's last turn in it was given: a session's own is what it is on now, and
                  -- a switch would move what it did before to the new one; else that, as for a try not given a turn yet. The
                  -- person's turn that opens a follow-up comes just before its first step does, and is marked as that step's.
                  COALESCE((
                    SELECT t.model FROM turn_deliveries t
                    WHERE t.provider_session_id = a.provider_session_id AND t.model IS NOT NULL
                      AND (t.node_attempt_id = a.id
                        OR (t.requested_at >= a.admitted_at AND (a.ended_at IS NULL OR t.requested_at <= a.ended_at)))
                    ORDER BY t.requested_at DESC, t.rowid DESC LIMIT 1
                  ), s.model) AS model,
                  a.started_at, a.ended_at
                FROM nodes n LEFT JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
                WHERE ${sql.in('n.execution_id', executions)}
                ORDER BY n.created_at, n.iteration, n.rowid, a.attempt_number`,
              sql<{ executionId: string; cause: string; graph: string; createdAt: string }>`
                SELECT execution_id, cause, graph, created_at FROM execution_graph_revisions
                WHERE ${sql.in('execution_id', executions)} ORDER BY revision`,
            ],
            { concurrency: 'unbounded' },
          )
          const decodeSteps = Schema.decodeUnknownOption(GraphSteps)
          const isKey = Schema.is(NodeKey)
          const shaped = yield* Effect.forEach(runs, (run, index) =>
            Effect.gen(function* () {
              const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(run.parameters).pipe(
                Effect.orElseSucceed(() => null),
              )
              const mine = revisions.filter((one) => one.executionId === run.executionId)
              const began = Option.match(decodeSteps(mine[0]?.graph), {
                onNone: () => [],
                onSome: (graph) => (graph.steps ?? []).filter((one) => one.skipped !== true).map((one) => one.key),
              })
              // A run under way publishes as `conclude` would decide now: a follow-up only where it was made a change in.
              const here = parameters?.here === true
              const publishes =
                run.endedAt === null &&
                parameters !== null &&
                (run.planId !== null || parameters.publishes === true || parameters.ships !== undefined) &&
                (parameters.end ??
                  (here ? null : yield* (yield* Changes).endFor(projectId, taskId).pipe(Effect.orElseSucceed(() => null)))) !== null
              // What started a follow-up: the person's message, or what the coordinator passed on, after the round before began.
              const before = runs[index - 1]?.createdAt ?? ''
              const ships = parameters?.ships !== undefined
              // A Ship is started by the person's press, not by what they said last.
              const [said] =
                run.planId === null && !ships
                  ? yield* sql<{ id: string; kind: string; content: string }>`
                      SELECT id, kind, content FROM thread_items
                      WHERE thread_id = ${threadId} AND created_at <= ${run.createdAt} AND created_at > ${before}
                        AND (kind = 'user_message' OR (kind = 'notice' AND json_extract(content, '$.role') = 'relayed'))
                      ORDER BY sequence DESC LIMIT 1`
                  : []
              const steps: StepRow[] = []
              for (const row of tries) {
                if (row.executionId !== run.executionId || !isKey(row.nodeKey)) continue
                const one =
                  row.tryState === null
                    ? []
                    : [
                        {
                          state: row.tryState,
                          hold: row.holdReason,
                          agentId: row.agentId,
                          model: row.model,
                          startedAt: row.startedAt,
                          endedAt: row.endedAt,
                        },
                      ]
                const had = steps.at(-1)
                if (had?.id === row.id) steps[steps.length - 1] = { ...had, tries: [...had.tries, ...one] }
                else steps.push({ id: row.id, key: row.nodeKey, iteration: row.iteration, state: row.state, tries: one })
              }
              return {
                id: run.id,
                planId: run.planId,
                createdAt: run.createdAt,
                endedAt: run.endedAt,
                planned: parameters?.steps ?? [],
                publishes,
                ...(ships ? { ships: true } : {}),
                began,
                changedAt: mine.find((one) => one.cause === 'patch')?.createdAt ?? null,
                said: said === undefined ? null : saidOf(said),
                steps,
              } satisfies RunRows
            }),
          )
          // Each helper on the round it started in, a lane of its model's on the Graph face (ADR-087).
          const rounds = graphOf(shaped)
          const helpers = yield* sql<{
            id: string
            name: string
            agentId: string
            model: string | null
            state: 'working' | 'done' | 'stopped' | 'failed'
            startedAt: string
            endedAt: string | null
          }>`SELECT id, name, agent_id, model, state, started_at, ended_at FROM helpers WHERE task_id = ${taskId} ORDER BY started_at`
          if (helpers.length === 0) return rounds
          return rounds.map((round, index) => {
            const next = rounds[index + 1]
            const its = helpers.filter(
              (helper) => (index === 0 || helper.startedAt >= round.createdAt) && (next === undefined || helper.startedAt < next.createdAt),
            )
            return its.length === 0 ? round : { ...round, helpers: its }
          })
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
            madeChangeAt: string | null
          }>`
            SELECT t.id AS thread_id, p.id AS project_id, p.name AS project_name, k.id AS task_id, k.title, k.description, k.request, k.slug, k.state,
              k.settled_at, ${sql.unsafe(SHOWN_BRANCH)}, w.path AS worktree, w.base_ref, w.base_commit, k.resolve_conflicts,
              (SELECT e.occurred_at FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = k.id AND e.type = 'task.made_change'
                ORDER BY e.sequence DESC LIMIT 1) AS made_change_at,
              (SELECT json_extract(r.rules, '$.resolveConflicts') FROM policies r WHERE r.project_id = p.id ORDER BY r.revision DESC LIMIT 1) AS project_resolves,
              k.allow_everything, ${sql.unsafe(PROJECT_ALLOWS('p.id'))} AS project_allows
            FROM threads t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = t.project_id
            LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id WHERE f.task_id = k.id AND f.device_id = ${instance.deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)
            WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (head === undefined) return yield* new NotFound({ kind: 'task thread', id: threadId })
          // The images and files the person sent with what they asked for, as the coordinator's chat shows them.
          const sentWith = yield* sql<{ content: string }>`
            SELECT ti.content FROM task_request_inputs r JOIN thread_items ti ON ti.user_input_id = r.user_input_id AND ti.kind = 'user_message'
            WHERE r.task_id = ${head.taskId} ORDER BY r.position, ti.sequence`
          const requestPictures = sentWith.flatMap((row) => picturesOf(field(parse(row.content), 'pictures')))
          const requestFiles = sentWith.flatMap((row) =>
            Option.getOrElse(decodeAttached(field(parse(row.content), 'files') ?? []), () => []),
          )
          // What the store says comes first, together, so it is as of the cursor; git after.
          const { items, earlier, turns } = yield* pageOf(threadId, page, true)
          // Its steps' reports, whatever page they're on: the task's finished view is read from the lead's, its graph from all.
          const reports = (yield* itemRows(threadId, { reports: true, limit: REPORTS })).items.map(itemOf)
          // The tasks its lead started, all of them: its thread's page may not reach the line that says so.
          const started = yield* sql<{ taskId: string; slug: string; title: string; threadId: string }>`
            SELECT k.id AS task_id, k.slug AS slug, k.title AS title, t.id AS thread_id
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.parent_task_id = ${head.taskId} ORDER BY k.created_at, k.id`
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
          const card: TaskCard | undefined = yield* cardFor(head.taskId, links)
          const session = yield* sessionOf(threadId)
          // Who leads it when no lead runs: the last on its thread, else its plan's.
          const [last] = yield* sql<{ agentId: string; model: string | null; account: string | null; startedAt: string }>`
            SELECT s.agent_id, s.model, a.name AS account, s.started_at FROM provider_sessions s LEFT JOIN agent_accounts a ON a.id = s.account_id
            WHERE s.thread_id = ${threadId} ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
          const planned = card?.plan?.steps.find((step) => step.key === 'implement')
          // Its lead changed since its last session began, with no lead running to change: the plan's lead is who leads it next.
          const [changedLead] = yield* sql<{ at: string | null }>`
            SELECT json_extract(parameters, '$.leadChanged') AS at FROM task_plans
            WHERE task_id = ${head.taskId} AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1`
          const leadMoved = last !== undefined && changedLead?.at != null && changedLead.at > last.startedAt && !session?.held
          // What the person can do to it as a whole, from where it stands.
          const standing = yield* standingOf(head.taskId)
          // Its folder, removed once it finished or on its way back (ADR-056).
          const folder = yield* folderOf(head.taskId)
          // Whether its run under way still has a review to come or under way, which the person can skip (ADR-034).
          const [reviewing] = yield* sql<{ left: number }>`
            SELECT count(*) AS left FROM runs r, json_each(r.parameters, '$.steps') s
            WHERE r.id = (SELECT id FROM runs WHERE task_id = ${head.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1)
              AND r.state = 'running' AND json_extract(s.value, '$.key') = 'review' AND NOT json_extract(s.value, '$.skipped')`
          const graph = yield* Effect.option(graphFor(head.projectId, head.taskId, threadId))
          // Looked at, its branches' remotes are asked where they are, and it is read again once they say.
          if (page.fresh === true) yield* (yield* Changes).askRemotes(head.taskId)
          // What git says of its worktrees, and its host, read at the same time.
          const [said, host] = yield* Effect.all(
            [gitOf(head.taskId, { changed: true, here: true, fresh: page.fresh === true }), hostOf(head.projectId)],
            {
              concurrency: 'unbounded',
            },
          )
          // What it used of each account its agents ran on: a reading that fails leaves it out, never the thread (ADR-084).
          const usage = yield* spendingOf({ taskId: head.taskId }).pipe(Effect.orElseSucceed(() => []))
          // Its lead's helpers at work (ADR-087), each on its change.
          const helpersAtWork = yield* sql<{ id: string; name: string; change: string | null; agentId: string; model: string | null }>`
            SELECT h.id, h.name, w.name AS change, h.agent_id, h.model FROM helpers h LEFT JOIN workspaces w ON w.id = h.workspace_id
            WHERE h.task_id = ${head.taskId} AND h.state = 'working' ORDER BY h.started_at`
          // Its changes, where it holds several: each with its stack, its wait, its pull request, what waits for Ship and its helper.
          const lineRows = yield* sql<{
            id: string
            name: string | null
            branch: string
            stackedOn: string | null
            waitsFor: string | null
            url: string | null
            helper: string | null
          }>`
            SELECT w.id, w.name, w.branch,
              (SELECT coalesce(o.name, o.branch) FROM workspaces o WHERE o.task_id = w.task_id AND o.binding_id = w.binding_id
                AND o.branch = w.toward AND o.id <> w.id LIMIT 1) AS stacked_on,
              (SELECT coalesce(o.name, o.branch) FROM workspaces o WHERE o.id = w.waits_for) AS waits_for,
              (SELECT c.pull_request_url FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL
                ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1) AS url,
              (SELECT h.name FROM helpers h WHERE h.task_id = w.task_id AND h.workspace_id = w.id AND h.state = 'working'
                ORDER BY h.started_at LIMIT 1) AS helper
            FROM workspaces w
            WHERE w.task_id = ${head.taskId} AND w.access = 'write' AND w.reviewing IS NULL AND w.state IN ('ready', 'away')
            ORDER BY w.created_at, w.rowid`
          // Several changes, by name: one in several repositories is one change, with its row there as it was.
          const severalChanges = new Set(lineRows.map((row) => row.name ?? '')).size > 1
          const waitingLines = !severalChanges
            ? new Set<string>()
            : new Set((yield* (yield* Changes).waitingChanges(head.taskId).pipe(Effect.orElseSucceed(() => []))).map((one) => one.id))
          // A move between a worktree and Local that waits: where to, why, and what it asks of the person, as last said.
          const [moving] = yield* sql<{ to: 'worktree' | 'checkout'; why: string | null; branch: string | null; head: string | null }>`
            SELECT w.moving_to AS "to", json_extract(e.payload, '$.why') AS why, json_extract(e.payload, '$.seen.branch') AS branch,
              json_extract(e.payload, '$.seen.head') AS head
            FROM workspaces w LEFT JOIN record_events e ON e.rowid = (
              SELECT max(x.rowid) FROM record_events x
              WHERE x.aggregate_type = 'workspace' AND x.aggregate_id = w.id AND x.type = 'workspace.move_waits')
            WHERE w.task_id = ${head.taskId} AND w.moving_to IS NOT NULL LIMIT 1`
          return {
            threadId,
            cursor: at,
            usage,
            project: { id: head.projectId, name: head.projectName },
            host,
            task: {
              id: head.taskId,
              title: head.title,
              description: head.description,
              request: head.request,
              ...(requestPictures.length === 0 ? {} : { requestPictures }),
              ...(requestFiles.length === 0 ? {} : { requestFiles }),
              slug: head.slug,
              state: head.state,
              branch: head.branch,
              worktree: head.worktree,
              ...(card?.local === true ? { local: true } : {}),
              ...(card?.scratch === true ? { scratch: true } : {}),
              ...(!severalChanges
                ? {}
                : {
                    lines: lineRows.map((one) => ({
                      id: one.id,
                      name: one.name ?? one.branch,
                      branch: one.branch,
                      stackedOn: one.stackedOn,
                      waitsFor: one.waitsFor,
                      url: one.url,
                      waiting: waitingLines.has(one.id),
                      helper: one.helper,
                    })),
                  }),
              ...(helpersAtWork.length === 0
                ? {}
                : {
                    helpers: helpersAtWork.map((one) => ({
                      id: one.id,
                      name: one.name,
                      change: one.change,
                      model: one.model ?? one.agentId,
                    })),
                  }),
              ...(moving === undefined
                ? {}
                : {
                    moving: {
                      to: moving.to,
                      why: moving.why ?? '',
                      ...(moving.head === null ? {} : { seen: { branch: moving.branch, head: moving.head } }),
                    },
                  }),
              ...(card?.waitsForCheckout == null ? {} : { waitsForCheckout: card.waitsForCheckout }),
              ...(card?.toward === undefined ? {} : { toward: card.toward }),
              ...(folder === undefined ? {} : { folder }),
              baseRef: head.baseRef,
              phase: card?.phase ?? null,
              ...(card?.stopped == null ? {} : { stopped: card.stopped }),
              ...(card?.mergeable === true ? { mergeable: true as const } : {}),
              kind: card?.kind,
              handedBack: card?.handedBack ?? null,
              checksBack: card?.checksBack ?? null,
              conflictUnsent: card?.conflictUnsent ?? null,
              conflictUnchecked: card?.conflictUnchecked ?? null,
              madeChangeAt: head.madeChangeAt,
              waits: card?.waits ?? null,
              ...(card?.reconnects == null ? {} : { reconnects: card.reconnects }),
              queued: card?.queued ?? null,
              ...(card?.place === undefined ? {} : { place: card.place }),
              // In Up next behind another of its tasks, continuing or in the line, or a plan waiting to start, the person can put it
              // first from here.
              ...((card?.inLine === true || card?.continues === true) && card.queued !== null
                ? (yield* placeOf(head.taskId))?.behind === true
                  ? { front: true }
                  : {}
                : card?.phase === 'planned' || card?.phase === 'held'
                  ? { front: true }
                  : {}),
              steps: card?.plan?.steps ?? [],
              // Its graph is a part of its own: one that can't be read leaves the face out, not the thread.
              ...Option.match(graph, { onNone: () => ({}), onSome: (rounds) => ({ graph: rounds }) }),
              lead:
                leadMoved && planned !== undefined
                  ? { agentId: planned.agentId, model: planned.model, account: null }
                  : last === undefined
                    ? planned === undefined
                      ? null
                      : { agentId: planned.agentId, model: planned.model, account: null }
                    : { agentId: last.agentId, model: last.model, account: last.account },
              step: card?.step ?? null,
              startedAt: card?.startedAt ?? null,
              stepAt: onStep?.admittedAt ?? null,
              settledAt: head.settledAt,
              ...links,
              unshipped: card?.unshipped ?? null,
              ...(card?.held === undefined ? {} : { held: card.held }),
              ...(card?.replied === undefined ? {} : { replied: card.replied }),
              ...(card?.afterMerge === undefined ? {} : { afterMerge: card.afterMerge }),
              // As the board reads it: a ready change whose branch holds nothing and whose pull request, if any, closed.
              ...(card?.phase === 'ready' &&
              card.kind === 'change' &&
              card.unshipped == null &&
              (card.change === null || card.change.state === 'closed') &&
              said.commits === 0 &&
              said.files.length === 0 &&
              (yield* Effect.flatMap(Changes, (changes) => changes.nothingBuilt(head.taskId)).pipe(Effect.orElseSucceed(() => false)))
                ? { nothingBuilt: true }
                : {}),
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
              runnables: yield* launches.runnables(head.projectId, head.taskId).pipe(Effect.orElseSucceed(() => [])),
              launches: (yield* launches.ofProject(head.projectId)).filter((launch) => launch.taskId === head.taskId),
              resolveConflicts: {
                task: head.resolveConflicts === null ? null : head.resolveConflicts === 1,
                // On unless the person turned it off (Policies.resolvesConflicts).
                project: head.projectResolves !== 0,
              },
              allowEverything: { task: head.allowEverything === 1, project: head.projectAllows === 1 },
              review: yield* reviewBriefOf(head.taskId),
            },
            session,
            retryable: yield* (yield* Sessions).retryable(threadId),
            attention: attention.map(callOf),
            items,
            earlier,
            reports: reports.flatMap((item) => (item === undefined ? [] : [item])),
            turns,
            started,
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
          // A cleared view starts at its mark, or, with the earlier conversation open, ends before it.
          const mark = yield* markOf(threadId)
          const within = mark === null ? {} : mark.earlierShown ? { until: mark.from } : { from: mark.from }
          // Its cards, the agent on it, the one it would start on and the project's host, read at the same time.
          const [read, session, suggested, host, view] = yield* Effect.all(
            [
              pageOf(threadId, { ...page, ...within }),
              sessionOf(threadId),
              coordinators.suggested(projectId),
              hostOf(projectId),
              viewOf(threadId),
            ],
            { concurrency: 'unbounded' },
          )
          // What is still open stays in a cleared view: carried in at its start, once the page reaches it.
          const carried =
            mark === null || mark.earlierShown || read.earlier
              ? []
              : yield* pageOf(threadId, { until: mark.from, limit: CARRIED, open: true }).pipe(Effect.map((one) => one.items))
          const { earlier } = read
          const items = [...carried, ...read.items]
          const turns = yield* turnsOf(items)
          // What it used today, since this computer's midnight, of each account it ran on (ADR-084).
          const midnight = new Date(yield* Clock.currentTimeMillis)
          midnight.setHours(0, 0, 0, 0)
          const usage = yield* spendingOf({ threadId, since: midnight.toISOString() }).pipe(Effect.orElseSucceed(() => []))
          return {
            threadId,
            cursor: at,
            usage,
            project: { id: projectId, name: project.name },
            session,
            retryable: yield* (yield* Sessions).retryable(threadId),
            suggested,
            items,
            earlier,
            turns,
            view,
            host,
            runnables: yield* launches.runnables(projectId, null).pipe(Effect.orElseSucceed(() => [])),
            // Every run in the project, the tasks' too: the coordinator's screen is the project's.
            launches: yield* launches.ofProject(projectId),
          } satisfies CoordinatorSnapshot
        })

      /**
       * One item, read by id, as a window does each one it hears changed: null for one the thread keeps for Althar and never
       * shows (what a lead could see, say), which is there, only not for the window; not found, one that isn't.
       */
      const shown = (threadId: string, itemId: string) =>
        Effect.gen(function* () {
          const { items } = yield* itemRows(threadId, { itemId, limit: 1 })
          const row = items[0]
          if (row === undefined) return yield* new NotFound({ kind: 'thread item', id: itemId })
          return (row.kind === 'task' ? yield* cardOf(row) : itemOf(row)) ?? null
        })

      /** One item a page shows, by id; not found where the thread has none, or keeps it for Althar alone. */
      const item = (threadId: string, itemId: string) =>
        Effect.flatMap(shown(threadId, itemId), (found) =>
          found === null ? Effect.fail(new NotFound({ kind: 'thread item', id: itemId })) : Effect.succeed(found),
        )

      const changesSince = (after: number, limit: number) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<ThreadChange>`
            SELECT c.cursor, c.aggregate_type, c.aggregate_id, c.project_id,
              CASE c.aggregate_type
                WHEN 'thread' THEN c.aggregate_id
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
                -- A task's card came out different: its thread's head says where it stands, as the card does.
                WHEN 'card' THEN (SELECT id FROM threads WHERE task_id = c.aggregate_id AND kind = 'task')
                WHEN 'external_link' THEN (SELECT t.id FROM external_links x
                  JOIN threads t ON t.task_id = x.task_id AND t.kind = 'task' WHERE x.id = c.aggregate_id)
                WHEN 'issue_draft' THEN (SELECT thread_id FROM issue_drafts WHERE id = c.aggregate_id)
                WHEN 'issue_change' THEN (SELECT thread_id FROM issue_changes WHERE id = c.aggregate_id)
                WHEN 'review_draft' THEN (SELECT thread_id FROM review_drafts WHERE id = c.aggregate_id)
                -- A run and a try at one of its steps belong to their task's thread, whose graph they change.
                WHEN 'run' THEN (SELECT t.id FROM runs r
                  JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task' WHERE r.id = c.aggregate_id)
                WHEN 'node_attempt' THEN (SELECT t.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                  JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
                  JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task' WHERE a.id = c.aggregate_id)
              END AS thread_id
            FROM change_log c WHERE c.cursor > ${after} ORDER BY c.cursor LIMIT ${limit}`
        })

      /*
       * The board keeps up (feed.ts): as a change of a task is recorded, whatever it changed, the task's card is worked
       * out again as its board shows it, with the calls it waits on, and where that came out different from the last time
       * the feed said `card` changes once. A window reads its boards, the home and the coordinator's cards again on that
       * alone, so no kind of change a card reads can be missed, and what is said in a thread, most of what is recorded,
       * reads one card here rather than every board there. What was kept of a settled card goes as its task changes.
       */
      let cardRevision = 0
      const cardShown = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ id: string; projectId: string; state: string; createdAt: string; settledAt: string | null }>`
            SELECT id, project_id, state, created_at, settled_at FROM tasks WHERE id = ${taskId}`
          if (row === undefined) return 'gone'
          for (const key of settledCards.keys()) if (key.startsWith(`${taskId}:`)) settledCards.delete(key)
          const card = yield* cardOnBoard(row)
          const calls = (yield* callsIn(row.projectId)).filter((one) => one.call.taskId === taskId).map((one) => one.call)
          return { whole: JSON.stringify({ card, calls }), card: JSON.stringify(card) }
        })
      // What of a project's board is no task's: the questions its coordinator asks the person, which wait in Needs you.
      const shownCalls = new Map<string, string>()
      const projectShown = (projectId: string) =>
        Effect.map(callsIn(projectId), (calls) => JSON.stringify(calls.filter((one) => one.call.taskId === null).map((one) => one.call)))
      const cardsMoved = (ledger: Ledger['Service'], after: number) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          let at = after
          // Each task a change was of, by its project: the change's own, so a task removed is still said of its board.
          const tasks = new Map<string, string>()
          // And each project a change of no task was in, whose own calls it may have moved.
          const projects = new Set<string>()
          for (;;) {
            const rows = yield* sql<{ cursor: number; projectId: string | null; taskId: string | null }>`
              SELECT c.cursor, c.project_id, ${sql.unsafe(taskOfChange)} AS task_id FROM change_log c
              WHERE c.cursor > ${at} ORDER BY c.cursor LIMIT ${CARD_CHANGES}`
            for (const row of rows)
              if (row.projectId === null) continue
              else if (row.taskId !== null) tasks.set(row.taskId, row.projectId)
              else projects.add(row.projectId)
            at = rows.at(-1)?.cursor ?? at
            if (rows.length < CARD_CHANGES) break
          }
          yield* Effect.forEach(
            tasks,
            ([taskId, projectId]) =>
              Effect.gen(function* () {
                const shown = yield* cardShown(taskId)
                if (shown !== 'gone' && shownCards.get(taskId)?.whole === shown.whole) return
                if (shown === 'gone') shownCards.delete(taskId)
                else shownCards.set(taskId, shown)
                cardRevision += 1
                yield* ledger.notify({
                  projectId: projectId as never,
                  aggregateType: 'card',
                  aggregateId: taskId,
                  aggregateRevision: cardRevision,
                })
              }),
            { concurrency: AT_ONCE, discard: true },
          )
          // A project's own calls came out different: said as its card, of the project, so its board and the home read again.
          yield* Effect.forEach(
            projects,
            (projectId) =>
              Effect.gen(function* () {
                const shown = yield* projectShown(projectId)
                // Not yet worked out since Althar started, it is said changed: a window may hold calls read before, which a
                // change now may have answered.
                if (shownCalls.get(projectId) === shown) return
                shownCalls.set(projectId, shown)
                cardRevision += 1
                yield* ledger.notify({
                  projectId: projectId as never,
                  aggregateType: 'card',
                  aggregateId: projectId,
                  aggregateRevision: cardRevision,
                })
              }),
            { concurrency: AT_ONCE, discard: true },
          )
          return at
        })
      const ledger = yield* Ledger
      // Listening, and where the record stands, as Queries is made, not as the fiber first runs: what is recorded in between
      // (an answer given the moment Althar is up) would be past where it starts, and never looked at.
      const grown = yield* ledger.listen
      let at = yield* Effect.orElseSucceed(run(cursor), () => 0)
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          // Changes are gathered for a moment, so a burst works each card out once.
          const round = Effect.gen(function* () {
            yield* grown
            yield* Effect.sleep(CARDS_GATHER)
            at = yield* run(cardsMoved(ledger, at))
          })
          yield* Effect.forever(
            round.pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not work out the cards that changed', cause),
              ),
            ),
          )
        }),
      )

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
        fileDiff: (taskId, path, untouched) => run(diffOf(taskId, path, untouched)),
        findings: (taskId, review) => run(findingsOf(taskId, review)),
        codeRoots: (threadId) => run(codeRoots(threadId)),
        findCode: (threadId, messages) => run(codeFound(threadId, messages)),
        readCode: (threadId, path, commit, line) =>
          run(Effect.flatMap(codeRoots(threadId), (place) => readCode(place, path, commit, line))),
        card: (taskId) =>
          run(
            Effect.flatMap(cardFor(taskId), (found) =>
              found === undefined ? Effect.fail(new NotFound({ kind: 'task', id: taskId })) : Effect.succeed(found),
            ),
          ),
        kept: run(keptForLater),
        board: (projectId) => run(board(projectId)),
        olderSettled: (projectId, before, taskId) => run(olderSettled(projectId, before, taskId)),
        home: (since) => run(home(since)),
        item: (threadId, itemId) => run(item(threadId, itemId)),
        shown: (threadId, itemId) => run(shown(threadId, itemId)),
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
              // Whose it is: the worktree an absolute path is in, else the first.
              const owner = isAbsolute(path)
                ? worktrees.find((worktree) => path === worktree.path || path.startsWith(`${worktree.path}${sep}`))
                : worktrees[0]
              // Its folder removed once it finished, a document it committed reads from the commit kept as it went (ADR-056).
              if (owner !== undefined && owner.state === 'cleaned' && owner.root !== null && !existsSync(owner.path)) {
                const [kept = null, branch = null] = yield* commitsOf(owner.root, [
                  `${KEPT}${owner.workspaceId}`,
                  `refs/heads/${owner.branch}`,
                ])
                const head = kept ?? branch
                if (head === null) return yield* new NotFound({ kind: 'document', id: path })
                return yield* documentKept(path, { root: owner.root, head, worktree: owner.path })
              }
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
