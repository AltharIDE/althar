import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { ConnectionList, ProjectRepository, Service } from '@althar/contracts'
import { RepositoryClone } from '@althar/ui'

import { useServices } from '../../data/services'
import { HOST_SERVICES, useHostRepositories } from '../../shared/hostRepositories'
import { ConnectInPlace } from '../newProject/SetupSide'
import type { RepositoriesModel } from './useRepositories'

/*
 * A repository cloned into a project that has some already, as a new
 * project clones one: the person's own on the code hosts connected, or one
 * a URL pasted names, into the usual place unless they choose another.
 * Those the project has already aren't offered again. Clone puts it away at
 * once, the repository waiting where it goes on the map while it is cloned.
 */

/** Where the clone place is kept, as a new project reads it: once a window. */
const CLONE_PLACE = ['clone-place'] as const

export function CloneInto({
  model,
  list,
  have,
  onDone,
}: {
  model: Pick<RepositoriesModel, 'clone'>
  /** The code hosts connected, whose repositories are offered. */
  list: ConnectionList | null
  /** The project's repositories, not offered again. */
  have: ReadonlyArray<ProjectRepository>
  /** Cloning it, or put away. */
  onDone: () => void
}) {
  const { host: system } = useServices()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Service | null>(null)
  const [place, setPlace] = useState<{ readonly grant: string; readonly where: string } | null>(null)
  const usual = useQuery({ queryKey: CLONE_PLACE, queryFn: () => system.clonePlace(), staleTime: Infinity })
  const into = place ?? usual.data ?? null
  const found = useHostRepositories(list, query)
  const had = new Set(
    have.flatMap((repository) => (repository.host === null ? [] : [repository.host.path.replace(/\.git$/, '').toLowerCase()])),
  )
  const repositories = found.repositories?.filter((one) => !had.has(`${one.owner}/${one.name}`.toLowerCase())) ?? found.repositories
  const choice = chosen === null ? null : found.cloneOf(chosen)

  const where = async () => {
    const picked = await system.pickClonePlace()
    if (picked !== null) setPlace(picked)
    return picked
  }

  return (
    <RepositoryClone
      hosts={found.hosts}
      repositories={repositories}
      failed={found.failed}
      onRetry={found.retry}
      query={query}
      onQuery={setQuery}
      pasted={found.pasted}
      chosen={choice === null ? null : chosen}
      onChoose={setChosen}
      onConnect={(service) => setConnecting(service as Service)}
      connecting={
        connecting !== null && HOST_SERVICES.includes(connecting) ? (
          <ConnectInPlace service={connecting} onDone={() => setConnecting(null)} />
        ) : null
      }
      where={into?.where ?? null}
      // oxlint-disable-next-line althar/press-at-once -- The system's folder picker is what the press shows, at once.
      onWhere={() => void where()}
      // oxlint-disable-next-line althar/press-at-once -- With nowhere to clone to, the system's folder picker is what the press shows, at once; else it is put away and the clone shows on the map.
      onClone={() => {
        if (choice === null) return
        // Nowhere usual and none chosen: the person is asked first, and nothing is cloned if they cancel.
        if (into === null && choice.here === null) {
          void where().then((picked) => {
            if (picked === null) return
            onDone()
            void model.clone(choice, picked)
          })
          return
        }
        onDone()
        void model.clone(choice, into)
      }}
      onCancel={onDone}
    />
  )
}
