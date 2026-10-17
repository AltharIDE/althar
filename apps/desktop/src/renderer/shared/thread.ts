import type { AllowedBy, FileMention, Picture, ThreadItem, Unfurl } from '@althar/contracts'
import { Delivery, PlanState, ToolKind, ToolState } from '@althar/ui'

import { type Handed, handedBy, type OutputSoFar, type PartHanded, type Ran, ranOf } from './handed'
import { isSending } from './items'
import { took } from './time'

/*
 * A thread's items as the blocks the kit draws, in order: what the person
 * said, each turn of the agent (its messages, thoughts, tool calls and plan,
 * grouped under one name), what a step reported when it ended, a task's card
 * in the coordinator's thread, and the lines that mark a change of scene.
 * Text still streaming replaces the stored text of its item.
 *
 * A turn's work folds (docs/plans/mvp.md, "Work is collapsed"): its tool
 * calls, thoughts and plan, and what it said on the way, under how long it
 * worked. Only its last message stays open, or nothing when a step's result
 * follows, since the step's summary is what the person reads. While it runs,
 * the fold says how long it has worked so far and what it is doing now.
 * Before it has said anything, where its reply will start is held for it.
 */

/** What a message or a tool call handed back beside its words (handed.ts). */
interface HandedParts {
  readonly pictures: ReadonlyArray<Picture>
  readonly files: ReadonlyArray<FileMention>
}

export type Part =
  | ({ readonly kind: 'message'; readonly id: string; readonly text: string } & HandedParts)
  | { readonly kind: 'thought'; readonly id: string; readonly text: string }
  | ({
      readonly kind: 'tool'
      readonly id: string
      readonly toolKind: ToolKind
      readonly verb: string
      readonly target: string
      readonly state: ToolState
      /** The whole command, when it runs one: what the row opens to, and what Copy takes. */
      readonly command: string | null
      /** The command as it reads at a glance, which the row shows in its place, where it can be said shorter. */
      readonly label?: string
      /** The project's rule that let it through without asking (ADR-018), where one did. */
      readonly allowedBy?: AllowedBy
      /** For a command: its output so far, or how much it printed once it ended (handed.ts). */
      readonly ran: Ran | null
      /** How a command ended, where it says. */
      readonly exit: number | null
      /** Every file it names, as it names them: what it touched, wrote or pointed at. */
      readonly touches: ReadonlyArray<string>
    } & HandedParts)
  | {
      readonly kind: 'plan'
      readonly id: string
      readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string; readonly state: PlanState }>
    }
  | { readonly kind: 'notice'; readonly id: string; readonly text: string; readonly tone: 'info' | 'warning' | 'error' }

export type StepResult = Extract<ThreadItem, { kind: 'step_result' }>['content']
export type TaskCardContent = Extract<ThreadItem, { kind: 'task' }>['content']
export type ArrivalContent = Extract<ThreadItem, { kind: 'arrival' }>['content']
export type QuestionContent = Extract<ThreadItem, { kind: 'question' }>['content']
export type RunContent = Extract<ThreadItem, { kind: 'run' }>['content']
export type IssueDraftContent = Extract<ThreadItem, { kind: 'issue_draft' }>['content']
export type SetupContent = Extract<ThreadItem, { kind: 'setup' }>['content']
export type PushRequestContent = Extract<ThreadItem, { kind: 'push_request' }>['content']
export type ReviewDraftContent = Extract<ThreadItem, { kind: 'review_draft' }>['content']

