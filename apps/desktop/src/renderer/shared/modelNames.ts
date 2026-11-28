import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { LaunchStep, ModelInfo } from '@althar/ui'

import { useModels } from '../data/models'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { type PickOn, catalogOf, effortName, infoOf, nameOf, onWorker, startEffortOf, viaOf } from './models'

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
const useNaming = () => {
  const { client } = useServices()
  const known = useModels()
  const agents = useQuery(reads(client).status()).data?.agents
  return useMemo(() => {
    const of = (offered: Parameters<typeof catalogOf>[0], by: Parameters<typeof catalogOf>[1]) =>
      catalogOf(offered, by, { withBlocked: true, apart: false })
    return {
      home: of(known ?? [], agents ?? []),
      /** What a worker offers, by its own check. */
      on: (worker: PickOn) => {
        const there = onWorker(known ?? [], agents ?? [], worker)
        return of(there.known, there.agents)
      },
    }
  }, [known, agents])
}

const useNamingCatalog = () => useNaming().home

export const useEffortNames = (): NameEffort => {
  const catalog = useNamingCatalog()
  return useCallback(
    (agentId, model, effort) =>
      agentId === null || effort === null ? null : effortName(catalog, infoOf(catalog, { agentId, model }).id, effort),
    [catalog],
  )
}

/** Where a step runs when not on the home: on a worker, or on whichever is free, with none named. */
export interface Elsewhere {
  readonly worker?: PickOn | undefined
}

/** A plan step's efforts by name: the one set for it, and the one it runs at with none set; each null where that can't be known. */
export type NameStepEfforts = (
  agentId: string,
  model: string | null,
  effort: string | null,
  elsewhere?: Elsewhere,
) => Pick<LaunchStep, 'effort' | 'defaultEffort'>

export const useStepEfforts = (): NameStepEfforts => {
  const naming = useNaming()
  return useCallback(
    (agentId, model, effort, elsewhere) => {
      const there = elsewhere?.worker === undefined ? naming.home : naming.on(elsewhere.worker)
      const named = (catalog: typeof there) => effortName(catalog, infoOf(catalog, { agentId, model }).id, effort)
      return {
        effort: named(there) ?? named(naming.home),
        // Elsewhere with no model named, it starts on whatever its agent there starts on, which isn't known here.
        defaultEffort: elsewhere !== undefined && model === null ? null : startEffortOf(there, infoOf(there, { agentId, model })),
      }
    },
    [naming],
  )
}

export const useModelNames = (): NameModel => {
  const catalog = useNamingCatalog()
  return useCallback(
    (agentId, model = null, account = null) => {
      if (agentId === null) return NOBODY
      const info = infoOf(catalog, { agentId, model })
      if (account === null) return info
      // Keep the way it goes (OpenCode Go) under the account the line names.
      const agentName = catalog.runtimes.find((runtime) => runtime.id === agentId)?.name ?? agentId
      const route = info.via?.startsWith('via ') ? info.via.slice(4) : agentName
      return { ...info, via: viaOf(route, account) }
    },
    [catalog],
  )
}

/** The provider within an agent that a model goes through, as the agent names it (`OpenCode Go`); its id where the agent doesn't list the model. */
export type NameProvider = (agentId: string | null, model: string | null, provider: string) => string

export const useProviderNames = (): NameProvider => {
  const known = useModels()
  return useCallback(
    (agentId, model, provider) => {
      const offered = known?.find((each) => each.agentId === agentId)?.models.find((each) => each.id === model)
      return (offered === undefined ? undefined : nameOf('', offered).provider) ?? provider
    },
    [known],
  )
}
