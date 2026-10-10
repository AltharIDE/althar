import { Ids, newId, type ProjectId, type ThreadItemKind } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import type { Handed, SessionEvent } from '@althar/provider-adapters'
import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { exitIn, type FileMention, handedByTool, handedNow, type HandedNow, type KeptPicture, keepOutput, Output, together } from './handed'
import { change, timestamp } from './records'
import { essentials } from './rules'

/*
 * The thread's items: what the person reads (docs/architecture/01). An
 * agent's message arrives in chunks and becomes one item, written when
 * something else happens or the turn ends, so the store isn't written for
 * every few words. A tool call is one item, updated as it runs.
 */

export type ItemKind = ThreadItemKind

export interface ItemPlace {
  readonly projectId: ProjectId
  readonly threadId: string
  readonly sessionId?: string
  readonly deliveryId?: string
  /** The folders the agent works in: a picture a link points at is read only from inside them. */
  readonly folders?: ReadonlyArray<string>
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

/** What was left out of a stored tool call, as it says. */
const cutOf = (content: Record<string, unknown> | undefined): ReadonlyArray<string> =>
  Array.isArray(content?.cut) ? content.cut.filter((entry): entry is string => typeof entry === 'string') : []

const defined = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))

const NOTHING: HandedNow = { pictures: [], files: [] }

/** What an item already holds of what was handed back, as it was stored. */
const handedIn = (content: Record<string, unknown> | undefined): HandedNow => ({
  pictures: Array.isArray(content?.pictures) ? (content.pictures as ReadonlyArray<KeptPicture>) : [],
  files: Array.isArray(content?.files) ? (content.files as ReadonlyArray<FileMention>) : [],
})

/** An item's content with what was handed back, where there is any. */
const withHanded = (content: Record<string, unknown>, handed: HandedNow) => ({
  ...content,
  ...(handed.pictures.length === 0 ? {} : { pictures: handed.pictures }),
  ...(handed.files.length === 0 ? {} : { files: handed.files }),
})

/** A command's output as far as it has come, for a client watching it: by the item it is, its last lines, and how many came before. */
export interface OutputSoFar {
  readonly itemId: string
  readonly text: string
  readonly dropped: number
}

/**
 * Turns one session's events into items. `record` takes each event as it
 * streams; `flush` writes the message being gathered, and is called when the
 * turn ends.
 */
