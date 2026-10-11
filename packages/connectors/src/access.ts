import type { Effect } from 'effect'

import type { Credential } from './credential'
import type { Fetch } from './http'
import type { Account } from './model'

/*
 * What a connection can do, as far as its service says, asked as it is made
 * and whenever the person asks again: who it signs in as, whether it reaches
 * the repositories of the person's projects on that instance, and each thing
 * Althar does there. Only reads are sent: what can only be known by writing
 * is said to be unknown, never guessed. A line that can't be done says why,
 * as a reason the window puts in words, with where it is put right.
 */

/** What Althar needs of a connection, each a line of the check. Which a product has, and in what order, is its own. */
export type AccessNeed =
  /** A company's own server answers, by its address. */
  | 'server'
  /** A Jira site answers. */
  | 'site'
  /** Trello's Power-Up API key, which the token was made for. */
  | 'key'
  /** Who it signs in as. */
  | 'account'
  /** It sees the projects' repositories on the instance. */
  | 'reach'
  /** It may push a task's branch. */
  | 'push'
  /** It may open, update and merge pull requests (merge requests). */
  | 'changes'
  /** It may read checks, and a failed job's log. */
  | 'checks'
  /** It may read issues and comment on them: a code host's issues. */
  | 'issues'
  /** A tracker: it may read issues (cards). */
  | 'read'
  /** A tracker: it may comment on them. */
  | 'comment'
  /** A tracker: it may move one through its states (lists). */
  | 'move'

export type AccessState = 'ok' | 'no' | 'unknown'

/** Why a line isn't ok, with what it names and, where there is one, the page that puts it right. */
export type AccessReason =
  /** The service didn't take the credential: wrong, revoked, or run out. */
  | { readonly kind: 'refused' }
  /** A scope the token wasn't given: a classic GitHub token's, GitLab's, Bitbucket's. */
  | { readonly kind: 'scope'; readonly scope: string; readonly url: string | null }
  /** A permission a fine-grained token wasn't given, by the name its page uses: Pull requests. */
  | { readonly kind: 'permission'; readonly permission: string; readonly url: string | null }
  /** The account's own role there doesn't allow it: GitLab's Reporter, Bitbucket's read. Null where the service doesn't name it. */
  | { readonly kind: 'role'; readonly role: string | null }
  /** Repositories it doesn't see, by their paths. */
  | { readonly kind: 'unseen'; readonly names: ReadonlyArray<string>; readonly url: string | null }
  /** Althar's GitHub App isn't installed on the owner, and where it is installed. */
  | { readonly kind: 'not_installed'; readonly owner: string; readonly url: string | null }
  /** The owner restricts OAuth apps, which keeps out an OAuth token such as gh's. */
  | { readonly kind: 'restricted'; readonly owner: string }
  /** The owner signs in with SAML: the token needs authorizing for it, there. */
  | { readonly kind: 'sso'; readonly owner: string; readonly url: string }
  /** GitHub gives fine-grained tokens no check runs: a classic token's page, where one that reads them is made. */
  | { readonly kind: 'no_check_runs'; readonly url: string }
  /** The service doesn't say: what a fine-grained token, or an API key, may change. */
  | { readonly kind: 'unreadable' }
  /** It couldn't be asked: the service's own words. */
  | { readonly kind: 'failed'; readonly message: string }

export interface AccessLine {
  readonly need: AccessNeed
  readonly state: AccessState
  /** What was found, in the service's own words: a login, an owner, a role (Developer, write), a host. */
  readonly fact: string | null
  /** How many, where the fact is a count: boards, teams, projects. */
  readonly count: number | null
  readonly reason: AccessReason | null
}

export interface AccessReport {
  /** Who it signs in as; null when the service didn't take the credential. */
  readonly account: Account | null
  readonly lines: ReadonlyArray<AccessLine>
  /** When the token runs out, where the service says. */
  readonly expiresAt: string | null
  /** The scopes it was given, where the service says (a classic or OAuth token's, GitLab's). */
  readonly scopes: ReadonlyArray<string> | null
}

/** What a check is asked with: where the instance is, how it signs in, and the repositories to look for there. */
export interface AccessInput {
  readonly fetch: Fetch
  readonly apiUrl: string
  readonly webUrl: string
  /** Whether the instance is the product's hosted service, not a company's own server. */
  readonly hosted: boolean
  readonly credential: Credential
  /** How it was signed in: an app's sign-in (GitHub's App, Linear's OAuth), or a token. */
  readonly auth: 'device_flow' | 'pkce' | 'token'
  /** The projects' repositories on this instance, by their paths. */
  readonly repositories: ReadonlyArray<ReadonlyArray<string>>
  /** Althar's GitHub App, by its slug, for where it is installed. */
  readonly appSlug?: string
}

/** A product's check: never failing, since a line says what went wrong. */
export type Access = (input: AccessInput) => Effect.Effect<AccessReport>

/** A line with nothing to add. */
export const line = (need: AccessNeed, state: AccessState, more: Partial<Omit<AccessLine, 'need' | 'state'>> = {}): AccessLine => ({
  need,
  state,
  fact: more.fact ?? null,
  count: more.count ?? null,
  reason: more.reason ?? null,
})
