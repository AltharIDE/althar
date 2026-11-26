import { type Mutation, useMutation, useMutationState } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { type BoardTask, type ChangeSummary, queuedToMerge } from '@althar/contracts'
import type { MergeStanding } from '@althar/ui'

import { messageOf } from './client'
import { useServices } from './services'

// Whether a task is in its merge queue is the one rule every place, the runtime's count too, reads it by.
export { queuedToMerge, shownChangeOf, shownQueued } from '@althar/contracts'

/*
 * Merging a task's pull request, kept by the window rather than by the
 * screen it was pressed on: the board, the home and the task show the task
 * as merging while its host merges it, and why it didn't after, wherever it
 * was pressed. Merged in its task and Back pressed meanwhile, its card on
 * the board says Merging, out of Needs you, and is settled once the runtime
 * says so. Merged, it stays merging until the board reads it so: its host
 * can take a merge and land it a moment later, and the runtime asks again
 * meanwhile, for a minute (`LANDS_WITHIN`). Put in its branch's merge queue
 * instead, it is in the merge queue for as long as the runtime reads it so:
 * its host merges it once the queue's checks pass, or the queue takes it
 * out and it is the person's again.
 */

const KEY = ['merge'] as const

/** How long a merge that went through shows as merging while its pull request still reads open: the runtime asks its host for that long. */
export const LANDS_WITHIN = 60_000

/**
 * How long Merge answers its press on its own before a merge bound for its
 * branch's queue shows in it: its check drawn in, it goes up into the queue.
 * The press plays through at once, as the UI is instant: not when the host
 * has answered, nor when the window next reads the pull request. Refused, it
 * is the person's again, saying why.
 */
export const QUEUES_AFTER = 600

/** Whether merging a pull request puts it in its branch's merge queue, as its host last said: there, the queue is how it merges. */
export const mergesThroughQueue = (change: Pick<ChangeSummary, 'needs'> | null | undefined): boolean =>
  change?.needs?.some((need) => need.kind === 'merge_queue') === true

/** A merge as the person asked it: a task's pull request at `url`, at the head they saw. */
export interface Merge {
  readonly taskId: string
  readonly head: string
  readonly url?: string | undefined
  readonly bypassQueue?: boolean
  /** Outputs' Review and merge or Merge now, with commits waiting for Ship: a Ship first for `review` where they wait. */
  readonly how?: 'review' | 'now'
}

/** Merges a task's pull request, as every screen in the window sees it go; fails as the runtime said. */
export const useMerge = (): ((merge: Merge) => Promise<void>) => {
  const { client } = useServices()
  return useMutation({
    mutationKey: KEY,
    mutationFn: (merge: Merge) =>
      merge.how !== undefined
        ? client.merge(merge.taskId, merge.head, merge.url, merge.how)
        : merge.bypassQueue === true
          ? client.merge(merge.taskId, merge.head, merge.url, undefined, true)
          : client.merge(merge.taskId, merge.head, merge.url),
  }).mutateAsync
}

export interface Merging {
  /** The tasks shown as merging: pressed and not answered yet, or merged and not yet read back so. */
  readonly merging: ReadonlySet<string>
  /** Why each task's last merge failed, where it did, until it is tried again. */
  readonly failed: Readonly<Record<string, string>>
  /** Of those merging, the tasks whose merge was pressed without its pull request's address: by its head, so its shown one's. */
  readonly unaddressed: ReadonlySet<string>
  /** Of those merging, the tasks going into their branch's merge queue, shown there from just after the press (`QUEUES_AFTER`). */
  readonly queuing: ReadonlySet<string>
}

interface Pressed {
  readonly taskId: string
  /** The pull request merged, by its address where it was said, or else by its head. */
  readonly url: string | undefined
  readonly head: string
  readonly bypass: boolean
  /** Whether, gone through, it may still be landing: Review and merge may only have sent its commits up for review. */
  readonly lands: boolean
  readonly status: 'idle' | 'pending' | 'success' | 'error'
  readonly at: number
  readonly error: unknown
}

const pressedOf = (mutation: Mutation<unknown, unknown, unknown>): Pressed => ({
  taskId: (mutation.state.variables as Merge | undefined)?.taskId ?? '',
  url: (mutation.state.variables as Merge | undefined)?.url,
  head: (mutation.state.variables as Merge | undefined)?.head ?? '',
  bypass: (mutation.state.variables as Merge | undefined)?.bypassQueue === true,
  lands: (mutation.state.variables as Merge | undefined)?.how !== 'review',
  status: mutation.state.status,
  at: mutation.state.submittedAt,
  error: mutation.state.error,
})

