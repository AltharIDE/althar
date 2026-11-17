import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react'

import { ApiError, type AlwaysScope, type BoardTask } from '@althar/contracts'

import { messageOf, type OnePress, type StuckAnswer } from '../../data/client'
import { useMerge, useMerging } from '../../data/merges'
import { useServices } from '../../data/services'
import { headsOf } from '../../shared/mergeHere'

/*
 * What the person does from a dock, on the board or the home: answer a call,
 * accept a pull request by merging it, push what the lead committed, merge
 * work that ended on its branch here, open its pull request, send the work
 * back to its lead with a note, or settle a finished task that isn't a
 * change (Done) or keep it for later. Each says what went wrong, if it did.
 * Each that settles a card in one press is kept on this computer as so
 * (DEV-173), to count what Needs you held that wasn't a decision.
 *
 * Done and Keep move the card from the press (`over`), held by the task
 * until a read of it says so, as an aside's Clear is; one the runtime
 * answered without moving comes back, saying so. The others' cards stay busy
 * from the press until a read of the board after the answer is shown, so a
 * card never offers again for a moment what it just did.
 */

/** What went wrong with a task's last push or merge. */
export interface ActionFailure {
  readonly action: 'push' | 'merge' | 'ship' | 'other'
  readonly message: string
}

/** What the coordinator is asked when the person carries on a draft that has no plan: it plans it, or says why it can't. */
const planIt = (task: { readonly title: string; readonly slug: string }) =>
  `Plan “${task.title}” (${task.slug}): it is a draft with no plan. Call propose_plan for it, or tell me why you can't.`

export interface WorkActions {
  /** The tasks as the person's presses left them: those Done or kept for later moved at once, until a read says so. */
  readonly over: <T extends BoardTask>(tasks: ReadonlyArray<T>) => ReadonlyArray<T>
  readonly error: string | null
  /** What last failed for each task, which action it was, and why, for its own card to say; a task's is cleared when it is tried again, and no other's. */
  readonly failed: Readonly<Record<string, ActionFailure>>
  /** The tasks being merged: their pull requests, wherever in the window Merge was pressed, or their branches here. */
  readonly merging: ReadonlySet<string>
  /** The tasks a note is on its way back to. */
  readonly sending: ReadonlySet<string>
  /** The tasks whose pull requests are being opened. */
  readonly opening: ReadonlySet<string>
  /** The tasks whose commits are being pushed. */
  readonly pushing: ReadonlySet<string>
  /** The tasks being shipped: what waits on their branch, reviewed first where their plan says, then sent up. */
  readonly shipping: ReadonlySet<string>
  /** The tasks whose review after a merge the person is answering, Fix it or Leave it. */
  readonly answeringAfterMerge: ReadonlySet<string>
  /** The tasks being marked done or kept for later. */
  readonly settling: ReadonlySet<string>
  /** The tasks whose conflict the lead is being asked to resolve, by the person's Resolve now. */
  readonly resolving: ReadonlySet<string>
  /** Resolve now: a task's conflict asked of its lead, whatever kept it from being asked; whether it went through. */
  readonly resolveNow: (taskId: string) => Promise<boolean>
  /** Settles a finished task that isn't a change as Done; whether it went through. */
  readonly markDone: (taskId: string) => Promise<boolean>
  /** Takes a finished task that isn't a change out of Needs you, kept for later; whether it went through. */
  readonly keep: (taskId: string) => Promise<boolean>
  /** Merges a ready task's pull request at the head the person saw; whether it went through. */
  readonly merge: (taskId: string, head: string, url?: string, bypassQueue?: boolean) => Promise<boolean>
  /** Merges a ready task's repositories without a pull request into their default branches here, up to the heads the dock showed; whether it went through. */
  readonly mergeHere: (task: BoardTask) => Promise<boolean>
  /** Pushes a task's branch to its pull request, up to the commit the person saw; whether it went through. */
  readonly push: (taskId: string, head: string, url?: string) => Promise<boolean>
  /** Ships what waits on a task's branch for Ship; whether Althar took it. */
  readonly ship: (taskId: string) => Promise<boolean>
  /** Fix it, on what a review after a merge found: the lead takes the findings, and its fix ships after the merged pull request. */
  readonly fixAfterMerge: (taskId: string) => Promise<boolean>
  /** Leave it, on what a review after a merge found: the findings close. */
  readonly leaveAfterMerge: (taskId: string) => Promise<boolean>
  /** Sends a ready task back to its lead with a note, starting the lead again if it stopped; whether it went through. `onePress` where the note is the card's own, as Carry on's. */
  readonly sendBack: (task: BoardTask, note: string, onePress?: boolean) => Promise<boolean>
  /** Opens the pull request of a task whose work ended on its branch. */
  readonly openChange: (taskId: string) => Promise<boolean>
  /** Answers a call; with `always`, kept in the project's rules by that scope. Whether it went through. */
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string, always?: AlwaysScope) => Promise<boolean>
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Says what went wrong reading what the actions act on. */
  readonly fail: (failure: unknown) => void
  readonly dismissError: () => void
}

