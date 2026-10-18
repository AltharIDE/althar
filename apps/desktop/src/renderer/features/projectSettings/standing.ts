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
 * Althar's standing with a tracker. First by the connections its issues are
 * read and moved through: one signed out is, whoever else is signed in
 * there, as its issues go on through it. Where none of them is still there,
 * by its server, as an issue is read next: a connection to another server
 * of the same product doesn't count.
 */
export const standingOf = (list: ConnectionList | null, tracker: Pick<Tracker, 'product' | 'at' | 'connections'>): Standing => {
  const all = list?.connections ?? []
  const used = tracker.connections.flatMap((id) => all.filter((connection) => connection.id === id))
  const there =
    used.length > 0
      ? used
      : all.filter(
          (connection) => connection.product === tracker.product && (tracker.at === null || hostNameOf(connection.webUrl) === tracker.at),
        )
  const out = there.find((connection) => connection.state === 'reauth_required')
  const ready = there.find((connection) => connection.state === 'ready')
  // Its own connections, a signed-out one first; on its server, a ready one, as the next issue is read through it.
  const shown = used.length > 0 ? (out ?? ready) : (ready ?? out)
  if (shown === undefined) return { kind: 'notConnected' }
  return shown.state === 'ready'
    ? { kind: 'connected', login: shown.account.login }
    : { kind: 'signedOut', login: shown.account.login, connectionId: shown.id }
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
