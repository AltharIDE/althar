import { type Mutation, useMutation, useMutationState } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ChangeSummary } from '@althar/contracts'

import { messageOf } from './client'
import { useServices } from './services'

/*
 * Merge when checks pass, kept by the window rather than by the screen it
 * was pressed on, as Merge is (merges.ts): pressed on the board, its task
 * and Needs you show it waiting at once, in the frame it was pressed, and
 * Don't merge takes it out as fast. The runtime's merge line keeps it from
 * then on (`whenGreen` on the pull request): what a read says rules once
 * it has said the press is there, or once a while has gone by without it
 * saying so. A press the runtime refused comes back, saying why, and so
 * does one the line sent back.
 */

const KEY = ['when-green'] as const

/** How long a press shows as it was pressed while the pull request still reads otherwise: the runtime reads it back well within this. */
export const HOLDS_FOR = 60_000

interface Asked {
  readonly taskId: string
  readonly url: string
  /** The head the person saw, for a press; none for Don't merge. */
  readonly head?: string
  /** The press's own id, which a read that answers it names (`whenGreen.press`). */
  readonly press?: string
}

interface Pressed {
  readonly url: string
  readonly leave: boolean
  readonly press: string | undefined
  readonly status: 'idle' | 'pending' | 'success' | 'error'
  readonly at: number
  readonly error: unknown
}

const pressedOf = (mutation: Mutation<unknown, unknown, unknown>): Pressed => {
  const asked = mutation.state.variables as Asked | undefined
  return {
    url: asked?.url ?? '',
    leave: asked?.head === undefined,
    press: asked?.press,
    status: mutation.state.status,
    at: mutation.state.submittedAt,
    error: mutation.state.error,
  }
}

/** The presses a read has since agreed with, window-wide: from then on the reads say where it stands. */
const agreed = new Set<string>()
const keyOf = (one: Pressed) => `${one.url} ${one.at}`

type Read = Pick<ChangeSummary, 'url' | 'state' | 'whenGreen'> | null | undefined

export interface WhenGreen {
  /** Merge when checks pass, at the head the person saw. */
  readonly press: (taskId: string, url: string, head: string) => void
  /** Don't merge. */
  readonly leave: (taskId: string, url: string) => void
  /** Whether it waits to merge when its checks pass, as pressed here or as the runtime reads it. */
  readonly waiting: (change: Read) => boolean
  /** Why it isn't waiting any more, where it came back without merging, or the press was refused: until it is pressed again. */
  readonly back: (change: Read) => string | null
}

export const useWhenGreen = (): WhenGreen => {
  const { client } = useServices()
  const { mutate } = useMutation({
    mutationKey: KEY,
    mutationFn: (asked: Asked) =>
      asked.head === undefined
        ? client.leaveMergeLine(asked.taskId, asked.url)
        : client.mergeWhenGreen(asked.taskId, asked.url, asked.head, asked.press ?? ''),
  })
  const presses = useMutationState({ filters: { mutationKey: KEY }, select: pressedOf })
  const last = useMemo(() => new Map(presses.map((one) => [one.url, one] as const)), [presses])
  // Read again as each press stops holding its place by itself.
  const [now, setNow] = useState(() => Date.now())
  const ends = [...last.values()].flatMap((one) => (one.status === 'success' && one.at + HOLDS_FOR > now ? [one.at + HOLDS_FOR] : []))
  const next = ends.length === 0 ? null : Math.min(...ends)
  useEffect(() => {
    if (next === null) return
    const timer = setTimeout(() => setNow(Math.max(Date.now(), next)), Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [next])

  const read = (change: Read) => change?.state === 'open' && change.whenGreen?.state === 'waiting'
  const waiting = useCallback(
    (change: Read): boolean => {
      if (change == null || change.state !== 'open') return false
      const one = last.get(change.url)
      if (one === undefined || one.status === 'idle') return read(change)
      if (one.status === 'pending') return !one.leave
      if (one.status === 'error') return read(change)
      // Gone through: as pressed until a read answers it (this very press, waiting or sent back already; for Don't merge, no
      // longer waiting), or a while has gone by. An older read, of before the press, never takes it back.
      if (one.leave ? !read(change) : one.press !== undefined && change.whenGreen?.press === one.press) agreed.add(keyOf(one))
      if (agreed.has(keyOf(one)) || one.at + HOLDS_FOR <= now) return read(change)
      return !one.leave
    },
    [last, now],
  )
  const back = useCallback(
    (change: Read): string | null => {
      if (change == null || change.state !== 'open' || waiting(change)) return null
      const one = last.get(change.url)
      if (one?.status === 'error') return messageOf(one.error)
      if (one?.status === 'pending' || (one?.status === 'success' && one.leave)) return null
      return change.whenGreen?.state === 'sent_back' ? (change.whenGreen.reason ?? null) : null
    },
    [last, waiting],
  )
  return useMemo(
    () => ({
      press: (taskId, url, head) => mutate({ taskId, url, head, press: crypto.randomUUID() }),
      leave: (taskId, url) => mutate({ taskId, url }),
      waiting,
      back,
    }),
    [mutate, waiting, back],
  )
}
