import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Status } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useStart } from '../src/renderer/features/start/useStart'
import { connectionList, fakeClient, githubConnection, status, usual } from './fixtures'
import { servicesFor } from './render'

/*
 * An account renamed, moved or removed, and a connection disconnected, show so from the press, before the runtime has
 * them (docs/decisions/foundations.md, The UI is instant), and come back, saying why, where they didn't go through.
 */

/** An answer the test gives when it says, as a busy runtime's. */
const later = () => {
  let settle: { resolve: () => void; reject: (failure: unknown) => void } = { resolve: () => undefined, reject: () => undefined }
  const promise = new Promise<void>((resolve, reject) => (settle = { resolve, reject }))
  return { promise, ...settle }
}

const withTwo: Status = {
  ...status,
  agents: status.agents.map((agent) =>
    agent.id === 'claude-code'
      ? { ...agent, accounts: [usual('acc_claude', 'signed_in'), { ...usual('acc_work', 'signed_in'), name: 'Work' }] }
      : agent,
  ),
}

const accountsOf = (shown: Status | null) =>
  shown?.agents.find((agent) => agent.id === 'claude-code')?.accounts.map((account) => [account.id, account.name])

const render = <T,>(use: () => T, client: Parameters<typeof servicesFor>[0]) => {
  const services = servicesFor(client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  return renderHook(use, { wrapper })
}

describe('an account changed', () => {
  it.each([
    [
      'renamed',
      (model: ReturnType<typeof useStart>) => model.renameAccount('acc_work', 'Personal'),
      'renameAccount',
      [
        ['acc_claude', usual('acc_claude', 'signed_in').name],
        ['acc_work', 'Personal'],
      ],
    ],
    [
      'moved up',
      (model: ReturnType<typeof useStart>) => model.moveAccount('claude-code', 'acc_work', 'up'),
      'orderAccounts',
      [
        ['acc_work', 'Work'],
        ['acc_claude', usual('acc_claude', 'signed_in').name],
      ],
    ],
    [
      'removed',
      (model: ReturnType<typeof useStart>) => model.removeAccount('acc_work'),
      'removeAccount',
      [['acc_claude', usual('acc_claude', 'signed_in').name]],
    ],
  ] as const)('shows so from the press when %s, before the runtime answers', async (_name, press, call, shown) => {
    const { client } = fakeClient({ status: vi.fn(async () => withTwo) })
    const answer = later()
    vi.mocked(client[call]).mockReturnValue(answer.promise)
    const { result } = render(() => useStart(), client)
    await waitFor(() => expect(result.current.status).not.toBeNull())
    act(() => void press(result.current))
    expect(accountsOf(result.current.status)).toEqual(shown)
    await act(async () => answer.resolve())
  })

  it('comes back as the runtime has it, saying why, where it wasn’t renamed', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => withTwo) })
    vi.mocked(client.renameAccount).mockRejectedValue(new ApiError({ reason: 'Taken', message: 'Another account has that name.' }))
    const { result } = render(() => useStart(), client)
    await waitFor(() => expect(result.current.status).not.toBeNull())
    await act(() => result.current.renameAccount('acc_work', 'Personal'))
    expect(accountsOf(result.current.status)).toEqual([
      ['acc_claude', usual('acc_claude', 'signed_in').name],
      ['acc_work', 'Work'],
    ])
    expect(result.current.error).toBe('Another account has that name.')
  })
})

describe('a connection disconnected', () => {
  const connected = { ...connectionList, connections: [githubConnection] }

  it('is gone from the press, though a read from before it lands', async () => {
    const listConnections = vi.fn(async () => connected)
    const { client } = fakeClient({ listConnections })
    const answer = later()
    vi.mocked(client.disconnect).mockReturnValue(answer.promise)
    const { result } = render(() => useConnections(), client)
    await waitFor(() => expect(result.current.list?.connections).toHaveLength(1))
    act(() => void result.current.disconnect(githubConnection.id))
    expect(result.current.list?.connections).toEqual([])
    listConnections.mockResolvedValue({ ...connected })
    await act(async () => answer.resolve())
    // Read again after, without it: gone as the runtime has it.
    listConnections.mockResolvedValue({ ...connectionList, connections: [] })
    await waitFor(() => expect(listConnections).toHaveBeenCalledTimes(2))
    expect(result.current.list?.connections).toEqual([])
  })

  it('comes back where it couldn’t be disconnected, saying why', async () => {
    const { client } = fakeClient({ listConnections: vi.fn(async () => connected) })
    vi.mocked(client.disconnect).mockRejectedValue(new ApiError({ reason: 'InUse', message: 'A project still uses it.' }))
    const { result } = render(() => useConnections(), client)
    await waitFor(() => expect(result.current.list?.connections).toHaveLength(1))
    await act(() => result.current.disconnect(githubConnection.id))
    expect(result.current.list?.connections.map((one) => one.id)).toEqual([githubConnection.id])
    expect(result.current.error).toBe('A project still uses it.')
  })
})
