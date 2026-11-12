import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Preset } from '@althar/contracts'

import { PresetsSection } from '../src/renderer/features/settings/PresetsSection'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Presets in Settings (a task is a conversation plus parts, "Presets"): the
 * built-in ones as they are, the person's own each with Edit, which opens its
 * name, parts and brief in its row, and whether it is kept to the project of
 * the task it was saved from.
 */

const own: Preset = {
  id: 'pst_1',
  name: 'Quick change',
  builtin: false,
  projectId: 'prj_1',
  about: 'a worktree, no review, a draft pull request, led by gpt-5',
  keptTo: 'Meridian',
  from: 'Meridian',
  parts: { workspace: 'worktree', checked: 'none', end: 'draft', shelf: 'board', lead: 'codex/gpt-5', reviewer: null, brief: '' },
}
const builtIn: Preset = {
  id: 'builtin:change',
  name: 'Change',
  builtin: true,
  projectId: null,
  about: 'a worktree, reviewed before it ships, a draft pull request, the coordinator picks its lead',
  parts: { workspace: 'worktree', checked: 'before', end: 'draft', shelf: 'board', lead: null, reviewer: null, brief: '' },
}

describe('presets in Settings', () => {
  it('edits one of the person’s own: its name, parts and brief, and keeps it to every project', async () => {
    const { client } = fakeClient({ listPresets: vi.fn(async () => [builtIn, own]) })
    withServices(<PresetsSection />, client)
    expect(await screen.findByText(/Only in Meridian\. a worktree, no review/)).toBeTruthy()
    // A built-in one has nothing to edit.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Reviewed change')
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Checked by' })).getByRole('radio', { name: 'After it merges' }))
    await userEvent.type(screen.getByLabelText(/Brief/), 'Keep it small.')
    await userEvent.click(screen.getByRole('switch', { name: 'Only in Meridian' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.editPreset).toHaveBeenCalledWith({
        id: 'pst_1',
        name: 'Reviewed change',
        parts: { ...own.parts, checked: 'after', brief: 'Keep it small.' },
        projectOnly: false,
      }),
    )
  })
})
