import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Status } from '@althar/contracts'

import { useModels } from '../src/renderer/data/models'
import { ServicesProvider } from '../src/renderer/data/services'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useStart } from '../src/renderer/features/start/useStart'
import { connectionList, fakeClient, githubConnection, status, usual } from './fixtures'
import { servicesFor } from './render'

/*
 * An account renamed, moved, signed out or removed, and a connection disconnected, show so from the press, before the runtime has
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

  it('shows the usual folder’s account signed out from the press, and its agent’s models are read again once it is', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => withTwo) })
    const answer = later()
    vi.mocked(client.signOutAccount).mockReturnValue(answer.promise)
    // A picker shows the models meanwhile, as Settings' agent page does.
    const { result } = render(() => ({ start: useStart(), models: useModels() }), client)
    await waitFor(() => expect(result.current.start.status).not.toBeNull())
    await waitFor(() => expect(result.current.models).not.toBeNull())
    const signedIn = (shown: Status | null) =>
      shown?.agents.find((agent) => agent.id === 'claude-code')?.accounts.map((account) => [account.id, account.signIn])
    act(() => void result.current.start.signOutAccount('acc_claude'))
    expect(signedIn(result.current.start.status)).toEqual([
      ['acc_claude', 'signed_out'],
      ['acc_work', 'signed_in'],
    ])
    expect(client.signOutAccount).toHaveBeenCalledWith('acc_claude')
    const read = vi.mocked(client.getModels).mock.calls.length
    await act(async () => answer.resolve())
    await waitFor(() => expect(vi.mocked(client.getModels).mock.calls.length).toBeGreaterThan(read))
  })

  it('reads the models again once an account is moved, as they follow the accounts’ order', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => withTwo) })
    const { result } = render(() => ({ start: useStart(), models: useModels() }), client)
    await waitFor(() => expect(result.current.start.status).not.toBeNull())
    await waitFor(() => expect(result.current.models).not.toBeNull())
    const read = vi.mocked(client.getModels).mock.calls.length
    await act(() => result.current.start.moveAccount('claude-code', 'acc_work', 'up'))
    await waitFor(() => expect(vi.mocked(client.getModels).mock.calls.length).toBeGreaterThan(read))
  })

  it('holds a rename over a read begun before it, as a recheck on focus is, until a read after its answer', async () => {
    const renamed: Status = {
      ...withTwo,
      agents: withTwo.agents.map((agent) => ({
        ...agent,
        accounts: agent.accounts.map((account) => (account.id === 'acc_work' ? { ...account, name: 'Personal' } : account)),
      })),
    }
    const before = later()
    let runtimeHas = withTwo
    const reads = vi.fn(async (asked?: { readonly recheck?: boolean }) => {
      // The recheck began before the rename, and answers as the runtime had it then, whenever it lands.
      if (asked?.recheck === true) {
        await before.promise
        return withTwo
      }
      return runtimeHas
    })
    const { client } = fakeClient({ status: reads })
    const answer = later()
    vi.mocked(client.renameAccount).mockReturnValue(answer.promise)
    const { result } = render(() => useStart(), client)
    await waitFor(() => expect(result.current.status).not.toBeNull())
    let rechecked: Promise<unknown> = Promise.resolve()
    act(() => {
      rechecked = result.current.recheck()
    })
    act(() => void result.current.renameAccount('acc_work', 'Personal'))
    // The read from before lands, in the cache and drawn: the rename still shows.
    await act(async () => {
      before.resolve()
      await rechecked
      await new Promise((drawn) => setTimeout(drawn, 0))
    })
    expect(accountsOf(result.current.status)).toContainEqual(['acc_work', 'Personal'])
    // Kept, and read after: the runtime's word, which has it.
    runtimeHas = renamed
    await act(async () => answer.resolve())
    await waitFor(() => expect(accountsOf(result.current.status)).toContainEqual(['acc_work', 'Personal']))
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
