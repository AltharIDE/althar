import type { AllowedBy, ThreadItem, Unfurl } from '@althar/contracts'
import { Delivery, PlanState, ToolKind, ToolState } from '@althar/ui'

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
 */

export type Part =
  | { readonly kind: 'message'; readonly id: string; readonly text: string }
  | { readonly kind: 'thought'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly toolKind: ToolKind
      readonly verb: string
      readonly target: string
      readonly state: ToolState
      /** The whole command, when it runs one: what the row opens to, and what Copy takes. */
      readonly command: string | null
      /** The project's rule that let it through without asking (ADR-018), where one did. */
      readonly allowedBy?: AllowedBy
    }
  | {
      readonly kind: 'plan'
      readonly id: string
      readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string; readonly state: PlanState }>
    }
  | { readonly kind: 'notice'; readonly id: string; readonly text: string; readonly tone: 'info' | 'warning' | 'error' }

export type StepResult = Extract<ThreadItem, { kind: 'step_result' }>['content']
export type TaskCardContent = Extract<ThreadItem, { kind: 'task' }>['content']
export type ArrivalContent = Extract<ThreadItem, { kind: 'arrival' }>['content']

export type Block =
  | {
      readonly kind: 'you'
      readonly id: string
      readonly text: string
      readonly at: string
      readonly delivery: Delivery
      /** The links in it Althar could unfurl: issues and pull requests. */
      readonly links: ReadonlyArray<Unfurl>
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
    }
  | { readonly kind: 'divider'; readonly id: string; readonly text: string }
  | { readonly kind: 'step'; readonly id: string; readonly at: string; readonly result: StepResult }
  | { readonly kind: 'card'; readonly id: string; readonly card: TaskCardContent }
  /** Something heard from outside: a comment on the task's pull request, its checks, its merge. */
  | { readonly kind: 'arrival'; readonly id: string; readonly at: string; readonly arrival: ArrivalContent }

/** ACP's tool kinds, as the kit's. */
/** The notice earlier versions left in a thread when Althar restarted under its lead. */
const RESTARTED = 'Althar restarted.'

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
  if (content.command !== null) return content.command
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
): Part => {
  switch (item.kind) {
    case 'agent_message':
    case 'agent_thought': {
      const live = streaming.get(item.id)?.text
      // Streaming text is whole each time; the store catches up behind it.
      const text = live !== undefined && live.length >= item.content.text.length ? live : item.content.text
      return { kind: item.kind === 'agent_thought' ? 'thought' : 'message', id: item.id, text }
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
        ...(item.content.allowedBy === undefined ? {} : { allowedBy: item.content.allowedBy }),
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
  const blocks: Array<Block> = []
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
    blocks.push({ kind: 'turn', id: part.id, agentId, at: ago(at), parts: [part], work: [], said: [], live: false, took: '', doing: null })
    spans.set(part.id, { from: at, to: at })
  }
  for (const item of source.items) {
    switch (item.kind) {
      case 'user_message': {
        // What waits its turn shows in the composer's queue, where it can be edited or taken back; what was taken back is gone.
        if (item.input?.state === 'withdrawn' || (queue && item.input?.state === 'queued' && !item.input.interrupting)) continue
        const delivery =
          item.input?.state === 'queued' ? (item.input.interrupting ? Delivery.Interrupting : Delivery.Queued) : Delivery.Delivered
        blocks.push({ kind: 'you', id: item.id, text: item.content.text, at: ago(item.createdAt), delivery, links: item.content.links })
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
      case 'notice':
        // A restart is Althar's business, not the person's; earlier versions said so in the thread.
        if (item.content.source === 'runtime' && item.content.title === RESTARTED) continue
        // What Althar itself says, such as a change of agent, is a line across the thread.
        if (item.content.source === 'runtime') {
          blocks.push({ kind: 'divider', id: item.id, text: noticeText(item.content) })
          continue
        }
    }
    add(item.agentId, item.createdAt, partOf(item, streaming, turnRunning, worktree))
  }
  // A message the store has placed but the window hasn't read yet shows from its first words.
  const read = new Set(source.items.map((item) => item.id))
  for (const [id, streamed] of streaming) {
    if (read.has(id)) continue
    add(streamed.agentId, streamed.at, { kind: streamed.kind === 'agent_thought' ? 'thought' : 'message', id, text: streamed.text })
  }
  // What an agent says after its step's result, closing its turn, folds with the work that led to it.
  const lastTurn = blocks.findLastIndex((block) => block.kind === 'turn')
  const merged: Array<Block> = []
  blocks.forEach((block, index) => {
    const step = merged.at(-1)
    const before = merged.at(-2)
    const closing = block.kind === 'turn' && step?.kind === 'step' && before?.kind === 'turn' && before.agentId === block.agentId
    if (!closing || (turnRunning && index === lastTurn)) return void merged.push(block)
    const span = spans.get(before.id)
    const after = spans.get(block.id)
    if (span !== undefined && after !== undefined) spans.set(before.id, { ...span, to: after.to })
    merged[merged.length - 2] = { ...before, parts: [...before.parts, ...block.parts] }
  })
  // Each turn folds its work; the one still running says what it is doing now.
  const live = turnRunning ? merged.findLastIndex((block) => block.kind === 'turn') : -1
  return merged.map((block, index) => {
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
    }
  })
}
