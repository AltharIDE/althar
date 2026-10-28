import type { ConnectionList, ProjectRepository } from '@althar/contracts'

import { hostNameOf, type Tracker } from '../project/front'

/*
 * Where Althar stands with what a project's work goes to: on a product's
 * server, connected there as someone, never connected, or signed out; and
 * whether any of it waits on the person, which the project's Settings say
 * with a dot, in the window's bar and beside Code and issues.
 */

export type Standing =
  | { readonly kind: 'connected'; readonly login: string }
  | { readonly kind: 'notConnected' }
  /** By the connection to sign in to again. */
  | { readonly kind: 'signedOut'; readonly login: string; readonly connectionId: string }

/**
 * Althar's standing with a tracker. Where its issues name the connections
 * they are read and moved through, by those alone, as its issues go on
 * through them whoever else is signed in there: one signed out is, and one
 * removed leaves them not connected, until the same account or workspace is
 * connected again, which they then go through. Where they name none, by its server, as an
 * issue is read next: a connection to another server of the same product
 * doesn't count.
 */
export const standingOf = (list: ConnectionList | null, tracker: Pick<Tracker, 'product' | 'at' | 'connections'>): Standing => {
  const all = list?.connections ?? []
  if (tracker.connections.length > 0) {
    const used = tracker.connections.map((id) => all.find((connection) => connection.id === id))
    // A signed-out one first, as signing in again is the person's to do; then one removed.
    const out = used.find((connection) => connection?.state === 'reauth_required')
    if (out !== undefined) return { kind: 'signedOut', login: out.account.login, connectionId: out.id }
    const ready = used.find((connection) => connection?.state === 'ready')
    return ready === undefined || used.includes(undefined) ? { kind: 'notConnected' } : { kind: 'connected', login: ready.account.login }
  }
  const there = all.filter(
    (connection) => connection.product === tracker.product && (tracker.at === null || hostNameOf(connection.webUrl) === tracker.at),
  )
  const ready = there.find((connection) => connection.state === 'ready')
  if (ready !== undefined) return { kind: 'connected', login: ready.account.login }
  const out = there.find((connection) => connection.state === 'reauth_required')
  return out === undefined ? { kind: 'notConnected' } : { kind: 'signedOut', login: out.account.login, connectionId: out.id }
}

/**
 * Whether something the project's work goes to waits on the person: a code
 * host whose sign-in stopped working, or a tracker its tasks' issues are on
 * that Althar can't reach. A code host never connected doesn't: its branches
 * push with the person's own git, as they chose.
 */
export const connectionsNeedYou = (
  repositories: ReadonlyArray<Pick<ProjectRepository, 'host'>> | null,
  trackers: ReadonlyArray<Tracker>,
  list: ConnectionList | null,
): boolean =>
  (repositories ?? []).some((repository) => repository.host?.account != null && repository.host.account.state !== 'ready') ||
  trackers.some((tracker) => standingOf(list, tracker).kind !== 'connected')
