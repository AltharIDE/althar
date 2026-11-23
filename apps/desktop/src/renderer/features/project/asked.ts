import type { QueryClient } from '@tanstack/react-query'

import type { BoardSnapshot } from '@althar/contracts'

import { keys } from '../../data/reads'
import { opensInPlace } from './Asides'

/**
 * Whether a prompt a thread raised itself (a permission, a question) leaves the window where it is: the thread is an aside,
 * open over the coordinator's conversation or listed on Scratch, so its prompt shows there. Read from the boards the window holds.
 */
export const staysInPlace = (cache: QueryClient, threadId: string) =>
  cache
    .getQueriesData<BoardSnapshot>({ queryKey: keys.board('').slice(0, 1) })
    .some(([, board]) => board?.tasks.some((task) => task.threadId === threadId && opensInPlace(task)) === true)
