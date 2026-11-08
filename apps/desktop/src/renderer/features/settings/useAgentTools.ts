import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { AgentTools, SyncedAgent, ToolRole } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The person's MCP servers and skills, as Settings shows them (ADR-097):
 * for every project, or one picked above the table; and the two sync
 * switches. Each change goes to the runtime and the view is read again from
 * what it kept, as sync writes into the person's own files and only it knows
 * what went through; what didn't is said in its words.
 */

export interface AgentToolsModel {
  readonly tools: AgentTools | undefined
  readonly loadFailed: boolean
  readonly projectId: string | null
  readonly setProjectId: (projectId: string | null) => void
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly error: string | null
  readonly setRoles: (kind: 'server' | 'skill', name: string, roles: ReadonlyArray<ToolRole>) => void
  readonly setSync: (kind: 'server' | 'skill', on: boolean, takeBack: boolean) => void
  readonly keep: (kind: 'server' | 'skill', agent: SyncedAgent, name: string, out: boolean) => void
  readonly pick: (kind: 'server' | 'skill', name: string, way: SyncedAgent | 'apart') => void
  readonly undo: (id: string) => void
  readonly signIn: (agent: SyncedAgent, name: string) => void
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const useAgentTools = (): AgentToolsModel => {
  const { client, cache } = useServices()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = useQuery(reads(client).agentTools(projectId))
  const projects = useQuery(reads(client).projects()).data?.projects ?? []
  const after = useCallback(
    (change: Promise<unknown>) => {
      setError(null)
      void change.then(
        () => cache.invalidateQueries({ queryKey: ['agentTools'] }),
        (failed: unknown) => {
          setError(said(failed))
          void cache.invalidateQueries({ queryKey: ['agentTools'] })
        },
      )
    },
    [cache],
  )
  return {
    tools: query.data,
    loadFailed: query.isError,
    projectId,
    setProjectId,
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    error,
    setRoles: (kind, name, roles) => {
      cache.setQueryData<AgentTools>(keys.agentTools(projectId), (was) =>
        was === undefined
          ? was
          : {
              ...was,
              [kind === 'server' ? 'servers' : 'skills']: (kind === 'server' ? was.servers : was.skills).map((row) =>
                row.name === name ? { ...row, roles: [...roles] } : row,
              ),
            },
      )
      after(client.setToolRoles(kind, name, roles, projectId))
    },
    setSync: (kind, on, takeBack) => after(client.setToolSync(kind, on, takeBack)),
    keep: (kind, agent, name, out) => after(client.setToolKeptOut(kind, agent, name, out)),
    pick: (kind, name, way) => after(client.pickToolWay(kind, name, way)),
    undo: (id) => after(client.undoToolSync(id)),
    signIn: (agent, name) => after(client.signInToolServer(agent, name)),
  }
}
