import { useState } from 'react'

import { NotBroughtIn } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { Offer } from '../../shared/thread'

/*
 * What was picked to bring in from other tools and didn't come in, as the project's conversation says it (Elsewhere.ts): each
 * by name and why. Try again brings in what another try could, at once said under way; the runtime says in a new line what
 * still didn't come in, and twice is once, so a second press brings nothing twice.
 */
export function NotBroughtInOf({ offer, title }: { offer: Extract<Offer, { kind: 'bring_in' }>; title: string }) {
  const { client } = useServices()
  const [tried, setTried] = useState<'trying' | 'tried' | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const some = offer.worktrees.length + offer.setups.length + offer.conversations.length > 0
  const tryAgain = () => {
    setTried('trying')
    setError(null)
    client
      .bringIn({
        projectId: offer.projectId,
        worktrees: offer.worktrees,
        setups: offer.setups,
        conversations: offer.conversations,
        steps: [],
      })
      .then(
        () => setTried('tried'),
        (failure: unknown) => {
          // Not gone through: Try again stands again, with why.
          setTried(undefined)
          setError(messageOf(failure))
        },
      )
  }
  return (
    <NotBroughtIn
      title={title}
      missed={offer.missed}
      {...(some ? { onTryAgain: tryAgain } : {})}
      {...(tried === undefined ? {} : { tried })}
      error={error}
    />
  )
}
