import { describe, expect, it } from 'vitest'

import type { AgentStatus, ServerDetail, SyncView, ToolRow } from '@althar/contracts'
import { Brand } from '@althar/ui'

import { agentsOf, filesOf, serverTileOf, skillTileOf, syncOf, toolId } from '../src/renderer/features/settings/tools'
import { agentTools, status } from './fixtures'

/*
 * What the runtime reads of the person's servers and skills, as the tiles take it: a field for a field, so the kit's own
 * words say it, with a repository's own told from the person's of the same name.
 */

const row = (over: Partial<ToolRow> = {}): ToolRow => ({
  name: 'linear',
  about: 'https://mcp.linear.app/mcp',
  sources: [{ from: 'claude', where: '~/.claude.json' }],
  roles: ['lead', 'reviewer', 'coordinator'],
  here: { claude: 'in', codex: 'added', opencode: 'missing' },
  offIn: [],
  repository: null,
  way: 'address',
  signIn: { claude: 'yes', codex: 'no', opencode: 'unknown' },
  failed: null,
  home: null,
  from: null,
  ...over,
})

describe('the person’s agents', () => {
  const claude = status.agents.find((agent) => agent.id === 'claude-code') as AgentStatus

  it('are the three whose own files are read, each with where it keeps its servers and skills', () => {
    const agents = agentsOf(agentTools, [])
    expect(agents.map((agent) => [agent.id, agent.name, agent.brand, agent.file, agent.folder])).toEqual([
      ['claude', 'Claude Code', Brand.ClaudeCode, '~/.claude.json', '~/.claude/skills'],
      ['codex', 'Codex', Brand.Codex, '~/.codex/config.toml', '~/.agents/skills'],
      ['opencode', 'OpenCode', Brand.OpenCode, '~/.config/opencode/opencode.json', '~/.config/opencode/skills'],
    ])
  })

  it('count as signed in only where the agent is on this computer and signed in, by the id the registry gives it', () => {
    expect(agentsOf(agentTools, [{ ...claude, installed: true, signIn: 'signed_in' }])[0]?.signedIn).toBe(true)
    expect(agentsOf(agentTools, [{ ...claude, installed: true, signIn: 'signed_out' }])[0]?.signedIn).toBe(false)
    expect(agentsOf(agentTools, [{ ...claude, installed: false, signIn: 'signed_in' }])[0]?.signedIn).toBe(false)
    expect(agentsOf(agentTools, [])[0]?.signedIn).toBe(false)
  })

  it('are listed, with nowhere named, before the runtime has read them', () => {
    expect(agentsOf(undefined, []).map((agent) => agent.file)).toEqual(['', '', ''])
  })
})

describe('a server as a tile', () => {
  it('has its mark where its name says one, and the failure the runtime kept', () => {
    const tile = serverTileOf(
      row({ name: 'github', failed: { agent: 'claude', why: 'It exited with code 1', at: '2026-11-08T10:00:00.000Z' } }),
    )
    expect(tile).toMatchObject({
      id: 'github',
      name: 'github',
      brand: Brand.GitHub,
      failed: { agent: 'claude', why: 'It exited with code 1' },
    })
    expect('brand' in serverTileOf(row({ name: 'playwright' }))).toBe(false)
  })

  it('keeps a repository’s own apart from the person’s of the same name', () => {
    expect(toolId(row())).toBe('linear')
    expect(toolId(row({ repository: 'p1' }))).toBe('p1:linear')
    expect(serverTileOf(row({ repository: 'p1' })).repository).toBe('p1')
  })
})

describe('a skill as a tile', () => {
  it('says where it was added from, and whether a newer version waits', () => {
    const from = { repo: 'acme/agent-skills', subpath: 'skills/notes', ref: 'main', sha: 'a'.repeat(40) }
    expect(skillTileOf(row({ name: 'notes', about: 'Write the notes.', from, home: 'Althar’s store' }), true)).toMatchObject({
      id: 'notes',
      about: 'Write the notes.',
      from: 'acme/agent-skills',
      home: 'Althar’s store',
      update: true,
    })
    expect(skillTileOf(row({ name: 'notes' }), false)).toMatchObject({ from: null, update: false })
  })
})

describe('what an opened server shows', () => {
  it('is each agent’s file as the runtime read it', () => {
    const detail: ServerDetail = {
      name: 'linear',
      runs: 'https://mcp.linear.app/mcp',
      files: [
        {
          agent: 'codex',
          where: '~/.codex/config.toml',
          state: 'copied',
          lines: ['[mcp_servers.linear]'],
          runs: 'https://…',
          why: null,
          signIn: 'no',
        },
      ],
      tools: 23,
      toolsWhy: null,
    }
    expect(filesOf(detail)).toEqual([
      { agent: 'codex', where: '~/.codex/config.toml', state: 'copied', lines: ['[mcp_servers.linear]'], why: null, signIn: 'no' },
    ])
  })
})

describe('what sync did', () => {
  it('is each file’s additions and each change with its undo, dated as the page says it', () => {
    const view: SyncView = {
      on: true,
      settle: [],
      since: [{ id: 's1', at: 'not a date', name: 'notion', kind: 'copied', from: 'claude', to: ['codex', 'opencode'], undone: false }],
      targets: [{ agent: 'codex', where: '~/.codex/config.toml', adds: ['notion'], out: [] }],
      errors: ['Codex wasn’t changed.'],
    }
    expect(syncOf(view)).toEqual({
      on: true,
      targets: [{ agent: 'codex', where: '~/.codex/config.toml', adds: ['notion'] }],
      changes: [{ id: 's1', at: 'not a date', name: 'notion', kind: 'copied', from: 'claude', to: ['codex', 'opencode'], undone: false }],
      errors: ['Codex wasn’t changed.'],
    })
  })
})