export type Block =
  | {
      readonly kind: 'you'
      readonly id: string
      readonly text: string
      readonly at: string
      readonly delivery: Delivery
      /** The links in it Althar could unfurl: issues and pull requests. */
      readonly links: ReadonlyArray<Unfurl>
      /** The images the person sent with it. */
      readonly pictures: ReadonlyArray<Picture>
    }
  | {
      readonly kind: 'turn'
      readonly id: string
      readonly agentId: string | null
      readonly at: string
      /** Everything it did and said, in order. */
      readonly parts: ReadonlyArray<Part>
      /** What folds: all but its last message. */
      readonly work: ReadonlyArray<Part>
      /** What stays open under the fold: its last message, unless a step's result follows. */
      readonly said: ReadonlyArray<Part>
      /** It is still running. */
      readonly live: boolean
      /** How long it worked, from its first item to its last, or until now while it runs. */
      readonly took: string
      /** While it runs, what it is doing now, in a few words. */
      readonly doing: string | null
      /** What it handed back beside its words: pictures, documents, files. */
      readonly handed: Handed
    }
  | { readonly kind: 'divider'; readonly id: string; readonly text: string }
  | { readonly kind: 'step'; readonly id: string; readonly at: string; readonly result: StepResult }
  | { readonly kind: 'card'; readonly id: string; readonly card: TaskCardContent }
  /** Something heard from outside: a comment on the task's pull request, its checks, its merge. */
  | { readonly kind: 'arrival'; readonly id: string; readonly at: string; readonly arrival: ArrivalContent }
  /** A question an agent asked the person, standing on its own, as the turn waited on it: answered where it is. */
  | { readonly kind: 'question'; readonly id: string; readonly at: string; readonly question: QuestionContent }
  /** A run of the project Althar started, where it was asked for (ADR-023). */
  | { readonly kind: 'run'; readonly id: string; readonly run: RunContent }
  /** An issue the coordinator drafted, filed only when the person says. */
  | { readonly kind: 'draft'; readonly id: string; readonly draft: IssueDraftContent }
  /** Althar setting up the task's worktree, before its lead starts (ADR-023). */
  | { readonly kind: 'setup'; readonly id: string; readonly setup: SetupContent }
  /** The lead asking the person to push its new commits to the task's pull request: when it asked, or when it settled. */
  | { readonly kind: 'push'; readonly id: string; readonly at: string; readonly request: PushRequestContent }
  /** A review the lead drafted of someone else's pull request, posted only when the person says. */
  | { readonly kind: 'review'; readonly id: string; readonly review: ReviewDraftContent }
  /**
   * The agent's turn runs on what it was last asked, and it hasn't said
   * anything yet: where its reply will start, held for it, with how long it
   * has been once that is worth saying, and whether that is longer than usual.
   */
  | { readonly kind: 'waiting'; readonly id: string; readonly took: string | null; readonly slow: boolean }

/** ACP's tool kinds, as the kit's. */
/** The notice earlier versions left in a thread when Althar restarted under its lead. */
const RESTARTED = 'Althar restarted.'

/** What the coordinator passed on to a lead, before notices had roles: by its title. */
const RELAYED_TITLE = 'From the coordinator'

/** What the coordinator passed on to a lead, which Althar says as the lead reads it: by its role, or before roles, its title. */
export const relayed = (content: { readonly title: string; readonly role?: string }): boolean =>
  content.role === 'relayed' || (content.role === undefined && content.title.startsWith(RELAYED_TITLE))

/** How many seconds an agent's first word is waited for before the thread says how long it has been, and then that it's longer than usual. */
export const WAIT = { counted: 3, slow: 30 }

export const toolKindOf = (kind: string): ToolKind => {
  switch (kind) {
    case 'read':
      return ToolKind.Read
    case 'edit':
      return ToolKind.Edit
    case 'delete':
      return ToolKind.Delete
    case 'move':
      return ToolKind.Move
    case 'search':
      return ToolKind.Search
    case 'execute':
      return ToolKind.Run
    case 'think':
      return ToolKind.Think
    case 'fetch':
      return ToolKind.Fetch
    default:
      return ToolKind.Other
  }
}

/**
 * What a tool call does, in a word, before what it does it to: as it runs
 * ("Running"), once done ("Ran"), and otherwise, when it was declined, failed
 * or stopped, the plain verb ("Run"), which the kit marks as such.
 */
export const verbs: Readonly<Record<ToolKind, { readonly plain: string; readonly running: string; readonly done: string }>> = {
  [ToolKind.Read]: { plain: 'Read', running: 'Reading', done: 'Read' },
  [ToolKind.List]: { plain: 'List', running: 'Listing', done: 'Listed' },
  [ToolKind.Search]: { plain: 'Search', running: 'Searching', done: 'Searched' },
  [ToolKind.Edit]: { plain: 'Edit', running: 'Editing', done: 'Edited' },
  [ToolKind.Create]: { plain: 'Create', running: 'Creating', done: 'Created' },
  [ToolKind.Delete]: { plain: 'Delete', running: 'Deleting', done: 'Deleted' },
  [ToolKind.Move]: { plain: 'Move', running: 'Moving', done: 'Moved' },
  [ToolKind.Run]: { plain: 'Run', running: 'Running', done: 'Ran' },
  [ToolKind.Think]: { plain: 'Plan', running: 'Planning', done: 'Planned' },
  [ToolKind.Fetch]: { plain: 'Fetch', running: 'Fetching', done: 'Fetched' },
  [ToolKind.Mcp]: { plain: 'Call', running: 'Calling', done: 'Called' },
  [ToolKind.Agent]: { plain: 'Start', running: 'Starting', done: 'Started' },
  [ToolKind.PullRequest]: { plain: 'Open', running: 'Opening', done: 'Opened' },
  [ToolKind.Comment]: { plain: 'Reply on', running: 'Replying on', done: 'Replied on' },
  [ToolKind.Push]: { plain: 'Push', running: 'Pushing', done: 'Pushed' },
  [ToolKind.Other]: { plain: 'Use', running: 'Using', done: 'Used' },
}

