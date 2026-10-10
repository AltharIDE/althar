import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type MemoryDetail } from '@althar/contracts'

import { MemoryView } from '../src/renderer/features/memory/MemoryView'
import { useMemory } from '../src/renderer/features/memory/useMemory'
import { fakeClient } from './fixtures'
import { withServices } from './render'

const evidence: MemoryDetail = {
  id: 'memory1',
  projectId: 'p1',
  threadId: 'thread1',
  taskId: 'task1',
  taskTitle: 'Fix login',
  sessionId: 'session1',
  agentId: 'claude',
  kind: 'tool_call',
  text: 'Login experiment failed; token expiry is only a hypothesis.',
  createdAt: '2026-10-10T10:00:00Z',
  revision: 3,
  sourceRevision: 2,
  state: 'active',
  bases: [{ repository: 'app', ref: 'repo1', commit: 'abc123', branch: 'fix/login' }],
  source: {
    kind: 'tool_call',
    text: 'Observed failure: exit 1. Cause unresolved.',
    revision: 2,
    truncated: false,
    offset: 0,
    nextOffset: null,
  },
  history: [{ sourceRevision: 1, text: 'Attempt running', recordedAt: '2026-10-10T09:00:00Z' }],
  historyTruncated: false,
  relatedUpdates: [],
  contextNotice: 'Historical source; inspect the full timeline.',
}
function Memory({ onSource = vi.fn() }: { onSource?: (entry: MemoryDetail) => void }) {
  return <MemoryView model={useMemory('p1')} onBack={vi.fn()} onSource={onSource} />
}

describe('project memory', () => {
  it('shows attributed failure evidence and historical bases, opens its source, and retires the revision actually read', async () => {
    const onSource = vi.fn()
    const { client } = fakeClient({
      searchMemory: vi.fn(async () => ({ entries: [evidence], pending: 0 })),
      readMemory: vi.fn(async () => evidence),
    })
    withServices(<Memory onSource={onSource} />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Login experiment failed/ }))
    expect(await screen.findByText('Observed failure: exit 1. Cause unresolved.')).toBeTruthy()
    expect(screen.getByText(/abc123/)).toBeTruthy()
    await userEvent.click(screen.getByText(/Revision 1/))
    expect(screen.getByText('Attempt running')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open source thread' }))
    expect(onSource).toHaveBeenCalledWith(evidence)
    await userEvent.click(screen.getByRole('button', { name: 'Retire memory' }))
    await waitFor(() =>
      expect(client.setMemoryState).toHaveBeenCalledWith({ projectId: 'p1', id: 'memory1', expectedRevision: 3, state: 'retired' }),
    )
  })

  it('refreshes a conflicting edit without claiming success and permits restoring retired evidence', async () => {
    const retired = { ...evidence, state: 'retired' as const, revision: 4 }
    const readMemory = vi.fn().mockResolvedValueOnce(evidence).mockResolvedValue(retired)
    const { client } = fakeClient({
      searchMemory: vi.fn(async () => ({ entries: [evidence], pending: 0 })),
      readMemory,
      setMemoryState: vi.fn(async () => false),
    })
    withServices(<Memory />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Login experiment failed/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Retire memory' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('changed while'))
    await userEvent.click(await screen.findByRole('button', { name: 'Restore memory' }))
    expect(client.setMemoryState).toHaveBeenLastCalledWith({ projectId: 'p1', id: 'memory1', expectedRevision: 4, state: 'active' })
  })

  it('searches only this project and resets pagination and selection when filters change', async () => {
    const { client } = fakeClient({
      searchMemory: vi.fn(async () => ({
        entries: Array.from({ length: 25 }, (_, index) => ({ ...evidence, id: `m${index}` })),
        pending: 2,
      })),
    })
    withServices(<Memory />, client)
    expect(await screen.findByText(/2 source updates/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(client.searchMemory).toHaveBeenLastCalledWith({ projectId: 'p1', query: '', includeRetired: false, offset: 25, limit: 25 }),
    )
    await userEvent.type(screen.getByRole('searchbox'), 'login')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include retired' }))
    await waitFor(() =>
      expect(client.searchMemory).toHaveBeenLastCalledWith({ projectId: 'p1', query: 'login', includeRetired: true, offset: 0, limit: 25 }),
    )
  })

  it('pages long source evidence and reports failed reads with an explicit retry', async () => {
    const readMemory = vi.fn(async (_project: string, _id: string, offset = 0) => ({
      ...evidence,
      source: {
        ...evidence.source,
        text: offset === 0 ? 'First evidence page' : 'Failure at the end',
        offset,
        nextOffset: offset === 0 ? 16000 : null,
        truncated: true,
      },
    }))
    const searchMemory = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'MemoryUnavailable', message: 'Memory is temporarily unavailable.' }))
      .mockResolvedValue({ entries: [evidence], pending: 0 })
    const { client } = fakeClient({ searchMemory, readMemory })
    withServices(<Memory />, client)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Memory is temporarily unavailable.')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await userEvent.click(await screen.findByRole('button', { name: /Login experiment failed/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'More evidence' }))
    expect(await screen.findByText('Failure at the end')).toBeTruthy()
    expect(readMemory).toHaveBeenLastCalledWith('p1', 'memory1', 16000)
  })
  it('shows attributed update candidates and opens their actual source', async () => {
    const update = { ...evidence, id: 'correction', kind: 'agent_message', text: 'Correction: the fixture reused an account.' }
    const readMemory = vi.fn(async (_project: string, id: string) =>
      id === 'correction' ? update : { ...evidence, relatedUpdates: [update] },
    )
    const { client } = fakeClient({ searchMemory: vi.fn(async () => ({ entries: [evidence], pending: 0 })), readMemory })
    withServices(<Memory />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Login experiment failed/ }))
    expect(await screen.findByRole('heading', { name: 'Possible corrections and updates' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Correction: the fixture reused/ }))
    await waitFor(() => expect(readMemory).toHaveBeenLastCalledWith('p1', 'correction', 0))
  })
})
