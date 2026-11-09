import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type AgentTools, type ToolRow } from '@althar/contracts'

import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { agentTools, fakeClient, installedSkill, skillCard } from './fixtures'
import { withServices } from './render'

/*
 * Settings › MCP servers and Settings › Skills: the person's own as tiles, opening in place; with none, where they will come
 * from; adding and removing in the person's agents' own files; and what is read saying while it is under way and in words
 * where it failed.
 */

function Settings({ at }: { at: Section }) {
  const [section, setSection] = useState<Section>(at)
  return <SettingsPage start={useStart({ recheck: true })} section={section} onSection={setSection} />
}

const row = (name: string, over: Partial<ToolRow> = {}): ToolRow => ({
  name,
  about: 'npx -y @scope/server',
  sources: [{ from: 'claude', where: '~/.claude.json' }],
  roles: ['lead', 'reviewer', 'coordinator'],
  here: { claude: 'in', codex: 'missing', opencode: 'missing' },
  offIn: [],
  repository: null,
  way: 'command',
  signIn: { claude: 'none', codex: 'unknown', opencode: 'unknown' },
  failed: null,
  home: null,
  from: null,
  ...over,
})

const tools = (over: Partial<AgentTools> = {}): AgentTools => ({ ...agentTools, ...over })

const main = () => within(screen.getByRole('main'))

