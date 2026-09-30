import { useCallback, useEffect, useRef, useState } from 'react'

import { type AgentStatus, PAGE, type ThreadItem, type ThreadSnapshot } from '@charrette/contracts'

import { messageOf } from '../../data/client'
import type { Streamed } from './thread'
import { useServices, useWatch } from '../../data/services'

/*
 * A task's view model: its thread as the store has it, the text an agent is
 * streaming, and what the person can do: talk to the lead, interrupt it,
 * answer its calls, change its model, hand the task to another agent, stop
 * it. It reads the thread's newest page once, then only what changes: an item
 * that changed is read alone, and anything else about the thread (the agent
 * working, the calls waiting) reads the thread's head again, without its
 * items. Earlier items are read a page at a time, when asked for.
 */

/** How long changes are gathered before they are read. */
const GATHER = 25

export interface TaskModel {
  /** The thread's head and the items read so far, oldest first. */
  readonly snapshot: ThreadSnapshot | null
  /** Text still streaming, by thread item. */
  readonly streaming: ReadonlyMap<string, Streamed>
  /** Agents that could lead: signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  /** Earlier items are on their way. */
  readonly loadingEarlier: boolean
  readonly loadEarlier: () => Promise<void>
  readonly send: (body: string) => Promise<void>
  readonly sendNow: (body: string) => Promise<void>
  readonly interrupt: () => Promise<void>
  readonly start: (agentId: string) => Promise<void>
  readonly switchAgent: (agentId: string) => Promise<void>
  readonly setModel: (model: string) => Promise<void>
  readonly stop: () => Promise<void>
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  readonly dismissError: () => void
}

/** Items by id, oldest first: what arrives replaces what was there. */
export const mergeItems = (current: ReadonlyArray<ThreadItem>, incoming: ReadonlyArray<ThreadItem>): ReadonlyArray<ThreadItem> => {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].toSorted((a, b) => a.sequence - b.sequence)
}

/** Streamed text the store now holds in full needs no streamed copy. */
const caughtUp = (streaming: ReadonlyMap<string, Streamed>, items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, Streamed> => {
  const kept = new Map(streaming)
  for (const item of items) {
    const live = kept.get(item.id)
    if (live !== undefined && 'text' in item.content && item.content.text.length >= live.text.length) kept.delete(item.id)
  }
  return kept.size === streaming.size ? streaming : kept
}

export const useTask = (threadId: string): TaskModel => {
  const { client } = useServices()
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null)
  const [streaming, setStreaming] = useState<ReadonlyMap<string, Streamed>>(new Map())
  const [since, setSince] = useState<number | null>(null)
  const [agents, setAgents] = useState<ReadonlyArray<AgentStatus>>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const changed = useRef({ head: false, items: new Set<string>() })

  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])

  const arrived = useCallback((items: ReadonlyArray<ThreadItem>) => {
    setSnapshot((current) => (current === null ? current : { ...current, items: mergeItems(current.items, items) }))
    setStreaming((current) => caughtUp(current, items))
  }, [])

  /** The thread's head again: its task, the agent working, the calls waiting. Its items stay as they are. */
  const readHead = useCallback(
    () =>
      client
        .getThread(threadId, { limit: 0 })
        .then(
          (head) => setSnapshot((current) => (current === null ? head : { ...head, items: current.items, earlier: current.earlier })),
          fail,
        ),
    [client, threadId, fail],
  )

  useEffect(() => {
    client.getThread(threadId).then((first) => {
      setSnapshot(first)
      setSince(first.cursor)
    }, fail)
    client.status().then((status) => setAgents(status.agents.filter((agent) => agent.signIn !== 'signed_out')), fail)
    return () => clearTimeout(timer.current)
  }, [client, threadId, fail])

  /** Reads what the gathered changes touched. */
  const readChanged = useCallback(() => {
    timer.current = undefined
    const { head, items } = changed.current
    changed.current = { head: false, items: new Set() }
    if (head) void readHead()
    for (const itemId of items) void client.getThreadItem(threadId, itemId).then((item) => arrived([item]), fail)
  }, [client, threadId, readHead, arrived, fail])

  useWatch((event) => {
    if (event._tag === 'Streaming') {
      if (event.threadId !== threadId) return
      setStreaming((current) =>
        new Map(current).set(event.itemId, {
          kind: event.kind,
          agentId: event.agentId,
          text: event.text,
          at: current.get(event.itemId)?.at ?? new Date().toISOString(),
        }),
      )
      return
    }
    if (event.threadId !== threadId) return
    if (event.aggregateType === 'thread_item') changed.current.items.add(event.aggregateId)
    else changed.current.head = true
    timer.current ??= setTimeout(readChanged, GATHER)
  }, since)

  const loadEarlier = useCallback(async () => {
    const first = snapshot?.items[0]
    if (first === undefined) return
    setLoadingEarlier(true)
    try {
      const page = await client.getThread(threadId, { before: first.sequence, limit: PAGE })
      setSnapshot((current) =>
        current === null ? current : { ...current, items: mergeItems(current.items, page.items), earlier: page.earlier },
      )
    } catch (failure) {
      fail(failure)
    } finally {
      setLoadingEarlier(false)
    }
  }, [client, threadId, snapshot, fail])

  /** Runs an action, says what went wrong if it did, and reads the thread's head again. */
  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null)
      setPending(true)
      try {
        await action()
      } catch (failure) {
        fail(failure)
      } finally {
        setPending(false)
        await readHead()
      }
    },
    [readHead, fail],
  )

  return {
    snapshot,
    streaming,
    agents,
    error,
    pending,
    loadingEarlier,
    loadEarlier,
    send: (body) => act(() => client.send({ threadId, body, disposition: 'after_current' })),
    sendNow: (body) => act(() => client.send({ threadId, body, disposition: 'interrupt_and_continue' })),
    interrupt: () => act(() => client.interrupt(threadId)),
    start: (agentId) => act(() => client.startSession({ threadId, agentId })),
    switchAgent: (agentId) => act(() => client.switchAgent({ threadId, agentId })),
    setModel: (model) => act(() => client.setModel({ threadId, model })),
    stop: () => act(() => client.stopSession(threadId)),
    answer: (attentionId, decision, reason) =>
      act(() => client.answer({ attentionId, decision, ...(reason === undefined || reason === '' ? {} : { reason }) })),
    dismissError: () => setError(null),
  }
}
