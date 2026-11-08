import { screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { TaskFolderState } from '../src/main/appPreferences'
import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/*
 * Where new tasks' folders go, under Work on this computer: Change opens a
 * picker, but not in the Flatpak, where every pick comes through the file
 * portal, which task folders can't use (ADR-027): there the row says why.
 */

function Settings() {
  const [section, setSection] = useState<Section>('this-mac')
  return <SettingsPage start={useStart({ recheck: true })} section={section} onSection={setSection} />
}

const shown = (state: TaskFolderState) => {
  const host = fakeHost({ taskFolder: vi.fn(async () => state), chooseTaskFolder: vi.fn(async () => null) })
  withServices(<Settings />, fakeClient().client, host)
  return screen.getByRole('main')
}

describe('the task folders row', () => {
  it('offers Change outside the Flatpak', async () => {
    const page = shown({ folder: '/home/ada/Althar', from: 'default', defaultFolder: '/home/ada/Althar' })
    const change = await within(page).findByRole('button', { name: /Task folders Change/ })
    expect((change as HTMLButtonElement).disabled).toBe(false)
    expect(within(page).queryByText(/file portal/)).toBeNull()
  })

  it('turns Change off in the Flatpak, and says why', async () => {
    const page = shown({
      folder: '/home/ada/.var/app/dev.althar.app/data/althar/worktrees',
      from: 'default',
      defaultFolder: '/home/ada/.var/app/dev.althar.app/data/althar/worktrees',
      sandboxed: true,
    })
    const change = await within(page).findByRole('button', { name: /Task folders Change/ })
    expect((change as HTMLButtonElement).disabled).toBe(true)
    expect(within(page).getByText(/only through its file portal, which task folders can’t use/)).toBeTruthy()
  })
})
