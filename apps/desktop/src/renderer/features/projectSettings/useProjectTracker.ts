import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ConnectionList, ProjectTracker, TrackerContainer } from '@althar/contracts'
import type { ContainerChoice, TrackerChoice } from '@althar/ui'

import { productBrand } from '../../shared/products'
import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { hostOf } from '../connections/ways'

/*
 * The tracker a project is bound to (ADR-059), as its settings change it:
 * one of the trackers connected, each told by its workspace or its site, and
 * where on it its drafts are filed. A choice shows at once and goes to the
 * runtime; one that didn't hold goes back, and says why. Unset, where its
 * issues go is learned from those it has.
 */

export interface ProjectTrackerModel {
  readonly trackers: ReadonlyArray<TrackerChoice>
  /** The connection it is bound to; null for none. */
  readonly value: string | null
  readonly container: ContainerChoice | null
  /** Where on the one bound issues can be filed; null while they are read, or where it is bound to none. */
  readonly containers: ReadonlyArray<ContainerChoice> | null
  readonly choose: (connectionId: string | null) => void
  readonly chooseContainer: (container: ContainerChoice | null) => void
  /** Why the last choice didn't hold. */
  readonly failed: string | null
}

/** A team as it is offered: its key, and its name where that says more. */
const choiceOf = (container: TrackerContainer): ContainerChoice => ({
  id: container.id,
  label: container.key === null || container.key === container.name ? container.name : `${container.key} (${container.name})`,
})

/** The trackers that file issues, each one connection: Linear · FNT, Jira · acme.atlassian.net, or the service alone. */
export const trackerChoices = (list: ConnectionList | null): ReadonlyArray<TrackerChoice> =>
  (list?.connections ?? []).flatMap((connection) => {
    const product = list?.products.find((option) => option.product === connection.product)
    if (product === undefined || !product.tracker || product.host) return []
    const which =
      connection.workspace !== undefined && connection.workspace !== null
        ? connection.workspace.name
        : connection.webUrl === product.hostedUrl
          ? null
          : hostOf(connection.webUrl)
    return [
      { id: connection.id, label: which === null ? product.name : `${product.name} · ${which}`, brand: productBrand(connection.product) },
    ]
  })

export const useProjectTracker = (projectId: string, list: ConnectionList | null): ProjectTrackerModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const key = keys.projectTracker(projectId)
  const bound = useQuery(read.projectTracker(projectId)).data ?? null
  const trackers = trackerChoices(list)
  const value = bound !== null && trackers.some((tracker) => tracker.id === bound.connectionId) ? bound.connectionId : null
  const listed = useQuery({ ...read.containers(value ?? ''), enabled: value !== null }).data
  const [failed, setFailed] = useState<string | null>(null)

  const save = useCallback(
    (next: ProjectTracker | null) => {
      setFailed(null)
      const was = cache.getQueryData<ProjectTracker | null>(key)
      cache.setQueryData<ProjectTracker | null>(key, next)
      void client.setProjectTracker(projectId, next).then(
        () => cache.invalidateQueries({ queryKey: key, exact: true }),
        (error: unknown) => {
          cache.setQueryData(key, was ?? null)
          setFailed(messageOf(error))
        },
      )
    },
    [cache, client, key, projectId],
  )

  return {
    trackers,
    value,
    container: bound?.container === undefined || bound.container === null ? null : { id: bound.container.id, label: bound.container.name },
    containers: value === null || listed === undefined ? null : listed.map(choiceOf),
    choose: (connectionId) => save(connectionId === null ? null : { connectionId, container: null }),
    chooseContainer: (container) => {
      if (value === null) return
      const named = listed?.find((one) => one.id === container?.id)
      save({ connectionId: value, container: container === null ? null : { id: container.id, name: named?.name ?? container.label } })
    },
    failed,
  }
}
