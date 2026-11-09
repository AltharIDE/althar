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
 * Settings › Tasks: how long work goes on alone, and what the rules of a new
 * project start with, each choice kept at once and said where it couldn't be;
 * and where a project's own values differ from what new projects start with.
 */

function Settings({ section: first }: { section: Section }) {
  const [section, setSection] = useState<Section>(first)
  return <SettingsPage start={useStart({ recheck: true })} section={section} onSection={setSection} />
}

const choose = async (page: HTMLElement, row: string, option: string) => {
  await userEvent.click(within(page).getByRole('combobox', { name: row }))
  await userEvent.click(within(document.body).getByRole('option', { name: option }))
}

describe('every task', () => {
  it('shows today’s values and keeps another choice at once, with the way back to today’s', async () => {
    const { client } = fakeClient()
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    expect(await within(page).findByRole('combobox', { name: 'Start a plan after' })).toHaveProperty('textContent', '25 seconds')
    expect(within(page).getByRole('combobox', { name: 'Rounds of review' }).textContent).toBe('3 rounds')
    await choose(page, 'Start a plan after', '10 seconds')
    expect(client.setPlansAndReviews).toHaveBeenLastCalledWith({ countdown: 10 })
    expect(within(page).getByRole('combobox', { name: 'Start a plan after' }).textContent).toBe('10 seconds')
    await choose(page, 'Rounds of review', '2 rounds')
    expect(client.setPlansAndReviews).toHaveBeenLastCalledWith({ rounds: 2 })
    await userEvent.click(within(page).getByRole('button', { name: 'Default: 25 seconds' }))
    expect(client.setPlansAndReviews).toHaveBeenLastCalledWith({ countdown: 25 })
    expect(within(page).getByRole('combobox', { name: 'When rounds run out' }).textContent).toBe('Carry on when every finding is settled')
    await choose(page, 'When rounds run out', 'Ask me')
    expect(client.setPlansAndReviews).toHaveBeenLastCalledWith({ roundsOut: 'ask' })
    await userEvent.click(within(page).getByRole('button', { name: 'Default: Carry on when every finding is settled' }))
    expect(client.setPlansAndReviews).toHaveBeenLastCalledWith({ roundsOut: 'settled' })
  })

  it('says a choice couldn’t be kept', async () => {
    const { client } = fakeClient({ setPlansAndReviews: vi.fn(async () => Promise.reject(new Error('disk full'))) })
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    await within(page).findByRole('combobox', { name: 'Rounds of review' })
    await choose(page, 'Rounds of review', '2 rounds')
    await waitFor(() => expect(within(page).getByRole('alert').textContent).toBe('That couldn’t be kept. Try again.'))
  })
})

describe('new projects start with', () => {
  it('shows what a project starts with and keeps another choice at once', async () => {
    const { client } = fakeClient()
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    expect((await within(page).findByRole('combobox', { name: 'When a task is done' })).textContent).toBe('Open a draft pull request')
    expect(within(page).getByRole('combobox', { name: 'When an account runs out' }).textContent).toBe(
      'Move to the strongest model with usage left',
    )
    expect(within(page).getByRole('switch', { name: 'Push the lead’s commits automatically' }).getAttribute('aria-checked')).toBe('true')
    expect(within(page).getByRole('switch', { name: 'Post screenshots to pull requests automatically' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    // There is no permission request to choose: Allow everything is the default.
    expect(within(page).queryByRole('combobox', { name: 'Permission requests' })).toBeNull()
    expect(within(page).getByText('Changing one here leaves the projects you have as they are.')).toBeTruthy()
    await choose(page, 'When an account runs out', 'Wait for the reset')
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ usageLimit: 'wait' })
    await userEvent.click(within(page).getByRole('switch', { name: 'Try an agent’s other accounts first' }))
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ rotateAccounts: true })
    await userEvent.click(within(page).getByRole('switch', { name: 'Post screenshots to pull requests automatically' }))
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ postScreenshots: true })
    await userEvent.click(within(page).getByRole('switch', { name: 'Move issues along with their tasks' }))
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ moveIssues: false })
    await choose(page, 'When a task is done', 'Push the branch only')
    expect(client.setNewProjectDefaults).toHaveBeenLastCalledWith({ end: 'none' })
  })

  it('says a choice couldn’t be kept', async () => {
    const { client } = fakeClient({ setNewProjectDefaults: vi.fn(async () => Promise.reject(new Error('disk full'))) })
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    await within(page).findByRole('combobox', { name: 'When a task is done' })
    await choose(page, 'When a task is done', 'Open a pull request for review')
    await waitFor(() => expect(within(page).getByRole('alert').textContent).toBe('That couldn’t be kept. Try again.'))
  })

  it('shows where a project has another value, and brings every project in line in one press', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async (projectId: string) => ({
        ...(await fakeClient().client.getProjectRules(projectId)),
        resolveConflicts: true,
        postScreenshots: true,
      })),
    })
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    const use = await within(page).findByRole('button', { name: 'Use this in every project' })
    expect(within(page).getByText(/On/, { selector: 'span' })).toBeTruthy()
    await userEvent.click(use)
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', postScreenshots: false }))
  })

  it('shows no line for a row where every project agrees', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async (projectId: string) => ({
        ...(await fakeClient().client.getProjectRules(projectId)),
        resolveConflicts: true,
      })),
    })
    withServices(<Settings section="tasks" />, client)
    const page = screen.getByRole('main')
    await within(page).findByRole('combobox', { name: 'When a task is done' })
    await waitFor(() => expect(client.getProjectRules).toHaveBeenCalled())
    expect(within(page).queryByRole('button', { name: 'Use this in every project' })).toBeNull()
  })
})