describe('Settings › MCP servers', () => {
  it('says, with none, what will be here and where they come from, offers the ones often added, and keeps the sync switch below', async () => {
    withServices(<Settings at="mcp-servers" />, fakeClient({ getAgentTools: vi.fn(async () => tools()) }).client)
    expect(await main().findByRole('heading', { name: 'No MCP servers yet' })).toBeTruthy()
    // Each agent's own file, which Althar reads.
    for (const file of ['~/.claude.json', '~/.codex/config.toml', '~/.config/opencode/opencode.json'])
      expect(main().getByText(file)).toBeTruthy()
    for (const name of ['github', 'linear', 'figma', 'notion', 'playwright'])
      expect(main().getByRole('button', { name: `Add ${name}` })).toBeTruthy()
    expect(main().getByRole('button', { name: 'Another server' })).toBeTruthy()
    expect(main().getByRole('switch', { name: 'Same servers everywhere' })).toBeTruthy()
    // Nothing changed yet: the tile for what sync changed isn't there.
    expect(main().queryByRole('button', { name: /^What it changed/ })).toBeNull()
  })

  it('puts what failed first, then what waits on the person, then the rest, a round switch each', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () =>
        tools({
          servers: [
            row('context7'),
            row('linear', {
              signIn: { claude: 'yes', codex: 'no', opencode: 'unknown' },
              here: { claude: 'in', codex: 'added', opencode: 'missing' },
            }),
            row('notion', { failed: { agent: 'claude', why: 'Notion refused its sign-in', at: '2026-11-08T10:00:00.000Z' } }),
          ],
        }),
      ),
    })
    withServices(<Settings at="mcp-servers" />, client)
    await main().findByRole('button', { name: /^notion/ })
    const names = main()
      .getAllByRole('button', { name: /^(context7|linear|notion)/ })
      .map((one) => /^(context7|linear|notion)/.exec(one.textContent ?? '')?.[1])
    expect(names).toEqual(['notion', 'linear', 'context7'])
    expect(main().getByText('Failed to start')).toBeTruthy()
    expect(main().getByText('Codex isn’t signed in')).toBeTruthy()
    // The round switch gives it to every role or none.
    await userEvent.click(main().getByRole('switch', { name: 'context7' }))
    expect(client.setToolRoles).toHaveBeenCalledWith('server', 'context7', [], null, null)
  })

  it('opens a server in place, with each agent’s own file and its tools counted, and back returns to its tile', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools({ servers: [row('linear', { about: 'https://mcp.linear.app/mcp', way: 'address' })] })),
      getServerDetail: vi.fn(async (name: string) => ({
        name,
        runs: 'https://mcp.linear.app/mcp',
        files: [
          {
            agent: 'claude' as const,
            where: '~/.claude.json',
            state: 'yours' as const,
            lines: ['"linear": {', '  "type": "http"', '}'],
            runs: 'https://mcp.linear.app/mcp',
            why: null,
            signIn: 'yes' as const,
          },
        ],
        tools: 23,
        toolsWhy: null,
      })),
    })
    withServices(<Settings at="mcp-servers" />, client)
    await userEvent.click(await main().findByRole('button', { name: /^linear/ }))
    expect(await main().findByText('23 tools')).toBeTruthy()
    expect(client.getServerDetail).toHaveBeenCalledWith('linear', null)
    expect(main().getByText('~/.claude.json')).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(document.activeElement).toBe(main().getByRole('button', { name: /^linear/ })))
  })

  it('says in words where an opened server’s files couldn’t be read, and reads them again on request', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools({ servers: [row('linear')] })),
      getServerDetail: vi
        .fn()
        .mockRejectedValueOnce(new ApiError({ reason: 'ServerRefused', message: 'The file is unreadable.' }))
        .mockResolvedValue({
          name: 'linear',
          runs: 'x',
          files: [],
          tools: null,
          toolsWhy: 'It needs a sign-in first.',
        }),
    })
    withServices(<Settings at="mcp-servers" />, client)
    await userEvent.click(await main().findByRole('button', { name: /^linear/ }))
    expect(await main().findByText(/The file is unreadable/)).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(vi.mocked(client.getServerDetail).mock.calls.length).toBe(2))
  })

  it('removes a server from every agent once the person confirms, naming where it comes out of', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () =>
        tools({ servers: [row('linear', { here: { claude: 'in', codex: 'added', opencode: 'missing' } })] }),
      ),
      getServerDetail: vi.fn(async (name: string) => ({
        name,
        runs: 'x',
        files: [
          {
            agent: 'claude' as const,
            where: '~/.claude.json',
            state: 'yours' as const,
            lines: [],
            runs: 'x',
            why: null,
            signIn: 'none' as const,
          },
          {
            agent: 'codex' as const,
            where: '~/.codex/config.toml',
            state: 'copied' as const,
            lines: [],
            runs: 'x',
            why: null,
            signIn: 'none' as const,
          },
          {
            agent: 'opencode' as const,
            where: '~/.config/opencode/opencode.json',
            state: 'missing' as const,
            lines: [],
            runs: 'x',
            why: null,
            signIn: 'unknown' as const,
          },
        ],
        tools: null,
        toolsWhy: null,
      })),
    })
    withServices(<Settings at="mcp-servers" />, client)
    await userEvent.click(await main().findByRole('button', { name: /^linear/ }))
    await screen.findByText('~/.codex/config.toml')
    await userEvent.click(await main().findByRole('button', { name: 'Remove…' }))
    const asked = await screen.findByRole('dialog', { name: 'Remove linear?' })
    const dialog = within(asked)
    const words = asked.textContent
    expect(words).toContain('Claude Code')
    expect(words).toContain('Codex')
    expect(words).not.toContain('OpenCode')
    expect(client.removeServer).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(client.removeServer).toHaveBeenCalledWith('linear'))
  })

  it('adds a server to the agents pressed, in their own files, and says in words what couldn’t be done', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools()),
      addServer: vi
        .fn()
        .mockRejectedValueOnce(new Error('Codex wasn’t changed: its codex command isn’t on this computer.'))
        .mockResolvedValue(undefined),
    })
    withServices(<Settings at="mcp-servers" />, client)
    await userEvent.click(await main().findByRole('button', { name: 'Add playwright' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect((dialog.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('playwright')
    await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.addServer).toHaveBeenCalledTimes(1))
    expect(await dialog.findByRole('alert')).toHaveProperty(
      'textContent',
      'Codex wasn’t changed: its codex command isn’t on this computer.',
    )
    // The one that went through isn't undone: the form stays to try again, which goes out as it was given.
    await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.addServer).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows its place while the servers are read, and says in words where they couldn’t be, with a way to try again', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(tools()) })
    withServices(<Settings at="mcp-servers" />, client)
    expect(await main().findByText('Your agents’ MCP servers couldn’t be read.')).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: 'Try again' }))
    expect(await main().findByRole('heading', { name: 'No MCP servers yet' })).toBeTruthy()
  })

  it('says where this Althar reads no agent’s settings, and nothing else', async () => {
    withServices(<Settings at="mcp-servers" />, fakeClient({ getAgentTools: vi.fn(async () => tools({ enabled: false })) }).client)
    expect(await main().findByText(/doesn’t read your agents’ settings/)).toBeTruthy()
  })

  it('asks the agents how their servers stand as it opens', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools({ servers: [row('linear')] })) })
    withServices(<Settings at="mcp-servers" />, client)
    await main().findByRole('button', { name: /^linear/ })
    await waitFor(() => expect(client.checkServers).toHaveBeenCalledTimes(1))
  })
})

