import type { AgentStatus, AgentTools, ServerDetail, SyncedAgent, SyncSince, SyncView, ToolRow } from '@althar/contracts'
import {
  Brand,
  type ServerTileModel,
  type SkillTileModel,
  type ToolAgentView,
  type ToolFileView,
  type ToolProjectView,
  type ToolSyncModel,
} from '@althar/ui'

import { serverBrand } from '../../shared/mcpServers'
import { kitInk } from '../../shared/inks'

/*
 * The person's MCP servers and skills as the kit's tiles take them: each field
 * of what the runtime reads maps onto a field of what the tiles show, so the
 * words are the kit's. The agents are the three whose own files Althar reads,
 * keyed as the runtime keys them (`claude`, `codex`, `opencode`), beside the
 * ids the registry gives the same agents (`claude-code`).
 */

/** The three agents whose settings are read, with the id the registry gives each. */
const SYNCED: ReadonlyArray<{ readonly id: SyncedAgent; readonly agent: string; readonly name: string; readonly brand: Brand }> = [
  { id: 'claude', agent: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode },
  { id: 'codex', agent: 'codex', name: 'Codex', brand: Brand.Codex },
  { id: 'opencode', agent: 'opencode', name: 'OpenCode', brand: Brand.OpenCode },
]

/** The person's agents, each with where it keeps its servers and skills and whether it is on this computer and signed in. */
export const agentsOf = (tools: AgentTools | undefined, status: ReadonlyArray<AgentStatus>): ReadonlyArray<ToolAgentView> =>
  SYNCED.map((one) => {
    const place = tools?.places.find((each) => each.agent === one.id)
    const here = status.find((agent) => agent.id === one.agent)
    return {
      id: one.id,
      name: one.name,
      brand: one.brand,
      file: place?.file ?? '',
      folder: place?.folder ?? '',
      signedIn: here?.installed === true && here.signIn === 'signed_in',
    }
  })

/** A project as the tiles name it. */
export const projectsOf = (
  projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly ink: Parameters<typeof kitInk>[0] }>,
): ReadonlyArray<ToolProjectView> => projects.map((project) => ({ id: project.id, name: project.name, ink: kitInk(project.ink) }))

/** A tile's key: a repository's own is told from the person's of the same name. */
export const toolId = (row: Pick<ToolRow, 'name' | 'repository'>) => (row.repository === null ? row.name : `${row.repository}:${row.name}`)

export const serverTileOf = (row: ToolRow): ServerTileModel => {
  const brand = serverBrand(row.name)
  return {
    id: toolId(row),
    name: row.name,
    ...(brand === undefined ? {} : { brand }),
    runs: row.about,
    roles: row.roles,
    offIn: row.offIn,
    repository: row.repository,
    here: row.here,
    signIn: row.signIn,
    failed: row.failed === null ? null : { agent: row.failed.agent, why: row.failed.why },
  }
}

export const skillTileOf = (row: ToolRow, update: boolean): SkillTileModel => ({
  id: toolId(row),
  name: row.name,
  about: row.about,
  roles: row.roles,
  offIn: row.offIn,
  repository: row.repository,
  here: row.here,
  home: row.home,
  from: row.from === null ? null : row.from.repo,
  update,
})

/** An agent's own file, as the opened server shows it. */
export const filesOf = (detail: ServerDetail): ReadonlyArray<ToolFileView> =>
  detail.files.map((file) => ({
    agent: file.agent,
    where: file.where,
    state: file.state,
    lines: file.lines,
    why: file.why,
    signIn: file.signIn,
  }))

/** When a line under What it changed happened, as the page says it. */
export const sinceWhen = (at: string) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** A sync switch as the tiles take it. */
export const syncOf = (view: SyncView): ToolSyncModel => ({
  on: view.on,
  targets: view.targets.map((target) => ({ agent: target.agent, where: target.where, adds: target.adds })),
  changes: view.since.map((each: SyncSince) => ({
    id: each.id,
    at: sinceWhen(each.at),
    name: each.name,
    kind: each.kind,
    from: each.from,
    to: each.to,
    undone: each.undone,
  })),
  errors: view.errors,
})
