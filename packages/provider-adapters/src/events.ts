import type * as acp from '@agentclientprotocol/sdk'
import type { ToolKind } from '@althar/domain'

import type { Classified } from './failures'

/*
 * What an agent's updates become inside Althar. The runtime turns these
 * into thread items. An update this version doesn't know is kept as `Other`
 * with its raw payload, never dropped and never fatal (docs/architecture/03).
 */

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** Why a turn stopped, as ACP reports it. */
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'

/** How far an answer to a permission request reaches: this action, the rest of the turn, or the session. */
export type PermissionScope = 'once' | 'turn' | 'session'

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly thoughtTokens?: number
  readonly cachedReadTokens?: number
  readonly cachedWriteTokens?: number
}

export interface ConfigOption {
  readonly id: string
  readonly name: string
  readonly category?: string
  readonly type: 'select' | 'boolean'
  readonly currentValue: string | boolean
  /** Every value a select option allows, flattened out of any groups. Empty for a boolean. */
  readonly values: ReadonlyArray<string>
  /** The same values, each with the name the agent gives it and what it says of it: Opus 4.1, the most capable. */
  readonly choices: ReadonlyArray<{ readonly value: string; readonly name: string; readonly description?: string }>
}

/** A file a tool call touches, and the line, when it says. */
export interface ToolLocation {
  readonly path: string
  readonly line?: number
}

/**
 * What a message or a tool's result carries beside its words, as the agent
 * sent it: a picture, a file it points at, or a resource's contents. The
 * runtime decides what of it to keep.
 */
export type Handed =
  /** A picture, its bytes in base64 as ACP carries them, and where it came from, when the agent says. */
  | { readonly _tag: 'Image'; readonly data: string; readonly mimeType: string; readonly uri?: string }
  /** A file or a resource it points at, not its contents. */
  | {
      readonly _tag: 'Link'
      readonly uri: string
      readonly name: string
      readonly title?: string
      readonly mimeType?: string
      readonly size?: number
    }
  /** A resource's contents: text, or bytes in base64. */
  | { readonly _tag: 'Embedded'; readonly uri: string; readonly mimeType?: string; readonly text?: string; readonly blob?: string }

/**
 * What a tool call holds, as its content says: words (a result, or a
 * command's output where the agent has no other way to send it), what it
 * hands back, a file it changes, or the terminal its command runs in. A
 * diff keeps its path, and whether the file is new, not its text.
 */
export type ToolContent =
  | { readonly _tag: 'Text'; readonly text: string }
  | Handed
  | { readonly _tag: 'Diff'; readonly path: string; readonly created: boolean }
  | { readonly _tag: 'Terminal'; readonly terminalId: string }

/**
 * A command's output as it comes, and how it ended: what Claude Code's and
 * Codex's adapters send in a tool call's `_meta` (`terminal_output_delta`,
 * `terminal_exit`) to a client that asks for it, as Althar does.
 */
export interface TerminalReport {
  /** More of what it printed, after what came before. */
  readonly output?: string
  /** It ended: its exit code, or the signal that stopped it, where it says. */
  readonly exit?: { readonly code: number | null; readonly signal: string | null }
}

