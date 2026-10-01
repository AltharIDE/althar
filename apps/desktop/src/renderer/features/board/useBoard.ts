import { useCallback, useEffect, useRef, useState } from 'react'

import type { BoardSnapshot, BoardTask } from '@charrette/contracts'

import { messageOf, type StuckAnswer } from '../../data/client'
import { useServices, useWatch } from '../../data/services'

/*
 * A project's board: every task it hasn't settled, the most recently
 * settled, and every call that waits on the person, as the runtime reads them
 * in one go. It is read once, then again whenever anything of the project
 * changes, gathered a moment so a burst of changes reads once. From it the
 * person answers calls, accepts a pull request by merging it, or sends the
 * work back to its lead with a note.
 */

/** How long changes are gathered before the board is read again. */
const GATHER = 60

export interface BoardModel {
  readonly board: BoardSnapshot | null
  readonly error: string | null
  /** The task whose pull request is being merged. */
  readonly merging: string | null
  /** The task a note is on its way back to. */
  readonly sending: string | null
  /** Merges a ready task's pull request; whether it went through. */
  readonly merge: (taskId: string) => Promise<boolean>
  /** Sends a ready task back to its lead with a note, starting the lead again if it stopped; whether it went through. */
  readonly sendBack: (task: BoardTask, note: string) => Promise<boolean>
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  readonly answerStuck: (attentionId: string, answer: StuckAnswer) => Promise<void>
  readonly dismissError: () => void
}

export const useBoard = (projectId: string): BoardModel => {
  const { client } = useServices()
  const [board, setBoard] = useState<BoardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  // Watched from the first read on; later reads don't start the watch again.
  const [since, setSince] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const fail = useCallback((failure: unknown) => setError(messageOf(failure)), [])
  const read = useCallback(() => {
    timer.current = undefined
    client.getBoard(projectId).then((read) => {
      setBoard(read)
      setSince((first) => first ?? read.cursor)
    }, fail)
  }, [client, projectId, fail])

  useEffect(() => {
    read()
    return () => clearTimeout(timer.current)
  }, [read])

  useWatch((event) => {
    if (event._tag === 'Streaming' || event.projectId !== projectId) return
    timer.current ??= setTimeout(read, GATHER)
  }, since)

  return {
    board,
    error,
    merging,
    sending,
    merge: useCallback(
      async (taskId) => {
        setMerging(taskId)
        setError(null)
        try {
          await client.merge(taskId)
          return true
        } catch (failure) {
          fail(failure)
          return false
        } finally {
          setMerging(null)
        }
      },
      [client, fail],
    ),
    sendBack: useCallback(
      async (task, note) => {
        setSending(task.taskId)
        setError(null)
        try {
          // A lead that stopped starts again, on the agent that led it, to read the note.
          const head = await client.getThread(task.threadId, { limit: 0 })
          if (head.session === null && task.lead !== null) await client.startSession({ threadId: task.threadId, agentId: task.lead })
          await client.send({ threadId: task.threadId, body: note, disposition: 'after_current' })
          return true
        } catch (failure) {
          fail(failure)
          return false
        } finally {
          setSending(null)
        }
      },
      [client, fail],
    ),
    answer: useCallback(
      (attentionId, decision, reason) => client.answer({ attentionId, decision, ...(reason === undefined ? {} : { reason }) }).catch(fail),
      [client, fail],
    ),
    answerStuck: useCallback((attentionId, answer) => client.answerStuck({ attentionId, answer }).catch(fail), [client, fail]),
    dismissError: useCallback(() => setError(null), []),
  }
}
