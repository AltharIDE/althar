import { useQuery } from '@tanstack/react-query'

import type { BoardSnapshot } from '@althar/contracts'

import { messageOf } from '../../data/client'
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

export interface BoardModel extends WorkActions {
  readonly board: BoardSnapshot | null
}

export const useBoard = (projectId: string): BoardModel => {
  const { client } = useServices()
  const actions = useWorkActions()
  const read = useQuery(reads(client).board(projectId))
  return {
    ...actions,
    board: read.data ?? null,
    error: actions.error ?? (read.error === null ? null : messageOf(read.error)),
  }
}