describe('Settings › Skills', () => {
  it('says, with none, what will be here and where they come from, with Add from GitHub and Same skills everywhere', async () => {
    withServices(
      <Settings at="skills" />,
      fakeClient({ getAgentTools: vi.fn(async () => tools()), listSkills: vi.fn(async () => ({ enabled: true, skills: [] })) }).client,
    )
    expect(await main().findByRole('heading', { name: 'No skills yet' })).toBeTruthy()
    for (const folder of ['~/.claude/skills', '~/.agents/skills', '~/.config/opencode/skills'])
      expect(main().getByText(folder)).toBeTruthy()
    expect(main().getByRole('button', { name: 'Add from GitHub' })).toBeTruthy()
    expect(main().getByRole('switch', { name: 'Same skills everywhere' })).toBeTruthy()
    // Althar ships none of its own.
    expect(main().queryByText(/agent-skills|superpowers|catalog/)).toBeNull()
  })

  it('lists the person’s skills, a switch each giving it to every role or none', async () => {
    const own = row('impeccable', { about: 'Design that holds up.', home: '~/.claude/skills/impeccable' })
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools({ skills: [own] })) })
    withServices(<Settings at="skills" />, client)
    await userEvent.click(await main().findByRole('switch', { name: 'impeccable' }))
    expect(client.setToolRoles).toHaveBeenCalledWith('skill', 'impeccable', [], null, null)
  })

  it('shows Update ready on one added from GitHub with a newer version, and reviews the update as an update of the one installed', async () => {
    const from = { repo: 'acme/agent-skills', subpath: 'skills/release-notes', ref: 'main', sha: 'a'.repeat(40) }
    const added = row('release-notes', {
      about: 'Write the notes.',
      from,
      home: 'Althar’s store',
      sources: [{ from: 'althar', where: 'Althar’s store' }],
    })
    const card = {
      ...skillCard,
      installed: {
        source: 'github' as const,
        repo: from.repo,
        subpath: from.subpath,
        treeHash: 'b'.repeat(64),
        review: 'reviewed' as const,
        active: true,
      },
    }
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools({ skills: [added] })),
      listSkills: vi.fn(async () => ({
        enabled: true,
        skills: [{ ...installedSkill, id: 'release-notes', source: 'github' as const, repo: from.repo }],
      })),
      checkSkillUpdates: vi.fn(async () => [{ id: 'release-notes', state: 'available' as const, card }]),
    })
    withServices(<Settings at="skills" />, client)
    expect(await main().findByText('Update ready')).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: /^release-notes/ }))
    await userEvent.click(await main().findByRole('button', { name: 'Update' }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.click(await dialog.findByRole('button', { name: 'Update' }))
    await waitFor(() => expect(client.approveSkill).toHaveBeenCalledWith(card, false))
  })

  it('removes one added from GitHub from its sheet, and gives the person’s own folder skills no Remove', async () => {
    const from = { repo: 'acme/agent-skills', subpath: 'skills/release-notes', ref: 'main', sha: 'a'.repeat(40) }
    const added = row('release-notes', { from, home: 'Althar’s store' })
    const folder = row('impeccable', { home: '~/.claude/skills/impeccable' })
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools({ skills: [added, folder] })) })
    withServices(<Settings at="skills" />, client)
    await userEvent.click(await main().findByRole('button', { name: /^impeccable/ }))
    expect(main().queryByRole('button', { name: 'Remove…' })).toBeNull()
    await userEvent.click(main().getByRole('button', { name: 'Back' }))
    await userEvent.click(await main().findByRole('button', { name: /^release-notes/ }))
    await userEvent.click(await main().findByRole('button', { name: 'Remove…' }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(client.uninstallSkill).toHaveBeenCalledWith('release-notes'))
  })

  it('adds one from GitHub only once its card is read, and shuts the dialog once it is added', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools()),
      listSkills: vi.fn(async () => ({ enabled: true, skills: [] })),
    })
    withServices(<Settings at="skills" />, client)
    await userEvent.click(await main().findByRole('button', { name: 'Add from GitHub' }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.type(dialog.getByRole('textbox', { name: 'Install a skill from GitHub' }), 'acme/agent-skills')
    await userEvent.click(dialog.getByRole('button', { name: 'Find skills' }))
    await userEvent.click(await dialog.findByRole('button', { name: 'Review' }))
    expect(client.stageSkill).toHaveBeenCalledWith({ repo: 'acme/agent-skills', ref: 'HEAD', subpath: 'skills/release-notes' })
    const card = await dialog.findByRole('region', { name: 'release-notes' })
    expect(client.approveSkill).not.toHaveBeenCalled()
    await userEvent.click(within(card).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(client.approveSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-notes' }), false))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers to replace a skill of the same name from another folder of the same repository, not to update it', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools()),
      listSkills: vi.fn(async () => ({ enabled: true, skills: [] })),
    })
    const installed = { source: 'github' as const, treeHash: 'b'.repeat(64), review: 'reviewed' as const, active: true }
    vi.mocked(client.stageSkill).mockResolvedValue({
      ...skillCard,
      installed: { ...installed, repo: 'acme/agent-skills', subpath: 'old/release-notes' },
    })
    withServices(<Settings at="skills" />, client)
    await userEvent.click(await main().findByRole('button', { name: 'Add from GitHub' }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.type(dialog.getByRole('textbox', { name: 'Install a skill from GitHub' }), 'acme/agent-skills')
    await userEvent.click(dialog.getByRole('button', { name: 'Find skills' }))
    await userEvent.click(await dialog.findByRole('button', { name: 'Review' }))
    const card = await dialog.findByRole('region', { name: 'release-notes' })
    await userEvent.click(within(card).getByRole('button', { name: 'Install in place of the one from acme/agent-skills' }))
    await waitFor(() => expect(client.approveSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-notes' }), true))
  })

  it('says in words where the skills couldn’t be read, with a way to try again', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(tools()) })
    withServices(<Settings at="skills" />, client)
    expect(await main().findByText('Your skills couldn’t be read.')).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: 'Try again' }))
    expect(await main().findByRole('heading', { name: 'No skills yet' })).toBeTruthy()
  })

  it('says in words where the store itself couldn’t be read at first, not staying on its loading state, and reads it again on request', async () => {
    const own = row('impeccable', { about: 'Design that holds up.', home: '~/.claude/skills/impeccable' })
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools({ skills: [own] })),
      listSkills: vi.fn().mockRejectedValueOnce(new Error('installs.json is unreadable')).mockResolvedValue({ enabled: true, skills: [] }),
    })
    withServices(<Settings at="skills" />, client)
    expect(await main().findByText('Your skills couldn’t be read.')).toBeTruthy()
    await userEvent.click(main().getByRole('button', { name: 'Try again' }))
    expect(await main().findByRole('button', { name: /^impeccable/ })).toBeTruthy()
  })
})