/** The verb for a tool call as it stands. */
export const verbFor = (toolKind: ToolKind, state: ToolState): string => {
  const verb = verbs[toolKind]
  return state === ToolState.Running ? verb.running : state === ToolState.Done ? verb.done : verb.plain
}

/** A tool call's status, as the kit's. One declined says so; one left running when its turn has ended was stopped with it. */
export const toolStateOf = (status: string, turnRunning: boolean, declined = false): ToolState => {
  if (declined) return ToolState.Declined
  switch (status) {
    case 'completed':
      return ToolState.Done
    case 'failed':
      return ToolState.Failed
    default:
      return turnRunning ? ToolState.Running : ToolState.Cancelled
  }
}

/** A plan step's status, as the kit's. A step still in progress when its turn has ended waits for the next. */
export const planStateOf = (status: string, turnRunning: boolean): PlanState =>
  status === 'completed' ? PlanState.Done : status === 'in_progress' && turnRunning ? PlanState.Running : PlanState.Queued

type ToolContent = Extract<ThreadItem, { kind: 'tool_call' }>['content']
type NoticeContent = Extract<ThreadItem, { kind: 'notice' }>['content']

/** A path inside the worktree, from the worktree; any other, whole. */
const within = (path: string, worktree: string | null) =>
  worktree !== null && path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path

/** Words an agent's title may start with that say what it does, which the row's own verb says already. */
const TITLE_VERBS = new Set([
  'read',
  'write',
  'edit',
  'create',
  'delete',
  'move',
  'list',
  'search',
  'find',
  'fetch',
  'run',
  'open',
  'call',
  'use',
])

/**
 * What a tool call acts on: the file it touches or the command it runs when
 * it says, and otherwise its title. A title that starts with a verb of its
 * own ("Write hello.txt", Codex's "Run command") gives the rest, since the
 * row's verb comes from the call's kind. Any other title, such as a command
 * Claude gives as its title ("grep -n …"), is kept whole.
 */
export const targetOf = (content: ToolContent, worktree: string | null): string => {
  const path = content.locations[0]?.path
  if (path !== undefined) return within(path, worktree)
  if (content.command !== null) return content.label ?? content.command
  const space = content.title.indexOf(' ')
  const first = space > 0 ? content.title.slice(0, space).toLowerCase() : ''
  return TITLE_VERBS.has(first) ? content.title.slice(space + 1) : content.title
}

/** Text an agent is still writing, by the item it will be. */
export interface Streamed {
  readonly kind: 'agent_message' | 'agent_thought'
  readonly agentId: string
  readonly text: string
  /** When it was first heard. */
  readonly at: string
}

const noticeText = (content: NoticeContent) => (content.description === null ? content.title : `${content.title} ${content.description}`)

