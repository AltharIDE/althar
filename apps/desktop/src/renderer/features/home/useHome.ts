import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

import type { BoardSnapshot, HomeSnapshot } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { homeSince, keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { readHeadsAhead } from '../board/useBoard'
import { type WorkActions, useWorkActions } from '../board/useWorkActions'

/*
 * The home's view model: every project, and across them what waits on the
 * person, what runs, and what the loop did since they last left the home.
 * The window keeps it, and reads it again whenever something it shows
 * changes, in any project (`HOME`, in the window's feed). What the loop did
 * is read from one moment for as long as the home is open, so nothing the
 * person hasn't seen goes while they look; on leaving, the runtime is told,
 * and the home is read again from then, ready for the next visit. Its
 * screen stays while the person is elsewhere (`KeptScreens`), hidden and
 * doing nothing: hiding is leaving, and showing again is opening.
 */

export interface HomeModel extends WorkActions {
  readonly home: HomeSnapshot | null
  /** The home's tasks and calls as a board, for the dock, which acts on either. */
  readonly board: BoardSnapshot | null
}

export const useHome = (): HomeModel => {
  const { client, cache } = useServices()
  const read = useQuery(reads(client).home())
  // A press's card stays busy until the home is read again after its answer: begun then, whatever was under way.
  const readAgain = useCallback(
    () => cache.refetchQueries({ queryKey: keys.home, exact: true }).then(() => cache.getQueryData<HomeSnapshot>(keys.home)?.tasks),
    [cache],
  )
  const actions = useWorkActions(read.data?.tasks ?? null, readAgain)
  const { over } = actions
  const readHome = read.data ?? null
  // The home as the person's presses left it: a card Done or kept for later moved at once.
  const home = useMemo(() => (readHome === null ? null : { ...readHome, tasks: over(readHome.tasks) }), [readHome, over])

  // What the loop did is read from where the read the home opened on started, as long as it is open. Shown again while
  // the home is read anew from when the person left, from where that read starts.
  const fetching = read.isFetching
  useEffect(() => {
    if (home !== null && !fetching) homeSince(client).since ??= home.since
  }, [client, home, fetching])

  // Leaving the home, or the window going, is when the person last looked.
  useEffect(() => {
    const left = () => void client.leftHome().catch(() => undefined)
    window.addEventListener('pagehide', left)
    return () => {
      window.removeEventListener('pagehide', left)
      homeSince(client).since = undefined
      // Kept hidden while the person is elsewhere (KeptScreens, React's Activity), the home hears nothing. Stale at once,
      // so that showing it again reads it anew, as it is: not once the runtime answers, which may be after they are back.
      void cache.invalidateQueries({ queryKey: keys.home, refetchType: 'none' })
      void client.leftHome().then(
        () => cache.invalidateQueries({ queryKey: keys.home, refetchType: 'all' }),
        () => undefined,
      )
    }
  }, [client, cache])

  const board = useMemo(
    () => (home === null ? null : { cursor: home.cursor, tasks: home.tasks, calls: home.calls, settledTotal: 0 }),
    [home],
  )
  useEffect(() => readHeadsAhead(client, cache, board), [client, cache, board])

  return {
    ...actions,
    error: actions.error ?? (read.error === null ? null : messageOf(read.error)),
    home,
    board,
  }
}
