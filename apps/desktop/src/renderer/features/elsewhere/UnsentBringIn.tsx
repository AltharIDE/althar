import { useState } from 'react'

import { NotBroughtIn } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import { unsent, useUnsent } from './unsent'

/*
 * A bringing in the runtime never got, said in the project's conversation as the runtime says what it got and couldn't
 * bring in (NotBroughtInOf): what was picked, by name, why it didn't go, and Try again. Gone through, the line goes; the
 * runtime says from then on what didn't come in.
 */
export function UnsentBringIn({ projectId, className }: { projectId: string; className?: string }) {
  const { client } = useServices()
  const kept = useUnsent(projectId)
  const [trying, setTrying] = useState(false)
  if (kept === undefined) return null
  const tryAgain = () => {
    setTrying(true)
    client.bringIn({ projectId, worktrees: kept.worktrees, setups: kept.setups, conversations: kept.conversations, steps: [] }).then(
      () => {
        setTrying(false)
        unsent.drop(projectId)
      },
      (failure: unknown) => {
        // Not gone through again: Try again stands, with why.
        setTrying(false)
        unsent.keep({ ...kept, why: messageOf(failure) })
      },
    )
  }
  return (
    <div className={className}>
      <NotBroughtIn
        title="Nothing picked from other tools came in"
        missed={kept.names.map((name) => ({ name, why: '' }))}
        onTryAgain={tryAgain}
        {...(trying ? { tried: 'trying' as const } : {})}
        error={trying ? null : kept.why}
      />
    </div>
  )
}