const partOf = (
  item: Extract<ThreadItem, { kind: 'agent_message' | 'agent_thought' | 'tool_call' | 'plan' | 'notice' }>,
  streaming: ReadonlyMap<string, Streamed>,
  turnRunning: boolean,
  worktree: string | null,
  outputs: ReadonlyMap<string, OutputSoFar>,
): Part => {
  switch (item.kind) {
    case 'agent_message':
    case 'agent_thought': {
      const live = streaming.get(item.id)?.text
      // Streaming text is whole each time; the store catches up behind it.
      const text = live !== undefined && live.length >= item.content.text.length ? live : item.content.text
      return item.kind === 'agent_thought'
        ? { kind: 'thought', id: item.id, text }
        : { kind: 'message', id: item.id, text, pictures: item.content.pictures, files: item.content.files }
    }
    case 'tool_call': {
      const toolKind = toolKindOf(item.content.toolKind)
      const state = toolStateOf(item.content.status, turnRunning, item.content.declined)
      return {
        kind: 'tool',
        id: item.id,
        toolKind,
        verb: verbFor(toolKind, state),
        target: targetOf(item.content, worktree),
        state,
        command: item.content.command,
        ...(item.content.label === undefined ? {} : { label: item.content.label }),
        ...(item.content.allowedBy === undefined ? {} : { allowedBy: item.content.allowedBy }),
        ran: ranOf(item.content, state, outputs.get(item.id)),
        exit: item.content.exit,
        touches: [...item.content.locations.map((location) => location.path), ...item.content.files.map((file) => file.path)],
        pictures: item.content.pictures,
        files: item.content.files,
      }
    }
    case 'plan':
      return {
        kind: 'plan',
        id: item.id,
        steps: item.content.entries.map((entry, index) => ({
          id: `${item.id}-${index}`,
          label: entry.content,
          state: planStateOf(entry.status, turnRunning),
        })),
      }
    case 'notice':
      return { kind: 'notice', id: item.id, text: noticeText(item.content), tone: item.content.severity }
  }
}

/** What blocks are made from: a thread's items, whether its agent is mid-turn, and the worktree its paths are under. */
export interface ThreadSource {
  readonly items: ReadonlyArray<ThreadItem>
  readonly turnRunning: boolean
  readonly worktree: string | null
  /** What waits its turn is in the composer's queue, not here: see `queueShown`. The turn running, when not said. */
  readonly queue?: boolean
  /** Commands' output as far as it has come, by their tool call's item, while they run. */
  readonly outputs?: ReadonlyMap<string, OutputSoFar>
  /** When the turn running started, by the runtime's clock: what the wait for its first word is counted from. */
  readonly turnStarted?: string | null
  /** When what opens the thread was asked, where it isn't one of its items, as a task's request: the agent's first turn answers it. */
  readonly openedAt?: string | null
  /**
   * What waits after the agent's last reply is being read now, with nothing
   * to wait behind (see `readingNow`): it is what the reply is waited for,
   * not a queue, though the agent may still be starting to read it.
   */
  readonly reading?: boolean
  /** When the agent's last turn ended, by the runtime's clock: a message delivered before it was answered, if with nothing. */
  readonly turnEnded?: string | null
  /** When the newest of what comes before these items was written, where they are the last stretch of a longer thread. */
  readonly earlierAt?: string
}

/** What a part handed back, for the turn to gather. */
const partHanded = (part: Part): PartHanded => {
  switch (part.kind) {
    case 'message':
      return { id: part.id, pictures: part.pictures, files: part.files }
    case 'tool':
      return { id: part.id, pictures: part.pictures, files: part.files, undone: part.state !== ToolState.Done, target: part.target }
    default:
      return { id: part.id, pictures: [], files: [] }
  }
}

/** A turn's work and what it said: all but its last message folds, and all of it before a step's result. */
const splitOf = (parts: ReadonlyArray<Part>, beforeStep: boolean) => {
  // A turn an error ended says so in the open: there's no answer to come.
  const ending = parts.at(-1)
  const failed = ending?.kind === 'notice' && ending.tone === 'error' ? parts.length - 1 : -1
  const last = beforeStep ? -1 : parts.findLastIndex((part) => part.kind === 'message')
  return {
    work: parts.filter((_, index) => index !== last && index !== failed),
    said: parts.filter((_, index) => index === last || index === failed),
  }
}

/** What a running turn is doing, from the last thing it did. */
const doingOf = (work: ReadonlyArray<Part>): string | null => {
  const last = work.at(-1)
  switch (last?.kind) {
    case 'tool':
      return `${last.verb} ${last.target}`
    case 'thought':
      return text.thinking
    case 'plan':
      return text.planning
    default:
      return null
  }
}

export const text = { thinking: 'Thinking', planning: 'Planning' }

