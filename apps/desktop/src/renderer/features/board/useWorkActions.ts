import { useCallback, useState } from 'react'

import type { BoardTask } from '@althar/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { useServices } from '../../data/services'
import { headsOf } from '../../shared/mergeHere'

/*
 * What the person does from a dock, on the board or the home: answer a call,
 * accept a pull request by merging it, push what the lead committed, merge
 * work that ended on its branch here, open its pull request, or send the
 * work back to its lead with a note. Each says what went wrong, if it did.
 */

export interface WorkActions {
  readonly error: string | null
  /** The task whose pull request is being merged. */
  readonly merging: string | null
  /** The task a note is on its way back to. */
  readonly sending: string | null
  /** The task whose pull request is being opened. */
  readonly opening: string | null
  /** The task whose commits are being pushed. */
  readonly pushing: string | null
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
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  /** Says what went wrong reading what the actions act on. */
  readonly fail: (failure: unknown) => void
  readonly dismissError: () => void
}

export const useWorkActions = (): WorkActions => {
  const { client } = useServices()
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [pushing, setPushing] = useState<string | null>(null)
  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])

  /** Runs an action, marking the task busy with it meanwhile; whether it went through. */
  const busy = useCallback(
    async (mark: (taskId: string | null) => void, taskId: string, act: () => Promise<unknown>) => {
      mark(taskId)
      setError(null)
      try {
        await act()
        return true
      } catch (failure) {
        fail(failure)
        return false
      } finally {
        mark(null)
      }
    },
    [fail],
  )

  return {
    error,
    merging,
    sending,
    opening,
    pushing,
    mergeHere: useCallback(
      (task) => busy(setMerging, task.taskId, () => client.mergeHere(task.taskId, headsOf(task.here))),
      [busy, client],
    ),
    push: useCallback((taskId, head, url) => busy(setPushing, taskId, () => client.push(taskId, head, url)), [busy, client]),
    merge: useCallback((taskId, head, url) => busy(setMerging, taskId, () => client.merge(taskId, head, url)), [busy, client]),
    sendBack: useCallback(
      (task, note) =>
        busy(setSending, task.taskId, async () => {
          // A lead that stopped starts again, on the agent that led it, with the note as its first turn: queued first, so it reads it then.
          const head = await client.getThread(task.threadId, { limit: 0 })
          await client.send({ threadId: task.threadId, body: note, disposition: 'after_current' })
          if (head.session === null && task.lead !== null) await client.startSession({ threadId: task.threadId, agentId: task.lead })
        }),
      [busy, client],
    ),
    openChange: useCallback((taskId) => busy(setOpening, taskId, () => client.openChange(taskId)), [busy, client]),
    answer: useCallback(
      (attentionId, decision, reason) => client.answer({ attentionId, decision, ...(reason === undefined ? {} : { reason }) }).catch(fail),
      [client, fail],
    ),
    answerStuck: useCallback((attentionId, answer) => client.answerStuck({ attentionId, answer }).catch(fail), [client, fail]),
    fail,
    dismissError: useCallback(() => setError(null), []),
  }
}
