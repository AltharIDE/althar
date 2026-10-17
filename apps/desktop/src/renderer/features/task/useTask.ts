import { useQuery } from '@tanstack/react-query'
import { doing, type Doing } from './actions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ApiError,
  type AgentStatus,
  type AlwaysScope,
  type Attachment,
  type FieldAnswer,
  PAGE,
  type ReviewVerdict,
  type ThreadItem,
  type ThreadSnapshot,
} from '@althar/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { caughtUp, isSending, mergeItems, newestReads, sending, takenBack, unsent, waiting } from '../../shared/items'
import { headsOf } from '../../shared/mergeHere'
import { type Choice, moveTo, runningOn, startOf } from '../../shared/models'
import type { OutputSoFar } from '../../shared/handed'
import { type Outgoing, sentWith } from '../../shared/useImages'
import { useOutputs } from '../../shared/useOutputs'
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

/** A thread not yet read has no items. */
const NO_ITEMS: ReadonlyArray<ThreadItem> = []

/** How long changes are gathered before they are read. */
const GATHER = 25

export interface TaskModel {
  /** The thread's head and the items read so far, oldest first. */
  readonly snapshot: ThreadSnapshot | null
  /** Text still streaming, by thread item. */
  readonly streaming: ReadonlyMap<string, Streamed>
  /** Commands' output as far as it has come, by their tool call's item, while they run. */
  readonly outputs: ReadonlyMap<string, OutputSoFar>
  /** Agents that could lead: signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  /** The agents have been read: none above then means none can lead, not that none are known yet. */
  readonly agentsKnown: boolean
  readonly error: string | null
  /** The files merging it here conflicts in, after a merge that couldn't go ahead for that; null otherwise. */
  readonly conflict: string | null
  readonly dismissConflict: () => void
  /** The pull request a push was refused by for commits on it that aren't on the branch, by its address; null otherwise. */
  readonly refused: string | null
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  /** Which of them, where it is one of the outputs' (see `doing`): the others wait, but aren't working. */
  readonly doing: Doing | null
  /** Earlier items are on their way. */
  readonly loadingEarlier: boolean
  readonly loadEarlier: () => Promise<void>
  /** Reads the files the task changed from git, past what the runtime keeps: for the person looking at them, hand edits and all. */
  readonly readFiles: () => void
  /**
   * Says something to the lead. With no lead working, `start` names the one
   * to start: the message is its first turn, with its brief. A task stopped
   * in the middle of its step resumes with it, on that one; an abandoned one
   * is reopened first. Whether Althar has the message: once it is queued it
   * has, whether or not the lead it starts does, which is said apart.
   */
  readonly send: (body: string, start?: Choice, images?: Outgoing) => Promise<boolean>
  readonly sendNow: (body: string, images?: Outgoing) => Promise<boolean>
  /** Takes back a message still waiting its turn; false, having said why, when the agent already has it. */
  readonly takeBack: (itemId: string) => Promise<boolean>
  readonly interrupt: () => Promise<void>
  /** Has the agent on the task compact its context, after what it was told before. */
  readonly compact: () => Promise<void>
  /** Puts the lead on another model or effort, or hands the task to another agent with one. */
  readonly choose: (choice: Choice) => Promise<void>
  /** Hands the task to another agent with what the person says, and any images: the new lead's first turn, after its brief. */
  readonly handOver: (choice: Choice, body: string, images?: Outgoing) => Promise<boolean>
  /** Stops the task: every agent on it, until it is resumed. */
  readonly stop: () => Promise<void>
  /** Skips the review of the work under way: ready once its lead is done. */
  readonly skipReview: () => Promise<void>
  /** Carries the task on from the step it stopped on, with its last lead. */
  readonly resume: () => Promise<void>
  /** Whether its lead resolves conflicts on its own, otherwise than its project says; null goes back to the project. */
  readonly setResolveConflicts: (on: boolean | null) => Promise<void>
  /** Allows everything its agents ask, short of what its project never allows, or takes it back: what waits goes ahead. */
  readonly setAllowEverything: (on: boolean) => Promise<void>
  /**
   * Settles it without its change; its worktree and branch stay. A merged one settles without the commits after its pull
   * request, which stay on its branch, and stays merged. Whether it was abandoned.
   */
  readonly abandon: () => Promise<boolean>
  /** Opens it again, once abandoned, on its worktree and branch. */
  readonly reopen: () => Promise<void>
  /** Gives it another title, in any state; the title shown is Althar's, once it is back. */
  readonly rename: (title: string) => Promise<void>
  /**
   * Attaches it to an open pull request it didn't open, by its link or
   * number; `start` starts its branch from that one's head. What happened,
   * or null where it didn't go through and the error says why.
   */
  readonly attach: (pullRequest: string, start: boolean) => Promise<Attachment | null>
  /** Starts its plan now, while it waits to start. */
  readonly startPlan: (planId: string) => Promise<void>
  /** Answers a call; with `always`, the answer is kept in the project's rules by that scope. */
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string, always?: AlwaysScope) => Promise<boolean>
  /** Answers a step that needs the person. */
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Answers an agent's question: what went wrong, in words, or null when it went through. */
  readonly answerQuestion: (attentionId: string, answers: Readonly<Record<string, FieldAnswer>>) => Promise<string | null>
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
  /**
   * Replaces the commits on the task's pull request with its branch, up to
   * the commit the person saw, once it was rewritten since it was pushed:
   * a force push they confirmed, only while the pull request is still at
   * `replaces`.
   */
  readonly replace: (head: string, replaces: string, url: string) => Promise<void>
  /** What to tell the lead so its branch takes the pull request's commits in by merging, fetched to it first; null where that failed, having said why. */
  readonly mergeNote: (url: string) => Promise<string | null>
  /** Stops listening to the task's pull request at this address. */
  readonly stopListening: (url: string) => Promise<void>
  /** Changes the review a review task's lead drafted: its verdict, summary, or which comments are kept and what they say. */
  readonly changeReview: (
    draftId: string,
    edit: {
      readonly verdict?: ReviewVerdict
      readonly summary?: string
      readonly comments?: ReadonlyArray<{ readonly id: string; readonly kept?: boolean; readonly body?: string }>
    },
  ) => Promise<void>
  /** Posts that review, as it stands; or again, after it wasn't posted. */
  readonly postReview: (draftId: string) => Promise<void>
  readonly discardReview: (draftId: string) => Promise<void>
  /** Stops a command its lead left running. */
  readonly stopBackground: (id: string) => Promise<void>
  /** Stops a command another task's lead left running, which keeps a place this task waits for. */
  readonly stopHolding: (threadId: string, id: string) => Promise<void>
  /** Clears one that ended by itself from the list. */
  readonly clearBackground: (id: string) => Promise<void>
  /** Runs what it built, with no agent, in its worktree. */
  /** Runs one of the project's runnables in its worktree, its default without one. */
  readonly runProject: (runnableId?: string | null) => Promise<void>
  readonly stopLaunch: (id: string) => Promise<void>
  readonly clearLaunch: (id: string) => Promise<void>
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
  // What its commands have printed so far, while they run.
  const outputs = useOutputs(threadId, snapshot?.items ?? NO_ITEMS, snapshot?.session?.turnRunning ?? false)
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (thread.error === null ? null : messageOf(thread.error))
  const [pending, setPending] = useState(false)
  const [acting, setActing] = useState<Doing | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
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

  // Its screen open, the task is seen, once: a plain task that finished is done then (DEV-96). Seeing it again does nothing more.
  useEffect(() => {
    if (taskId !== null) client.seeTask(taskId).catch(() => undefined)
  }, [client, taskId])

  // And as it becomes ready in front of the person, however quickly it got there: one that finished there has been seen finishing.
  const phase = snapshot?.task.phase ?? null
  useEffect(() => {
    if (phase === 'ready' && taskId !== null && document.visibilityState === 'visible') client.seeTask(taskId).catch(() => undefined)
  }, [client, taskId, phase])

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
    // A command's output as far as it has come is useOutputs'.
    if (event._tag === 'Output') return
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
    // What Althar runs of the project, whole each time: this task's, which the pill over the composer shows.
    if (event._tag === 'Launches')
      return void setSnapshot((current) =>
        current.project.id !== event.projectId
          ? current
          : { ...current, task: { ...current.task, launches: event.launches.filter((launch) => launch.taskId === current.task.id) } },
      )
    // Its project's rules, which belong to no thread: by their switch it may allow everything now, or no longer. Its head again.
    const ofItsRules = event._tag === 'Changed' && event.aggregateType === 'policy' && event.projectId === snapshot?.project.id
    if (event.threadId !== threadId && !ofItsRules) return
    // How full the lead's context is, as it says: kept on its session, which the composer shows.
    if (event._tag === 'Context')
      return void setSnapshot((current) =>
        current.session === null
          ? current
          : { ...current, session: { ...current.session, context: { used: event.used, size: event.size } } },
      )
    // What it left running, whole each time: kept on its session too, which the pill over the composer shows.
    if (event._tag === 'Background')
      return void setSnapshot((current) =>
        current.session === null ? current : { ...current, session: { ...current.session, background: event.background } },
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

  /**
   * Runs an action, says what went wrong if it did, and reads the thread's
   * head again. It stays under way until that read, or one begun after it,
   * is shown, so what it changed shows as it ends: a Push never shows its
   * count from before it went.
   */
  const act = useCallback(
    async (action: () => Promise<unknown>, which: Doing | null = null) => {
      setError(null)
      setPending(true)
      setActing(which)
      try {
        await action()
      } catch (failure) {
        fail(failure)
      } finally {
        await readHead()
        // A read begun since, as the runtime's word of the push arrives, replaces it: shown once that lands.
        await newest.landed('head')
        setPending(false)
        setActing(null)
      }
    },
    [readHead, newest, fail],
  )

  /** Runs an action on the task, once it has been read. */
  const onTask = (action: (taskId: string) => Promise<unknown>) =>
    act(async () => (snapshot === null ? undefined : action(snapshot.task.id)))

  /**
   * What the person sends shows at once, as the window's copy until the
   * store's arrives; gone again if the send fails. Whether Althar has it, so
   * what was sent can go back in the composer when it doesn't. Althar has it
   * once the action says so (`accepted`), or once it succeeds: what fails
   * after, such as starting the lead that reads it, is said, but the message
   * stays where it is, so it is never sent twice.
   */
  const shown = (
    text: string,
    disposition: 'after_current' | 'interrupt_and_continue',
    action: (accepted: () => void) => Promise<unknown>,
    images: Outgoing | undefined,
    // Behind a turn running it waits its turn; handed to another agent, it is that one's first.
    queued = disposition === 'interrupt_and_continue' || snapshot?.session?.turnRunning === true,
  ) => {
    let id = ''
    setSnapshot((current) => {
      const next = sending(current.items, {
        text,
        queued,
        interrupting: disposition === 'interrupt_and_continue',
        ...(images === undefined ? {} : { pictures: images.pictures }),
      })
      id = next.id
      return { ...current, items: next.items }
    })
    let accepted = false
    const accept = () => {
      accepted = true
    }
    return act(async () => {
      try {
        await action(accept)
        accept()
      } catch (failure) {
        if (!accepted) setSnapshot((current) => ({ ...current, items: unsent(current.items, id, text) }))
        throw failure
      }
    }).then(() => accepted)
  }

  return {
    snapshot,
    streaming,
    outputs,
    agents,
    agentsKnown: status !== undefined,
    error,
    conflict,
    dismissConflict: () => setConflict(null),
    refused,
    pending,
    doing: acting,
    loadingEarlier,
    loadEarlier,
    readFiles,
    send: (body, start, images) =>
      shown(
        body,
        'after_current',
        async (accepted) => {
          // Abandoned, what the person says reopens it first, as its menu would; refused, nothing is sent.
          const reopening = snapshot?.task.actions.includes('reopen') === true
          if (reopening && snapshot !== null) await client.reopenTask(snapshot.task.id)
          // Queued first, so the lead that starts reads it in its first turn rather than after one of its own.
          await client.send({ threadId, body, disposition: 'after_current', ...sentWith(images) })
          // Althar has it now: a lead that doesn't start is said, and what was said waits in the queue for the next.
          accepted()
          if (start === undefined || snapshot === null) return
          // Reopened, it stands where it was, which only the runtime knows: read again.
          const actions = reopening ? (await client.getThread(threadId, { limit: 0 })).task.actions : snapshot.task.actions
          // Stopped in the middle of its step, the task carries that step on, with what the person said first.
          if (actions.includes('resume'))
            await client.resumeTask({ taskId: snapshot.task.id, agentId: start.agentId, model: start.model, effort: start.effort })
          else await client.startSession(startOf(threadId, start))
        },
        images,
      ),
    sendNow: (body, images) =>
      shown(
        body,
        'interrupt_and_continue',
        () => client.send({ threadId, body, disposition: 'interrupt_and_continue', ...sentWith(images) }),
        images,
      ),
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
    compact: () => act(() => client.compact(threadId)),
    choose: (choice) =>
      act(async () => {
        const session = snapshot?.session
        // A thread the runtime no longer holds can't be moved: the choice starts the lead on it instead. While it is held, the choice changes the lead it has.
        await (session == null || !session.held
          ? client.startSession(startOf(threadId, choice))
          : moveTo(client, threadId, runningOn(session), choice))
      }),
    handOver: (choice, body, images) =>
      shown(body, 'after_current', () => client.switchAgent({ ...startOf(threadId, choice), body, ...sentWith(images) }), images, false),
    stop: () => onTask((taskId) => client.stopTask(taskId)),
    skipReview: () => onTask((taskId) => client.skipReview(taskId)),
    resume: () => onTask((taskId) => client.resumeTask({ taskId })),
    setResolveConflicts: (on) => onTask((taskId) => client.setTaskResolveConflicts({ taskId, resolveConflicts: on })),
    setAllowEverything: (on) => onTask((taskId) => client.setTaskAllowEverything({ taskId, allowEverything: on })),
    abandon: async () => {
      let abandoned = false
      // Merged, the runtime offers leaving out what came after in its place: the person abandons either way.
      const merged = snapshot?.task.actions.includes('leaveOut') === true
      await onTask(async (taskId) => {
        await (merged ? client.leaveOutCommits(taskId) : client.abandonTask(taskId))
        abandoned = true
      })
      return abandoned
    },
    reopen: () => onTask((taskId) => client.reopenTask(taskId)),
    rename: (title) => onTask((taskId) => client.renameTask(taskId, title)),
    attach: async (pullRequest, start) => {
      let done = null as Attachment | null
      await onTask(async (taskId) => {
        done = await client.attachPullRequest(taskId, pullRequest, start)
      })
      return done
    },
    startPlan: (planId) => act(() => client.startPlan(planId)),
    answer: async (attentionId, decision, reason, always) => {
      // Whether it went through: a call whose answer didn't is answerable again.
      let through = true
      await act(() =>
        client
          .answer({
            attentionId,
            decision,
            ...(reason === undefined || reason === '' ? {} : { reason }),
            ...(always === undefined ? {} : { always }),
          })
          .catch((failure: unknown) => {
            through = false
            throw failure
          }),
      )
      return through
    },
    answerStuck: (attentionId, answer) => act(() => client.answerStuck({ attentionId, answer })),
    answerQuestion: (attentionId, answers) =>
      client.answerQuestion({ attentionId, answers }).then(
        () => null,
        (failure: unknown) => messageOf(failure),
      ),
    markReady: (url) =>
      act(async () => (snapshot === null ? undefined : client.markReady(snapshot.task.id, url)), doing.markReady(url ?? '')),
    markAllReady: (urls) =>
      onTask(async (taskId) => {
        for (const url of urls) await client.markReady(taskId, url)
      }),
    openChange: () => act(async () => (snapshot === null ? undefined : client.openChange(snapshot.task.id)), doing.openChange),
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
      }, doing.mergeHere),
    pushHere: () => act(async () => (snapshot === null ? undefined : client.pushHere(snapshot.task.id)), doing.pushHere),
    pushBranch: () =>
      act(async () => {
        if (snapshot === null) return
        // Each repository with a remote, at the head the person saw: a commit the lead made since isn't pushed unseen.
        const heads = snapshot.task.here.flatMap((repo) =>
          repo.remote == null || repo.head === null ? [] : [{ repository: repo.repository, head: repo.head }],
        )
        await client.pushBranch(snapshot.task.id, heads)
      }, doing.pushBranch),
    accept: (changes) =>
      act(async () => {
        if (snapshot === null) return
        for (const change of changes) await client.merge(snapshot.task.id, change.head, change.url)
      }, doing.accept),
    push: (head, url) =>
      act(
        async () => {
          setRefused(null)
          if (snapshot === null) return
          try {
            await client.push(snapshot.task.id, head, url)
          } catch (failure) {
            // Commits on it the branch doesn't have are the lead's to bring in: the card says so, and offers to ask it, in place of an error.
            if (failure instanceof ApiError && failure.reason === 'PushRefused' && failure.why === 'behind') {
              setRefused(url ?? snapshot.task.changes[0]?.url ?? '')
              return
            }
            throw failure
          }
        },
        doing.push(url ?? ''),
      ),
    replace: (head, replaces, url) =>
      act(
        async () => (snapshot === null ? undefined : client.replacePullRequest(snapshot.task.id, head, replaces, url)),
        doing.replace(url),
      ),
    mergeNote: async (url) => {
      let note: string | null = null
      await act(async () => {
        if (snapshot === null) return
        note = await client.mergeNote(snapshot.task.id, url)
        setRefused(null)
      }, doing.bringIn(url))
      return note
    },
    stopListening: (url) => onTask((taskId) => client.stopListening(taskId, url)),
    changeReview: (draftId, edit) => act(() => client.changeReviewDraft(draftId, edit)),
    postReview: (draftId) => act(() => client.postReviewDraft(draftId)),
    discardReview: (draftId) => act(() => client.discardReviewDraft(draftId)),
    stopBackground: (id) => act(() => client.stopBackground(threadId, id)),
    stopHolding: (holder, id) => act(() => client.stopBackground(holder, id)),
    clearBackground: (id) => act(() => client.clearBackground(threadId, id)),
    runProject: (runnableId = null) =>
      act(async () =>
        snapshot === null
          ? undefined
          : client.runProject(snapshot.project.id, snapshot.task.id, threadId, ...(runnableId === null ? [] : [runnableId])),
      ),
    stopLaunch: (id) => act(() => client.stopLaunch(id)),
    clearLaunch: (id) => act(() => client.clearLaunch(id)),
    dismissError: () => setError(null),
  }
}
