import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * How long work goes on alone, and what the rules of a new project start
 * with: two sections of Settings, each choice kept at once and said where it
 * couldn't be.
 */

function Settings({ section: first }: { section: Section }) {
  const [section, setSection] = useState<Section>(first)
  return <SettingsPage start={useStart({ recheck: true })} section={section} onSection={setSection} />
}

const choose = async (page: HTMLElement, row: string, option: string) => {
  await userEvent.click(within(page).getByRole('combobox', { name: row }))
  await userEvent.click(within(document.body).getByRole('option', { name: option }))
}

describe('long runs', () => {
  it('shows today’s values and keeps another choice at once, with the way back to today’s', async () => {
    const { client } = fakeClient()
    withServices(<Settings section="long-runs" />, client)
    const page = screen.getByRole('main')
    expect(await within(page).findByRole('combobox', { name: 'Start a plan after' })).toHaveProperty('textContent', '25 seconds')
    expect(within(page).getByRole('combobox', { name: 'Rounds of review' }).textContent).toBe('3 rounds')
    expect(within(page).getByRole('combobox', { name: 'Restart a quiet turn after' }).textContent).toBe('10 minutes')
    expect(within(page).getByRole('combobox', { name: 'Check in after' }).textContent).toBe('6 hours')
    await choose(page, 'Start a plan after', '10 seconds')
    expect(client.setLongRuns).toHaveBeenLastCalledWith({ countdown: 10 })
    expect(within(page).getByRole('combobox', { name: 'Start a plan after' }).textContent).toBe('10 seconds')
    await choose(page, 'Rounds of review', '2 rounds')
    expect(client.setLongRuns).toHaveBeenLastCalledWith({ rounds: 2 })
    await choose(page, 'Check in after', 'Never')
    expect(client.setLongRuns).toHaveBeenLastCalledWith({ checkIn: 0 })
    await userEvent.click(within(page).getByRole('button', { name: 'Use 25 seconds' }))
    expect(client.setLongRuns).toHaveBeenLastCalledWith({ countdown: 25 })
  })

  it('says a choice couldn’t be kept', async () => {
    const { client } = fakeClient({ setLongRuns: vi.fn(async () => Promise.reject(new Error('disk full'))) })
    withServices(<Settings section="long-runs" />, client)
    const page = screen.getByRole('main')
    await within(page).findByRole('combobox', { name: 'Restart a quiet turn after' })
    await choose(page, 'Restart a quiet turn after', '5 minutes')
    await waitFor(() => expect(within(page).getByRole('alert').textContent).toBe('That couldn’t be kept. Try again.'))
  })
})

describe('new projects', () => {
  it('shows what a project starts with and keeps another choice at once', async () => {
    const { client } = fakeClient()
    withServices(<Settings section="new-projects" />, client)
    const page = screen.getByRole('main')
    expect((await within(page).findByRole('combobox', { name: 'Permission requests' })).textContent).toBe('Allow, except what you keep')
    expect(within(page).getByRole('combobox', { name: 'When an account runs out' }).textContent).toBe('Move to the next agent')
    expect(within(page).getByRole('combobox', { name: 'When a task is done' }).textContent).toBe('Open a draft pull request')
    await choose(page, 'Permission requests', 'The coordinator decides')
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ permissions: 'coordinator' })
    await choose(page, 'When an account runs out', 'Wait for the reset')
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ usageLimit: 'wait' })
    await userEvent.click(within(page).getByRole('switch', { name: 'Try an agent’s other accounts first' }))
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ rotateAccounts: true })
    await choose(page, 'When a task is done', 'Push the branch only')
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ end: 'none' })
  })

  it('says a choice couldn’t be kept', async () => {
    const { client } = fakeClient({ setNewProjectDefaults: vi.fn(async () => Promise.reject(new Error('disk full'))) })
    withServices(<Settings section="new-projects" />, client)
    const page = screen.getByRole('main')
    await within(page).findByRole('combobox', { name: 'When a task is done' })
    await choose(page, 'When a task is done', 'Open a pull request for review')
    await waitFor(() => expect(within(page).getByRole('alert').textContent).toBe('That couldn’t be kept. Try again.'))
  })
})
