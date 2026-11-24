import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type AgentStatus, ApiError, type ProjectSummary, type Status } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { readModelsAgain } from '../../data/models'
import { reads, recheckStatus } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The start screen's view model: the agents on this Mac, each with its
 * accounts and how each is signed in (ADR-012), and the projects. The first
 * project is the first screen's own (useFirstProject); every later one is
 * made in a tab of its own (features/newProject). Signing an account in is
 * the accounts' own model (features/accounts), which reads the agents from
 * here. An account renamed, moved, signed out or removed shows so at once,
 * and the agents are read again behind it, as the runtime has them: what
 * didn't go through comes back with that read, and the error says why. One
 * signed out or removed offers its agent's models no more, so they are read
 * again too.
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
  /** Signs an account out, shown signed out at once: the usual folder's too, which signs the agent's own command out. */
  readonly signOutAccount: (accountId: string) => Promise<void>
  /** An account whose removal couldn't sign it out, which can be removed anyway; null when there's none. */
  readonly unremoved: string | null
  readonly removeAnyway: () => Promise<void>
}

/**
 * `recheck` asks every agent again as the screen opens, rather than trust the
 * runtime's last answer: where the person signs in, so after they did. The
 * window also asks again whenever it comes back to the front.
 */
/**
 * An account change as it shows before the runtime says so: each agent as it changes it, and what it changes (an
 * account's name, an agent's order of accounts), which a later change of the same, once kept, takes the place of.
 */
interface AccountChange {
  readonly of: string
  readonly show: (agent: AgentStatus) => AgentStatus
}

export const useStart = ({ recheck = false }: { readonly recheck?: boolean } = {}): StartModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const projectsRead = useQuery(read.projects())
  const statusRead = useQuery(read.status())
  // Account changes still waiting for a read after their answer, by press: each drawn over every read of the agents, so a
  // read begun before one (a recheck as the window got focus) never takes it back.
  const [held, setHeld] = useState<ReadonlyMap<number, AccountChange>>(new Map())
  const pressed = useRef(0)
  const readNow = statusRead.data ?? null
  const status = useMemo(
    () =>
      readNow === null || held.size === 0
        ? readNow
        : { ...readNow, agents: readNow.agents.map((agent) => [...held.values()].reduce((now, change) => change.show(now), agent)) },
    [readNow, held],
  )
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

  /**
   * Runs an account change, shown first as it will be (`shows`, each agent as it changes it), says what went wrong if it
   * did, and shows the agents as they are after it.
   */
  const changing = useCallback(
    async (change: () => Promise<unknown>, shows?: AccountChange) => {
      setError(null)
      const press = ++pressed.current
      if (shows !== undefined) setHeld((now) => new Map([...now, [press, shows]]))
      let failed = false
      try {
        await change()
      } catch (failure) {
        failed = true
        setError(messageOf(failure))
      }
      // Read after the answer: what it shows from here is the runtime's. Kept, it also takes the place of every earlier change
      // of its account still waiting, which would otherwise show again over it; failed, only its own goes.
      await reloadStatus(false)
      const of = failed ? undefined : shows?.of
      setHeld((now) => {
        const left = [...now].filter(([one, it]) => one !== press && (of === undefined || one > press || it.of !== of))
        return left.length === now.size ? now : new Map(left)
      })
    },
    [reloadStatus],
  )

  const moveAccount = useCallback(
    (agentId: string, accountId: string, to: 'up' | 'down') => {
      const ids = status?.agents.find((agent) => agent.id === agentId)?.accounts.map((account) => account.id) ?? []
      const at = ids.indexOf(accountId)
      const next = ids.filter((id) => id !== accountId)
      next.splice(Math.max(0, to === 'up' ? at - 1 : at + 1), 0, accountId)
      return changing(() => client.orderAccounts(agentId, next), {
        of: `order ${agentId}`,
        show: (agent) =>
          agent.id !== agentId
            ? agent
            : { ...agent, accounts: next.flatMap((id) => agent.accounts.filter((account) => account.id === id)) },
      })
    },
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
    renameAccount: (accountId, name) =>
      changing(() => client.renameAccount(accountId, name), {
        of: `name ${accountId}`,
        show: (agent) => ({
          ...agent,
          accounts: agent.accounts.map((account) => (account.id === accountId ? { ...account, name } : account)),
        }),
      }),
    moveAccount,
    removeAccount: (accountId) => {
      setUnremoved(null)
      return changing(
        async () => {
          try {
            await client.removeAccount(accountId)
            readModelsAgain(client)
          } catch (failure) {
            if (failure instanceof ApiError && failure.reason === 'SignOutFailed') setUnremoved(accountId)
            throw failure
          }
        },
        {
          of: `removed ${accountId}`,
          show: (agent) => ({ ...agent, accounts: agent.accounts.filter((account) => account.id !== accountId) }),
        },
      )
    },
    signOutAccount: (accountId) =>
      changing(
        async () => {
          await client.signOutAccount(accountId)
          readModelsAgain(client)
        },
        {
          of: `signed out ${accountId}`,
          show: (agent) => {
            if (!agent.accounts.some((account) => account.id === accountId)) return agent
            const accounts = agent.accounts.map((account) =>
              account.id === accountId ? { ...account, signIn: 'signed_out' as const, outUntil: null } : account,
            )
            // Signed in where any of its accounts is, as the runtime says it.
            const signIn = accounts.some((account) => account.signIn === 'signed_in')
              ? 'signed_in'
              : accounts.some((account) => account.signIn === 'unknown')
                ? 'unknown'
                : 'signed_out'
            return { ...agent, accounts, signIn }
          },
        },
      ),
    unremoved,
    removeAnyway: () =>
      changing(async () => {
        if (unremoved !== null) await client.removeAccount(unremoved, true)
        setUnremoved(null)
      }),
  }
}
