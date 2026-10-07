import { useCallback, useEffect, useRef, useState } from 'react'

import type { BoardSnapshot, HomeSnapshot } from '@althar/contracts'

import { useServices, useWatch } from '../../data/services'
import { newestReads } from '../../shared/items'
import { BOARD, GATHER } from '../board/useBoard'
import { type WorkActions, useWorkActions } from '../board/useWorkActions'

/*
 * The home's view model: every project, and across them what waits on the
 * person, what runs, and what the loop did since they last left the home.
 * It is read once, then again whenever something it shows changes, in any
 * project. What the loop did is read from one moment for as long as the
 * home is open, so nothing the person hasn't seen goes while they look; on
 * leaving, the runtime is told, and the next visit starts from then.
 */

/** What changes the home: what changes a board, and the projects themselves. */
const HOME = new Set([...BOARD, 'project', 'decision'])

export interface HomeModel extends WorkActions {
  readonly home: HomeSnapshot | null
  /** The home's tasks and calls as a board, for the dock, which acts on either. */
  readonly board: BoardSnapshot | null
}

export const useHome = (): HomeModel => {
  const { client } = useServices()
  const actions = useWorkActions()
  const [home, setHome] = useState<HomeSnapshot | null>(null)
  const [since, setSince] = useState<number | null>(null)
  // What the loop did is read from where the first read started, as long as the home is open.
  const from = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [newest] = useState(newestReads)

  const { fail } = actions
  const read = useCallback(() => {
    timer.current = undefined
    void newest(
      'home',
      client.getHome(from.current),
      (read) => {
        from.current ??= read.since
        setHome(read)
        setSince((first) => first ?? read.cursor)
      },
      fail,
    )
  }, [client, newest, fail])

  useEffect(() => {
    read()
    return () => clearTimeout(timer.current)
  }, [read])

  // Leaving the home, or the window going, is when the person last looked.
  useEffect(() => {
    const left = () => void client.leftHome().catch(() => undefined)
    window.addEventListener('pagehide', left)
    return () => {
      window.removeEventListener('pagehide', left)
      left()
    }
  }, [client])

  useWatch((event) => {
    if (event._tag === 'Streaming' || !HOME.has(event.aggregateType)) return
    timer.current ??= setTimeout(read, GATHER)
  }, since)

  return {
    home,
    board: home === null ? null : { cursor: home.cursor, tasks: home.tasks, calls: home.calls },
    ...actions,
  }
}
