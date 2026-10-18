import type { ConnectionList, Product, ProjectRepository } from '@althar/contracts'

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
  | { readonly kind: 'signedOut'; readonly login: string }

/** Althar's standing on a product's server, by its host name: a connection to another server of the same product doesn't count. */
export const standingOf = (list: ConnectionList | null, product: Product, at: string | null): Standing => {
  const there = (list?.connections ?? []).filter(
    (connection) => connection.product === product && (at === null || hostNameOf(connection.webUrl) === at),
  )
  const ready = there.find((connection) => connection.state === 'ready')
  if (ready !== undefined) return { kind: 'connected', login: ready.account.login }
  const out = there.find((connection) => connection.state === 'reauth_required')
  return out === undefined ? { kind: 'notConnected' } : { kind: 'signedOut', login: out.account.login }
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
  trackers.some((tracker) => standingOf(list, tracker.product, tracker.at).kind !== 'connected')
