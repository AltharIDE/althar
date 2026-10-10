import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { ApiError, type FoundAccount, type FoundRepository, type ProjectSummary, type Status } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads, recheckStatus } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The start screen's view model: the agents on this Mac, each with its
 * accounts and how each is signed in (ADR-012), the projects, and opening a
 * folder as a new one.
 */

/** A repository found where the person opened a folder, with the grant of the folder it was found in. */
export interface KeptRepository extends FoundRepository {
  readonly grant: string
}

/** A folder of several repositories, read and waiting to be made a project: the folder's grant, its name, and the repositories kept. */
export interface Forming {
  readonly grant: string
  readonly name: string
  readonly repositories: ReadonlyArray<KeptRepository>
}

/** Where a new account signs in: a folder Althar makes, one a switcher made (by its grant), or one the person chooses. */
export type AccountPlace = { readonly kind: 'own' } | { readonly kind: 'found'; readonly grant: string } | { readonly kind: 'choose' }

export interface StartModel {
  readonly status: Status | null
  readonly projects: ReadonlyArray<ProjectSummary> | null
  readonly error: string | null
  readonly opening: boolean
  readonly setupStep: 'agents' | 'project'
  readonly continueSetup: () => void
  readonly skipSetup: () => void
  readonly backToAgents: () => void
  readonly signInAgent: (agentId: string) => Promise<void>
  readonly signingIn: string | null
  readonly checkAgents: () => Promise<void>
  /** Asks for a folder and opens it as a project; the project, or null when the person cancelled. */
  readonly openFolder: () => Promise<ProjectSummary | null>
  /** Opens a folder dropped on the window as a project; null when it couldn't. */
  readonly openDropped: (file: File) => Promise<ProjectSummary | null>
  /** A folder of several repositories, waiting for the person to say which to keep; null otherwise. */
  readonly forming: Forming | null
  /** Adds the repositories in folders the person chooses to the one being formed. */
  readonly addFolders: () => Promise<void>
  /** Leaves a repository out of the project being formed. */
  readonly leaveOut: (path: string) => void
  /** Makes the project being formed, with its name and who answers when agents need a yes; null when it couldn't. */
  readonly create: (project: { readonly name: string; readonly permissions: 'rules' | 'ask' | 'allow' }) => Promise<ProjectSummary | null>
  readonly creating: boolean
  readonly cancelForming: () => void
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
  /** An account whose removal couldn't sign it out, which can be removed anyway; null when there's none. */
  readonly unremoved: string | null
  readonly removeAnyway: () => Promise<void>
}

const SETUP = 'althar.agent-setup'

const setupDone = () => {
  try {
    return window.localStorage.getItem(SETUP) === 'done'
  } catch {
    return false
  }
}

/**
 * `recheck` asks every agent again as the screen opens, rather than trust the
 * runtime's last answer: where the person signs in, so after they did. The
 * window also asks again whenever it comes back to the front.
 */
