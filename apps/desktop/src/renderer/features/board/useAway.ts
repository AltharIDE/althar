import type { AwayAct as Kept } from '@althar/contracts'
import type { AwayAct } from '@althar/ui'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * While you were away, on the board (ADR-097): what agents did outside their
 * worktrees in the project since the person last cleared it, newest first.
 * Each row says how it is taken back (Revert it, Delete, Undo) or why it
 * can't be; pressed, it says so in place until the runtime answers, and how
 * it went after. × clears the list at once: what comes after shows again.
 */

export const text = {
  revert: 'Revert it',
  delete: 'Delete',
  undo: 'Undo',
  /** While it is being taken back, or once it is. */
  reverting: 'Reverting',
  deleting: 'Deleting',
  undoing: 'Undoing',
  deleted: 'Deleted',
  undone: 'Undone',
}

/** When, as the board says a time: the hour today, the day and hour this week, else the date. */
export const atWords = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  const week = now.getTime() - at.getTime() < 6 * 24 * 60 * 60 * 1000
  return `${at.toLocaleDateString(undefined, week ? { weekday: 'short' } : { day: 'numeric', month: 'short' })} ${time}`
}

/** How a row takes its act back, in its link's words; and what it says while that is under way, and once done. */
const waysOf = (act: Kept) =>
  act.undo === 'revert'
    ? { link: text.revert, under: text.reverting, done: text.reverting }
    : act.kind === 'post'
      ? { link: text.delete, under: text.deleting, done: text.deleted }
      : { link: text.undo, under: text.undoing, done: text.undone }

/** An act as the kit's row shows it, with what was pressed and not yet answered, and why one pressed didn't go. */
export const rowOf = (act: Kept, pressed: boolean, refused: string | undefined, now: Date): AwayAct => {
  const ways = waysOf(act)
  const failed = refused ?? (act.state === 'failed' ? (act.error ?? undefined) : undefined)
  return {
    id: act.id,
    kind: act.kind,
    what: act.what,
    ...(act.task === null ? {} : { task: act.task.title }),
    at: atWords(act.at, now),
    ...(act.cant === null ? {} : { cant: act.cant }),
    ...(act.undo === null ? {} : { undo: ways.link }),
    ...(pressed || act.state === 'undoing' ? { undoing: ways.under } : act.state === 'undone' ? { undoing: ways.done, undone: true } : {}),
    ...(failed === undefined ? {} : { failed }),
  }
}

export const useAway = (projectId: string) => {
  const { client, cache } = useServices()
  const read = useQuery({ ...reads(client).away(projectId), enabled: projectId !== '' })
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set())
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map())
  const away = read.data ?? null

  const clear = useCallback(() => {
    // Gone at once; read again once the runtime has kept when they looked.
    cache.setQueryData(keys.away(projectId), (now: typeof away | undefined) => (now == null ? now : { ...now, acts: [] }))
    void client.clearAway(projectId).finally(() => cache.invalidateQueries({ queryKey: keys.away(projectId) }))
  }, [cache, client, projectId])

  const undo = useCallback(
    (actId: string) => {
      setPressed((was) => new Set(was).add(actId))
      setRefused((was) => {
        const next = new Map(was)
        next.delete(actId)
        return next
      })
      void client
        .undoAway(actId)
        .catch((failure: unknown) => setRefused((was) => new Map(was).set(actId, messageOf(failure))))
        .finally(() => {
          void cache.invalidateQueries({ queryKey: keys.away(projectId) })
          setPressed((was) => {
            const next = new Set(was)
            next.delete(actId)
            return next
          })
        })
    },
    [cache, client, projectId],
  )

  /** The task a row was done for, by its thread; the revert's, while one is under way. */
  const threadOf = (actId: string) => {
    const act = away?.acts.find((one) => one.id === actId)
    return act?.undoTask?.threadId ?? act?.task?.threadId ?? null
  }

  const rows = (now: Date) => (away?.acts ?? []).map((act) => rowOf(act, pressed.has(act.id), refused.get(act.id), now))
  return { away, rows, clear, undo, threadOf }
}
