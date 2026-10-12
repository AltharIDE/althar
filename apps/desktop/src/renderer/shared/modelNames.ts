import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { ModelInfo } from '@althar/ui'

import { useModels } from '../data/models'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { catalogOf, infoOf, viaOf } from './models'

/*
 * How every screen names who works (ADR-015): the model, as people know it,
 * with its maker's mark, and on hover the agent that runs it and, where
 * known, the account. An agent's own default is named as the model it
 * stands for; until the agent has said what it offers, the agent's name.
 */

/** A model's name from its agent and its id there; null for the agent's own. Null agent: nobody yet. */
export type NameModel = (agentId: string | null, model?: string | null, account?: string | null) => ModelInfo

const NOBODY: ModelInfo = { id: 'agent', name: '', short: '', runtime: 'agent', efforts: [] }

export const useModelNames = (): NameModel => {
  const { client } = useServices()
  const known = useModels()
  const agents = useQuery(reads(client).status()).data?.agents
  // Switched off or not, a session already on one is still named; by the model alone, the way is on hover.
  const catalog = useMemo(() => catalogOf(known ?? [], agents ?? [], { withBlocked: true, apart: false }), [known, agents])
  return useCallback(
    (agentId, model = null, account = null) => {
      if (agentId === null) return NOBODY
      const info = infoOf(catalog, { agentId, model })
      if (account === null) return info
      const agentName = catalog.runtimes.find((runtime) => runtime.id === agentId)?.name ?? agentId
      return { ...info, via: viaOf(agentName, account) }
    },
    [catalog],
  )
}
