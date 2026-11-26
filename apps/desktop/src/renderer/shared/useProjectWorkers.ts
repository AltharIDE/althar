import { useQuery } from '@tanstack/react-query'

import type { ProjectWorker } from '@althar/contracts'

import { useServices } from '../data/services'

const NONE: ReadonlyArray<ProjectWorker> = []

/**
 * The project's workers as the home lists them now (ADR-103), each with what its own check found and what the project
 * needs that it lacks: read every few seconds while shown, one read for every view of the project.
 */
export const useProjectWorkers = (projectId: string | undefined): ReadonlyArray<ProjectWorker> => {
  const { client } = useServices()
  return (
    useQuery({
      queryKey: ['project-workers', projectId],
      queryFn: () => client.listProjectWorkers(projectId ?? ''),
      enabled: projectId !== undefined,
      retry: false,
      refetchInterval: 5000,
    }).data ?? NONE
  )
}
