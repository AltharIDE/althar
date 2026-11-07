import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { PlanUsage, SignInEnding as Ending } from '@althar/contracts'
import { SignInEnds } from '@althar/ui'

import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import { useSettingsWays } from '../settings/open'
import { clock, useNow } from '../../shared/time'
import { usePlanUsage } from './usePlan'

/** Whose sign-in, as the glossary names an account: the agent, then the account where it has several, Claude Code (work). */
export const whoseOf = (ending: Ending): string => (ending.several ? `${ending.agentName} (${ending.accountName})` : ending.agentName)

/** A warning as put aside here: by its sign-in and its stage, so the next stage the runtime raises shows again. */
const asideKey = (ending: Ending) => `${ending.accountId}\u0000${ending.endsAt}\u0000${ending.stage}`

/** The warning the window shows: the soonest the runtime raised that wasn't put aside here meanwhile; none while every sign-in is far from its end. */
export const shownOf = (usage: PlanUsage | null, aside: ReadonlySet<string>): Ending | undefined =>
  usage?.endings?.find((ending) => !aside.has(asideKey(ending)))

/**
 * An agent's sign-in that ends within its last days, in the window's bar
 * beside an update's line (DEV-196): raised by the runtime with plan usage,
 * once at each stage of a sign-in's end. Sign in again opens the agent's tab in Settings with
 * that account's sign-in started; putting it aside is kept, and it goes at
 * once. Nothing shows while all is well.
 */
export function SignInEnding() {
  const { client } = useServices()
  const cache = useQueryClient()
  const usage = usePlanUsage()
  const ways = useSettingsWays()
  // When it ends, written again each minute: today's time, a weekday's, or a date.
  const now = useNow(true, 60_000)
  const [aside, setAside] = useState<ReadonlySet<string>>(new Set())
  const ending = shownOf(usage, aside)
  if (ending === undefined) return null
  return (
    <SignInEnds
      whose={whoseOf(ending)}
      {...(ending.stage === 'ended' ? {} : { when: clock(ending.endsAt, new Date(now)) })}
      onSignIn={() => ways.signIn(ending.agentId, ending.accountId)}
      onDismiss={() => {
        setAside((was) => new Set([...was, asideKey(ending)]))
        // Kept by the runtime, which tells plan usage again without it; one that didn't keep comes back as it does.
        void client.dismissSignInEnding(ending.accountId, ending.endsAt, ending.stage).catch(() => {
          setAside((was) => new Set([...was].filter((key) => key !== asideKey(ending))))
          void cache.invalidateQueries({ queryKey: keys.planUsage, exact: true })
        })
      }}
    />
  )
}
