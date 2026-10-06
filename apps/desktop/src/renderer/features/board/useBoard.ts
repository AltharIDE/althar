import { useCallback, useEffect, useRef, useState } from 'react'

import type { BoardSnapshot } from '@althar/contracts'

import { newestReads } from '../../shared/items'
import { useServices, useWatch } from '../../data/services'
import { type WorkActions, useWorkActions } from './useWorkActions'

/*
 * A project's board: every task it hasn't settled, the most recently
 * settled, and every call that waits on the person, as the runtime reads them
 * in one go. It is read once, then again whenever something it shows changes,
 * gathered a moment so a burst of changes reads once. From it the
 * person answers calls, accepts a pull request by merging it, or sends the
 * work back to its lead with a note.
 */

/** How long changes are gathered before the board is read again. */
export const GATHER = 60

/**
 * What changes what the board shows: a task, its plan, run, steps and
 * sessions, an agent's turn starting or ending, a call, a pull request, a
 * worktree. Not what is said in a thread, which changes far more often and
 * none of this.
 */
export const BOARD = new Set([
  'task',
  'task_plan',
  'run',
  'node_attempt',
  'provider_session',
  'turn_delivery',
  'attention_request',
  'external_link',
  'workspace',
])

export interface BoardModel extends WorkActions {
  readonly board: BoardSnapshot | null
}

export const useBoard = (projectId: string): BoardModel => {
  const { client } = useServices()
  const actions = useWorkActions()
  const [board, setBoard] = useState<BoardSnapshot | null>(null)
  // Watched from the first read on; later reads don't start the watch again.
  const [since, setSince] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [newest] = useState(newestReads)

  const { fail } = actions
  const read = useCallback(() => {
    timer.current = undefined
    void newest(
      'board',
      client.getBoard(projectId),
      (read) => {
        setBoard(read)
        setSince((first) => first ?? read.cursor)
      },
      fail,
    )
  }, [client, projectId, newest, fail])

  useEffect(() => {
    read()
    return () => clearTimeout(timer.current)
  }, [read])

  useWatch((event) => {
    if (event._tag === 'Streaming' || event.projectId !== projectId || !BOARD.has(event.aggregateType)) return
    timer.current ??= setTimeout(read, GATHER)
  }, since)

  return { board, ...actions }
}
