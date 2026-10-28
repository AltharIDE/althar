import { type Mutation, useMutation, useMutationState } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { BoardTask } from '@althar/contracts'

import { messageOf } from './client'
import { useServices } from './services'

/*
 * Merging a task's pull request, kept by the window rather than by the
 * screen it was pressed on: the board, the home and the task show the task
 * as merging while its host merges it, and why it didn't after, wherever it
 * was pressed. Merged in its task and Back pressed meanwhile, its card on
 * the board says Merging, out of Needs you, and is settled once the runtime
 * says so. Merged, it stays merging until the board reads it so: its host
 * can take a merge and land it a moment later, and the runtime asks again
 * meanwhile, for a minute (`LANDS_WITHIN`).
 */

const KEY = ['merge'] as const

/** How long a merge that went through shows as merging while its pull request still reads open: the runtime asks its host for that long. */
export const LANDS_WITHIN = 60_000

/** A merge as the person asked it: a task's pull request at `url`, at the head they saw. */
export interface Merge {
  readonly taskId: string
  readonly head: string
  readonly url?: string | undefined
}

/** Merges a task's pull request, as every screen in the window sees it go; fails as the runtime said. */
export const useMerge = (): ((merge: Merge) => Promise<void>) => {
  const { client } = useServices()
  return useMutation({ mutationKey: KEY, mutationFn: (merge: Merge) => client.merge(merge.taskId, merge.head, merge.url) }).mutateAsync
}

export interface Merging {
  /** The tasks shown as merging: pressed and not answered yet, or merged and not yet read back so. */
  readonly merging: ReadonlySet<string>
  /** Why each task's last merge failed, where it did, until it is tried again. */
  readonly failed: Readonly<Record<string, string>>
}

interface Pressed {
  readonly taskId: string
  /** The pull request merged, by its address where it was said, or else by its head. */
  readonly url: string | undefined
  readonly head: string
  readonly status: 'idle' | 'pending' | 'success' | 'error'
  readonly at: number
  readonly error: unknown
}

const pressedOf = (mutation: Mutation<unknown, unknown, unknown>): Pressed => ({
  taskId: (mutation.state.variables as Merge | undefined)?.taskId ?? '',
  url: (mutation.state.variables as Merge | undefined)?.url,
  head: (mutation.state.variables as Merge | undefined)?.head ?? '',
  status: mutation.state.status,
  at: mutation.state.submittedAt,
  error: mutation.state.error,
})

/** Where each task's merges stand, as `tasks` read them, the last pressed for each. */
export const useMerging = (tasks: ReadonlyArray<Pick<BoardTask, 'taskId' | 'change'>> | null): Merging => {
  const pressed = useMutationState({ filters: { mutationKey: KEY }, select: pressedOf })
  // When a merge that went through stops showing as merging, though it still reads open: read again as each one's time ends.
  const [now, setNow] = useState(() => Date.now())
  const last = useMemo(() => new Map(pressed.map((one) => [one.taskId, one])), [pressed])
  const landing = [...last.values()].filter((one) => one.status === 'success' && one.at + LANDS_WITHIN > now)
  const next = landing.length === 0 ? null : Math.min(...landing.map((one) => one.at + LANDS_WITHIN))
  useEffect(() => {
    if (next === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [next])
  return useMemo(() => {
    // The pull request each task shows, while it is open: another of the task's, once one merged, is the person's to accept.
    const open = new Map((tasks ?? []).flatMap((task) => (task.change?.state === 'open' ? [[task.taskId, task.change] as const] : [])))
    const landing = (one: Pressed) => {
      const shown = open.get(one.taskId)
      return shown !== undefined && (one.url === undefined ? shown.head === one.head : shown.url === one.url)
    }
    const merging = new Set<string>()
    const failed: Record<string, string> = {}
    for (const one of last.values()) {
      if (one.status === 'pending') merging.add(one.taskId)
      else if (one.status === 'success' && landing(one) && one.at + LANDS_WITHIN > now) merging.add(one.taskId)
      else if (one.status === 'error') failed[one.taskId] = messageOf(one.error)
    }
    return { merging, failed }
  }, [last, tasks, now])
}

/** The step a task being merged shows it is on, as a step after its plan's. */
export const MERGING_STEP = 'merging'

/**
 * Tasks as the board and the home place them: one ready whose merge is under
 * way is at work, merging, out of Needs you, until it is settled.
 */
export const asMerging = <T extends BoardTask>(tasks: ReadonlyArray<T>, merging: ReadonlySet<string>): ReadonlyArray<T> =>
  merging.size === 0
    ? tasks
    : tasks.map((task) =>
        task.phase === 'ready' && merging.has(task.taskId)
          ? // Althar's at work on it, not an agent: nothing waits for a place or a reset.
            { ...task, phase: 'running', step: MERGING_STEP, queued: null, waits: null, reconnects: null, continues: false, inLine: false }
          : task,
      )
