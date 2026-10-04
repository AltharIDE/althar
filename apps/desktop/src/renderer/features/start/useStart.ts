import { useCallback, useEffect, useState } from 'react'

import type { FoundAccount, ProjectSummary, Status } from '@charrette/contracts'

import { messageOf } from '../../data/client'
import { useServices, useWatch } from '../../data/services'

/*
 * The start screen's view model: the agents on this Mac, each with its
 * accounts and how each is signed in (ADR-012), the projects, and opening a
 * folder as a new one.
 */

/** Where a new account signs in: a folder Charrette makes, one a switcher made (by its grant), or one the person chooses. */
export type AccountPlace = { readonly kind: 'own' } | { readonly kind: 'found'; readonly grant: string } | { readonly kind: 'choose' }

export interface StartModel {
  readonly status: Status | null
  readonly projects: ReadonlyArray<ProjectSummary> | null
  readonly error: string | null
  readonly opening: boolean
  /** Asks for a folder and opens it as a project; the project, or null when the person cancelled. */
  readonly openFolder: () => Promise<ProjectSummary | null>
  /** Opens a folder dropped on the window as a project; null when it couldn't. */
  readonly openDropped: (file: File) => Promise<ProjectSummary | null>
  /** Folders account switchers keep each agent's accounts in, as last looked for. */
  readonly found: Readonly<Record<string, ReadonlyArray<FoundAccount>>>
  readonly lookForAccounts: (agentId: string) => void
  /** Adds an account; one in a folder of its own is signed in at once. */
  readonly addAccount: (agentId: string, name: string, place: AccountPlace) => Promise<void>
  /** Opens the agent's own sign-in for the account, in Terminal. */
  readonly signInAccount: (accountId: string) => Promise<void>
  readonly renameAccount: (accountId: string, name: string) => Promise<void>
  readonly moveAccount: (agentId: string, accountId: string, to: 'up' | 'down') => Promise<void>
  readonly removeAccount: (accountId: string) => Promise<void>
}

/** Changes that move what the start screen shows: a project's name, its tasks, who is working, what waits on you. */
const SHOWN = new Set(['project', 'task', 'provider_session', 'attention_request'])

export const useStart = (): StartModel => {
  const { client, host } = useServices()
  const [status, setStatus] = useState<Status | null>(null)
  const [projects, setProjects] = useState<ReadonlyArray<ProjectSummary> | null>(null)
  const [since, setSince] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [found, setFound] = useState<Readonly<Record<string, ReadonlyArray<FoundAccount>>>>({})

  const loadProjects = useCallback(() => {
    client.listProjects().then(
      (list) => {
        setProjects(list.projects)
        setSince((first) => first ?? list.cursor)
      },
      (failure: unknown) => setError(messageOf(failure)),
    )
  }, [client])

  useEffect(() => {
    loadProjects()
    // This is where sign-in shows, so each agent is asked again. That takes a moment; the projects don't wait for it.
    client.status({ recheck: true }).then(setStatus, (failure: unknown) => setError(messageOf(failure)))
  }, [client, loadProjects])

  /** The agents again: checked afresh after a sign-in, as read when anything else changed. */
  const reloadStatus = useCallback(
    (recheck: boolean) => client.status({ recheck }).then(setStatus, (failure: unknown) => setError(messageOf(failure))),
    [client],
  )

  // Back from signing in, in Terminal: each account is asked again.
  useEffect(() => {
    const onFocus = () => void reloadStatus(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadStatus])

  /** Runs an account change, says what went wrong if it did, and shows the agents as they are after it. */
  const changing = useCallback(
    async (change: () => Promise<unknown>, recheck = false) => {
      setError(null)
      try {
        await change()
      } catch (failure) {
        setError(messageOf(failure))
      }
      await reloadStatus(recheck)
    },
    [reloadStatus],
  )

  const signInAccount = useCallback(
    (accountId: string) =>
      changing(async () => {
        const { line, opened } = await client.signInAccount(accountId)
        if (!opened) setError(`Run this in a terminal to sign in, then come back: ${line}`)
      }),
    [changing, client],
  )

  const addAccount = useCallback(
    (agentId: string, name: string, place: AccountPlace) =>
      changing(async () => {
        const grant = place.kind === 'found' ? place.grant : place.kind === 'choose' ? await host.pickFolder('account') : undefined
        if (grant === null) return
        const account = await client.addAccount({ agentId, name, ...(grant === undefined ? {} : { grant }) })
        // A folder of its own starts signed out: its sign-in opens at once.
        if (account.signIn !== 'signed_in') await signInAccount(account.id)
      }, true),
    [changing, client, host, signInAccount],
  )

  const lookForAccounts = useCallback(
    (agentId: string) =>
      void client.findAccounts(agentId).then(
        (places) => setFound((now) => ({ ...now, [agentId]: places })),
        () => setFound((now) => ({ ...now, [agentId]: [] })),
      ),
    [client],
  )

  const moveAccount = useCallback(
    (agentId: string, accountId: string, to: 'up' | 'down') =>
      changing(async () => {
        const ids = status?.agents.find((agent) => agent.id === agentId)?.accounts.map((account) => account.id) ?? []
        const at = ids.indexOf(accountId)
        const next = ids.filter((id) => id !== accountId)
        next.splice(Math.max(0, to === 'up' ? at - 1 : at + 1), 0, accountId)
        await client.orderAccounts(agentId, next)
      }),
    [changing, client, status],
  )

  useWatch((event) => {
    if (event._tag === 'Changed' && SHOWN.has(event.aggregateType)) loadProjects()
  }, since)

  const open = useCallback(
    async (grant: string | null) => {
      if (grant === null) return null
      setError(null)
      setOpening(true)
      try {
        return await client.openProject(grant)
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setOpening(false)
      }
    },
    [client],
  )

  const openFolder = useCallback(async () => open(await host.pickFolder()), [host, open])
  const openDropped = useCallback(async (file: File) => open(await host.grantDropped(file)), [host, open])

  return {
    status,
    projects,
    error,
    opening,
    openFolder,
    openDropped,
    found,
    lookForAccounts,
    addAccount,
    signInAccount,
    renameAccount: (accountId, name) => changing(() => client.renameAccount(accountId, name)),
    moveAccount,
    removeAccount: (accountId) => changing(() => client.removeAccount(accountId)),
  }
}
