import { Ids, newId, type ProjectId } from '@charrette/domain'
import { Ledger } from '@charrette/persistence-sqlite'
import type { SessionEvent } from '@charrette/provider-adapters'
import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { change, timestamp } from './records'

/*
 * The thread's items: what the person reads (docs/architecture/01). An
 * agent's message arrives in chunks and becomes one item, written when
 * something else happens or the turn ends, so the store isn't written for
 * every few words. A tool call is one item, updated as it runs.
 */

export type ItemKind = 'user_message' | 'agent_message' | 'agent_thought' | 'tool_call' | 'plan' | 'step_result' | 'notice'

export interface ItemPlace {
  readonly projectId: ProjectId
  readonly threadId: string
  readonly sessionId?: string
  readonly deliveryId?: string
}

/** Adds an item at the end of the thread. */
export const addItem = (
  place: ItemPlace,
  kind: ItemKind,
  content: unknown,
  links: { readonly toolCallId?: string; readonly userInputId?: string } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const id = yield* newId(Ids.threadItem)
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, delivery_id, provider_session_id, tool_call_id, content, created_at)
          VALUES (${id}, ${place.projectId}, ${place.threadId},
            (SELECT coalesce(max(sequence), 0) + 1 FROM thread_items WHERE thread_id = ${place.threadId}),
            ${kind}, ${links.userInputId ?? null}, ${place.deliveryId ?? null}, ${place.sessionId ?? null}, ${links.toolCallId ?? null},
            ${JSON.stringify(content)}, ${yield* timestamp})`
        yield* ledger.notify({ projectId: place.projectId, aggregateType: 'thread_item', aggregateId: id, aggregateRevision: 1 })
      }),
    )
    return id
  })

/** Replaces an item's content. */
export const updateItem = (projectId: ProjectId, id: string, content: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const revision = yield* change('thread_items', id, { content: JSON.stringify(content) })
        yield* ledger.notify({ projectId, aggregateType: 'thread_item', aggregateId: id, aggregateRevision: revision })
      }),
    )
  })

const toolItem = (sessionId: string, toolCallId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      id: string
      content: string
    }>`SELECT id, content FROM thread_items WHERE provider_session_id = ${sessionId} AND tool_call_id = ${toolCallId}`
    return row === undefined ? undefined : { id: row.id, content: JSON.parse(row.content) as Record<string, unknown> }
  })

/** How often a message being streamed is written: every so many characters, or so many milliseconds. */
const WRITE_EVERY_CHARACTERS = 2_000
const WRITE_EVERY_MILLIS = 2_000

const defined = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))

/**
 * Turns one session's events into items. `record` takes each event as it
 * streams; `flush` writes the message being gathered, and is called when the
 * turn ends.
 */
export const recorder = (place: ItemPlace & { readonly sessionId: string }) => {
  let gathering:
    | { readonly kind: 'agent_message' | 'agent_thought'; readonly id: string; text: string; written: number; writtenAt: number }
    | undefined
  let plan: string | undefined

  /** Writes the message being gathered; its item was placed when its first chunk arrived. */
  const flush = Effect.gen(function* () {
    const open = gathering
    gathering = undefined
    if (open !== undefined) yield* updateItem(place.projectId, open.id, { text: open.text })
  })

  const gather = (kind: 'agent_message' | 'agent_thought', text: string) =>
    Effect.gen(function* () {
      if (gathering !== undefined && gathering.kind !== kind) yield* flush
      const now = yield* Clock.currentTimeMillis
      if (gathering === undefined) {
        // The item is placed when its first chunk arrives, so the thread keeps the order things happened in.
        gathering = { kind, id: yield* addItem(place, kind, { text }), text, written: text.length, writtenAt: now }
        return
      }
      gathering.text += text
      // A long message is written as it grows, so a crash loses only its last few seconds.
      if (gathering.text.length - gathering.written >= WRITE_EVERY_CHARACTERS || now - gathering.writtenAt >= WRITE_EVERY_MILLIS) {
        yield* updateItem(place.projectId, gathering.id, { text: gathering.text })
        gathering.written = gathering.text.length
        gathering.writtenAt = now
      }
    })

  const notice = (content: Record<string, unknown>) => Effect.andThen(flush, addItem(place, 'notice', defined(content)))

  const record = (event: SessionEvent) => {
    switch (event._tag) {
      case 'AgentMessage':
        return gather('agent_message', event.text)
      case 'AgentThought':
        return gather('agent_thought', event.text)
      case 'ToolCall':
        return Effect.gen(function* () {
          yield* flush
          const content = defined({
            title: event.title,
            kind: event.kind,
            status: event.status,
            rawInput: event.rawInput,
            locations: event.locations,
          })
          const existing = yield* toolItem(place.sessionId, event.toolCallId)
          if (existing === undefined) yield* addItem(place, 'tool_call', content, { toolCallId: event.toolCallId })
          else yield* updateItem(place.projectId, existing.id, { ...existing.content, ...content })
        })
      case 'ToolCallUpdate':
        return Effect.gen(function* () {
          yield* flush
          const content = defined({ title: event.title, status: event.status, rawOutput: event.rawOutput, locations: event.locations })
          const existing = yield* toolItem(place.sessionId, event.toolCallId)
          if (existing === undefined)
            yield* addItem(
              place,
              'tool_call',
              { title: '', kind: 'other', status: 'pending', ...content },
              { toolCallId: event.toolCallId },
            )
          else yield* updateItem(place.projectId, existing.id, { ...existing.content, ...content })
        })
      case 'Plan':
        return Effect.gen(function* () {
          yield* flush
          if (plan === undefined) plan = yield* addItem(place, 'plan', { entries: event.entries })
          else yield* updateItem(place.projectId, plan, { entries: event.entries })
        })
      case 'Notice':
        return notice({ source: 'agent', severity: event.severity, title: event.title, description: event.description })
      case 'AgentFailure':
        return notice({ source: 'agent', severity: event.severity, title: event.classified.message, failure: event.classified.failure })
      case 'ModeChanged':
        return event.byAgent
          ? notice({ source: 'runtime', severity: 'info', title: `The agent moved to its ${event.modeId} mode.` })
          : Effect.void
      case 'Resumed':
        return notice({ source: 'runtime', severity: 'info', title: 'Resumed after a rejection.', description: event.reason })
      default:
        return Effect.void
    }
  }

  /** The message being gathered, as far as it has come: what a watching client shows while it streams. */
  const current = () => (gathering === undefined ? undefined : { id: gathering.id, kind: gathering.kind, text: gathering.text })

  return { record, flush, current }
}

/** The thread as text, oldest first: what a new agent reads when it takes over (ADR-005). */
export const transcript = (threadId: string, budget: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const items = yield* sql<{ kind: ItemKind; content: string; agentId: string | null }>`
      SELECT i.kind, i.content, s.agent_id FROM thread_items i
      LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
      WHERE i.thread_id = ${threadId} ORDER BY i.sequence`
    const lines = items.flatMap((item) => {
      const content = JSON.parse(item.content) as Record<string, unknown>
      const text = (key: string) => (typeof content[key] === 'string' ? (content[key] as string) : '')
      switch (item.kind) {
        case 'user_message':
          return [`[person] ${text('text')}`]
        case 'agent_message':
          return [`[${item.agentId ?? 'agent'}] ${text('text')}`]
        case 'tool_call':
          return [`[tool] ${text('title')} (${text('status')})`]
        case 'notice':
          return [`[note] ${text('title')}${text('description') === '' ? '' : `: ${text('description')}`}`]
        default:
          return []
      }
    })
    // The most recent part is kept; what doesn't fit is left out from the start.
    const kept: Array<string> = []
    let used = 0
    for (const line of lines.toReversed()) {
      if (used + line.length > budget) break
      kept.unshift(line)
      used += line.length + 1
    }
    return { text: kept.join('\n'), omitted: lines.length - kept.length }
  })
