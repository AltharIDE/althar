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

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

const text = (value: unknown, key: string): string => {
  const found = field(value, key)
  return typeof found === 'string' ? found : ''
}

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

/** What a tool call did, in a word, before what it did it to. */
export const verbText: Readonly<Record<ToolKind, string>> = {
  [ToolKind.Read]: 'Read',
  [ToolKind.List]: 'Listed',
  [ToolKind.Search]: 'Searched',
  [ToolKind.Edit]: 'Edited',
  [ToolKind.Create]: 'Created',
  [ToolKind.Delete]: 'Deleted',
  [ToolKind.Move]: 'Moved',
  [ToolKind.Run]: 'Ran',
  [ToolKind.Think]: 'Thought',
  [ToolKind.Fetch]: 'Fetched',
  [ToolKind.Mcp]: 'Used',
  [ToolKind.Agent]: 'Did',
  [ToolKind.PullRequest]: 'Opened',
  [ToolKind.Comment]: 'Commented',
  [ToolKind.Push]: 'Pushed',
  [ToolKind.Other]: 'Did',
}

/** A tool call's status, as the kit's. One left running when its turn has ended was stopped with it. */
export const toolStateOf = (status: string, turnRunning: boolean): ToolState => {
  switch (status) {
    case 'completed':
      return ToolState.Done
    case 'failed':
      return ToolState.Failed
    default:
      return turnRunning ? ToolState.Running : ToolState.Cancelled
  }
}

/** A path inside the worktree, from the worktree; any other, whole. */
const within = (path: string, worktree: string | null) =>
  worktree !== null && path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path

/**
 * What a tool call did, and to what: the file it touched or the command it
 * ran when it says, and otherwise its title, whose first word is its verb.
 */
export const describeTool = (
  content: unknown,
  toolKind: ToolKind,
  worktree: string | null,
): { readonly verb: string; readonly target: string } => {
  const locations = field(content, 'locations')
  const path = Array.isArray(locations) ? text(locations[0], 'path') : ''
  if (path !== '') return { verb: verbText[toolKind], target: within(path, worktree) }
  const command = field(field(content, 'rawInput'), 'command')
  if (typeof command === 'string' && command !== '') return { verb: verbText[toolKind], target: command }
  if (Array.isArray(command) && command.length > 0) return { verb: verbText[toolKind], target: command.join(' ') }
  const title = text(content, 'title')
  const space = title.indexOf(' ')
  return space > 0 ? { verb: title.slice(0, space), target: title.slice(space + 1) } : { verb: verbText[toolKind], target: title }
}

/** A plan step's status, as the kit's. A step still in progress when its turn has ended waits for the next. */
export const planStateOf = (status: string, turnRunning: boolean): PlanState =>
  status === 'completed' ? PlanState.Done : status === 'in_progress' && turnRunning ? PlanState.Running : PlanState.Queued

const partOf = (
  item: ThreadItem,
  streaming: ReadonlyMap<string, string>,
  turnRunning: boolean,
  worktree: string | null,
): Part | undefined => {
  const live = streaming.get(item.id)
  const stored = text(item.content, 'text')
  // Streaming text is whole each time; the store catches up behind it.
  const shown = live !== undefined && live.length >= stored.length ? live : stored
  switch (item.kind) {
    case 'agent_message':
      return { kind: 'message', id: item.id, text: shown }
    case 'agent_thought':
      return { kind: 'thought', id: item.id, text: shown }
    case 'tool_call': {
      const toolKind = toolKindOf(text(item.content, 'kind'))
      return {
        kind: 'tool',
        id: item.id,
        toolKind,
        ...describeTool(item.content, toolKind, worktree),
        state: toolStateOf(text(item.content, 'status'), turnRunning),
      }
    }
    case 'plan': {
      const entries = field(item.content, 'entries')
      return {
        kind: 'plan',
        id: item.id,
        steps: (Array.isArray(entries) ? entries : []).map((entry, index) => ({
          id: `${item.id}-${index}`,
          label: text(entry, 'content'),
          state: planStateOf(text(entry, 'status'), turnRunning),
        })),
      }
    }
    case 'notice': {
      const severity = text(item.content, 'severity')
      const description = text(item.content, 'description')
      return {
        kind: 'notice',
        id: item.id,
        text: description === '' ? text(item.content, 'title') : `${text(item.content, 'title')} ${description}`,
        tone: severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info',
      }
    }
    default:
      return undefined
  }
}

/** The blocks of a thread, oldest first. */
export const blocksOf = (
  snapshot: ThreadSnapshot,
  streaming: ReadonlyMap<string, string>,
  ago: (iso: string) => string,
): ReadonlyArray<Block> => {
  const turnRunning = snapshot.session?.turnRunning ?? false
  const blocks: Array<Block> = []
  for (const item of snapshot.items) {
    if (item.kind === 'user_message') {
      const delivery =
        item.input?.state === 'queued' ? (item.input.interrupting ? Delivery.Interrupting : Delivery.Queued) : Delivery.Delivered
      blocks.push({ kind: 'you', id: item.id, text: text(item.content, 'text'), at: ago(item.createdAt), delivery })
      continue
    }
    // What Charrette itself says, such as a change of agent, is a line across the thread.
    if (item.kind === 'notice' && text(item.content, 'source') === 'runtime') {
      blocks.push({ kind: 'divider', id: item.id, text: text(item.content, 'title') })
      continue
    }
    const part = partOf(item, streaming, turnRunning, snapshot.task.worktree)
    if (part === undefined) continue
    const last = blocks.at(-1)
    if (last?.kind === 'turn' && last.agentId === item.agentId) {
      blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] }
    } else {
      blocks.push({ kind: 'turn', id: item.id, agentId: item.agentId, at: ago(item.createdAt), parts: [part] })
    }
  }
  return blocks
}