export const recorder = (place: ItemPlace & { readonly sessionId: string }) => {
  let gathering:
    | {
        readonly kind: 'agent_message' | 'agent_thought'
        readonly id: string
        text: string
        written: number
        writtenAt: number
        /** Pictures and files it handed back between its words. */
        handed: HandedNow
      }
    | undefined
  let plan: string | undefined
  /** Commands' output as it comes, by tool call, until each ends. */
  const outputs = new Map<string, Output>()
  /** Commands that ended, whose output is kept. */
  const finished = new Set<string>()
  const folders = place.folders ?? []
  const where = (itemId: string) => ({ projectId: place.projectId, itemId, folders })

  /** Writes the message being gathered; its item was placed when its first chunk arrived. */
  const flush = Effect.gen(function* () {
    const open = gathering
    gathering = undefined
    if (open !== undefined) yield* updateItem(place.projectId, open.id, withHanded({ text: open.text }, open.handed))
  })

  /** The message being gathered, or a new one: what it hands back goes with its words. */
  const gathered = (kind: 'agent_message' | 'agent_thought', text: string) =>
    Effect.gen(function* () {
      if (gathering !== undefined && gathering.kind !== kind) yield* flush
      if (gathering !== undefined) return { open: gathering, fresh: false }
      // The item is placed when its first chunk arrives, so the thread keeps the order things happened in.
      const open = {
        kind,
        id: yield* addItem(place, kind, { text }),
        text,
        written: text.length,
        writtenAt: yield* Clock.currentTimeMillis,
        handed: NOTHING,
      }
      gathering = open
      return { open, fresh: true }
    })

  const gather = (kind: 'agent_message' | 'agent_thought', text: string) =>
    Effect.gen(function* () {
      const { open, fresh } = yield* gathered(kind, text)
      if (fresh) return
      const now = yield* Clock.currentTimeMillis
      open.text += text
      // A long message is written as it grows, so a crash loses only its last few seconds.
      if (open.text.length - open.written >= WRITE_EVERY_CHARACTERS || now - open.writtenAt >= WRITE_EVERY_MILLIS) {
        yield* updateItem(place.projectId, open.id, withHanded({ text: open.text }, open.handed))
        open.written = open.text.length
        open.writtenAt = now
      }
    })

  /** A picture or a file in what the agent says: kept with the message it is in, and written at once. */
  const handedInMessage = (content: Handed) =>
    Effect.gen(function* () {
      const { open } = yield* gathered('agent_message', '')
      const now = yield* handedNow(where(open.id), content)
      if (now.pictures.length === 0 && now.files.length === 0) return
      open.handed = together(open.handed, now)
      yield* updateItem(place.projectId, open.id, withHanded({ text: open.text }, open.handed))
      open.written = open.text.length
      open.writtenAt = yield* Clock.currentTimeMillis
    })

  /** Keeps a command's output once it ends, and its exit, on its item. */
  const ended = (toolCallId: string, output: Output) =>
    Effect.gen(function* () {
      outputs.delete(toolCallId)
      finished.add(toolCallId)
      return { output: yield* keepOutput(where(output.itemId), output), exit: output.exit }
    })

  /**
   * What a tool call's event adds to its item beyond what it is: pictures and
   * files it hands back, and, for a command, its output once it ends. Its
   * output so far is held here, for watching clients, until then.
   */
  const extrasOf = (
    toolCallId: string,
    itemId: string,
    stored: Record<string, unknown>,
    event: Extract<SessionEvent, { _tag: 'ToolCall' | 'ToolCallUpdate' }>,
  ) =>
    Effect.gen(function* () {
      const kind = typeof stored.kind === 'string' ? stored.kind : 'other'
      const content = event.content ?? []
      let extras: Record<string, unknown> | undefined
      if (content.length > 0 || kind === 'edit') {
        const had = handedIn(stored)
        const now = together(had, yield* handedByTool(where(itemId), content, event.rawInput, kind))
        if (now.pictures.length > had.pictures.length || now.files.length > had.files.length) extras = withHanded({}, now)
      }
      const command = kind === 'execute' || event.terminal !== undefined || content.some((entry) => entry._tag === 'Terminal')
      // A command that ended keeps what it printed: what comes after, in this turn or a later one, changes none of it.
      if (!command || finished.has(toolCallId) || stored.output !== undefined) return extras
      const output = outputs.get(toolCallId) ?? new Output(itemId)
      outputs.set(toolCallId, output)
      if (event.terminal?.output !== undefined) output.add(event.terminal.output)
      else if (!output.terminal && kind === 'execute') {
        // OpenCode says a command's output as the tool's own words, whole each time.
        const words = content.flatMap((entry) => (entry._tag === 'Text' ? [entry.text] : []))
        if (words.length > 0) output.replace(words.join('\n'))
      }
      const exit = event.terminal?.exit?.code ?? (event._tag === 'ToolCallUpdate' ? exitIn(event.rawOutput) : null)
      if (exit !== null) output.exit = exit
      if (event.status !== 'completed' && event.status !== 'failed') return extras
      return { ...extras, ...(yield* ended(toolCallId, output)) }
    })

  /** Ends what the turn left open: a command's output, kept as far as it came, as when the turn was stopped. */
  const end = Effect.gen(function* () {
    yield* flush
    // A Map lets the entry being visited go as it is kept.
    for (const [toolCallId, output] of outputs) {
      const item = yield* toolItem(place.sessionId, toolCallId)
      const kept = yield* ended(toolCallId, output)
      if (item !== undefined) yield* updateItem(place.projectId, item.id, { ...item.content, ...kept })
    }
  })

  const notice = (content: Record<string, unknown>) => Effect.andThen(flush, addItem(place, 'notice', defined(content)))

  const record = (event: SessionEvent) => {
    switch (event._tag) {
      case 'AgentMessage':
        return gather('agent_message', event.text)
      case 'AgentThought':
        return gather('agent_thought', event.text)
      case 'AgentContent':
        return handedInMessage(event.content)
      case 'ToolCall':
      case 'ToolCallUpdate':
        return Effect.gen(function* () {
          yield* flush
          // The call's command and paths are kept, not what it writes or what came back (docs/architecture/07).
          const kept = event.rawInput === undefined ? undefined : essentials(event.rawInput)
          const output = event._tag === 'ToolCallUpdate' && event.rawOutput !== undefined
          const content = defined({
            title: event.title,
            kind: event._tag === 'ToolCall' ? event.kind : undefined,
            status: event.status,
            rawInput: kept?.input,
            locations: event.locations,
          })
          const existing = yield* toolItem(place.sessionId, event.toolCallId)
          const cut = [...new Set([...cutOf(existing?.content), ...(kept?.cut ?? []), ...(output ? ['output'] : [])])]
          const marked = cut.length === 0 ? content : { ...content, cut }
          if (existing === undefined) {
            const stored = { title: '', kind: 'other', status: 'pending', ...marked }
            const id = yield* addItem(place, 'tool_call', stored, { toolCallId: event.toolCallId })
            const extras = yield* extrasOf(event.toolCallId, id, stored, event)
            if (extras !== undefined) yield* updateItem(place.projectId, id, { ...stored, ...extras })
          } else {
            const stored = { ...existing.content, ...marked }
            const extras = yield* extrasOf(event.toolCallId, existing.id, stored, event)
            yield* updateItem(place.projectId, existing.id, { ...stored, ...extras })
          }
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

  /** Commands' output that grew since this was last asked, each as far as it has come. */
  const outputsSoFar = (): ReadonlyArray<OutputSoFar> =>
    [...outputs.values()].flatMap((output) => {
      if (!output.changed) return []
      output.changed = false
      return [{ itemId: output.itemId, ...output.tail() }]
    })

  /** A command's output as far as it has come, while it runs, by its item. */
  const outputOf = (itemId: string): OutputSoFar | undefined => {
    const output = [...outputs.values()].find((candidate) => candidate.itemId === itemId)
    return output === undefined ? undefined : { itemId, ...output.tail() }
  }

  return { record, flush, end, current, outputsSoFar, outputOf }
}

/** The thread as text, oldest first: what a new agent reads when it takes over (ADR-005). */
export const transcript = (threadId: string, budget: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const items = yield* sql<{ kind: ItemKind; content: string; agentId: string | null; task: string | null }>`
      SELECT i.kind, i.content, s.agent_id,
        (SELECT k.slug || ': ' || k.title FROM tasks k WHERE k.id = json_extract(i.content, '$.taskId')) AS task
      FROM thread_items i
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
        case 'step_result':
          return [`[${text('step')}${text('verdict') === '' ? '' : `, ${text('verdict')}`}] ${text('summary')}`]
        case 'task':
          return item.task === null ? [] : [`[task] ${item.task}`]
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
