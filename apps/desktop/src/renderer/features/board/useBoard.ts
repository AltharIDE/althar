import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { BoardSnapshot } from '@althar/contracts'

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
  readonly board: BoardSnapshot | null
}

export const useBoard = (projectId: string): BoardModel => {
  const { client, cache } = useServices()
  const actions = useWorkActions()
  const read = useQuery(reads(client).board(projectId))
  const board = read.data ?? null
  useEffect(() => readHeadsAhead(client, cache, board), [client, cache, board])
  return {
    ...actions,
    board,
    error: actions.error ?? (read.error === null ? null : messageOf(read.error)),
  }
}
