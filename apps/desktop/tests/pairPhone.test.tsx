import type { RegisteredClient } from '@althar/contracts'
import { ApiError } from '@althar/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PhonesDialog } from '../src/renderer/features/phones/PhonesDialog'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Pair a phone… from the homes menu: This Mac lets phones in at a press, the
 * code shows as a QR and to paste, the dialog hears when a phone used it, and
 * the phones it paired are listed and come off at once.
 */

const iPhone: RegisteredClient = {
  deviceId: 'dev_1a2b3c4d5e6f708192a3b4c5d6e7f809',
  name: 'iPhone',
  publicKey: 'A'.repeat(43),
  role: 'socket',
  revision: 1,
  createdAt: new Date(Date.now()).toISOString(),
  revokedAt: null,
}
const pixel: RegisteredClient = {
  ...iPhone,
  deviceId: 'dev_9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  name: 'Pixel 9',
  createdAt: '2026-10-12T09:00:00.000Z',
}
const code = `althar-pairing1.${btoa(JSON.stringify({ homeId: 'home_5c1e0a7d93b24f6e8a01c2d3e4f5a6b7', tlsKeyPin: 'a'.repeat(64) }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')}`
const made = () => ({
  code,
  link: `https://althar.ai/pair#${code.slice('althar-pairing'.length)}`,
  tokenHash: 'b'.repeat(64),
  expiresAt: Date.now() + 300_000,
})

describe('pairing a phone from the homes menu', () => {
  it('lets phones in to This Mac, shows the code, and hears the phone pair', async () => {
    let on = false
    let paired = false
    const { client } = fakeClient({
      phoneAccess: vi.fn(async () => ({ origin: on ? 'https://studio-mac.local:6769' : null, switchable: true, on })),
      setPhoneAccess: vi.fn(async (wanted: boolean) => {
        on = wanted
        return { origin: 'https://studio-mac.local:6769', switchable: true, on }
      }),
      createPairingCode: vi.fn(async () => made()),
      pairingStatus: vi.fn(async () =>
        paired ? { state: 'paired' as const, device: iPhone } : { state: 'waiting' as const, expiresAt: Date.now() + 300_000 },
      ),
      pairedDevices: vi.fn(async () => ({ clients: paired ? [iPhone, pixel] : [pixel], next: null })),
    })
    withServices(<PhonesDialog home="This Mac" onClose={() => undefined} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Let phones in' }))
    expect(client.setPhoneAccess).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Scan it with your phone’s camera')).toBeTruthy()
    expect(screen.getByText(code)).toBeTruthy()
    expect(screen.getByText('Phones on the same Wi-Fi reach it, at studio-mac.local.')).toBeTruthy()
    expect(screen.getByText('Pixel 9')).toBeTruthy()
    paired = true
    expect(await screen.findByText('iPhone is paired', {}, { timeout: 4000 })).toBeTruthy()
    expect(await screen.findByText('Paired just now')).toBeTruthy()
  })

  it('takes a phone off at once, and puts it back with the home’s reason when it refuses', async () => {
    const { client } = fakeClient({
      phoneAccess: vi.fn(async () => ({ origin: 'https://studio.example:6769', switchable: false, on: true })),
      createPairingCode: vi.fn(async () => made()),
      pairedDevices: vi.fn(async () => ({ clients: [pixel], next: null })),
      removePairedDevice: vi.fn(async () => {
        throw new ApiError({ reason: 'ClientNotFound', message: 'Choose a connection device registered on this home.' })
      }),
    })
    withServices(<PhonesDialog home="studio" onClose={() => undefined} />, client)
    await screen.findByText('Pixel 9')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const asking = within(screen.getByRole('dialog', { name: 'Remove Pixel 9?' }))
    await userEvent.click(asking.getByRole('button', { name: 'Remove' }))
    expect(client.removePairedDevice).toHaveBeenCalledWith(pixel.deviceId)
    expect(await screen.findByText('Choose a connection device registered on this home.')).toBeTruthy()
    expect(screen.getByText('Pixel 9')).toBeTruthy()
  })

  it('says why a window that may not make codes can’t, with nothing to try again', async () => {
    const { client } = fakeClient({
      phoneAccess: vi.fn(async () => {
        throw new ApiError({ reason: 'Forbidden', message: 'Manage connection devices from a trusted client or the host console.' })
      }),
    })
    withServices(<PhonesDialog home="studio" onClose={() => undefined} />, client)
    expect(await screen.findByText('Manage connection devices from a trusted client or the host console.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows a remote home’s setup command where its host doesn’t take phones', async () => {
    const { client } = fakeClient({ phoneAccess: vi.fn(async () => ({ origin: null, switchable: false, on: false })) })
    withServices(<PhonesDialog home="studio" onClose={() => undefined} />, client)
    expect(await screen.findByText('studio doesn’t take phones yet')).toBeTruthy()
    await waitFor(() => expect(client.createPairingCode).not.toHaveBeenCalled())
  })
})