/** The blocks of a thread, oldest first, with what is still being written but not yet read at the end. */
export const blocksOf = (
  source: ThreadSource,
  streaming: ReadonlyMap<string, Streamed>,
  ago: (iso: string) => string,
  now: string = new Date().toISOString(),
): ReadonlyArray<Block> => {
  const { turnRunning, worktree } = source
  const queue = source.queue ?? turnRunning
  const outputs = source.outputs ?? new Map<string, OutputSoFar>()
  const blocks: Array<Block> = []
  /** What the agent was last asked, in the thread: what the person said it has, or what the coordinator passed on. */
  let asked: ThreadItem | null = null
  /** When the newest item so far was written; and whether what was last asked waited behind something newer, as a turn at work. */
  let newest = source.earlierAt === undefined ? 0 : Date.parse(source.earlierAt)
  let waitedBehind = false
  /** Whether what was last asked is still on its way to the agent: the window's copy of what the person sent, or queued in the store. */
  let onItsWay = false
  /** When each turn began and last grew, by its id. */
  const spans = new Map<string, { from: string; to: string }>()
  const add = (agentId: string | null, at: string, part: Part) => {
    const last = blocks.at(-1)
    if (last?.kind === 'turn' && last.agentId === agentId) {
      blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] }
      const span = spans.get(last.id)
      if (span !== undefined) spans.set(last.id, { ...span, to: at })
      return
    }
    blocks.push({
      kind: 'turn',
      id: part.id,
      agentId,
      at: ago(at),
      parts: [part],
      work: [],
      said: [],
      live: false,
      took: '',
      doing: null,
      handed: handedBy([], null),
    })
    spans.set(part.id, { from: at, to: at })
  }
  for (const item of source.items) {
    const before = newest
    newest = Math.max(newest, Date.parse(item.createdAt))
    // The agent asking the person something: its question stands in its place.
    if (item.kind === 'tool_call' && item.content.asks === true) continue
    switch (item.kind) {
      case 'user_message': {
        // What waits its turn shows in the composer's queue, where it can be edited or taken back; what was taken back is gone.
        if (item.input?.state === 'withdrawn' || (queue && item.input?.state === 'queued' && !item.input.interrupting)) continue
        // Being read now, it is the agent's already, in the store's word a moment later.
        const delivery =
          item.input?.state === 'queued' && (item.input.interrupting || source.reading !== true)
            ? item.input.interrupting
              ? Delivery.Interrupting
              : Delivery.Queued
            : Delivery.Delivered
        blocks.push({
          kind: 'you',
          id: item.id,
          text: item.content.text,
          at: ago(item.createdAt),
          delivery,
          links: item.content.links,
          pictures: item.content.pictures,
        })
        if (delivery === Delivery.Delivered) {
          asked = item
          waitedBehind = before > Date.parse(item.createdAt)
          onItsWay = isSending(item.id) || item.input?.state === 'queued'
        }
        continue
      }
      case 'arrival':
        blocks.push({ kind: 'arrival', id: item.id, at: ago(item.createdAt), arrival: item.content })
        continue
      case 'step_result': {
        // The step ended with this: the turn that did the work ran until now.
        const last = blocks.at(-1)
        const span = last?.kind === 'turn' ? spans.get(last.id) : undefined
        if (last?.kind === 'turn' && span !== undefined) spans.set(last.id, { ...span, to: item.createdAt })
        blocks.push({ kind: 'step', id: item.id, at: ago(item.createdAt), result: item.content })
        continue
      }
      case 'task':
        blocks.push({ kind: 'card', id: item.id, card: item.content })
        continue
      case 'question':
        blocks.push({ kind: 'question', id: item.id, at: ago(item.createdAt), question: item.content })
        continue
      case 'run':
        blocks.push({ kind: 'run', id: item.id, run: item.content })
        continue
      case 'issue_draft':
        blocks.push({ kind: 'draft', id: item.id, draft: item.content })
        continue
      case 'setup':
        blocks.push({ kind: 'setup', id: item.id, setup: item.content })
        continue
      case 'push_request':
        blocks.push({ kind: 'push', id: item.id, at: ago(item.content.settledAt ?? item.createdAt), request: item.content })
        continue
      case 'review_draft':
        blocks.push({ kind: 'review', id: item.id, review: item.content })
        continue
      case 'notice':
        // A restart is Althar's business, not the person's; earlier versions said so in the thread.
        if (item.content.source === 'runtime' && item.content.title === RESTARTED) continue
        // What Althar itself says, such as a change of agent, is a line across the thread.
        if (item.content.source === 'runtime') {
          blocks.push({ kind: 'divider', id: item.id, text: noticeText(item.content) })
          if (relayed(item.content)) {
            asked = item
            waitedBehind = before > Date.parse(item.createdAt)
            onItsWay = false
          }
          continue
        }
    }
    add(item.agentId, item.createdAt, partOf(item, streaming, turnRunning, worktree, outputs))
  }
  // A message the store has placed but the window hasn't read yet shows from its first words.
  const read = new Set(source.items.map((item) => item.id))
  for (const [id, streamed] of streaming) {
    if (read.has(id)) continue
    add(
      streamed.agentId,
      streamed.at,
      streamed.kind === 'agent_thought'
        ? { kind: 'thought', id, text: streamed.text }
        : { kind: 'message', id, text: streamed.text, pictures: [], files: [] },
    )
  }
  // The turn running is the last one, unless what the agent was last asked came after it: then the last is over, and the
  // running one hasn't said anything yet; or none runs yet, as the agent starts to read it.
  const lastTurn = blocks.findLastIndex((block) => block.kind === 'turn')
  const askedId = asked?.id
  // Where what it was last asked stands: among the blocks, or before them all, where it opens the thread from outside it.
  const askedAt = askedId !== undefined ? blocks.findLastIndex((block) => block.id === askedId) : source.openedAt == null ? null : -0.5
  const askedWhen = asked?.createdAt ?? source.openedAt
  // Between turns it is waited on only on its way to the agent, or given to it with no turn ended since: a turn that ended on it,
  // interrupted or with nothing said, has answered it as far as it will.
  const over = !onItsWay && source.turnEnded != null && askedWhen != null && Date.parse(source.turnEnded) >= Date.parse(askedWhen)
  const waiting = askedAt !== null && askedAt > lastTurn && (turnRunning || (source.reading === true && !over))
  const runningTurn = turnRunning && !waiting ? lastTurn : -1
  // What an agent says after its step's result, closing its turn, folds with the work that led to it. A run it starts on its own after, with tool calls or a plan, is work of its own: it folds under its own time, and its last message shows.
  const merged: Array<Block> = []
  blocks.forEach((block, index) => {
    const step = merged.at(-1)
    const before = merged.at(-2)
    const closing =
      block.kind === 'turn' &&
      step?.kind === 'step' &&
      before?.kind === 'turn' &&
      before.agentId === block.agentId &&
      !block.parts.some((part) => part.kind === 'tool' || part.kind === 'plan')
    if (!closing || index === runningTurn) return void merged.push(block)
    const span = spans.get(before.id)
    const after = spans.get(block.id)
    if (span !== undefined && after !== undefined) spans.set(before.id, { ...span, to: after.to })
    merged[merged.length - 2] = { ...before, parts: [...before.parts, ...block.parts] }
  })
  // Each turn folds its work; the one still running says what it is doing now.
  const live = runningTurn === -1 ? -1 : merged.findLastIndex((block) => block.kind === 'turn')
  const drawn = merged.map((block, index): Block => {
    if (block.kind !== 'turn') return block
    const span = spans.get(block.id)
    const running = index === live
    const { work, said } = splitOf(block.parts, !running && merged[index + 1]?.kind === 'step')
    return {
      ...block,
      work,
      said,
      live: running,
      took: span === undefined ? '' : took(span.from, running ? now : span.to),
      doing: running ? doingOf(work) : null,
      handed: handedBy(block.parts.map(partHanded), worktree),
    }
  })
  if (!waiting || askedWhen == null) return drawn
  // Counted from when it was asked, through the agent's start where it starts for it. Where it waited behind something first,
  // as what the person sent while the agent was at work, or a task's request behind its setup, from when the turn on it started,
  // or from when it was asked where that is later, as when the turn heard of is the one before; uncounted until then.
  const since =
    asked !== null && !waitedBehind
      ? Date.parse(askedWhen)
      : source.turnStarted == null || !turnRunning
        ? null
        : Math.max(Date.parse(source.turnStarted), Date.parse(askedWhen))
  const waited = since === null ? 0 : (Date.parse(now) - since) / 1000
  return [
    ...drawn,
    {
      kind: 'waiting',
      // One of its own, whatever it waits on, so it never starts again as the store's copy of a message takes the window's place.
      id: 'waiting',
      took: since !== null && waited >= WAIT.counted ? took(new Date(since).toISOString(), now) : null,
      slow: waited >= WAIT.slow,
    },
  ]
}
