import { useQuery } from '@tanstack/react-query'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useModelNames } from '../../shared/modelNames'
import { homeGlanceOf } from '../home/glance'
import type { EdgeGlance } from './EdgePicture'

/*
 * What waits on the person and how much is in progress, as the home has it
 * now, for Settings' pictures of the edge of the screen: read as the home
 * reads it, without being the home, so looking at Settings is not looking
 * at the home. Undefined until it is read, where the pictures show a busy
 * moment instead.
 */
export const useEdgeGlance = (): EdgeGlance | undefined => {
  const { client } = useServices()
  const home = useQuery(reads(client).home()).data
  const agents = useQuery(reads(client).status()).data?.agents ?? []
  const named = useModelNames()
  if (home === undefined) return undefined
  return homeGlanceOf(home, {
    agentName: (id) => agents.find((agent) => agent.id === id)?.name ?? id ?? '',
    modelName: (agentId, model) => named(agentId, model).name,
  }).edge
}
