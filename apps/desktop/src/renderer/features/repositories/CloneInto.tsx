import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { ConnectionList, ProjectRepository, RepositoryHost, Service } from '@althar/contracts'
import { type HostedRepository, RepositoryClone } from '@althar/ui'

import { useServices } from '../../data/services'
import { type CloneChoice, checkoutOf, HOST_SERVICES, sameRepository, useHostRepositories } from '../../shared/hostRepositories'
import { hostnameOf } from '../../shared/remotes'
import { ConnectInPlace } from '../newProject/SetupSide'
import type { RepositoriesModel } from './useRepositories'

/*
 * A repository cloned into a project that has some already, as a new
 * project clones one: the person's own on the code hosts connected, or one
 * a URL pasted names, into the usual place unless they choose another.
 * Those the project has already, the same path on the same host, aren't
 * offered again. One of the same name on this computer is offered to add
 * from where it is only once it is read to be the same repository; until
 * then, and where it isn't, it is cloned like any other. What the panel
 * shows is what Clone (or Add) does: it puts the panel away at once, the
 * repository waiting where it goes on the map until it joins them.
 */

/** Where the clone place is kept, as a new project reads it: once a window. */
const CLONE_PLACE = ['clone-place'] as const

/** The address a project's repository's host is at, as a remote names it: github.com, gitlab.example.com. */
const addressOf = (host: RepositoryHost) => (host.url !== null ? hostnameOf(host.url) : (host.instance ?? host.name).toLowerCase())

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
  const { client, host: system } = useServices()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Service | null>(null)
  const [place, setPlace] = useState<{ readonly grant: string; readonly where: string } | null>(null)
  const usual = useQuery({ queryKey: CLONE_PLACE, queryFn: () => system.clonePlace(), staleTime: Infinity })
  const into = place ?? usual.data ?? null
  const found = useHostRepositories(list, query)
  const had = have.flatMap((repository) =>
    repository.host === null ? [] : [{ host: addressOf(repository.host), remote: repository.host.path }],
  )
  const choiceOf = (one: HostedRepository) => found.cloneOf(one.id)
  const listed = (found.repositories ?? []).flatMap((one) => {
    const choice = choiceOf(one)
    return choice !== null && had.some((kept) => sameRepository(kept, choice)) ? [] : [{ one, choice }]
  })
  const pasted = found.pasted === null ? null : { one: found.pasted, choice: choiceOf(found.pasted) }
  // Each of the same name as one on this computer, read for whether it is that one: its grant where it is.
  const named = [...listed, ...(pasted === null ? [] : [pasted])].flatMap(({ choice }) => (choice?.here == null ? [] : [choice]))
  const checked = useQueries({
    queries: named.map((choice) => ({
      queryKey: ['found-checkout', choice.id, choice.here?.found ?? ''],
      queryFn: () => checkoutOf(choice, system, client),
      staleTime: 60_000,
    })),
  })
  const checkoutFor = (id: string) => {
    const at = named.findIndex((choice) => choice.id === id)
    return at === -1 ? null : (checked[at]?.data ?? null)
  }
  // Shown at its checkout exactly where it is read to be that repository, as Clone then adds it: else, cloned as any other.
  // A pasted URL's row, made up where the host's list hasn't it, takes its checkout from the same reading.
  const shown = ({ one, choice }: { readonly one: HostedRepository; readonly choice: CloneChoice | null }): HostedRepository => {
    const at = choice?.here != null && checkoutFor(choice.id) !== null ? choice.here.where : null
    return one.here === at ? one : { ...one, here: at }
  }
  const repositories = found.repositories === null ? null : listed.map(shown)
  const choice = chosen === null ? null : found.cloneOf(chosen)
  const checkout = choice === null ? null : checkoutFor(choice.id)

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
      pasted={pasted === null ? null : shown(pasted)}
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
        if (checkout !== null && choice.here !== null) {
          onDone()
          void model.clone(choice, { checkout, where: choice.here.where })
          return
        }
        if (into !== null) {
          onDone()
          void model.clone(choice, into)
          return
        }
        // Nowhere usual and none chosen: the person is asked first, the panel staying, and nothing is cloned if they cancel.
        void where().then((picked) => {
          if (picked === null) return
          onDone()
          void model.clone(choice, picked)
        })
      }}
      onCancel={onDone}
    />
  )
}
