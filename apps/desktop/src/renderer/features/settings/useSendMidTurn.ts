import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * What sending does while an agent is mid-turn, as Settings shows and changes it: queue the message for the turn's end,
 * its default, or steer the agent with it at once. A change shows at once; one the runtime can't keep reads again what it kept.
 */

export type SendMidTurn = 'queue' | 'steer'

export interface SendMidTurnModel {
  readonly to: SendMidTurn
  readonly failed: boolean
  readonly set: (to: SendMidTurn) => void
}

/** Null until the settings are read. */
export const useSendMidTurn = (): SendMidTurnModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  const made = useRef(0)

  const set = useCallback(
    (to: SendMidTurn) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, sendMidTurn: to }))
      setFailed(false)
      client.setSendMidTurn(to).then(
        () => undefined,
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { to: settings.sendMidTurn ?? 'queue', failed, set }
}
