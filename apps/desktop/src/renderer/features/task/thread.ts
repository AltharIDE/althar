import type { ThreadItem, ThreadSnapshot } from '@charrette/contracts'
import { Delivery, PlanState, ToolKind, ToolState } from '@charrette/ui'

/*
 * A thread's items as the blocks the kit draws, in order: what the person
 * said, each turn of the agent (its messages, thoughts, tool calls and plan,
 * grouped under one name), and the lines that mark a change of scene. Text
 * still streaming replaces the stored text of its item.
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
    }
  | {
      readonly kind: 'plan'
      readonly id: string
      readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string; readonly state: PlanState }>
    }
  | { readonly kind: 'notice'; readonly id: string; readonly text: string; readonly tone: 'info' | 'warning' | 'error' }

export type Block =
  | { readonly kind: 'you'; readonly id: string; readonly text: string; readonly at: string; readonly delivery: Delivery }
  | {
      readonly kind: 'turn'
      readonly id: string
      readonly agentId: string | null
      readonly at: string
      readonly parts: ReadonlyArray<Part>
    }
  | { readonly kind: 'divider'; readonly id: string; readonly text: string }

/** ACP's tool kinds, as the kit's. */
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

/**
 * What a tool call acts on: the file it touches or the command it runs when
 * it says, and otherwise its title. A command's title is the command itself;
 * any other title that starts with a verb of its own ("Write hello.txt")
 * gives the rest, since the verb comes from the call's kind.
 */
export const targetOf = (content: ToolContent, worktree: string | null): string => {
  const path = content.locations[0]?.path
  if (path !== undefined) return within(path, worktree)
  if (content.command !== null) return content.command
  const space = content.title.indexOf(' ')
  return space > 0 && content.toolKind !== 'other' && content.toolKind !== 'execute' ? content.title.slice(space + 1) : content.title
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
  item: Exclude<ThreadItem, { kind: 'user_message' }>,
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

/** The blocks of a thread, oldest first, with what is still being written but not yet read at the end. */
export const blocksOf = (
  snapshot: ThreadSnapshot,
  streaming: ReadonlyMap<string, Streamed>,
  ago: (iso: string) => string,
): ReadonlyArray<Block> => {
  const turnRunning = snapshot.session?.turnRunning ?? false
  const blocks: Array<Block> = []
  const add = (agentId: string | null, at: string, part: Part) => {
    const last = blocks.at(-1)
    if (last?.kind === 'turn' && last.agentId === agentId) blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] }
    else blocks.push({ kind: 'turn', id: part.id, agentId, at: ago(at), parts: [part] })
  }
  for (const item of snapshot.items) {
    if (item.kind === 'user_message') {
      const delivery =
        item.input?.state === 'queued' ? (item.input.interrupting ? Delivery.Interrupting : Delivery.Queued) : Delivery.Delivered
      blocks.push({ kind: 'you', id: item.id, text: item.content.text, at: ago(item.createdAt), delivery })
      continue
    }
    // What Charrette itself says, such as a change of agent or a restart, is a line across the thread.
    if (item.kind === 'notice' && item.content.source === 'runtime') {
      blocks.push({ kind: 'divider', id: item.id, text: noticeText(item.content) })
      continue
    }
    add(item.agentId, item.createdAt, partOf(item, streaming, turnRunning, snapshot.task.worktree))
  }
  // A message the store has placed but the window hasn't read yet shows from its first words.
  const read = new Set(snapshot.items.map((item) => item.id))
  for (const [id, streamed] of streaming) {
    if (read.has(id)) continue
    add(streamed.agentId, streamed.at, { kind: streamed.kind === 'agent_thought' ? 'thought' : 'message', id, text: streamed.text })
  }
  return blocks
}
