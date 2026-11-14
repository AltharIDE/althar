import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type AcpCatalog, type AcpConnection } from '@althar/contracts'

import { AgentCatalogSection } from '../src/renderer/features/settings/AgentCatalogSection'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient } from './fixtures'
import { servicesFor } from './render'
import { ServicesProvider } from '../src/renderer/data/services'
import { render } from '@testing-library/react'

function Catalog() {
  return <AgentCatalogSection start={useStart()} />
}
const spec: AcpConnection = {
  id: 'acp-goose',
  name: 'Goose',
  command: 'goose',
  args: ['acp'],
  mode: 'approve',
  readerMode: 'approve',
  modeOption: 'mode',
  modelOption: 'model',
  effortOption: null,
  held: {},
  registryId: 'goose',
  registryVersion: '1.2.3',
}
const before: AcpCatalog = {
  revision: 0,
  items: [],
  connections: [{ connection: spec, state: 'ready', reason: null, version: '1.2.3' }],
  problem: null,
  refreshing: false,
}

describe('agent connection changes in Settings', () => {
  it('removes at once, holds the removal through an older read, and ignores a read that arrives after confirmation', async () => {
    const { client } = fakeClient()
    const ack = Promise.withResolvers<number>()
    const older = Promise.withResolvers<AcpCatalog>()
    const read = vi.fn(async () => before)
    vi.spyOn(client, 'getAgentCatalog').mockImplementation(read)
    vi.spyOn(client, 'removeAcpConnection').mockImplementation(() => ack.promise)
    const services = servicesFor(client)
    render(
      <ServicesProvider value={services}>
        <Catalog />
      </ServicesProvider>,
    )
    expect(await screen.findByText('Available for work · 1.2.3')).toBeTruthy()
    read.mockImplementationOnce(() => older.promise)
    void services.cache.invalidateQueries({ queryKey: ['agentCatalog'] })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('Available for work · 1.2.3')).toBeNull()
    read.mockImplementation(async () => ({ ...before, revision: 1, connections: [] }))
    await act(async () => {
      ack.resolve(1)
      await ack.promise
    })
    await waitFor(() => expect(services.cache.getQueryData<AcpCatalog>(['agentCatalog'])?.revision).toBe(1))
    await act(async () => {
      older.resolve(before)
      await older.promise
    })
    expect(screen.queryByText('Available for work · 1.2.3')).toBeNull()
    expect(services.cache.getQueryData<AcpCatalog>(['agentCatalog'])?.revision).toBe(1)
  })

  it('restores a failed removal and reports the failure beside the connections', async () => {
    const { client } = fakeClient()
    vi.spyOn(client, 'getAgentCatalog').mockImplementation(async () => before)
    vi.spyOn(client, 'removeAcpConnection').mockImplementation(async () => {
      throw new ApiError({ reason: 'AcpConnectionRefused', message: 'Close the active conversation first.' })
    })
    const services = servicesFor(client)
    render(
      <ServicesProvider value={services}>
        <Catalog />
      </ServicesProvider>,
    )
    await screen.findByText('Available for work · 1.2.3')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Close the active conversation first.')
    expect(screen.getByText('Available for work · 1.2.3')).toBeTruthy()
  })
})
