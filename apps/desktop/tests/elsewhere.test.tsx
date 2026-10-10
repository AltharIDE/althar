import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from '../src/renderer/features/settings/SettingsPanel'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost, withoutOpenCode } from './fixtures'
import { withServices } from './render'

/* Settings as Windows has it: a PC, no count on the app's icon, and the system's own sound rather than named ones. */

vi.mock('../src/renderer/shared/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/shared/device')>()
  return { ...actual, platform: 'win32', device: actual.deviceWords('win32') }
})

function Settings() {
  const [open, setOpen] = useState(true)
  return <SettingsPanel start={useStart()} open={open} onOpenChange={setOpen} />
}

const openModule = async (title: RegExp) => {
  const panel = await screen.findByRole('dialog', { name: 'Settings' })
  await userEvent.click(within(panel).getByRole('button', { name: title }))
  return panel
}

describe('settings on Windows', () => {
  it('keeps this PC awake, and offers no count on the icon and the system’s sound, heard when chosen', async () => {
    const host = fakeHost({ platform: 'win32', sounds: vi.fn(async () => []) })
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: withoutOpenCode })) })
    withServices(<Settings />, client, host)
    const panel = await openModule(/^Keep awake/)
    expect(within(panel).getByRole('heading', { name: 'This PC', level: 2 })).toBeTruthy()
    expect(within(panel).getByRole('switch', { name: 'Keep this PC awake while work runs' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to all settings' }))
    // An agent not here says so in the PC's words.
    expect(await within(panel).findByText('Not on this PC')).toBeTruthy()

    await openModule(/^Notifications/)
    expect(within(panel).queryByRole('switch', { name: /Count them/ })).toBeNull()
    expect(within(panel).getByText('The system’s own sound, with each notification, or none.')).toBeTruthy()
    await userEvent.click(within(panel).getByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'The system’s sound' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'default')
    expect(host.playSound).toHaveBeenCalledWith('default')
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to all settings' }))
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^Notifications\s*With sound/ })).toBeTruthy())
  })
})
