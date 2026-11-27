import { useState } from 'react'

import { RepositoryTrustLine } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import type { Offer } from '../../shared/thread'
import { trustFileOf } from './useAgentSettings'

/*
 * A task's one quiet line where its lead started without its repository's
 * agent settings (sessionConnections.ts, DEV-280). Review shows what they
 * run, as the lead's folder has them, to trust them or go on without:
 * answered, it says so at once, and its next session starts as decided.
 */
export function AgentSettingsLineOf({ offer, title }: { offer: Extract<Offer, { kind: 'agent_settings' }>; title: string }) {
  const { client, cache } = useServices()
  const [answered, setAnswered] = useState<'trusted' | 'without' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const decide = (trusted: boolean) => {
    setAnswered(trusted ? 'trusted' : 'without')
    setError(undefined)
    client.decideAgentSettings({ projectId: offer.projectId, repositoryId: offer.repositoryId, trusted, files: offer.files }).then(
      () => cache.invalidateQueries({ queryKey: keys.agentSettings(offer.projectId), exact: true }),
      (failure: unknown) => {
        // Not gone through: Review stands again, with why.
        setAnswered(undefined)
        setError(messageOf(failure))
      },
    )
  }
  return (
    <RepositoryTrustLine
      title={title}
      repository={offer.repository}
      files={offer.files.map(trustFileOf)}
      {...(answered === undefined ? {} : { answered })}
      {...(error === undefined ? {} : { error })}
      onTrust={() => decide(true)}
      onWithout={() => decide(false)}
    />
  )
}