export type SessionEvent =
  | { readonly _tag: 'AgentMessage'; readonly text: string; readonly messageId?: string }
  /** Something in a message that isn't words: a picture, or a file it points at. */
  | { readonly _tag: 'AgentContent'; readonly content: Handed; readonly messageId?: string }
  | { readonly _tag: 'AgentThought'; readonly text: string }
  | {
      readonly _tag: 'ToolCall'
      readonly toolCallId: string
      readonly title: string
      readonly kind: ToolKind
      readonly status: ToolCallStatus
      readonly rawInput?: unknown
      /** The files it touches, when it says. */
      readonly locations?: ReadonlyArray<ToolLocation>
      readonly content?: ReadonlyArray<ToolContent>
      readonly terminal?: TerminalReport
    }
  | {
      readonly _tag: 'ToolCallUpdate'
      readonly toolCallId: string
      readonly status?: ToolCallStatus
      readonly title?: string
      /** Some agents, Claude Code's among them, send a call's input only once they have all of it, in an update. */
      readonly rawInput?: unknown
      readonly rawOutput?: unknown
      readonly locations?: ReadonlyArray<ToolLocation>
      /** What it holds now, whole: each update that has content says all of it again. */
      readonly content?: ReadonlyArray<ToolContent>
      readonly terminal?: TerminalReport
    }
  | { readonly _tag: 'Plan'; readonly entries: ReadonlyArray<{ readonly content: string; readonly status: string }> }
  | {
      readonly _tag: 'ContextUsage'
      readonly used: number
      readonly size: number
      readonly cost?: { readonly amount: number; readonly currency: string }
    }
  | { readonly _tag: 'OptionsChanged'; readonly options: ReadonlyArray<ConfigOption> }
  /** The mode changed. `byAgent` when Althar didn't ask for it, such as a plan session leaving plan mode. */
  | { readonly _tag: 'ModeChanged'; readonly modeId: string; readonly byAgent: boolean }
  | { readonly _tag: 'Notice'; readonly severity: string; readonly title: string; readonly description?: string }
  /**
   * Althar answered a permission request. `optionId` is what was sent to
   * the agent (null when the request was cancelled), and `stopsTurn` says the
   * agent stops the turn on it; the adapter then resumes the turn itself.
   */
  | {
      readonly _tag: 'PermissionAnswered'
      readonly toolCallId: string
      readonly decision: 'allow' | 'reject'
      readonly optionId: string | null
      readonly scope: PermissionScope | null
      readonly stopsTurn: boolean
    }
  /** A permission request was dropped before Althar decided it: the turn was cancelled, by Althar or the agent. */
  | { readonly _tag: 'PermissionWithdrawn'; readonly toolCallId: string }
  /** The adapter resumed a turn the agent stopped on a rejection, telling it why. */
  | { readonly _tag: 'Resumed'; readonly reason: string }
  /** The agent reported a failure in structured form, during a turn or between turns. */
  | { readonly _tag: 'AgentFailure'; readonly severity: 'warning' | 'error'; readonly classified: Classified }
  | { readonly _tag: 'Other'; readonly update: string; readonly raw: unknown }
  /**
   * The turn is over. `failure` is set when the agent reported one in
   * structured form, even if the turn itself ended normally, as Claude does
   * when its account runs out.
   */
  | { readonly _tag: 'TurnEnded'; readonly stopReason: StopReason; readonly usage?: TokenUsage; readonly failure?: Classified }

const toolKinds: ReadonlyArray<string> = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']
const asToolKind = (kind: string | null | undefined): ToolKind =>
  kind !== null && kind !== undefined && toolKinds.includes(kind) ? (kind as ToolKind) : 'other'

const defined = <K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } =>
  value === null || value === undefined ? {} : ({ [key]: value } as { [P in K]: V })

const locationsOf = (locations: ReadonlyArray<acp.ToolCallLocation> | null | undefined): ReadonlyArray<ToolLocation> | undefined =>
  locations === null || locations === undefined
    ? undefined
    : locations.map((location) => ({ path: location.path, ...defined('line', location.line ?? undefined) }))

const textOf = (content: acp.ContentBlock): string | undefined => (content.type === 'text' ? content.text : undefined)

