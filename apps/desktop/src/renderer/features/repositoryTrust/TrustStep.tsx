import { useState } from 'react'

import type { RepositoryAgentSettings } from '@althar/contracts'
import { RepositoryTrustStep } from '@althar/ui'

import { trustFileOf, useAgentSettings } from './useAgentSettings'

/*
 * Adding a project is where its repositories' own agent settings are
 * trusted (DEV-280): made, and before its tab opens on it, each repository
 * whose settings run something asks once, with what they run. Each answer
 * shows at once and goes on behind; with every one answered, the tab opens
 * on the project.
 */
export function TrustStep({
  projectId,
  project,
  repositories,
  onDone,
}: {
  projectId: string
  project: string
  /** Those with settings not decided on yet, as read once the project was made. */
  repositories: ReadonlyArray<RepositoryAgentSettings>
  /** Every one answered: the tab opens on the project. */
  onDone: () => void
}) {
  const model = useAgentSettings(projectId)
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  return (
    <RepositoryTrustStep
      project={project}
      repositories={repositories
        .filter((repository) => !answered.has(repository.repositoryId))
        .map((repository) => ({ id: repository.repositoryId, name: repository.name, files: repository.files.map(trustFileOf) }))}
      onAnswer={(repositoryId, trusted) => {
        const repository = repositories.find((one) => one.repositoryId === repositoryId)
        if (repository === undefined) return
        void model.decide(repository, trusted)
        const next = new Set(answered).add(repositoryId)
        setAnswered(next)
        if (repositories.every((one) => next.has(one.repositoryId))) onDone()
      }}
    />
  )
}
