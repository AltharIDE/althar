import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AgentTools, NewServer, SyncedAgent, ToolRole } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The person's MCP servers and skills, as Settings shows them (ADR-097): the
 * roles each gets and the projects whose marks are pressed in or out, adding and
 * removing a server, and the two sync switches. Each change goes to the runtime
 * and the view is read again from what it kept, as sync writes into the
 * person's own files and only it knows what went through; what didn't is said
 * in its words. As the servers open, each agent is asked through its own
 * command how its servers stand (signed in, failed to start); that reads, and
 * what it says shows on the tiles when it is back.
 */

export interface AgentToolsModel {
  readonly tools: AgentTools | undefined
  readonly loadFailed: boolean
  readonly reload: () => void
  readonly error: string | null
  /** A call to a command under way that the person waits on: adding or removing a server. */
  readonly busy: boolean
  readonly setRoles: (kind: 'server' | 'skill', name: string, roles: ReadonlyArray<ToolRole>, repository?: string | null) => void
  readonly setInProject: (kind: 'server' | 'skill', name: string, projectId: string, on: boolean) => void
  readonly setSync: (kind: 'server' | 'skill', on: boolean, takeBack: boolean) => void
  readonly keep: (kind: 'server' | 'skill', agent: SyncedAgent, name: string, out: boolean) => void
  readonly pick: (kind: 'server' | 'skill', name: string, way: SyncedAgent | 'apart') => void
  readonly undo: (id: string) => void
  readonly signIn: (agent: SyncedAgent, name: string) => void
  /** Adds a server to each agent given, in its own file; the words of why, where it couldn't be, else null. */
  readonly add: (server: NewServer, agents: ReadonlyArray<SyncedAgent>) => Promise<string | null>
  /** Takes a server out of every agent's file that has it; the words of why, where it couldn't be, else null. */
  readonly remove: (name: string) => Promise<string | null>
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The agents are asked how their servers stand at most this often as the person opens the servers. */
const CHECK_EVERY = 5 * 60_000

export const useAgentTools = (options: { readonly check?: boolean } = {}): AgentToolsModel => {
  const { client, cache } = useServices()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery(reads(client).agentTools(null))
  const reload = useCallback(() => void cache.invalidateQueries({ queryKey: ['agentTools'] }), [cache])

  // Asked once as the servers open, and again at most every few minutes: the agents' own commands start each server to see.
  const checked = useRef<number | null>(null)
  const enabled = query.data?.enabled === true
  const last = query.data?.checkedAt ?? null
  useEffect(() => {
    if (options.check !== true || !enabled || checked.current !== null) return
    const age = last === null ? Number.POSITIVE_INFINITY : Date.now() - new Date(last).getTime()
    checked.current = Date.now()
    if (age < CHECK_EVERY) return
    client.checkServers().then(reload, () => undefined)
  }, [client, enabled, last, options.check, reload])

  const after = useCallback(
    (change: Promise<unknown>) => {
      setError(null)
      void change.then(reload, (failed: unknown) => {
        setError(said(failed))
        reload()
      })
    },
    [reload],
  )
  const shown = useCallback(
    (
      kind: 'server' | 'skill',
      name: string,
      repository: string | null,
      change: (row: AgentTools['servers'][number]) => AgentTools['servers'][number],
    ) =>
      cache.setQueryData<AgentTools>(keys.agentTools(null), (was) =>
        was === undefined
          ? was
          : {
              ...was,
              [kind === 'server' ? 'servers' : 'skills']: (kind === 'server' ? was.servers : was.skills).map((row) =>
                row.name === name && row.repository === repository ? change(row) : row,
              ),
            },
      ),
    [cache],
  )
  const changing = useCallback(
    (work: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      return work().then(
        () => {
          setBusy(false)
          reload()
          return null
        },
        (failed: unknown) => {
          setBusy(false)
          reload()
          return said(failed)
        },
      )
    },
    [reload],
  )
  return {
    tools: query.data,
    loadFailed: query.isError,
    reload,
    error,
    busy,
    setRoles: (kind, name, roles, repository = null) => {
      shown(kind, name, repository, (row) => ({ ...row, roles: [...roles] }))
      after(client.setToolRoles(kind, name, roles, null, repository))
    },
    setInProject: (kind, name, projectId, on) => {
      shown(kind, name, null, (row) => ({ ...row, offIn: on ? row.offIn.filter((id) => id !== projectId) : [...row.offIn, projectId] }))
      after(client.setToolInProject(kind, name, projectId, on))
    },
    setSync: (kind, on, takeBack) => after(client.setToolSync(kind, on, takeBack)),
    keep: (kind, agent, name, out) => after(client.setToolKeptOut(kind, agent, name, out)),
    pick: (kind, name, way) => after(client.pickToolWay(kind, name, way)),
    undo: (id) => after(client.undoToolSync(id)),
    signIn: (agent, name) => after(client.signInToolServer(agent, name)),
    add: (server, agents) => changing(() => client.addServer(server, agents)),
    remove: (name) => changing(() => client.removeServer(name)),
  }
}
