import { useRef, useState } from 'react'

import type { RepositoryAgentSettings } from '@althar/contracts'
import { RepositoryTrustStep } from '@althar/ui'

import { trustFileOf, useAgentSettings } from './useAgentSettings'

/*
 * Adding a project is where its repositories' own agent settings are
 * trusted (DEV-280): made, and before its tab opens on it, each repository
 * whose settings run something asks once, with what they run. An answer
 * shows at once, its card going; one that didn't save comes back, saying
 * why, to answer again. With every one saved, the tab opens on the project.
 * Where what they run couldn't be read, that is said, not taken for none:
 * try again, or open the project, its leads starting without them.
 */
export function TrustStep({
  projectId,
  project,
  repositories,
  unreadable,
  onDone,
}: {
  projectId: string
  project: string
  /** Those with settings not decided on yet, as read once the project was made. */
  repositories: ReadonlyArray<RepositoryAgentSettings>
  /** What they run couldn't be read: why, and reading it again. */
  unreadable?: { readonly error: string; readonly onRetry: () => void }
  /** Every one answered and saved, or opened as it is: the tab opens on the project. */
  onDone: () => void
}) {
  const model = useAgentSettings(projectId)
  // Answered, shown at once; saved, counted toward opening the project.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const saved = useRef(new Set<string>())
  return (
    <RepositoryTrustStep
      project={project}
      repositories={repositories
        .filter((repository) => !answered.has(repository.repositoryId))
        .map((repository) => ({
          id: repository.repositoryId,
          name: repository.name,
          files: repository.files.map(trustFileOf),
          ...(errors[repository.repositoryId] === undefined ? {} : { error: errors[repository.repositoryId] }),
        }))}
      onAnswer={(repositoryId, trusted) => {
        const repository = repositories.find((one) => one.repositoryId === repositoryId)
        if (repository === undefined) return
        setAnswered((was) => new Set(was).add(repositoryId))
        setErrors(({ [repositoryId]: _was, ...rest }) => rest)
        void model.decide(repository, trusted).then((error) => {
          if (error !== undefined) {
            // Not saved: its card stands again, with why.
            setAnswered((was) => new Set([...was].filter((id) => id !== repositoryId)))
            setErrors((was) => ({ ...was, [repositoryId]: error }))
            return
          }
          saved.current.add(repositoryId)
          if (repositories.every((one) => saved.current.has(one.repositoryId))) onDone()
        })
      }}
      {...(unreadable === undefined ? {} : { unreadable: { ...unreadable, onOpen: onDone } })}
    />
  )
}
