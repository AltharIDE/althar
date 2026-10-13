import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { BoardSnapshot, BoardTask } from '@althar/contracts'

import { type Client, messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { type WorkActions, useWorkActions } from './useWorkActions'

/*
 * A project's board: every task it hasn't settled, the most recently
 * settled, and every call that waits on the person, as the runtime reads them
 * in one go. The window keeps it, and reads it again whenever something it
 * shows changes (`BOARD`, in the window's feed). From it the person answers
 * calls, accepts a pull request by merging it, or sends the work back to its
 * lead with a note.
 */

/** Reads ahead the head of every ready task with a pull request, as the board stands, so its dock opens with its files. */
export const readHeadsAhead = (client: Client, cache: QueryClient, board: BoardSnapshot | null) => {
  for (const task of board?.tasks ?? [])
    if (task.phase === 'ready' && task.change !== null) void cache.prefetchQuery(reads(client).head(task.threadId, board?.cursor ?? 0))
}

export interface BoardModel extends WorkActions {
  /** The board as read, with the older settled tasks the person asked for added to its tasks. */
  readonly board: BoardSnapshot | null
  /** Whether settled tasks remain that the board hasn't loaded. */
  readonly moreSettled: boolean
  /** Loads the next page of settled tasks, older than the oldest it shows. */
  readonly showOlder: () => void
}

/** Settled tasks, most recent first. */
const recentFirst = (a: BoardTask, b: BoardTask) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '') || b.taskId.localeCompare(a.taskId)

export const useBoard = (projectId: string): BoardModel => {
  const { client, cache } = useServices()
  const actions = useWorkActions()
  const read = useQuery(reads(client).board(projectId))
  const [older, setOlder] = useState<{ readonly projectId: string; readonly tasks: ReadonlyArray<BoardTask> }>({ projectId, tasks: [] })
  const [olderError, setOlderError] = useState<string | null>(null)
  const snapshot = read.data ?? null
  // Settled work doesn't change: what was loaded stays, unless the snapshot has the task again (reopened, or now among the most recent).
  const board = useMemo(() => {
    if (snapshot === null) return null
    const have = new Set(snapshot.tasks.map((task) => task.taskId))
    const more = older.projectId === projectId ? older.tasks.filter((task) => !have.has(task.taskId)) : []
    return more.length === 0 ? snapshot : { ...snapshot, tasks: [...snapshot.tasks, ...more] }
  }, [snapshot, older, projectId])
  const settled = board?.tasks.filter((task) => task.phase === 'settled').toSorted(recentFirst) ?? []
  const oldest = settled.at(-1)
  const showOlder = () => {
    if (oldest?.settledAt == null) return
    setOlderError(null)
    client.getOlderSettled(projectId, oldest.settledAt, oldest.taskId).then(
      (page) => setOlder((now) => ({ projectId, tasks: [...(now.projectId === projectId ? now.tasks : []), ...page] })),
      (error: unknown) => setOlderError(messageOf(error)),
    )
  }
  useEffect(() => readHeadsAhead(client, cache, board), [client, cache, board])
  return {
    ...actions,
    board,
    moreSettled: board !== null && settled.length < board.settledTotal,
    showOlder,
    error: actions.error ?? olderError ?? (read.error === null ? null : messageOf(read.error)),
  }
}
