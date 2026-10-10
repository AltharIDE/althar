import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { ApiError, type ProjectSummary, type Status } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { reads, recheckStatus } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The start screen's view model: the agents on this Mac, each with its
 * accounts and how each is signed in (ADR-012), and the projects. The first
 * project is the first screen's own (useFirstProject); every later one is
 * made in a tab of its own (features/newProject). Signing an account in is
 * the accounts' own model (features/accounts), which reads the agents from
 * here.
 */

export interface StartModel {
  readonly status: Status | null
  readonly projects: ReadonlyArray<ProjectSummary> | null
  readonly error: string | null
  /** Asks each agent again how its accounts are signed in. */
  readonly recheck: () => Promise<void>
  /** Downloads an agent Althar can fetch, then asks the agents again; its row says it downloads meanwhile. */
  readonly install: (agentId: string) => Promise<void>
  /** Why each agent's last download didn't finish, by its id. */
  readonly installFailed: Readonly<Record<string, string>>
  /** When the agents were last read, as a time: a read that found nothing changed moves it on too. */
  readonly checkedAt: number
  readonly renameAccount: (accountId: string, name: string) => Promise<void>
  readonly moveAccount: (agentId: string, accountId: string, to: 'up' | 'down') => Promise<void>
  readonly removeAccount: (accountId: string) => Promise<void>
  /** An account whose removal couldn't sign it out, which can be removed anyway; null when there's none. */
  readonly unremoved: string | null
  readonly removeAnyway: () => Promise<void>
}

/**
 * `recheck` asks every agent again as the screen opens, rather than trust the
 * runtime's last answer: where the person signs in, so after they did. The
 * window also asks again whenever it comes back to the front.
 */
export const useStart = ({ recheck = false }: { readonly recheck?: boolean } = {}): StartModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const projectsRead = useQuery(read.projects())
  const statusRead = useQuery(read.status())
  const status = statusRead.data ?? null
  const projects = projectsRead.data?.projects ?? null
  const [failed, setError] = useState<string | null>(null)
  const readFailure = projectsRead.error ?? statusRead.error
  const error = failed ?? (readFailure === null ? null : messageOf(readFailure))
  const [unremoved, setUnremoved] = useState<string | null>(null)
  const [installFailed, setInstallFailed] = useState<Readonly<Record<string, string>>>({})

  /** The agents again: checked afresh after a sign-in, as the runtime last knew them after anything else. */
  const reloadStatus = useCallback(
    (again: boolean) =>
      (again ? recheckStatus(client, cache) : cache.fetchQuery({ ...reads(client).status(), staleTime: 0 })).then(
        () => undefined,
        (failure: unknown) => setError(messageOf(failure)),
      ),
    [client, cache],
  )

  // One function for the model's life, so an effect that asks again when it changes asks once.
  const recheckNow = useCallback(() => reloadStatus(true), [reloadStatus])

  useEffect(() => {
    if (recheck) void reloadStatus(true)
  }, [recheck, reloadStatus])

  // Back from signing in, in Terminal: each account is asked again.
  useEffect(() => {
    const onFocus = () => void reloadStatus(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadStatus])

  /** Runs an account change, says what went wrong if it did, and shows the agents as they are after it. */
  const changing = useCallback(
    async (change: () => Promise<unknown>, again = false) => {
      setError(null)
      try {
        await change()
      } catch (failure) {
        setError(messageOf(failure))
      }
      await reloadStatus(again)
    },
    [reloadStatus],
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

  return {
    status,
    projects,
    error,
    recheck: recheckNow,
    install: async (agentId) => {
      setInstallFailed((now) => Object.fromEntries(Object.entries(now).filter(([id]) => id !== agentId)))
      // The runtime says it downloads as soon as it starts, so the row changes at once; that read is waited for before the
      // last one, so it can never land after it and say the agent still downloads.
      const done = client.installAgent(agentId)
      const first = reloadStatus(false)
      try {
        await done
      } catch (failure) {
        setInstallFailed((now) => ({ ...now, [agentId]: messageOf(failure) }))
      }
      await first
      await reloadStatus(true)
    },
    installFailed,
    checkedAt: statusRead.dataUpdatedAt,
    renameAccount: (accountId, name) => changing(() => client.renameAccount(accountId, name)),
    moveAccount,
    removeAccount: (accountId) =>
      changing(async () => {
        setUnremoved(null)
        try {
          await client.removeAccount(accountId)
        } catch (failure) {
          if (failure instanceof ApiError && failure.reason === 'SignOutFailed') setUnremoved(accountId)
          throw failure
        }
      }),
    unremoved,
    removeAnyway: () =>
      changing(async () => {
        if (unremoved !== null) await client.removeAccount(unremoved, true)
        setUnremoved(null)
      }),
  }
}
