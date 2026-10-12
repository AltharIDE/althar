import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { ModelInfo } from '@althar/ui'

import { useModels } from '../data/models'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { catalogOf, effortName, infoOf, viaOf } from './models'

/*
 * How every screen names who works (ADR-015): the model, as people know it,
 * with its maker's mark, and on hover the agent that runs it and, where
 * known, the account. An agent's own default is named as the model it
 * stands for; until the agent has said what it offers, the agent's name.
 * How hard it thinks is named as the model picker names it.
 */

/** A model's name from its agent and its id there; null for the agent's own. Null agent: nobody yet. */
export type NameModel = (agentId: string | null, model?: string | null, account?: string | null) => ModelInfo

/** An effort's name, as the picker shows it, from its agent, its model there and its id; null where it has none, or isn't known yet. */
export type NameEffort = (agentId: string | null, model: string | null, effort: string | null) => string | null

const NOBODY: ModelInfo = { id: 'agent', name: '', short: '', runtime: 'agent', efforts: [] }

/** Every agent's models, switched off or not: a session already on one is still named; by the model alone, the way is on hover. */
const useNamingCatalog = () => {
  const { client } = useServices()
  const known = useModels()
  const agents = useQuery(reads(client).status()).data?.agents
  return useMemo(() => catalogOf(known ?? [], agents ?? [], { withBlocked: true, apart: false }), [known, agents])
}

export const useEffortNames = (): NameEffort => {
  const catalog = useNamingCatalog()
  return useCallback(
    (agentId, model, effort) =>
      agentId === null || effort === null ? null : effortName(catalog, infoOf(catalog, { agentId, model }).id, effort),
    [catalog],
  )
}

export const useModelNames = (): NameModel => {
  const catalog = useNamingCatalog()
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
