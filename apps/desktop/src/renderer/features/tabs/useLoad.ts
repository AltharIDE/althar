import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { Load, LoadShare } from '@althar/contracts'
import { type LoadGlance, type LoadMeterText, MemoryPressure, Room } from '@althar/ui'

import { useServices } from '../../data/services'
import { brandOf } from '../../shared/agents'
import { device } from '../../shared/device'
import { usePreferences } from '../../shared/usePreferences'

/*
 * How hard this computer works, for the meter in the window's bar: the
 * runtime's reading (`GetLoad`), asked for every three seconds while the
 * person keeps the meter on and the window is in view, and never otherwise,
 * so the computer is read only while someone can see it. A row of the peek
 * opens its work: a task's thread, a project's conversation for its
 * coordinator, its front for its default branch running. The switch in the
 * peek turns the meter off as Settings does, for every window.
 */

/** How often the meter reads again while it shows. */
export const EVERY = 3_000

/** How many readings the peek's trace has room for: two minutes of them, as the runtime keeps. */
export const SLOTS = 40

export const text = {
  coordinator: 'Coordinator',
  defaultBranch: 'Default branch',
  meter: { machine: device.This, peek: `${device.This}’s load` } satisfies Partial<LoadMeterText>,
}

const GB = 1024 ** 3
const MB = 1024 ** 2

/** Memory as macOS shows it, in units of 1024: 19.5 GB, 32 GB, 640 MB. */
export const memoryOf = (bytes: number): string =>
  bytes >= GB ? `${Number((bytes / GB).toFixed(1))} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`

const pressureOf = (pressure: Load['pressure']): MemoryPressure | null => {
  switch (pressure) {
    case 'normal':
      return MemoryPressure.Normal
    case 'warning':
      return MemoryPressure.Warning
    case 'critical':
      return MemoryPressure.Critical
    default:
      return null
  }
}

/** A piece of work's row, by what it is: a task, a project's coordinator, or its default branch. */
const idOf = (share: LoadShare) => (share.taskId === null ? `${share.kind} ${share.projectId}` : `task ${share.taskId}`)

const titleOf = (share: LoadShare) => share.title ?? (share.kind === 'coordinator' ? text.coordinator : text.defaultBranch)

/** The runtime's reading, as the meter draws it. */
export const glanceOf = (load: Load): LoadGlance => {
  const shares = load.shares
  const memory = load.memoryTotal > 0 ? Math.min(1, load.memoryUsed / load.memoryTotal) : 0
  const sum = (part: (share: LoadShare) => number) => (shares === null ? null : shares.reduce((all, share) => all + part(share), 0))
  const work = sum((share) => share.cpu)
  const held = sum((share) => share.memory)
  return {
    cpu: load.cpu,
    work: work === null ? null : Math.min(load.cpu, work),
    memory,
    workMemory: held === null || load.memoryTotal <= 0 ? null : Math.min(memory, held / load.memoryTotal),
    memoryUsed: memoryOf(load.memoryUsed),
    memoryTotal: memoryOf(load.memoryTotal),
    pressure: pressureOf(load.pressure),
    rows:
      shares?.map((share) => {
        const mark = share.agent === null ? undefined : brandOf(share.agent.id)
        return {
          id: idOf(share),
          title: titleOf(share),
          project: share.project,
          ...(share.agent === null ? {} : { agent: share.agent.name }),
          ...(mark === undefined ? {} : { mark }),
          cpu: share.cpu,
          memory: memoryOf(share.memory),
          processes: share.processes,
        }
      }) ?? null,
    history: load.history,
  }
}

export interface LoadModel {
  /** What the meter draws; null while it is off, or before the first reading. */
  readonly glance: LoadGlance | null
  /** Opens a piece of work from its row, by its id. */
  readonly open: (id: string) => void
  /** Takes the meter out of the bar, as Settings would. */
  readonly hide: () => void
}

/**
 * Used by the bar itself, and asks only once a project is read: the bar is
 * there while the projects are still being read, but with none, the first
 * screen takes the window and has no bar, so nothing asks.
 */
export const useLoad = (projects: boolean): LoadModel => {
  const { client } = useServices()
  const navigate = useNavigate()
  const { preferences, read, set } = usePreferences()
  const on = read && preferences.showLoad && projects
  const reading = useQuery({
    queryKey: ['load'],
    queryFn: () => client.getLoad(),
    enabled: on,
    // Only while the window is in view: hidden, it isn't read at all.
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  const load = on ? reading.data : undefined

  const open = (id: string) => {
    const share = load?.shares?.find((one) => idOf(one) === id)
    if (share === undefined) return
    if (share.threadId !== null) void navigate({ to: '/threads/$threadId', params: { threadId: share.threadId } })
    else if (share.kind === 'coordinator')
      void navigate({ to: '/projects/$projectId', params: { projectId: share.projectId }, search: { room: Room.Talk } })
    else void navigate({ to: '/projects/$projectId', params: { projectId: share.projectId } })
  }

  return { glance: load === undefined ? null : glanceOf(load), open, hide: () => set('showLoad', false) }
}
