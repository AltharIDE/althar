import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from '../Config'
import { agentTools, setSkillRoles, setToolInProject, setToolRoles, syncIo } from '../agentTools'
import { addServer, removeServer, serverDetail } from '../mcpAdd'
import { checkHealth } from '../mcpHealth'
import * as mcpSync from '../mcpSync'
import * as skillSync from '../skillSync'
import type { ApiKit } from './kit'

/** Runs one of sync's steps against the person's agents' settings, where this runtime reads them; refused where it doesn't. */
const withSync = (step: (io: mcpSync.SyncIo & skillSync.SkillIo) => Promise<unknown>) =>
  Effect.gen(function* () {
    const io = yield* syncIo
    if (io === undefined) return yield* Effect.fail(new Error('This Althar doesn’t read your agents’ settings.'))
    yield* Effect.tryPromise({ try: () => step(io), catch: (error) => (error instanceof Error ? error : new Error(String(error))) })
  })

/**
 * The person's MCP servers and tools: which roles and projects get each, a server's detail, checking, adding and removing.
 * Syncing them across agents' own files, and a server's sign-in.
 */
export const toolsHandlers = ({ api, skillAct }: ApiKit) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const config = yield* RuntimeConfig
    return {
      GetAgentTools: ({ projectId }) =>
        api(agentTools(projectId)).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.provideService(RuntimeConfig, config)),
      SetToolRoles: ({ commandId, kind, name, roles, projectId, repository }) =>
        api(
          kind === 'server'
            ? setToolRoles(kind, name, roles, projectId, repository ?? null)
            : // A skill added from GitHub is on while any role gets it, which turns it on or off in the store, as a switch there did.
              Effect.gen(function* () {
                const turned = yield* setSkillRoles(config.skills, name, roles, projectId, repository ?? null)
                if (turned !== undefined)
                  yield* skillAct(commandId, turned.id, turned.active ? 'turned_on' : 'turned_off', { treeHash: turned.treeHash })
              }),
        ).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetToolInProject: ({ kind, name, projectId, on }) =>
        api(setToolInProject(kind, name, projectId, on)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      GetServerDetail: ({ name, repository }) =>
        api(serverDetail(name, repository)).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(RuntimeConfig, config),
        ),
      AddServer: ({ server, agents }) =>
        api(withSync((io) => addServer(io, server, agents))).pipe(Effect.provideService(RuntimeConfig, config)),
      RemoveServer: ({ name }) => api(withSync((io) => removeServer(io, name))).pipe(Effect.provideService(RuntimeConfig, config)),
      SetToolSync: ({ kind, on, takeBack }) =>
        api(
          withSync((io) =>
            kind === 'server'
              ? on
                ? mcpSync.turnOn(io)
                : mcpSync.turnOff(io, takeBack)
              : mcpSync.serialized(io, () => (on ? skillSync.turnSkillsOn(io) : skillSync.turnSkillsOff(io, takeBack))),
          ),
        ).pipe(Effect.provideService(RuntimeConfig, config)),
      // A read of how the person's servers stand in their agents, kept for the tiles; a runtime that doesn't read their agents asks none.
      CheckServers: () =>
        api(
          Effect.gen(function* () {
            const io = yield* syncIo
            if (io !== undefined) yield* Effect.promise(() => checkHealth(io))
          }),
        ).pipe(Effect.provideService(RuntimeConfig, config)),
      SetToolKeptOut: ({ kind, agent, name, out }) =>
        api(
          withSync((io) =>
            kind === 'server'
              ? out
                ? mcpSync.keepOut(io, agent, name)
                : mcpSync.putBack(io, agent, name)
              : mcpSync.serialized(io, () => (out ? skillSync.keepSkillOut(io, agent, name) : skillSync.putSkillBack(io, agent, name))),
          ),
        ).pipe(Effect.provideService(RuntimeConfig, config)),
      PickToolWay: ({ kind, name, way }) =>
        api(
          withSync((io) =>
            kind === 'server' ? mcpSync.pickWay(io, name, way) : mcpSync.serialized(io, () => skillSync.pickSkill(io, name, way)),
          ),
        ).pipe(Effect.provideService(RuntimeConfig, config)),
      UndoToolSync: ({ id }) => api(withSync((io) => mcpSync.undoSince(io, id))).pipe(Effect.provideService(RuntimeConfig, config)),
      SignInToolServer: ({ agent, name }) =>
        api(
          Effect.gen(function* () {
            const io = yield* syncIo
            const line = io === undefined ? undefined : mcpSync.signIn(io, agent, name)
            if (line !== undefined && config.openTerminal !== undefined) yield* config.openTerminal(line)
          }),
        ).pipe(Effect.provideService(RuntimeConfig, config)),
    } satisfies Partial<ApiHandlers>
  })