/** Where a task's card is in Needs you: a call waits on the person, or its work is ready (`lanesOf`). */
const NEEDS_YOU: ReadonlySet<BoardTask['phase']> = new Set(['waiting', 'ready'])

/** Where the tasks aren't read again by a press: its card is busy until its answer. */
const READ_NOTHING = () => Promise.resolve(undefined)

/** Where Done and Keep for later move a card: settled, or kept for later, as the runtime's card then says. */
type Settling = Extract<BoardTask['phase'], 'settled' | 'kept'>

/** What the window says where the runtime answered Done or Keep for later but the task didn't move. */
export const workText = {
  stillOpen: 'Something of it opened meanwhile, so it stays as it was.',
}

/**
 * What the actions act on: the tasks shown, by which a merge that went through shows as merging until it reads so, and
 * how to read them again, by which a card stays busy until a read after its press's answer is shown, and Done and Keep
 * for later check what the runtime did: the tasks as that read has them, or none where it failed.
 */
export const useWorkActions = (
  tasks: ReadonlyArray<BoardTask> | null = null,
  readAgain: () => Promise<ReadonlyArray<BoardTask> | undefined> = READ_NOTHING,
): WorkActions => {
  const { client } = useServices()
  // The cards moved by Done or Keep for later, by task, until a read of each says so.
  const [moved, setMoved] = useState<ReadonlyMap<string, Settling>>(new Map())
  const agreed =
    tasks === null ? [] : [...moved].filter(([taskId, to]) => (tasks.find((task) => task.taskId === taskId)?.phase ?? to) === to)
  if (agreed.length > 0) setMoved((now) => new Map([...now].filter(([taskId]) => !agreed.some(([one]) => one === taskId))))
  const over = useCallback(
    <T extends BoardTask>(shown: ReadonlyArray<T>): ReadonlyArray<T> =>
      moved.size === 0 ? shown : shown.map((task) => (moved.has(task.taskId) ? { ...task, phase: moved.get(task.taskId)! } : task)),
    [moved],
  )
  // The tasks read again from after a press's answer: what failed to read is the feed's to catch up on.
  const readAfter = useCallback(() => readAgain().catch(() => undefined), [readAgain])
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<WorkActions['failed']>({})
  // Merging here is this screen's; a pull request's merge is the window's, wherever it was pressed.
  const [mergingHere, setMerging] = useState<ReadonlySet<string>>(new Set())
  const merge = useMerge()
  const merges = useMerging(tasks)
  const merging = useMemo(
    () => (mergingHere.size === 0 ? merges.merging : new Set([...merges.merging, ...mergingHere])),
    [merges.merging, mergingHere],
  )
  const failures = useMemo(
    () => ({
      ...Object.fromEntries(Object.entries(merges.failed).map(([taskId, message]) => [taskId, { action: 'merge', message } as const])),
      ...failed,
    }),
    [merges.failed, failed],
  )
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set())
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set())
  const [pushing, setPushing] = useState<ReadonlySet<string>>(new Set())
  const [shipping, setShipping] = useState<ReadonlySet<string>>(new Set())
  const [answeringAfterMerge, setAnsweringAfterMerge] = useState<ReadonlySet<string>>(new Set())
  const [settling, setSettling] = useState<ReadonlySet<string>>(new Set())
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set())
  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])
  /** Whether a task's card is in Needs you as it is pressed, as last shown: Done on one kept for later settles none there. */
  const inNeeds = useCallback((taskId: string) => NEEDS_YOU.has(tasks?.find((task) => task.taskId === taskId)?.phase ?? 'settled'), [tasks])
  // Kept by the way: what fails to keep it changes nothing the person sees. A task's press counts where its card was in Needs
  // you before it was pressed (`from`); a call's always is.
  const pressed = useCallback(
    (from: boolean, through: boolean, press: OnePress) => {
      if (from && through) void client.settledWithOnePress(press).catch(() => {})
      return through
    },
    [client],
  )

  /**
   * Runs an action, marking the task busy with it meanwhile (each task on its own, so cards act side by side); whether it
   * went through. Its card stays busy until a read of the board after the answer is shown, so it never offers again for a
   * moment what it just did; one that moves its card at once (`to`) holds it moved until a read says so.
   */
  const busy = useCallback(
    async (
      mark: Dispatch<SetStateAction<ReadonlySet<string>>>,
      taskId: string,
      act: () => Promise<unknown>,
      action: 'push' | 'merge' | 'ship' | 'other' = 'other',
      to?: Settling,
    ) => {
      const set = (on: boolean) =>
        mark((now) => {
          const next = new Set(now)
          if (on) next.add(taskId)
          else next.delete(taskId)
          return next
        })
      set(true)
      setError(null)
      setFailed(({ [taskId]: _, ...rest }) => rest)
      if (to !== undefined) setMoved((now) => new Map([...now, [taskId, to]]))
      const back = () =>
        setMoved((now) => {
          if (!now.has(taskId)) return now
          const next = new Map(now)
          next.delete(taskId)
          return next
        })
      try {
        await act()
        const after = await readAfter()
        if (to !== undefined) {
          // Read afresh after the answer, as an aside's Clear is: one the runtime answered without moving comes back, saying so.
          const now = after?.find((task) => task.taskId === taskId)
          if (now !== undefined && now.phase !== to) throw new ApiError({ reason: 'Unchanged', message: workText.stillOpen })
        }
        return true
      } catch (failure) {
        back()
        fail(failure)
        setFailed((now) => ({ ...now, [taskId]: { action, message: messageOf(failure) } }))
        return false
      } finally {
        set(false)
      }
    },
    [fail, readAfter],
  )

  /** Done or Keep for later: the card moved from the press, until a read says so. */
  const settle = useCallback(
    (taskId: string, to: Settling, act: () => Promise<unknown>) => busy(setSettling, taskId, act, 'other', to),
    [busy],
  )

  return {
    over,
    error,
    failed: failures,
    merging,
    sending,
    opening,
    pushing,
    shipping,
    answeringAfterMerge,
    settling,
    resolving,
    resolveNow: useCallback(
      async (taskId) =>
        pressed(inNeeds(taskId), await busy(setResolving, taskId, () => client.resolveConflictsNow(taskId)), { taskId, action: 'resolve' }),
      [busy, client, pressed, inNeeds],
    ),
    markDone: useCallback(
      async (taskId) => {
        const from = inNeeds(taskId)
        return pressed(from, await settle(taskId, 'settled', () => client.markTaskDone(taskId)), { taskId, action: 'done' })
      },
      [settle, client, pressed, inNeeds],
    ),
    keep: useCallback(
      async (taskId) => {
        const from = inNeeds(taskId)
        return pressed(from, await settle(taskId, 'kept', () => client.keepTaskForLater(taskId)), { taskId, action: 'keep' })
      },
      [settle, client, pressed, inNeeds],
    ),
    mergeHere: useCallback(
      (task) => busy(setMerging, task.taskId, () => client.mergeHere(task.taskId, headsOf(task.here))),
      [busy, client],
    ),
    push: useCallback(
      async (taskId, head, url) =>
        pressed(inNeeds(taskId), await busy(setPushing, taskId, () => client.push(taskId, head, url), 'push'), { taskId, action: 'push' }),
      [busy, client, pressed, inNeeds],
    ),
    // Ship is the push the person's tweaks wait for: kept as one, as Push is.
    ship: useCallback(
      async (taskId) =>
        pressed(inNeeds(taskId), await busy(setShipping, taskId, () => client.ship(taskId), 'ship'), { taskId, action: 'push' }),
      [busy, client, pressed, inNeeds],
    ),
    // What a review after a merge found: the person's Fix it or Leave it, each the one decision it waited on.
    fixAfterMerge: useCallback(
      async (taskId) =>
        pressed(inNeeds(taskId), await busy(setAnsweringAfterMerge, taskId, () => client.fixAfterMerge(taskId)), {
          taskId,
          action: 'resolve',
        }),
      [busy, client, pressed, inNeeds],
    ),
    leaveAfterMerge: useCallback(
      async (taskId) =>
        pressed(inNeeds(taskId), await busy(setAnsweringAfterMerge, taskId, () => client.leaveAfterMerge(taskId)), {
          taskId,
          action: 'done',
        }),
      [busy, client, pressed, inNeeds],
    ),
    // Its card says why it didn't merge (`failures`), as the window keeps it.
    merge: useCallback(
      async (taskId, head, url, bypassQueue) => {
        setError(null)
        setFailed(({ [taskId]: _, ...rest }) => rest)
        const from = inNeeds(taskId)
        try {
          await merge({ taskId, head, url, ...(bypassQueue ? { bypassQueue: true } : {}) })
          return pressed(from, true, { taskId, action: 'merge' })
        } catch (failure) {
          fail(failure)
          return false
        }
      },
      [merge, fail, pressed, inNeeds],
    ),
    sendBack: useCallback(
      async (task, note, onePress = false) => {
        const from = inNeeds(task.taskId)
        const through = await busy(setSending, task.taskId, async () => {
          const head = await client.getThread(task.threadId, { limit: 0 })
          const restarting = head.session === null || !head.session.held
          // The lead as the thread has it now, not as the card was read: it may have changed since.
          const lead = head.task.lead?.agentId ?? null
          // A draft whose plan never came has no lead to carry on, and nothing to start: the coordinator is asked to plan it.
          if (head.task.state === 'draft' && head.task.planId === null && lead === null) {
            const coordinator = await client.getCoordinator(head.project.id, { limit: 0 })
            await client.send({ threadId: coordinator.threadId, body: planIt(head.task), disposition: 'after_current' })
            return
          }
          // A thread the runtime no longer holds can't take it — its recorded session may be stale or dead — so the lead starts again on the agent that led it.
          // A held thread takes the note itself: running, after the current turn; between turns, now. With no lead to start, the person is told why.
          if (restarting && lead === null)
            throw new ApiError({
              reason: 'NoLead',
              message: 'No lead to start. Pick an agent for it first.',
            })
          await client.send({ threadId: task.threadId, body: note, disposition: 'after_current' })
          // Stopped in the middle of its step, the task carries that step on, as its own screen does: its run goes on too, so
          // nothing reads it as stopped while its lead works, and its time runs from now.
          if (head.task.actions.includes('resume')) await client.resumeTask({ taskId: task.taskId })
          else if (restarting && lead !== null)
            await client.startSession({ threadId: task.threadId, agentId: lead }).catch((failure: unknown) => {
              // Another start took over after the read: the queued note will go to that session.
              if (failure instanceof ApiError && failure.reason === 'SessionRunning') return
              // The note stays queued: say so, and why the lead didn't start.
              setError(`Queued, but the lead didn't start. ${messageOf(failure)}`)
            })
        })
        return onePress ? pressed(from, through, { taskId: task.taskId, action: 'carry_on' }) : through
      },
      [busy, client, pressed, inNeeds],
    ),
    openChange: useCallback((taskId) => busy(setOpening, taskId, () => client.openChange(taskId)), [busy, client]),
    answer: useCallback(
      (attentionId, decision, reason, always) =>
        client
          .answer({ attentionId, decision, ...(reason === undefined ? {} : { reason }), ...(always === undefined ? {} : { always }) })
          .then(
            // Answered as it stands, with nothing written: one press.
            () => (reason === undefined ? pressed(true, true, { attentionId, action: decision }) : true),
            (failure: unknown) => {
              fail(failure)
              return false
            },
          ),
      [client, fail, pressed],
    ),
    answerStuck: useCallback((attentionId, answer) => client.answerStuck({ attentionId, answer }).catch(fail), [client, fail]),
    fail,
    dismissError: useCallback(() => setError(null), []),
  }
}