export const useStart = ({ recheck = false }: { readonly recheck?: boolean } = {}): StartModel => {
  const { client, host, cache } = useServices()
  const read = reads(client)
  const projectsRead = useQuery(read.projects())
  const statusRead = useQuery(read.status())
  const status = statusRead.data ?? null
  const projects = projectsRead.data?.projects ?? null
  const [failed, setError] = useState<string | null>(null)
  const readFailure = projectsRead.error ?? statusRead.error
  const error = failed ?? (readFailure === null ? null : messageOf(readFailure))
  const [opening, setOpening] = useState(false)
  const [continued, setContinued] = useState(setupDone)
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [awaitingSignIn, setAwaitingSignIn] = useState<ReadonlyArray<string>>([])
  const canOpen = continued || (projects !== null && projects.length > 0)
  // Completion means the person continued or explicitly chose to set up later.
  const finishSetup = () => {
    setContinued(true)
    try {
      window.localStorage.setItem(SETUP, 'done')
    } catch {
      // Still works for this window if storage is unavailable.
    }
  }
  const [forming, setForming] = useState<Forming | null>(null)
  const [creating, setCreating] = useState(false)
  const [found, setFound] = useState<Readonly<Record<string, ReadonlyArray<FoundAccount>>>>({})
  const [unremoved, setUnremoved] = useState<string | null>(null)

  /** The agents again: checked afresh after a sign-in, as the runtime last knew them after anything else. */
  const reloadStatus = useCallback(
    (again: boolean) =>
      (again ? recheckStatus(client, cache) : cache.fetchQuery({ ...reads(client).status(), staleTime: 0 })).then(
        () => undefined,
        (failure: unknown) => setError(messageOf(failure)),
      ),
    [client, cache],
  )

  useEffect(() => {
    if (recheck) void reloadStatus(true)
  }, [recheck, reloadStatus])

  // Back from signing in, in Terminal: each account is asked again.
  useEffect(() => {
    const onFocus = () => void reloadStatus(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reloadStatus])

  // Browser login can finish after the window regains focus. Keep asking until
  // all pending accounts are signed in, with one request at a time and a bounded wait.
  useEffect(() => {
    if (awaitingSignIn.length === 0) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const until = Date.now() + 10 * 60_000
    const check = async () => {
      await reloadStatus(true)
      if (cancelled) return
      const accounts = cache.getQueryData<Status>(keys.status)?.agents.flatMap((agent) => agent.accounts) ?? []
      if (awaitingSignIn.every((id) => accounts.some((one) => one.id === id && one.signIn === 'signed_in')) || Date.now() >= until) {
        setAwaitingSignIn([])
        return
      }
      timer = setTimeout(() => void check(), 2000)
    }
    timer = setTimeout(() => void check(), 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [awaitingSignIn, cache, reloadStatus])

  /** The projects read again, so a project just made is in them when its screen opens. */
  const listed = useCallback(
    async (project: ProjectSummary) => {
      await cache.refetchQueries({ queryKey: keys.projects }).catch(() => undefined)
      return project
    },
    [cache],
  )

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

  const signInAccount = useCallback(
    (accountId: string) =>
      changing(async () => {
        const { line, opened } = await client.signInAccount(accountId)
        setAwaitingSignIn((pending) => (pending.includes(accountId) ? pending : [...pending, accountId]))
        if (!opened) setError(`Run this in a terminal to sign in, then come back: ${line}`)
      }),
    [changing, client],
  )

  const signInAgent = async (agentId: string) => {
    const agent = status?.agents.find((one) => one.id === agentId)
    const account = agent?.accounts.find((one) => one.home === null) ?? agent?.accounts[0]
    if (account === undefined || signingIn !== null) return
    setSigningIn(agentId)
    try {
      await signInAccount(account.id)
    } finally {
      setSigningIn(null)
    }
  }

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

  // A folder of several repositories waits for the person to say which to keep; anything else opens at once.
  const open = useCallback(
    async (grant: string | null) => {
      if (grant === null) return null
      setError(null)
      setOpening(true)
      try {
        const reading = await client.readFolder(grant)
        if (reading.project === null && reading.kind === 'folder' && reading.repositories.length > 1) {
          setForming({ grant, name: reading.name, repositories: reading.repositories.map((found) => ({ ...found, grant })) })
          return null
        }
        return await listed(await client.openProject(grant))
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setOpening(false)
      }
    },
    [client, listed],
  )

  const openFolder = useCallback(async () => (canOpen && !opening ? open(await host.pickFolder()) : null), [canOpen, opening, host, open])

  const addFolders = useCallback(async () => {
    const grant = await host.pickFolder()
    if (grant === null) return
    try {
      const reading = await client.readFolder(grant)
      // A folder inside a repository is a project of its own, not one of several: the repository itself is what's added.
      const [inside] = reading.kind === 'inside' ? reading.repositories : []
      if (inside !== undefined) {
        setError(`That’s a folder inside ${inside.name}. Add ${inside.name} itself.`)
        return
      }
      setError(null)
      setForming((now) =>
        now === null
          ? now
          : {
              ...now,
              repositories: [
                ...now.repositories,
                ...reading.repositories
                  .filter((found) => !now.repositories.some((kept) => kept.path === found.path))
                  .map((found) => ({ ...found, grant })),
              ],
            },
      )
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [client, host])

  const create = useCallback(
    async (project: { readonly name: string; readonly permissions: 'rules' | 'ask' | 'allow' }) => {
      if (forming === null) return null
      if (forming.repositories.length === 0) {
        setError('Keep at least one repository.')
        return null
      }
      setError(null)
      setCreating(true)
      try {
        const made = await client.openProject(forming.grant, {
          name: project.name,
          repositories: forming.repositories.map((kept) => ({ grant: kept.grant, path: kept.path })),
        })
        // Who answers when agents need a yes is the project's first rule, where the person chose other than the default.
        if (project.permissions !== 'rules') await client.setProjectRules({ projectId: made.id, permissions: project.permissions })
        setForming(null)
        return await listed(made)
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setCreating(false)
      }
    },
    [client, forming, listed],
  )
  const openDropped = useCallback(
    async (file: File) => (canOpen && !opening ? open(await host.grantDropped(file)) : null),
    [canOpen, opening, host, open],
  )

  return {
    status,
    projects,
    error,
    opening,
    setupStep: continued ? 'project' : 'agents',
    continueSetup: () => {
      if (status?.agents.some((agent) => agent.signIn === 'signed_in')) finishSetup()
    },
    skipSetup: finishSetup,
    backToAgents: () => setContinued(false),
    signInAgent,
    signingIn,
    checkAgents: () => {
      setError(null)
      return reloadStatus(true)
    },
    openFolder,
    openDropped,
    forming,
    addFolders,
    leaveOut: (path) =>
      setForming((now) => (now === null ? now : { ...now, repositories: now.repositories.filter((kept) => kept.path !== path) })),
    create,
    creating,
    cancelForming: () => setForming(null),
    found,
    lookForAccounts,
    addAccount,
    signInAccount,
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
