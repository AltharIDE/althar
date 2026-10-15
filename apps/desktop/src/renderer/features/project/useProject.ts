import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ApiError,
  type AgentStatus,
  type CoordinatorSnapshot,
  PAGE,
  type PlanStep,
  type ProjectRepository,
  type ProjectSummary,
  type TaskEnd,
  type ThreadItem,
  type FieldAnswer,
} from '@althar/contracts'

import { messageOf } from '../../data/client'
import { CARDS } from '../../data/feed'
import { keys, reads } from '../../data/reads'
import { useServices, useWatch } from '../../data/services'
import type { OutputSoFar } from '../../shared/handed'
import { type Outgoing, sentWith } from '../../shared/useImages'
import { useOutputs } from '../../shared/useOutputs'
import { caughtUp, isSending, mergeItems, newestReads, sending, takenBack, unsent, waiting } from '../../shared/items'
import { type Choice, moveTo, runningOn, startOf } from '../../shared/models'
import type { Streamed } from '../../shared/thread'

/*
 * A project's Talk room: the coordinator's thread, with each task's card in
 * it, and what the person can do there: talk to the coordinator, pick the
 * agent it runs on, and change, hold or start a plan before it starts on its
 * own. Like a task's thread, it reads the newest page
 * once, then what changes: an item alone, or the thread's head. A card shows
 * a task that moves in threads of its own, so a change to any task of the
 * project reads the cards again.
 */

/** How long changes are gathered before they are read. */
const GATHER = 25

export interface ProjectModel {
  readonly project: ProjectSummary | null
  /** Its repositories as this Mac has them, each with its remote: what its front page says it is made of. */
  readonly repositories: ReadonlyArray<ProjectRepository> | null
  /** The coordinator's thread: its head and the items read so far, oldest first. */
  readonly coordinator: CoordinatorSnapshot | null
  /** Text still streaming, by thread item. */
  readonly streaming: ReadonlyMap<string, Streamed>
  /** Commands' output as far as it has come, by their tool call's item, while they run. */
  readonly outputs: ReadonlyMap<string, OutputSoFar>
  /** Agents that could work: signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  readonly loadingEarlier: boolean
  readonly loadEarlier: () => Promise<void>
  /** Says something to the coordinator, which starts it on `agentId` if it isn't running. */
  /** Tells the coordinator something, with any images; a coordinator not running starts as the person chose, when they did. */
  readonly say: (body: string, choice: Choice | null, images?: Outgoing) => Promise<boolean>
  readonly sayNow: (body: string, images?: Outgoing) => Promise<boolean>
  /** Takes back a message still waiting its turn; false, having said why, when the agent already has it. */
  readonly takeBack: (itemId: string) => Promise<boolean>
  readonly interrupt: () => Promise<void>
  /** Runs the project with no agent: a task's worktree, or with none its default branch. Its card goes in the coordinator's thread. */
  readonly runProject: (taskId?: string | null) => Promise<void>
  readonly stopLaunch: (id: string) => Promise<void>
  readonly clearLaunch: (id: string) => Promise<void>
  /** Moves the running coordinator to another agent. */
  /** Puts the coordinator on another model or effort, or another agent with one. */
  readonly choose: (choice: Choice) => Promise<void>
  /** Hands the conversation to another agent with what the person says, and any images: its first turn, after its brief. */
  readonly handOver: (choice: Choice, body: string, images?: Outgoing) => Promise<boolean>
  /** Answers the coordinator's question: what went wrong, in words, or null when it went through. */
  readonly answerQuestion: (attentionId: string, answers: Readonly<Record<string, FieldAnswer>>) => Promise<string | null>
  readonly startPlan: (planId: string) => Promise<void>
  readonly holdPlan: (planId: string) => Promise<void>
  /** Stops a command a task's lead left running, which keeps a place the waiting plans wait for. */
  readonly stopBackground: (threadId: string, id: string) => Promise<void>
  readonly changePlan: (planId: string, steps: ReadonlyArray<PlanStep>, end?: TaskEnd | null) => Promise<void>
  readonly fileIssueDraft: (draftId: string) => Promise<void>
  readonly changeIssueDraft: (
    draftId: string,
    edit: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
  ) => Promise<void>
  readonly discardIssueDraft: (draftId: string) => Promise<void>
  readonly dismissError: () => void
}

/** A thread not yet read has no items. */
const NO_ITEMS: ReadonlyArray<ThreadItem> = []

