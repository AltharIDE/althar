import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type AgentStatus,
  type CoordinatorSnapshot,
  PAGE,
  type IssueSummary,
  type PlanStep,
  type ProjectSummary,
  type TaskEnd,
  type TaskSummary,
  type ThreadItem,
} from '@althar/contracts'

import { messageOf } from '../../data/client'
import { CARDS } from '../../data/feed'
import { keys, reads } from '../../data/reads'
import { useServices, useWatch } from '../../data/services'
import { caughtUp, isSending, mergeItems, newestReads, sending, takenBack, unsent, waiting } from '../../shared/items'
import { type Choice, moveTo, runningOn, startOf } from '../../shared/models'
import type { Streamed } from '../../shared/thread'

/*
 * A project's Talk room: the coordinator's thread, with each task's card in
 * it, and what the person can do there: talk to the coordinator, pick the
 * agent it runs on, change, hold or start a plan before it starts on its own,
 * and start a task themselves. Like a task's thread, it reads the newest page
 * once, then what changes: an item alone, or the thread's head. A card shows
 * a task that moves in threads of its own, so a change to any task of the
 * project reads the cards again.
 */

/** How long changes are gathered before they are read. */
const GATHER = 25

export interface NewTask {
  readonly title: string
  readonly description: string
  readonly lead: Choice
  /** Who reviews it, or null for no review. */
  readonly reviewer: Choice | null
  /** The issue it comes from, by its ref, if any. */
  readonly issue: string | null
  /** What happens when the work is done; null where the repository's host isn't connected. */
  readonly end: TaskEnd | null
  /** The project's repositories it changes, by name; null where the project has one. */
  readonly repositories: ReadonlyArray<string> | null
}

export interface ProjectModel {
  readonly project: ProjectSummary | null
  /** The coordinator's thread: its head and the items read so far, oldest first. */
  readonly coordinator: CoordinatorSnapshot | null
  /** Text still streaming, by thread item. */
  readonly streaming: ReadonlyMap<string, Streamed>
  /** Agents that could work: signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  /** How the project's tasks end where a plan doesn't say; null where its host decides. */
  readonly end: TaskEnd | null
  readonly error: string | null
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  /** A task the person planned is starting. */
  readonly starting: boolean
  readonly loadingEarlier: boolean
  readonly loadEarlier: () => Promise<void>
  /** Says something to the coordinator, which starts it on `agentId` if it isn't running. */
  /** Tells the coordinator something; a coordinator not running starts as the person chose, when they did. */
  readonly say: (body: string, choice: Choice | null) => Promise<void>
  readonly sayNow: (body: string) => Promise<void>
  /** Takes back a message still waiting its turn; false, having said why, when the agent already has it. */
  readonly takeBack: (itemId: string) => Promise<boolean>
  readonly interrupt: () => Promise<void>
  /** Moves the running coordinator to another agent. */
  /** Puts the coordinator on another model or effort, or another agent with one. */
  readonly choose: (choice: Choice) => Promise<void>
  /** Hands the conversation to another agent with what the person says: its first turn, after its brief. */
  readonly handOver: (choice: Choice, body: string) => Promise<void>
  readonly startPlan: (planId: string) => Promise<void>
  readonly holdPlan: (planId: string) => Promise<void>
  readonly changePlan: (planId: string, steps: ReadonlyArray<PlanStep>, end?: TaskEnd | null) => Promise<void>
  /** Plans and starts a task; the task, or null when it couldn't. */
  readonly startTask: (input: NewTask) => Promise<TaskSummary | null>
  /** The person's open issues, for a task to come from. */
  readonly listIssues: () => Promise<ReadonlyArray<IssueSummary>>
  readonly dismissError: () => void
}