/** A resource's name, from the end of where it is. */
const nameOf = (uri: string) =>
  uri
    .replace(/[?#].*$/, '')
    .split('/')
    .findLast((part) => part !== '') ?? uri

/** What a content block carries beside words, or nothing for words and sound. */
export const handedOf = (content: acp.ContentBlock): Handed | undefined => {
  switch (content.type) {
    case 'image':
      // Claude Code sends a picture it only has the address of with no bytes: it is a link to it.
      if (content.data === '')
        return content.uri === null || content.uri === undefined || content.uri === ''
          ? undefined
          : { _tag: 'Link', uri: content.uri, name: nameOf(content.uri), ...defined('mimeType', content.mimeType || undefined) }
      return { _tag: 'Image', data: content.data, mimeType: content.mimeType, ...defined('uri', content.uri) }
    case 'resource_link':
      return {
        _tag: 'Link',
        uri: content.uri,
        name: content.name,
        ...defined('title', content.title),
        ...defined('mimeType', content.mimeType),
        ...defined('size', content.size),
      }
    case 'resource': {
      const resource = content.resource
      return {
        _tag: 'Embedded',
        uri: resource.uri,
        ...defined('mimeType', resource.mimeType),
        ...('text' in resource ? { text: resource.text } : { blob: resource.blob }),
      }
    }
    case 'text':
    case 'audio':
      return undefined
  }
}

const toolContentOf = (content: ReadonlyArray<acp.ToolCallContent> | null | undefined): ReadonlyArray<ToolContent> | undefined =>
  content === null || content === undefined
    ? undefined
    : content.flatMap((entry): ReadonlyArray<ToolContent> => {
        switch (entry.type) {
          case 'content': {
            const text = textOf(entry.content)
            if (text !== undefined) return [{ _tag: 'Text', text }]
            const handed = handedOf(entry.content)
            return handed === undefined ? [] : [handed]
          }
          case 'diff':
            return [{ _tag: 'Diff', path: entry.path, created: entry.oldText === null || entry.oldText === undefined }]
          case 'terminal':
            return [{ _tag: 'Terminal', terminalId: entry.terminalId }]
        }
      })

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined

/**
 * What a client puts in `clientCapabilities._meta` to hear a command's
 * output: as chunks while it runs where the agent streams it (Codex), or
 * whole when it ends (Claude Code), each with its exit code. Both adapters
 * read Althar as a JetBrains AIR client (for structured failures), and send
 * an AIR client no command output unless it asks for it this way.
 */
export const terminalOutputCapability = { terminal_output_delta: true }

/** What a tool call's `_meta` says of its command's terminal, where it says anything. */
export const terminalOf = (meta: unknown): TerminalReport | undefined => {
  const fields = recordOf(meta)
  const chunk = recordOf(fields?.terminal_output_delta) ?? recordOf(fields?.terminal_output)
  const output = typeof chunk?.data === 'string' && chunk.data !== '' ? chunk.data : undefined
  const ended = recordOf(fields?.terminal_exit)
  const exit =
    ended === undefined
      ? undefined
      : {
          code: typeof ended.exit_code === 'number' ? ended.exit_code : null,
          signal: typeof ended.signal === 'string' ? ended.signal : null,
        }
  return output === undefined && exit === undefined ? undefined : { ...defined('output', output), ...defined('exit', exit) }
}

export const normalizeOptions = (options: ReadonlyArray<acp.SessionConfigOption> | null | undefined): ReadonlyArray<ConfigOption> =>
  (options ?? []).map((option) => {
    const choices: Array<{ readonly value: string; readonly name: string; readonly description?: string }> = []
    const choice = (entry: acp.SessionConfigSelectOption) =>
      choices.push({ value: entry.value, name: entry.name, ...defined('description', entry.description ?? undefined) })
    if (option.type === 'select') {
      for (const entry of option.options) {
        if ('value' in entry) choice(entry)
        else if ('options' in entry) for (const inner of entry.options) choice(inner)
      }
    }
    return {
      id: option.id,
      name: option.name,
      ...defined('category', option.category),
      type: option.type,
      currentValue: option.currentValue,
      values: choices.map((entry) => entry.value),
      choices,
    }
  })

export const normalizeUsage = (usage: acp.Usage | null | undefined): TokenUsage | undefined =>
  usage === null || usage === undefined
    ? undefined
    : {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        ...defined('thoughtTokens', usage.thoughtTokens),
        ...defined('cachedReadTokens', usage.cachedReadTokens),
        ...defined('cachedWriteTokens', usage.cachedWriteTokens),
      }

export const normalize = (update: acp.SessionUpdate): SessionEvent => {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(update.content)
      if (text !== undefined) return { _tag: 'AgentMessage', text, ...defined('messageId', update.messageId) }
      const handed = handedOf(update.content)
      return handed === undefined
        ? { _tag: 'Other', update: update.sessionUpdate, raw: update }
        : { _tag: 'AgentContent', content: handed, ...defined('messageId', update.messageId) }
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      return text === undefined ? { _tag: 'Other', update: update.sessionUpdate, raw: update } : { _tag: 'AgentThought', text }
    }
    case 'tool_call':
      return {
        _tag: 'ToolCall',
        toolCallId: update.toolCallId,
        title: update.title,
        kind: asToolKind(update.kind),
        status: update.status ?? 'pending',
        ...defined('rawInput', update.rawInput),
        ...defined('locations', locationsOf(update.locations)),
        ...defined('content', toolContentOf(update.content)),
        ...defined('terminal', terminalOf(update._meta)),
      }
    case 'tool_call_update':
      return {
        _tag: 'ToolCallUpdate',
        toolCallId: update.toolCallId,
        ...defined('status', update.status),
        ...defined('title', update.title),
        ...defined('rawInput', update.rawInput),
        ...defined('rawOutput', update.rawOutput),
        ...defined('locations', locationsOf(update.locations)),
        ...defined('content', toolContentOf(update.content)),
        ...defined('terminal', terminalOf(update._meta)),
      }
    case 'plan':
      return { _tag: 'Plan', entries: update.entries.map((entry) => ({ content: entry.content, status: entry.status })) }
    case 'usage_update':
      return {
        _tag: 'ContextUsage',
        used: update.used,
        size: update.size,
        ...defined(
          'cost',
          update.cost === null || update.cost === undefined ? undefined : { amount: update.cost.amount, currency: update.cost.currency },
        ),
      }
    case 'config_option_update':
      return { _tag: 'OptionsChanged', options: normalizeOptions(update.configOptions) }
    case 'current_mode_update':
      return { _tag: 'ModeChanged', modeId: update.currentModeId, byAgent: true }
    case 'notice':
      return { _tag: 'Notice', severity: update.severity, title: update.title, ...defined('description', update.description) }
    case 'user_message_chunk':
    case 'plan_update':
    case 'plan_removed':
    case 'available_commands_update':
    case 'session_info_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
      return { _tag: 'Other', update: update.sessionUpdate, raw: update }
    default:
      return { _tag: 'Other', update: String((update as { readonly sessionUpdate?: unknown }).sessionUpdate), raw: update }
  }
}