/** The last merge pressed for each key, and the time now, read again as each one that went through stops landing. */
// `keyOf` is one of the two below, the same each render.
const usePressed = (keyOf: (one: Pressed) => string | undefined): { last: ReadonlyMap<string, Pressed>; now: number } => {
  const pressed = useMutationState({ filters: { mutationKey: KEY }, select: pressedOf })
  // When a merge that went through stops showing as merging, though it still reads open: read again as each one's time ends.
  const [now, setNow] = useState(() => Date.now())
  const last = useMemo(
    () =>
      new Map(
        pressed.flatMap((one) => {
          const key = keyOf(one)
          return key === undefined ? [] : [[key, one] as const]
        }),
      ),
    [pressed, keyOf],
  )
  // And as each press under way has answered for itself long enough to go up into its merge queue, where it goes into one.
  const ends = [...last.values()].flatMap((one) => [
    ...(one.status === 'success' && one.at + LANDS_WITHIN > now ? [one.at + LANDS_WITHIN] : []),
    ...((one.status === 'pending' || one.status === 'success') && one.at + QUEUES_AFTER > now ? [one.at + QUEUES_AFTER] : []),
  ])
  const next = ends.length === 0 ? null : Math.min(...ends)
  useEffect(() => {
    if (next === null) return
    // At least the time it waited for: a timer may fire a moment early by the clock, and the same end would set none again.
    const timer = setTimeout(() => setNow(Math.max(Date.now(), next)), Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [next])
  return { last, now }
}

const byTask = (one: Pressed) => one.taskId
const byUrl = (one: Pressed) => one.url

/** A pull request's merge under way, wherever in the window it was pressed: a bypass of its queue, a merge, or one going into its queue. */
export type Pressing = 'merge' | 'bypass' | 'queue'

/** A press, the same wherever in the window it is read: its task and when it was pressed. */
const pressOf = (one: Pressed) => `${one.taskId} ${one.at}`

/**
 * The presses whose pull request a read has said is in its merge queue,
 * window-wide: from then on the reads say where it stands, so one the queue
 * takes out again is out, not shown in it or merging still.
 */
const confirmed = new Set<string>()

/** Whether a read has said `one`'s pull request is in its queue, noting it where `change`, its read now, says so. */
const confirmedQueued = (one: Pressed, change: Pick<ChangeSummary, 'state' | 'queued'> | undefined): boolean => {
  if (one.bypass) return false
  if (change?.state === 'open' && change.queued === true) confirmed.add(pressOf(one))
  return confirmed.has(pressOf(one))
}

/**
 * Whether a merge under way shows in its branch's merge queue already: one
 * that goes through the queue, as its host last said, once Merge has
 * answered its press, until a read says it is queued itself, or merged.
 */
const queuing = (one: Pressed, change: Pick<ChangeSummary, 'state' | 'queued' | 'needs'> | undefined, now: number) =>
  !one.bypass &&
  one.lands &&
  change?.state === 'open' &&
  mergesThroughQueue(change) &&
  one.at + QUEUES_AFTER <= now &&
  !confirmedQueued(one, change)

/**
 * The pull requests, by address, whose merge is under way wherever in the
 * window it was pressed: pressed and not answered, or gone through and not yet
 * read back queued or merged, as `changes` read them. Kept by each pull
 * request, not by its task, so a task's second pull request is never merged
 * twice, whichever screen is open.
 */
export const usePressedMerges = (
  changes: ReadonlyArray<Pick<ChangeSummary, 'url' | 'state' | 'queued' | 'needs'>> | null,
): ReadonlyMap<string, Pressing> => {
  const { last, now } = usePressed(byUrl)
  return useMemo(() => {
    const read = new Map((changes ?? []).map((change) => [change.url, change]))
    const under = new Map<string, Pressing>()
    for (const [url, one] of last) {
      const change = read.get(url)
      // Once read in its queue, the reads say where it stands, though Merge hasn't answered yet: taken out again, it is out.
      if (confirmedQueued(one, change)) continue
      // Gone through, it lands while it still reads open.
      const landing = one.status === 'success' && one.lands && one.at + LANDS_WITHIN > now && change?.state === 'open'
      if (one.status === 'pending' || landing) under.set(url, one.bypass ? 'bypass' : queuing(one, change, now) ? 'queue' : 'merge')
    }
    return under
  }, [last, changes, now])
}

/**
 * The pull requests, by address, a read has said were in their merge queue
 * since their merge was pressed, and says now are open and out of it: the
 * queue took them out, so they are the person's to merge again, though the
 * press may not have answered yet.
 */
export const useTakenOut = (changes: ReadonlyArray<Pick<ChangeSummary, 'url' | 'state' | 'queued'>> | null): ReadonlySet<string> => {
  const { last } = usePressed(byUrl)
  return useMemo(() => {
    const read = new Map((changes ?? []).map((change) => [change.url, change]))
    return new Set(
      [...last].flatMap(([url, one]) => {
        const change = read.get(url)
        return change?.state === 'open' && change.queued !== true && confirmedQueued(one, change) ? [url] : []
      }),
    )
  }, [last, changes])
}

const WAITS = ['merge-waits'] as const

/** Pull requests a press merges in turn, each once the one before has landed, held for that press while it lasts. */
interface Waits {
  readonly taskId: string
  readonly urls: ReadonlyArray<string>
  readonly done: Promise<void>
}

/**
 * Holds pull requests for a press that merges them in turn, window-wide, for
 * as long as the press lasts: left and come back to, the task offers none of
 * them a Merge of its own meanwhile. Gives back what lets them go.
 */
export const useHoldMerges = (): ((taskId: string, urls: ReadonlyArray<string>) => () => void) => {
  const { mutate } = useMutation({ mutationKey: WAITS, mutationFn: (waits: Waits) => waits.done })
  return useCallback(
    (taskId, urls) => {
      let release: () => void = () => {}
      const done = new Promise<void>((resolve) => {
        release = resolve
      })
      if (urls.length > 0) mutate({ taskId, urls, done })
      return release
    },
    [mutate],
  )
}

/** The pull requests held for a press under way anywhere in the window, by address, until each one's turn comes. */
export const useHeldMerges = (): ReadonlySet<string> => {
  const held = useMutationState({
    filters: { mutationKey: WAITS, status: 'pending' },
    select: (mutation) => (mutation.state.variables as Waits | undefined)?.urls ?? [],
  })
  return useMemo(() => new Set(held.flat()), [held])
}

/** Where each task's merges stand, as `tasks` read them, the last pressed for each. */
export const useMerging = (tasks: ReadonlyArray<Pick<BoardTask, 'taskId' | 'change'>> | null): Merging => {
  const { last, now } = usePressed(byTask)
  return useMemo(() => {
    // The pull request each task shows, while it is open: another of the task's, once one merged, is the person's to accept.
    const open = new Map((tasks ?? []).flatMap((task) => (task.change?.state === 'open' ? [[task.taskId, task.change] as const] : [])))
    const landing = (one: Pressed) => {
      const shown = open.get(one.taskId)
      return shown !== undefined && (one.url === undefined ? shown.head === one.head : shown.url === one.url)
    }
    const merging = new Set<string>()
    const unaddressed = new Set<string>()
    const queued = new Set<string>()
    const failed: Record<string, string> = {}
    for (const one of last.values()) {
      // Read in its queue, the queue has it: the reads say where it stands from then on, Merge answered or not.
      if (landing(one) && confirmedQueued(one, open.get(one.taskId))) continue
      if (one.status === 'pending') merging.add(one.taskId)
      else if (one.status === 'success' && one.lands && landing(one) && one.at + LANDS_WITHIN > now) merging.add(one.taskId)
      else if (one.status === 'error') failed[one.taskId] = messageOf(one.error)
      if (merging.has(one.taskId) && landing(one) && queuing(one, open.get(one.taskId), now)) queued.add(one.taskId)
    }
    for (const one of last.values()) if (one.url === undefined && merging.has(one.taskId)) unaddressed.add(one.taskId)
    return { merging, failed, unaddressed, queuing: queued }
  }, [last, tasks, now])
}

/**
 * Where a pull request's merge stands, as every Merge button shows it in its
 * place: `merging` from the press until the runtime says otherwise, then
 * `queued` while its branch's merge queue holds it, `merged` once it landed;
 * null where it is the person's to merge, as before the press or after a
 * merge that failed, which its place says beside it.
 */
export type { MergeStanding }

export const mergeStandingOf = (
  change: Pick<ChangeSummary, 'state' | 'queued'> | null | undefined,
  merging: boolean,
  /** The merge under way bypasses its queue: Merging, though it still reads queued, so nothing offers the bypass again. */
  bypassing = false,
  /** The merge under way goes into its queue, its press answered: in the queue already, before the runtime reads it so. */
  queuing = false,
): MergeStanding | null => {
  if (change == null) return merging ? 'merging' : null
  if (change.state === 'merged') return 'merged'
  if (change.state !== 'open') return null
  if ((change.queued === true || (merging && queuing)) && !(merging && bypassing)) return 'queued'
  return merging ? 'merging' : null
}

/** The step a task being merged shows it is on, as a step after its plan's. */
export const MERGING_STEP = 'merging'

/** The step a task shows while its pull requests wait in their merge queues. */
export const MERGE_QUEUE_STEP = 'merge_queue'

/**
 * Tasks as the board and the home place them: one ready whose merge is under
 * way, or whose pull request is in its merge queue, is at work, out of Needs
 * you, until it is settled or the queue takes it out. One of `queuing`, going
 * into its queue, is in it from just after the press.
 */
export const asMerging = <T extends BoardTask>(
  tasks: ReadonlyArray<T>,
  merging: ReadonlySet<string>,
  queuing: ReadonlySet<string> = new Set(),
): ReadonlyArray<T> =>
  merging.size === 0 && !tasks.some(queuedToMerge)
    ? tasks
    : tasks.map((task) =>
        task.phase === 'ready' && (queuedToMerge(task) || merging.has(task.taskId))
          ? // Althar's at work on it, or its host, not an agent: nothing waits for a place or a reset.
            {
              ...task,
              phase: 'running',
              step: queuedToMerge(task) || (merging.has(task.taskId) && queuing.has(task.taskId)) ? MERGE_QUEUE_STEP : MERGING_STEP,
              queued: null,
              waits: null,
              reconnects: null,
              continues: false,
              inLine: false,
            }
          : task,
      )
