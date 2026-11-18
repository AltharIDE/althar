import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/* Settings › Appearance on Linux: light, dark, or as the computer is, in its own words. */

vi.mock('../src/renderer/shared/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/shared/device')>()
  return { ...actual, platform: 'linux', device: actual.deviceWords('linux') }
})

function Appearance() {
  return <SettingsPage start={useStart()} section="appearance" onSection={vi.fn()} />
}

describe('Appearance on Linux', () => {
  it('offers light, dark or as the computer is', async () => {
    const host = fakeHost({
      platform: 'linux',
      appIcon: vi.fn(async () => null),
      edge: vi.fn(async () => ({ place: 'island', notch: false, platform: 'linux', tray: true })),
    })
    withServices(<Appearance />, fakeClient().client, host)
    const choice = await screen.findByRole('radiogroup', { name: 'Light or dark' })
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Light', 'Dark', 'Match the computer'])
  })
})
