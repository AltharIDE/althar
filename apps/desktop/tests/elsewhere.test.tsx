import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { QuickSettings } from '../src/renderer/features/settings/QuickSettings'
import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost, withoutOpenCode } from './fixtures'
import { withServices } from './render'

/*
 * Settings off a Mac: as Windows has it, a PC, no count on the app's icon,
 * the system's own sound rather than named ones, and Althar in the system
 * tray; and on Linux, in the tray where the desktop has one.
 */

vi.mock('../src/renderer/shared/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/shared/device')>()
  return { ...actual, platform: 'win32', device: actual.deviceWords('win32') }
})

/* The Settings tab, on a section. */
function Settings({ at }: { at: Section }) {
  const [section, setSection] = useState<Section>(at)
  return <SettingsPage start={useStart()} section={section} onSection={setSection} />
}

const sections = () => within(screen.getByRole('navigation', { name: 'Settings' }))

describe('settings on Windows', () => {
  it('keep this PC awake, and offer no count on the icon and the system’s sound, heard when chosen', async () => {
    const host = fakeHost({ platform: 'win32', sounds: vi.fn(async () => []) })
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: withoutOpenCode })) })
    withServices(<Settings at="this-mac" />, client, host)
    expect(screen.getByRole('heading', { name: 'Work on this PC', level: 1 })).toBeTruthy()
    expect(await screen.findByRole('switch', { name: 'Keep this PC awake while work runs' })).toBeTruthy()
    expect(sections().getByRole('button', { name: 'Work on this PC' })).toBeTruthy()

    // An agent not here says so in the PC's words.
    await userEvent.click(sections().getByRole('button', { name: /^Agents/ }))
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    expect(screen.getByRole('region', { name: 'OpenCode isn’t on this PC' })).toBeTruthy()

    await userEvent.click(sections().getByRole('button', { name: 'Notifications' }))
    expect(screen.queryByRole('switch', { name: /Count them/ })).toBeNull()
    await userEvent.click(screen.getByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'The system’s sound' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'default')
    expect(host.playSound).toHaveBeenCalledWith('default')
    // Its card down the side says it.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sound\s*System sound/ })).toBeTruthy())
  })

  it('put back the system’s sound, where there are no named ones to choose from', async () => {
    const host = fakeHost({ platform: 'win32', sounds: vi.fn(async () => []) })
    withServices(<QuickSettings open onOpenChange={vi.fn()} onSettings={vi.fn()} />, fakeClient().client, host)
    const panel = await screen.findByRole('dialog', { name: 'Quick settings' })
    await userEvent.click(within(panel).getByRole('switch', { name: 'Sound' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'default')
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^Sound\s*System sound/ })).toBeTruthy())
  })

  it('offers light, dark or as the PC is, in the PC’s words', async () => {
    const host = fakeHost({ platform: 'win32', appIcon: vi.fn(async () => null) })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const choice = await screen.findByRole('radiogroup', { name: 'Light or dark' })
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Light', 'Dark', 'Match the PC'])
    await userEvent.click(within(choice).getByRole('radio', { name: 'Match the PC' }))
    // already as the system is: nothing to keep
    await userEvent.click(within(choice).getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('appearance', 'light'))
  })

  it('says Althar is in the system tray, where Windows may tuck it away, with nothing to choose', async () => {
    const host = fakeHost({
      platform: 'win32',
      appIcon: vi.fn(async () => null),
      edge: vi.fn(async () => ({ place: 'island', notch: false, platform: 'win32', tray: true })),
    })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    expect(await screen.findByText('In the system tray')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'In other apps' })).toBeNull()
    expect(screen.getByText('Windows may tuck it under the ^. Drag it onto the taskbar to keep it in sight.')).toBeTruthy()
  })
})

describe('settings on Linux', () => {
  it('says Althar is in the tray, or, on a desktop without one, only in its window', async () => {
    const linux = (tray: boolean) =>
      fakeHost({
        platform: 'linux',
        appIcon: vi.fn(async () => null),
        edge: vi.fn(async () => ({ place: 'island', notch: false, platform: 'linux', tray })),
      })
    const first = withServices(<Settings at="appearance" />, fakeClient().client, linux(true))
    // A desktop may take the mark and not show it, which nothing tells Althar: the page says where it would be then.
    expect(await screen.findByText('Without a tray, Althar shows only in its window.')).toBeTruthy()
    first.unmount()
    withServices(<Settings at="appearance" />, fakeClient().client, linux(false))
    expect(await screen.findByText('Only in Althar’s window')).toBeTruthy()
    expect(screen.getByText('This desktop has no system tray.')).toBeTruthy()
  })
})
