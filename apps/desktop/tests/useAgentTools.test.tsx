import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentTools, ToolRow } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { useAgentTools } from '../src/renderer/features/settings/useAgentTools'
import { agentTools, fakeClient } from './fixtures'
import { servicesFor } from './render'

/*
 * The person's MCP servers as Settings changes them: a switch shows at once and is kept; adding a server and removing one say,
 * in words, what couldn't be done and read the tiles again; the agents are asked how their servers stand as the servers open,
 * and not again for a while.
 */

const row = (name: string, over: Partial<ToolRow> = {}): ToolRow => ({
  name,
  about: 'npx @playwright/mcp@latest',
  sources: [{ from: 'opencode', where: '~/.config/opencode/opencode.json' }],
  roles: ['lead', 'reviewer', 'coordinator'],
  here: { claude: 'missing', codex: 'missing', opencode: 'in' },
  offIn: [],
  repository: null,
  way: 'command',
  signIn: { claude: 'unknown', codex: 'unknown', opencode: 'none' },
  failed: null,
  home: null,
  from: null,
  ...over,
})

const tools = (over: Partial<AgentTools> = {}): AgentTools => ({ ...agentTools, servers: [row('playwright')], ...over })

const hook = (client = fakeClient().client, options: Parameters<typeof useAgentTools>[0] = {}) => {
  const services = servicesFor(client)
  return renderHook(() => useAgentTools(options), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('a round switch', () => {
  it('shows at once what roles get the server, and keeps it', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools()) })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools?.servers).toHaveLength(1))
    act(() => result.current.setRoles('server', 'playwright', [], null))
    expect(result.current.tools?.servers[0]?.roles).toEqual([])
    expect(client.setToolRoles).toHaveBeenCalledWith('server', 'playwright', [], null, null)
  })

  it('names the project whose repository holds a server of its own, so one of the same name isn’t turned with it', async () => {
    const own = row('site-browser', { repository: 'p1', roles: [] })
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools({ servers: [row('site-browser'), own] })) })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools?.servers).toHaveLength(2))
    act(() => result.current.setRoles('server', 'site-browser', ['lead'], 'p1'))
    expect(result.current.tools?.servers.map((one) => [one.repository, one.roles.length])).toEqual([
      [null, 3],
      ['p1', 1],
    ])
    expect(client.setToolRoles).toHaveBeenCalledWith('server', 'site-browser', ['lead'], null, 'p1')
  })
})

describe('a project’s mark', () => {
  it('pressed out shows at once, and pressed in again goes back', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools()) })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools?.servers).toHaveLength(1))
    act(() => result.current.setInProject('server', 'playwright', 'p1', false))
    expect(result.current.tools?.servers[0]?.offIn).toEqual(['p1'])
    expect(client.setToolInProject).toHaveBeenLastCalledWith('server', 'playwright', 'p1', false)
    act(() => result.current.setInProject('server', 'playwright', 'p1', true))
    expect(result.current.tools?.servers[0]?.offIn).toEqual([])
  })
})

describe('adding and removing a server', () => {
  it('adds to the agents given, reads the tiles again, and says nothing where it went through', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools()) })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools).toBeDefined())
    const reads = vi.mocked(client.getAgentTools).mock.calls.length
    let failed: string | null = 'unset'
    await act(async () => {
      failed = await result.current.add({ name: 'linear', url: 'https://mcp.linear.app/mcp' }, ['opencode'])
    })
    expect(failed).toBeNull()
    expect(client.addServer).toHaveBeenCalledWith({ name: 'linear', url: 'https://mcp.linear.app/mcp' }, ['opencode'])
    await waitFor(() => expect(vi.mocked(client.getAgentTools).mock.calls.length).toBeGreaterThan(reads))
    expect(result.current.busy).toBe(false)
  })

  it('says in the runtime’s words what it couldn’t do, and still reads what did go through', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools()),
      addServer: vi.fn(async () => {
        throw new Error('Codex wasn’t changed: its codex command isn’t on this computer.')
      }),
    })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools).toBeDefined())
    const reads = vi.mocked(client.getAgentTools).mock.calls.length
    let failed: string | null = null
    await act(async () => {
      failed = await result.current.add({ name: 'linear', url: 'https://mcp.linear.app/mcp' }, ['claude', 'codex'])
    })
    expect(failed).toBe('Codex wasn’t changed: its codex command isn’t on this computer.')
    await waitFor(() => expect(vi.mocked(client.getAgentTools).mock.calls.length).toBeGreaterThan(reads))
  })

  it('removes a server from every agent, and says why where it couldn’t', async () => {
    const { client } = fakeClient({
      getAgentTools: vi.fn(async () => tools()),
      removeServer: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('OpenCode wasn’t changed.')),
    })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.tools).toBeDefined())
    let first: string | null = 'unset'
    let second: string | null = null
    await act(async () => {
      first = await result.current.remove('playwright')
      second = await result.current.remove('playwright')
    })
    expect(first).toBeNull()
    expect(second).toBe('OpenCode wasn’t changed.')
    expect(client.removeServer).toHaveBeenCalledWith('playwright')
  })
})

describe('how the servers stand', () => {
  it('is asked of the agents as the servers open, once, and read again when they have answered', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools()) })
    const { result, rerender } = hook(client, { check: true })
    await waitFor(() => expect(client.checkServers).toHaveBeenCalledTimes(1))
    rerender()
    await waitFor(() => expect(result.current.tools).toBeDefined())
    expect(client.checkServers).toHaveBeenCalledTimes(1)
  })

  it('is not asked again while it was asked a few minutes ago', async () => {
    const lately = new Date(Date.now() - 60_000).toISOString()
    const { client } = fakeClient({ getAgentTools: vi.fn(async () => tools({ checkedAt: lately })) })
    const { result } = hook(client, { check: true })
    await waitFor(() => expect(result.current.tools?.checkedAt).toBe(lately))
    expect(client.checkServers).not.toHaveBeenCalled()
  })

  it('is not asked where the runtime reads no agent’s settings, nor where the section only lists skills', async () => {
    const off = fakeClient({ getAgentTools: vi.fn(async () => ({ ...agentTools, enabled: false })) })
    const first = hook(off.client, { check: true })
    await waitFor(() => expect(first.result.current.tools?.enabled).toBe(false))
    expect(off.client.checkServers).not.toHaveBeenCalled()
    const skills = fakeClient({ getAgentTools: vi.fn(async () => tools()) })
    const second = hook(skills.client)
    await waitFor(() => expect(second.result.current.tools).toBeDefined())
    expect(skills.client.checkServers).not.toHaveBeenCalled()
  })

  it('says a read that failed, and reads again on request', async () => {
    const { client } = fakeClient({ getAgentTools: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(tools()) })
    const { result } = hook(client)
    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.tools?.servers).toHaveLength(1))
    expect(result.current.loadFailed).toBe(false)
  })
})