export const useProject = (projectId: string): ProjectModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const listed = useQuery(read.projects())
  const project = listed.data?.projects.find((candidate) => candidate.id === projectId) ?? null
  const repositories = useQuery(read.repositories(projectId)).data ?? null
  const thread = useQuery(read.coordinator(projectId))
  const coordinator = thread.data ?? null
  const status = useQuery(read.status()).data
  const agents = useMemo(() => status?.agents.filter((agent) => agent.signIn !== 'signed_out') ?? [], [status])
  const [streaming, setStreaming] = useState<ReadonlyMap<string, Streamed>>(new Map())
  const [failed, setError] = useState<string | null>(null)
  const readFailure = thread.error ?? listed.error
  const error = failed ?? (readFailure === null ? null : messageOf(readFailure))
  const [pending, setPending] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [newest] = useState(newestReads)
  const changed = useRef({ head: false, cards: false, items: new Set<string>() })
  const threadId = coordinator?.threadId ?? null
  // What the coordinator's commands have printed so far, while they run.
  const outputs = useOutputs(threadId, coordinator?.items ?? NO_ITEMS, coordinator?.session?.turnRunning ?? false)

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
    // A command's output as far as it has come is useOutputs'; the coordinator leaves nothing running.
    if (event._tag === 'Output' || event._tag === 'Background') return
    // Every run in the project, the tasks' too, whole each time, which the pill over the composer shows.
    if (event._tag === 'Launches') {
      if (event.projectId === projectId) setCoordinator((current) => ({ ...current, launches: event.launches }))
      return
    }
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

  const send = (body: string, disposition: 'after_current' | 'interrupt_and_continue', images?: Outgoing) =>
    threadId === null ? Promise.resolve() : client.send({ threadId, body, disposition, ...sentWith(images) })

  /** What the person says shows at once, as the window's copy until the store's arrives; gone again if it fails. Whether Althar has it. */
  const shown = (
    text: string,
    disposition: 'after_current' | 'interrupt_and_continue',
    action: () => Promise<unknown>,
    images: Outgoing | undefined,
    queued = disposition === 'interrupt_and_continue' || coordinator?.session?.turnRunning === true,
  ) => {
    let id = ''
    setCoordinator((current) => {
      const next = sending(current.items, {
        text,
        queued,
        interrupting: disposition === 'interrupt_and_continue',
        ...(images === undefined ? {} : { pictures: images.pictures }),
      })
      id = next.id
      return { ...current, items: next.items }
    })
    let accepted = true
    return act(async () => {
      try {
        await action()
      } catch (failure) {
        accepted = false
        setCoordinator((current) => ({ ...current, items: unsent(current.items, id, text) }))
        throw failure
      }
    }).then(() => accepted)
  }

  return {
    project,
    repositories,
    coordinator,
    streaming,
    outputs,
    agents,
    error,
    pending,
    loadingEarlier,
    loadEarlier,
    say: (body, choice, images) =>
      shown(
        body,
        'after_current',
        async () => {
          /*
           * Not running, it starts first, as it ran last or as the person picked, and its brief waits
           * for what they say. Started in the same call as the send, an agent that didn't start would
           * fail a message the queue has already, which would then go back in the composer to be sent
           * twice; started first, a send that fails was never queued. One already starting, as for a
           * message just before, reads this one next.
           */
          if (
            threadId !== null &&
            coordinator !== null &&
            (coordinator.session === null || !coordinator.session.held) &&
            choice !== null
          )
            await client.startSession(startOf(threadId, choice)).catch((failure: unknown) => {
              if (!(failure instanceof ApiError && failure.reason === 'SessionRunning')) throw failure
            })
          await send(body, 'after_current', images)
        },
        images,
      ),
    sayNow: (body, images) => shown(body, 'interrupt_and_continue', () => send(body, 'interrupt_and_continue', images), images),
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
    runProject: (taskId = null) => act(() => client.runProject(projectId, taskId, threadId)),
    stopLaunch: (id) => act(() => client.stopLaunch(id)),
    clearLaunch: (id) => act(() => client.clearLaunch(id)),
    choose: (choice) =>
      act(async () => {
        const session = coordinator?.session
        // A session the runtime no longer holds can't be moved; the pick is applied when the person next says something.
        if (threadId !== null && session != null && session.held) await moveTo(client, threadId, runningOn(session), choice)
      }),
    handOver: (choice, body, images) =>
      shown(
        body,
        'after_current',
        async () => {
          if (threadId !== null)
            await client.switchAgent({
              ...startOf(threadId, choice),
              body,
              ...sentWith(images),
            })
        },
        images,
        false,
      ),
    answerQuestion: (attentionId, answers) =>
      client.answerQuestion({ attentionId, answers }).then(
        () => null,
        (failure: unknown) => messageOf(failure),
      ),
    startPlan: (planId) => act(() => client.startPlan(planId)),
    holdPlan: (planId) => act(() => client.holdPlan(planId)),
    stopBackground: (threadId, id) => act(() => client.stopBackground(threadId, id)),
    changePlan: (planId, steps, end) => act(() => client.changePlan(planId, steps, end)),
    fileIssueDraft: (draftId) => act(() => client.fileIssueDraft(draftId)),
    changeIssueDraft: (draftId, edit) => act(() => client.changeIssueDraft(draftId, edit)),
    discardIssueDraft: (draftId) => act(() => client.discardIssueDraft(draftId)),
    dismissError: () => setError(null),
  }
}
