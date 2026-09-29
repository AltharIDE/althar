import type * as acp from '@agentclientprotocol/sdk'
import type { ToolKind } from '@charrette/domain'

import type { Classified } from './failures'

/*
 * What an agent's updates become inside Charrette. The runtime turns these
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
}

export type SessionEvent =
  | { readonly _tag: 'AgentMessage'; readonly text: string; readonly messageId?: string }
  | { readonly _tag: 'AgentThought'; readonly text: string }
  | {
      readonly _tag: 'ToolCall'
      readonly toolCallId: string
      readonly title: string
      readonly kind: ToolKind
      readonly status: ToolCallStatus
      readonly rawInput?: unknown
    }
  | {
      readonly _tag: 'ToolCallUpdate'
      readonly toolCallId: string
      readonly status?: ToolCallStatus
      readonly title?: string
      readonly rawOutput?: unknown
    }
  | { readonly _tag: 'Plan'; readonly entries: ReadonlyArray<{ readonly content: string; readonly status: string }> }
  | {
      readonly _tag: 'ContextUsage'
      readonly used: number
      readonly size: number
      readonly cost?: { readonly amount: number; readonly currency: string }
    }
  | { readonly _tag: 'OptionsChanged'; readonly options: ReadonlyArray<ConfigOption> }
  /** The mode changed. `byAgent` when Charrette didn't ask for it, such as a plan session leaving plan mode. */
  | { readonly _tag: 'ModeChanged'; readonly modeId: string; readonly byAgent: boolean }
  | { readonly _tag: 'Notice'; readonly severity: string; readonly title: string; readonly description?: string }
  /**
   * Charrette answered a permission request. `optionId` is what was sent to
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
  /** A permission request was dropped before Charrette decided it: the turn was cancelled, by Charrette or the agent. */
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

const textOf = (content: acp.ContentBlock): string | undefined => (content.type === 'text' ? content.text : undefined)

export const normalizeOptions = (options: ReadonlyArray<acp.SessionConfigOption> | null | undefined): ReadonlyArray<ConfigOption> =>
  (options ?? []).map((option) => {
    const values: Array<string> = []
    if (option.type === 'select') {
      for (const entry of option.options) {
        if ('value' in entry) values.push(entry.value)
        else if ('options' in entry) for (const inner of entry.options) values.push(inner.value)
      }
    }
    return {
      id: option.id,
      name: option.name,
      ...defined('category', option.category),
      type: option.type,
      currentValue: option.currentValue,
      values,
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
      return text === undefined
        ? { _tag: 'Other', update: update.sessionUpdate, raw: update }
        : { _tag: 'AgentMessage', text, ...defined('messageId', update.messageId) }
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
      }
    case 'tool_call_update':
      return {
        _tag: 'ToolCallUpdate',
        toolCallId: update.toolCallId,
        ...defined('status', update.status),
        ...defined('title', update.title),
        ...defined('rawOutput', update.rawOutput),
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
