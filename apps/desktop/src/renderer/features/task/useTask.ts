import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, type AgentStatus, PAGE, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { caughtUp, isSending, mergeItems, newestReads, sending, takenBack, unsent, waiting } from '../../shared/items'
import { headsOf } from '../../shared/mergeHere'
import { type Choice, moveTo, runningOn, startOf } from '../../shared/models'
import type { Streamed } from '../../shared/thread'
import { useServices, useWatch } from '../../data/services'

/*
 * A task's view model: its thread as the store has it, the text an agent is
 * streaming, and what the person can do: talk to the lead, interrupt it,
 * answer its calls, change its model and effort or hand the task to another
 * agent with one, and steer its course: start its plan now, stop it, resume
 * it, abandon it, reopen it. It reads the thread's newest page once, then only what changes: an item
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
  /** The agents have been read: none above then means none can lead, not that none are known yet. */
  readonly agentsKnown: boolean
  readonly error: string | null
  /** The files merging it here conflicts in, after a merge that couldn't go ahead for that; null otherwise. */
  readonly conflict: string | null
  readonly dismissConflict: () => void
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  /** Earlier items are on their way. */
  readonly loadingEarlier: boolean
  readonly loadEarlier: () => Promise<void>
  /** Reads the files the task changed from git, past what the runtime keeps: for the person looking at them, hand edits and all. */
  readonly readFiles: () => void
  /**
   * Says something to the lead. With no lead working, `start` names the one
   * to start: the message is its first turn, with its brief. A task stopped
   * in the middle of its step resumes with it, on that one; an abandoned one
   * is reopened first.
   */
  readonly send: (body: string, start?: Choice) => Promise<void>
  readonly sendNow: (body: string) => Promise<void>
  /** Takes back a message still waiting its turn; false, having said why, when the agent already has it. */
  readonly takeBack: (itemId: string) => Promise<boolean>
  readonly interrupt: () => Promise<void>
  /** Puts the lead on another model or effort, or hands the task to another agent with one. */
  readonly choose: (choice: Choice) => Promise<void>
  /** Hands the task to another agent with what the person says: the new lead's first turn, after its brief. */
  readonly handOver: (choice: Choice, body: string) => Promise<void>
  /** Stops the task: every agent on it, until it is resumed. */
  readonly stop: () => Promise<void>
  /** Carries the task on from the step it stopped on, with its last lead. */
  readonly resume: () => Promise<void>
  /** Settles it without its change; its worktree and branch stay. Whether it was abandoned. */
  readonly abandon: () => Promise<boolean>
  /** Opens it again, once abandoned, on its worktree and branch. */
  readonly reopen: () => Promise<void>
  /** Starts its plan now, while it waits to start. */
  readonly startPlan: (planId: string) => Promise<void>
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  /** Answers a step that needs the person. */
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Marks the task's draft pull request ready for review: the one at `url`, in a task of several. */
  readonly markReady: (url?: string) => Promise<void>
  /** Marks each of these draft pull requests ready for review, in turn: as its menu does, for all of them. */
  readonly markAllReady: (urls: ReadonlyArray<string>) => Promise<void>
  /** Opens the pull request of a task whose work ended on its branch. */
  readonly openChange: () => Promise<void>
  /** Merges the task into its repositories' default branches here, up to the heads it showed; it has no pull request. */
  readonly mergeHere: () => Promise<void>
  /** Pushes what it merged here to the remotes its default branches follow. */
  readonly pushHere: () => Promise<void>
  /** Pushes its branch to its repositories' remotes, up to the heads shown, with the person's own git. */
  readonly pushBranch: () => Promise<void>
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
  const [conflict, setConflict] = useState<string | null>(null)
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

  const readFiles = useCallback(
    () =>
      void newest(
        'head',
        client.getThread(threadId, { limit: 0, fresh: true }),
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
    // How full the lead's context is, as it says: kept on its session, which the composer shows.
    if (event._tag === 'Context')
      return void setSnapshot((current) =>
        current.session === null
          ? current
          : { ...current, session: { ...current.session, context: { used: event.used, size: event.size } } },
      )
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

  /** Runs an action on the task, once it has been read. */
  const onTask = (action: (taskId: string) => Promise<unknown>) =>
    act(async () => (snapshot === null ? undefined : action(snapshot.task.id)))

  /** What the person sends shows at once, as the window's copy until the store's arrives; gone again if the send fails. */
  const shown = (
    text: string,
    disposition: 'after_current' | 'interrupt_and_continue',
    action: () => Promise<unknown>,
    // Behind a turn running it waits its turn; handed to another agent, it is that one's first.
    queued = disposition === 'interrupt_and_continue' || snapshot?.session?.turnRunning === true,
  ) => {
    let id = ''
    setSnapshot((current) => {
      const next = sending(current.items, { text, queued, interrupting: disposition === 'interrupt_and_continue' })
      id = next.id
      return { ...current, items: next.items }
    })
    return act(async () => {
      try {
        await action()
      } catch (failure) {
        setSnapshot((current) => ({ ...current, items: unsent(current.items, id, text) }))
        throw failure
      }
    })
  }

  return {
    snapshot,
    streaming,
    agents,
    agentsKnown: status !== undefined,
    error,
    conflict,
    dismissConflict: () => setConflict(null),
    pending,
    loadingEarlier,
    loadEarlier,
    readFiles,
    send: (body, start) =>
      shown(body, 'after_current', async () => {
        // Abandoned, what the person says reopens it first, as its menu would; refused, nothing is sent.
        const reopening = snapshot?.task.actions.includes('reopen') === true
        if (reopening && snapshot !== null) await client.reopenTask(snapshot.task.id)
        // Queued first, so the lead that starts reads it in its first turn rather than after one of its own.
        await client.send({ threadId, body, disposition: 'after_current' })
        if (start === undefined || snapshot === null) return
        // Reopened, it stands where it was, which only the runtime knows: read again.
        const actions = reopening ? (await client.getThread(threadId, { limit: 0 })).task.actions : snapshot.task.actions
        // Stopped in the middle of its step, the task carries that step on, with what the person said first.
        if (actions.includes('resume'))
          await client.resumeTask({ taskId: snapshot.task.id, agentId: start.agentId, model: start.model, effort: start.effort })
        else await client.startSession(startOf(threadId, start))
      }),
    sendNow: (body) => shown(body, 'interrupt_and_continue', () => client.send({ threadId, body, disposition: 'interrupt_and_continue' })),
    takeBack: async (itemId) => {
      // What is still on its way has nothing to take back yet.
      if (isSending(itemId)) return false
      setError(null)
      try {
        await client.takeBack(itemId)
        // Gone from the queue at once, rather than when the runtime's word of it arrives.
        arrived(takenBack(snapshot?.items ?? [], itemId))
        return true
      } catch (failure) {
        fail(failure)
        return false
      }
    },
    interrupt: () => act(() => client.interrupt(threadId)),
    choose: (choice) =>
      act(async () => {
        const session = snapshot?.session
        await (session == null ? client.startSession(startOf(threadId, choice)) : moveTo(client, threadId, runningOn(session), choice))
      }),
    handOver: (choice, body) => shown(body, 'after_current', () => client.switchAgent({ ...startOf(threadId, choice), body }), false),
    stop: () => onTask((taskId) => client.stopTask(taskId)),
    resume: () => onTask((taskId) => client.resumeTask({ taskId })),
    abandon: async () => {
      let abandoned = false
      await onTask(async (taskId) => {
        await client.abandonTask(taskId)
        abandoned = true
      })
      return abandoned
    },
    reopen: () => onTask((taskId) => client.reopenTask(taskId)),
    startPlan: (planId) => act(() => client.startPlan(planId)),
    answer: (attentionId, decision, reason) =>
      act(() => client.answer({ attentionId, decision, ...(reason === undefined || reason === '' ? {} : { reason }) })),
    answerStuck: (attentionId, answer) => act(() => client.answerStuck({ attentionId, answer })),
    markReady: (url) => act(async () => (snapshot === null ? undefined : client.markReady(snapshot.task.id, url))),
    markAllReady: (urls) =>
      onTask(async (taskId) => {
        for (const url of urls) await client.markReady(taskId, url)
      }),
    openChange: () => act(async () => (snapshot === null ? undefined : client.openChange(snapshot.task.id))),
    mergeHere: () =>
      act(async () => {
        setConflict(null)
        if (snapshot === null) return
        try {
          await client.mergeHere(snapshot.task.id, headsOf(snapshot.task.here))
        } catch (failure) {
          // Conflicting with the default branch is the lead's to settle: the window offers to ask it.
          if (failure instanceof ApiError && failure.reason === 'CantMerge' && failure.why === 'conflicts')
            setConflict(failure.detail ?? '')
          throw failure
        }
      }),
    pushHere: () => act(async () => (snapshot === null ? undefined : client.pushHere(snapshot.task.id))),
    pushBranch: () =>
      act(async () => {
        if (snapshot === null) return
        // Each repository with a remote, at the head the person saw: a commit the lead made since isn't pushed unseen.
        const heads = snapshot.task.here.flatMap((repo) =>
          repo.remote == null || repo.head === null ? [] : [{ repository: repo.repository, head: repo.head }],
        )
        await client.pushBranch(snapshot.task.id, heads)
      }),
    accept: (changes) =>
      act(async () => {
        if (snapshot === null) return
        for (const change of changes) await client.merge(snapshot.task.id, change.head, change.url)
      }),
    push: (head, url) => act(async () => (snapshot === null ? undefined : client.push(snapshot.task.id, head, url))),
    dismissError: () => setError(null),
  }
}
