import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type AgentStatus, PAGE, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { caughtUp, mergeItems, newestReads, waiting } from '../../shared/items'
import { headsOf } from '../../shared/mergeHere'
import { type Choice, moveTo, runningOn, startOf } from '../../shared/models'
import type { Streamed } from '../../shared/thread'
import { useServices, useWatch } from '../../data/services'

/*
 * A task's view model: its thread as the store has it, the text an agent is
 * streaming, and what the person can do: talk to the lead, interrupt it,
 * answer its calls, change its model and effort or hand the task to another
 * agent with one, stop it. It reads the thread's newest page once, then only what changes: an item
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
  /**
   * Says something to the lead. With no lead working, `start` names the one
   * to start: the message is its first turn, with its brief.
   */
  readonly send: (body: string, start?: Choice) => Promise<void>
  readonly sendNow: (body: string) => Promise<void>
  readonly interrupt: () => Promise<void>
  /** Puts the lead on another model or effort, or hands the task to another agent with one. */
  readonly choose: (choice: Choice) => Promise<void>
  readonly stop: () => Promise<void>
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  /** Answers a step that needs the person. */
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Marks the task's draft pull request ready for review: the one at `url`, in a task of several. */
  readonly markReady: (url?: string) => Promise<void>
  /** Opens the pull request of a task whose work ended on its branch. */
  readonly openChange: () => Promise<void>
  /** Merges the task into its repositories' default branches here, up to the heads it showed; it has no pull request. */
  readonly mergeHere: () => Promise<void>
  /**
   * Accepts its pull requests: merges each on its host in turn, at the head
   * the person saw, and stops at the first that is refused, so the rest
   * wait; pending throughout.
   */
  readonly accept: (changes: ReadonlyArray<{ readonly head: string; readonly url: string }>) => Promise<void>
  /** Pushes the task's branch to its pull request, up to the commit the person saw: the one at `url`, in a task of several. */
  readonly push: (head: string, url?: string) => Promise<void>
  readonly dismissError: () => void
}

export const useTask = (threadId: string): TaskModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const thread = useQuery(read.thread(threadId))
  const snapshot = thread.data ?? null
  const status = useQuery(read.status()).data
  const agents = useMemo(() => status?.agents.filter((agent) => agent.signIn !== 'signed_out') ?? [], [status])
  const [streaming, setStreaming] = useState<ReadonlyMap<string, Streamed>>(new Map())
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (thread.error === null ? null : messageOf(thread.error))
  const [pending, setPending] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [newest] = useState(newestReads)
  const changed = useRef({ head: false, items: new Set<string>() })
  const taskId = snapshot?.task.id ?? null
  const hasChange = (snapshot?.task.changes.length ?? 0) > 0

  /** Changes the thread as the window keeps it; nothing before it is first read. */
  const setSnapshot = useCallback(
    (change: (current: ThreadSnapshot) => ThreadSnapshot) =>
      cache.setQueryData<ThreadSnapshot>(keys.thread(threadId), (current) => (current === undefined ? current : change(current))),
    [cache, threadId],
  )

  // A task with a pull request asks its host for news as it opens, rather than at the next turn of listening.
  useEffect(() => {
    if (taskId !== null && hasChange) client.refreshTask(taskId).catch(() => undefined)
  }, [client, taskId, hasChange])

  useEffect(() => () => clearTimeout(timer.current), [])

  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])

  const arrived = useCallback(
    (items: ReadonlyArray<ThreadItem>) => {
      setSnapshot((current) => ({ ...current, items: mergeItems(current.items, items) }))
      setStreaming((current) => caughtUp(current, items))
    },
    [setSnapshot],
  )

  /** The thread's head again: its task, the agent working, the calls waiting. Its items stay as they are. */
  const readHead = useCallback(
    () =>
      newest(
        'head',
        client.getThread(threadId, { limit: 0 }),
        (head) =>
          cache.setQueryData<ThreadSnapshot>(keys.thread(threadId), (current) =>
            current === undefined ? head : { ...head, items: current.items, earlier: current.earlier },
          ),
        fail,
      ),
    [client, cache, threadId, newest, fail],
  )

  /** Reads what the gathered changes touched. */
  const readChanged = useCallback(() => {
    timer.current = undefined
    const { head, items } = changed.current
    changed.current = { head: false, items: new Set() }
    if (head) void readHead()
    for (const itemId of items) void newest(itemId, client.getThreadItem(threadId, itemId), (item) => arrived([item]), fail)
  }, [client, threadId, readHead, newest, arrived, fail])

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
    // A message delivered changes its input, not its item: read again what still shows as queued.
    if (event.aggregateType === 'user_input') for (const id of waiting(snapshot?.items ?? [])) changed.current.items.add(id)
    timer.current ??= setTimeout(readChanged, GATHER)
  })

  const loadEarlier = useCallback(async () => {
    const first = snapshot?.items[0]
    if (first === undefined) return
    setLoadingEarlier(true)
    try {
      const page = await client.getThread(threadId, { before: first.sequence, limit: PAGE })
      setSnapshot((current) => ({ ...current, items: mergeItems(current.items, page.items), earlier: page.earlier }))
    } catch (failure) {
      fail(failure)
    } finally {
      setLoadingEarlier(false)
    }
  }, [client, threadId, snapshot, setSnapshot, fail])

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
    send: (body, start) =>
      act(async () => {
        // Queued first, so the lead that starts reads it in its first turn rather than after one of its own.
        await client.send({ threadId, body, disposition: 'after_current' })
        if (start !== undefined) await client.startSession(startOf(threadId, start))
      }),
    sendNow: (body) => act(() => client.send({ threadId, body, disposition: 'interrupt_and_continue' })),
    interrupt: () => act(() => client.interrupt(threadId)),
    choose: (choice) =>
      act(async () => {
        const session = snapshot?.session
        await (session == null ? client.startSession(startOf(threadId, choice)) : moveTo(client, threadId, runningOn(session), choice))
      }),
    stop: () => act(() => client.stopSession(threadId)),
    answer: (attentionId, decision, reason) =>
      act(() => client.answer({ attentionId, decision, ...(reason === undefined || reason === '' ? {} : { reason }) })),
    answerStuck: (attentionId, answer) => act(() => client.answerStuck({ attentionId, answer })),
    markReady: (url) => act(async () => (snapshot === null ? undefined : client.markReady(snapshot.task.id, url))),
    openChange: () => act(async () => (snapshot === null ? undefined : client.openChange(snapshot.task.id))),
    mergeHere: () => act(async () => (snapshot === null ? undefined : client.mergeHere(snapshot.task.id, headsOf(snapshot.task.here)))),
    accept: (changes) =>
      act(async () => {
        if (snapshot === null) return
        for (const change of changes) await client.merge(snapshot.task.id, change.head, change.url)
      }),
    push: (head, url) => act(async () => (snapshot === null ? undefined : client.push(snapshot.task.id, head, url))),
    dismissError: () => setError(null),
  }
}
