import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'

import { ApiError, type AlwaysScope, type BoardTask } from '@althar/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { useServices } from '../../data/services'
import { headsOf } from '../../shared/mergeHere'

/*
 * What the person does from a dock, on the board or the home: answer a call,
 * accept a pull request by merging it, push what the lead committed, merge
 * work that ended on its branch here, open its pull request, send the work
 * back to its lead with a note, or settle a finished task that isn't a
 * change (Done) or keep it for later. Each says what went wrong, if it did.
 */

/** What went wrong with a task's last push or merge. */
export interface ActionFailure {
  readonly action: 'push' | 'merge' | 'other'
  readonly message: string
}

export interface WorkActions {
  readonly error: string | null
  /** What last failed for each task, which action it was, and why, for its own card to say; a task's is cleared when it is tried again, and no other's. */
  readonly failed: Readonly<Record<string, ActionFailure>>
  /** The tasks whose pull requests are being merged. */
  readonly merging: ReadonlySet<string>
  /** The tasks a note is on its way back to. */
  readonly sending: ReadonlySet<string>
  /** The tasks whose pull requests are being opened. */
  readonly opening: ReadonlySet<string>
  /** The tasks whose commits are being pushed. */
  readonly pushing: ReadonlySet<string>
  /** The tasks being marked done or kept for later. */
  readonly settling: ReadonlySet<string>
  /** Settles a finished task that isn't a change as Done; whether it went through. */
  readonly markDone: (taskId: string) => Promise<boolean>
  /** Takes a finished task that isn't a change out of Needs you, kept for later; whether it went through. */
  readonly keep: (taskId: string) => Promise<boolean>
  /** Merges a ready task's pull request at the head the person saw; whether it went through. */
  readonly merge: (taskId: string, head: string, url?: string) => Promise<boolean>
  /** Merges a ready task's repositories without a pull request into their default branches here, up to the heads the dock showed; whether it went through. */
  readonly mergeHere: (task: BoardTask) => Promise<boolean>
  /** Pushes a task's branch to its pull request, up to the commit the person saw; whether it went through. */
  readonly push: (taskId: string, head: string, url?: string) => Promise<boolean>
  /** Sends a ready task back to its lead with a note, starting the lead again if it stopped; whether it went through. */
  readonly sendBack: (task: BoardTask, note: string) => Promise<boolean>
  /** Opens the pull request of a task whose work ended on its branch. */
  readonly openChange: (taskId: string) => Promise<boolean>
  /** Answers a call; with `always`, kept in the project's rules by that scope. Whether it went through. */
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string, always?: AlwaysScope) => Promise<boolean>
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Says what went wrong reading what the actions act on. */
  readonly fail: (failure: unknown) => void
  readonly dismissError: () => void
}

export const useWorkActions = (): WorkActions => {
  const { client } = useServices()
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<WorkActions['failed']>({})
  const [merging, setMerging] = useState<ReadonlySet<string>>(new Set())
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set())
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set())
  const [pushing, setPushing] = useState<ReadonlySet<string>>(new Set())
  const [settling, setSettling] = useState<ReadonlySet<string>>(new Set())
  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])

  /** Runs an action, marking the task busy with it meanwhile (each task on its own, so cards act side by side); whether it went through. */
  const busy = useCallback(
    async (
      mark: Dispatch<SetStateAction<ReadonlySet<string>>>,
      taskId: string,
      act: () => Promise<unknown>,
      action: 'push' | 'merge' | 'other' = 'other',
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
      try {
        await act()
        return true
      } catch (failure) {
        fail(failure)
        setFailed((now) => ({ ...now, [taskId]: { action, message: messageOf(failure) } }))
        return false
      } finally {
        set(false)
      }
    },
    [fail],
  )

  return {
    error,
    failed,
    merging,
    sending,
    opening,
    pushing,
    settling,
    markDone: useCallback((taskId) => busy(setSettling, taskId, () => client.markTaskDone(taskId)), [busy, client]),
    keep: useCallback((taskId) => busy(setSettling, taskId, () => client.keepTaskForLater(taskId)), [busy, client]),
    mergeHere: useCallback(
      (task) => busy(setMerging, task.taskId, () => client.mergeHere(task.taskId, headsOf(task.here))),
      [busy, client],
    ),
    push: useCallback((taskId, head, url) => busy(setPushing, taskId, () => client.push(taskId, head, url), 'push'), [busy, client]),
    merge: useCallback((taskId, head, url) => busy(setMerging, taskId, () => client.merge(taskId, head, url), 'merge'), [busy, client]),
    sendBack: useCallback(
      (task, note) =>
        busy(setSending, task.taskId, async () => {
          const head = await client.getThread(task.threadId, { limit: 0 })
          const restarting = head.session === null || !head.session.held
          // The lead as the thread has it now, not as the card was read: it may have changed since.
          const lead = head.task.lead?.agentId ?? null
          // A thread the runtime no longer holds can't take it — its recorded session may be stale or dead — so the lead starts again on the agent that led it.
          // A held thread takes the note itself: running, after the current turn; between turns, now. With no lead to start, the person is told why.
          if (restarting && lead === null)
            throw new ApiError({
              reason: 'NoLead',
              message: 'This task has no lead to start. Pick an agent for it first.',
            })
          await client.send({ threadId: task.threadId, body: note, disposition: 'after_current' })
          if (restarting && lead !== null)
            await client.startSession({ threadId: task.threadId, agentId: lead }).catch((failure: unknown) => {
              // Another start took over after the read: the queued note will go to that session.
              if (failure instanceof ApiError && failure.reason === 'SessionRunning') return
              // Keep the queued note, and say not to send it again while making the startup failure clear.
              setError(`Note queued, but the lead could not start. ${messageOf(failure)} The note is already queued; don't send it again.`)
            })
        }),
      [busy, client],
    ),
    openChange: useCallback((taskId) => busy(setOpening, taskId, () => client.openChange(taskId)), [busy, client]),
    answer: useCallback(
      (attentionId, decision, reason, always) =>
        client
          .answer({ attentionId, decision, ...(reason === undefined ? {} : { reason }), ...(always === undefined ? {} : { always }) })
          .then(
            () => true,
            (failure: unknown) => {
              fail(failure)
              return false
            },
          ),
      [client, fail],
    ),
    answerStuck: useCallback((attentionId, answer) => client.answerStuck({ attentionId, answer }).catch(fail), [client, fail]),
    fail,
    dismissError: useCallback(() => setError(null), []),
  }
}
