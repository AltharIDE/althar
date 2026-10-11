import { useState } from 'react'

import type { BackgroundCommand, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import type { Heard, ListenSource, RunningProcess } from '@althar/ui'

import { productBrand } from '../../shared/products'
import type { ArrivalContent } from '../../shared/thread'
import { heardVerb } from '../../shared/ThreadBlocks'
import { ago, running } from '../../shared/time'

/*
 * What goes on behind a task, outside its conversation, as the pills over
 * its composer show it: the pull requests it listens to, and what was last
 * heard from them; and what its lead left running, such as a dev server.
 */

export const behindText = {
  /** What listening to a pull request hears. */
  listensFor: 'review comments and checks',
  /** Under the list: what becomes of what it hears. */
  note: 'Failed checks, and what you and the repository’s people say, go to the lead.',
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

/** Where one answers, as the pill says it: the address without its scheme or a bare trailing slash. */
export const addressOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** What the lead left running, each with how long it has run, or when it ended by itself and how. */
export const runningOf = (background: ReadonlyArray<BackgroundCommand>, now: string): ReadonlyArray<RunningProcess> =>
  background.map((command) => ({
    id: command.id,
    command: command.command,
    ...(command.url === null ? {} : { url: addressOf(command.url) }),
    ...(command.ended === null
      ? { since: running(command.startedAt, now) }
      : { since: ago(command.ended.at, new Date(now)), exited: command.ended.code }),
  }))