export const useProject = (projectId: string): ProjectModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const listed = useQuery(read.projects())
  const project = listed.data?.projects.find((candidate) => candidate.id === projectId) ?? null
  const thread = useQuery(read.coordinator(projectId))
  const coordinator = thread.data ?? null
  const status = useQuery(read.status()).data
  const agents = useMemo(() => status?.agents.filter((agent) => agent.signIn !== 'signed_out') ?? [], [status])
  // The project's ending, which a task the person plans starts from.
  const end = useQuery(read.rules(projectId)).data?.end ?? null
  const [streaming, setStreaming] = useState<ReadonlyMap<string, Streamed>>(new Map())
  const [failed, setError] = useState<string | null>(null)
  const readFailure = thread.error ?? listed.error
  const error = failed ?? (readFailure === null ? null : messageOf(readFailure))
  const [pending, setPending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [newest] = useState(newestReads)
  const changed = useRef({ head: false, cards: false, items: new Set<string>() })
  const threadId = coordinator?.threadId ?? null

  /** Changes the coordinator's thread as the window keeps it; nothing before it is first read. */
  const setCoordinator = useCallback(
    (change: (current: CoordinatorSnapshot) => CoordinatorSnapshot) =>
      cache.setQueryData<CoordinatorSnapshot>(keys.coordinator(projectId), (current) =>
        current === undefined ? current : change(current),
      ),
    [cache, projectId],
  )

  useEffect(() => () => clearTimeout(timer.current), [])

  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])

  const arrived = useCallback(
    (items: ReadonlyArray<ThreadItem>) => {
      setCoordinator((current) => ({ ...current, items: mergeItems(current.items, items) }))
      setStreaming((current) => caughtUp(current, items))
    },
    [setCoordinator],
  )

  /** The thread's head again: the agent working, the one it would start on. Its items stay as they are. */
  const readHead = useCallback(
    () =>
      newest(
        'head',
        client.getCoordinator(projectId, { limit: 0 }),
        (head) =>
          cache.setQueryData<CoordinatorSnapshot>(keys.coordinator(projectId), (current) =>
            current === undefined ? head : { ...head, items: current.items, earlier: current.earlier },
          ),
        fail,
      ),
    [client, cache, projectId, newest, fail],
  )

  /** Reads what the gathered changes touched. */
  const readChanged = useCallback(() => {
    timer.current = undefined
    const { head, cards, items } = changed.current
    changed.current = { head: false, cards: false, items: new Set() }
    if (threadId === null) return
    if (head) void readHead()
    const read = new Set(items)
    if (cards) for (const item of coordinator?.items ?? []) if (item.kind === 'task') read.add(item.id)
    for (const itemId of read) void newest(itemId, client.getThreadItem(threadId, itemId), (item) => arrived([item]), fail)
  }, [client, threadId, coordinator, readHead, newest, arrived, fail])

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
    // How full the coordinator's context is, as it says: kept on its session, which the composer shows.
    if (event._tag === 'Context') {
      if (event.threadId === threadId)
        setCoordinator((current) =>
          current.session === null
            ? current
            : { ...current, session: { ...current.session, context: { used: event.used, size: event.size } } },
        )
      return
    }
    if (event.threadId === threadId) {
      if (event.aggregateType === 'thread_item') changed.current.items.add(event.aggregateId)
      else changed.current.head = true
      // A message delivered changes its input, not its item: read again what still shows as queued.
      if (event.aggregateType === 'user_input') for (const id of waiting(coordinator?.items ?? [])) changed.current.items.add(id)
    } else if (event.aggregateType === 'connection') changed.current.head = true
    else if (event.projectId === projectId && CARDS.has(event.aggregateType)) changed.current.cards = true
    else return
    timer.current ??= setTimeout(readChanged, GATHER)
  })

  const loadEarlier = useCallback(async () => {
    const first = coordinator?.items[0]
    if (first === undefined) return
    setLoadingEarlier(true)
    try {
      const page = await client.getCoordinator(projectId, { before: first.sequence, limit: PAGE })
      setCoordinator((current) => ({ ...current, items: mergeItems(current.items, page.items), earlier: page.earlier }))
    } catch (failure) {
      fail(failure)
    } finally {
      setLoadingEarlier(false)
    }
  }, [client, projectId, coordinator, setCoordinator, fail])

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

  const startTask = useCallback(
    async (input: NewTask) => {
      setError(null)
      setStarting(true)
      try {
        return await client.startTask({
          projectId,
          title: input.title.trim(),
          ...(input.description.trim() === '' ? {} : { description: input.description.trim() }),
          steps: [
            { key: 'implement', ...input.lead, skipped: false },
            ...(input.reviewer === null ? [] : [{ key: 'review' as const, ...input.reviewer, skipped: false }]),
          ],
          ...(input.issue === null ? {} : { issue: input.issue }),
          end: input.end,
          ...(input.repositories === null ? {} : { repositories: input.repositories }),
        })
      } catch (failure) {
        fail(failure)
        return null
      } finally {
        setStarting(false)
      }
    },
    [client, projectId, fail],
  )

  // Kept the same across renders: the new-task panel reads the issues once, when it opens.
  const listIssues = useCallback(
    () =>
      client.listIssues(projectId).then(
        (list) => list.issues,
        (failure: unknown) => {
          fail(failure)
          return []
        },
      ),
    [client, projectId, fail],
  )

  const send = (body: string, disposition: 'after_current' | 'interrupt_and_continue') =>
    threadId === null ? Promise.resolve() : client.send({ threadId, body, disposition })

  /** What the person says shows at once, as the window's copy until the store's arrives; gone again if it fails. */
  const shown = (
    text: string,
    disposition: 'after_current' | 'interrupt_and_continue',
    action: () => Promise<unknown>,
    queued = disposition === 'interrupt_and_continue' || coordinator?.session?.turnRunning === true,
  ) => {
    let id = ''
    setCoordinator((current) => {
      const next = sending(current.items, { text, queued, interrupting: disposition === 'interrupt_and_continue' })
      id = next.id
      return { ...current, items: next.items }
    })
    return act(async () => {
      try {
        await action()
      } catch (failure) {
        setCoordinator((current) => ({ ...current, items: unsent(current.items, id, text) }))
        throw failure
      }
    })
  }

  return {
    project,
    coordinator,
    streaming,
    agents,
    end,
    error,
    pending,
    starting,
    loadingEarlier,
    loadEarlier,
    say: (body, choice) =>
      shown(body, 'after_current', async () => {
        // The runtime starts it as it ran last; anything else the person picked starts first.
        const suggested = coordinator?.suggested
        const same =
          suggested != null &&
          choice?.agentId === suggested.agentId &&
          choice.model === suggested.model &&
          choice.effort === suggested.effort
        if (threadId !== null && coordinator?.session === null && choice !== null && !same)
          await client.startSession(startOf(threadId, choice))
        await send(body, 'after_current')
      }),
    sayNow: (body) => shown(body, 'interrupt_and_continue', () => send(body, 'interrupt_and_continue')),
    takeBack: async (itemId) => {
      // What is still on its way has nothing to take back yet.
      if (isSending(itemId)) return false
      setError(null)
      try {
        await client.takeBack(itemId)
        // Gone from the queue at once, rather than when the runtime's word of it arrives.
        arrived(takenBack(coordinator?.items ?? [], itemId))
        return true
      } catch (failure) {
        fail(failure)
        return false
      }
    },
    interrupt: () => act(async () => (threadId === null ? undefined : client.interrupt(threadId))),
    choose: (choice) =>
      act(async () => {
        const session = coordinator?.session
        if (threadId !== null && session != null) await moveTo(client, threadId, runningOn(session), choice)
      }),
    handOver: (choice, body) =>
      shown(
        body,
        'after_current',
        async () => {
          if (threadId !== null) await client.switchAgent({ ...startOf(threadId, choice), body })
        },
        false,
      ),
    startPlan: (planId) => act(() => client.startPlan(planId)),
    holdPlan: (planId) => act(() => client.holdPlan(planId)),
    changePlan: (planId, steps, end) => act(() => client.changePlan(planId, steps, end)),
    startTask,
    listIssues,
    dismissError: () => setError(null),
  }
}
