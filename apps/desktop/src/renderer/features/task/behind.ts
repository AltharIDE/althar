import { useState } from 'react'

import type { ThreadItem, ThreadSnapshot } from '@althar/contracts'
import type { BehindText, BehindWait, Heard, ListenSource } from '@althar/ui'

import { productBrand } from '../../shared/products'
import type { ArrivalContent } from '../../shared/thread'
import { heardVerb } from '../../shared/ThreadBlocks'
import { ago } from '../../shared/time'

/*
 * What goes on behind a task, outside its conversation, as the chip over its
 * composer shows it: why it waits, the pull requests it listens to, and what
 * was last heard from them. What runs behind it is shared/running.ts's.
 */

export const behindText = {
  /** What listening to a pull request hears. */
  listensFor: 'review comments and checks',
}

/** What it listens to is only ever its pull requests, so the chip counts them as such. */
export const listeningText: Partial<BehindText> = { sources: (n) => (n === 1 ? '1 pull request' : `${n} pull requests`) }

/**
 * Why it waits, where it does (ADR-032): where it stands in its project's
 * line, and the tasks that hold the places, those kept only by what they left
 * running by its names, which can be stopped from here where its thread is
 * known. Null where it doesn't wait.
 */
export const waitOf = (task: ThreadSnapshot['task'], placeWords: (place: number) => string): BehindWait | null =>
  task.queued === null && task.place === undefined
    ? null
    : {
        ...(task.place === undefined ? {} : { place: placeWords(task.place) }),
        holders: (task.queued?.holders ?? []).map((holder) => ({
          id: holder.taskId,
          title: holder.title,
          ...(holder.kept
            ? {
                keptBy: holder.running.map((command) => command.name ?? command.label ?? command.command),
                stoppable: holder.threadId !== null && holder.running.length > 0,
              }
            : {}),
        })),
      }

type Arrival = Extract<ThreadItem, { kind: 'arrival' }>

const arrivalsOf = (items: ReadonlyArray<ThreadItem>): ReadonlyArray<Arrival> => items.filter((item) => item.kind === 'arrival')

/** What was heard, in a line: dana commented on PR #12, Checks passed on PR #12. */
export const heardLine = (arrival: ArrivalContent): string =>
  [arrival.from, heardVerb(arrival), arrival.where].filter((part) => part !== null).join(' ')

/** The task's pull requests it still listens to, each with when it last heard from it. */
export const listeningOf = (snapshot: ThreadSnapshot): ReadonlyArray<ListenSource> => {
  const arrivals = arrivalsOf(snapshot.items)
  return snapshot.task.changes
    .filter((change) => change.listening)
    .map((change) => {
      const label = `${change.short} ${change.prefix}${change.number}`
      // An arrival names its pull request as the label does.
      const last = arrivals.findLast((arrival) => arrival.content.where === label)
      return {
        id: change.url,
        mark: productBrand(change.product),
        label,
        where: change.repository,
        what: behindText.listensFor,
        ...(last === undefined ? {} : { last: ago(last.createdAt) }),
      }
    })
}

/**
 * The last thing heard while the task is open, for the pill to say for a
 * moment; nothing for what had arrived before it opened. Null until the
 * thread is read.
 */
export function useHeard(items: ReadonlyArray<ThreadItem> | null): Heard | null {
  // The newest arrival when the thread was first read: null for none, undefined before it was read.
  const [first, setFirst] = useState<string | null | undefined>(undefined)
  const latest = items === null ? undefined : arrivalsOf(items).at(-1)
  if (items !== null && first === undefined) setFirst(latest?.id ?? null)
  if (first === undefined || latest === undefined || latest.id === first) return null
  return { key: latest.id, text: heardLine(latest.content) }
}
