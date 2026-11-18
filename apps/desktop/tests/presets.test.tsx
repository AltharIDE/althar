import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Preset } from '@althar/contracts'

import { PresetsSection } from '../src/renderer/features/settings/PresetsSection'
import { agents, fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Presets in Settings (a task is a conversation plus parts, "Presets"): the
 * built-in ones, naming no model, each with Tune, which sets its lead,
 * reviewer, their efforts and brief as the person's own, and Reset back to
 * the built-in; the person's own each with Edit, which opens its name, parts
 * and brief in its row, and whether it is kept to the project of the task it
 * was saved from.
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
    // A built-in one is tuned, not edited.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Tune' })).toHaveLength(1)
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

  it('tunes a built-in one as the person’s own: its lead, reviewer and brief, each picked for every task until set', async () => {
    const { client } = fakeClient({ listPresets: vi.fn(async () => [builtIn, own]) })
    withServices(<PresetsSection agents={agents} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Tune' }))
    // Nothing named: both are picked for each task, as for any step.
    expect(screen.getAllByText('Picked for each task')).toHaveLength(2)
    const [lead] = screen.getAllByRole('button', { name: 'Choose a model' })
    await userEvent.click(lead!)
    await userEvent.click(await screen.findByRole('button', { name: /^Lead: / }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.type(screen.getByLabelText(/Brief/), 'Three directions.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.tunePreset).toHaveBeenCalledWith('builtin:change', {
        lead: expect.stringMatching(/^codex\//) as unknown as string,
        effort: null,
        reviewer: null,
        reviewerEffort: null,
        brief: 'Three directions.',
      }),
    )
  })

  it('resets a tuned built-in one at once, and brings the tuning back with a line where the runtime kept it', async () => {
    const tuned: Preset = { ...builtIn, tuned: true, parts: { ...builtIn.parts, lead: 'codex/gpt-5' } }
    const resetPreset = vi.fn(async () => Promise.reject(new Error('Althar couldn’t reset it.')))
    const { client } = fakeClient({ listPresets: vi.fn(async () => [tuned]), resetPreset })
    withServices(<PresetsSection agents={agents} />, client)
    expect(await screen.findByText('Tuned')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(resetPreset).toHaveBeenCalledWith('builtin:change')
    expect((await screen.findByRole('alert')).textContent).toBe('Althar couldn’t reset it.')
    expect(screen.getByText('Tuned')).toBeTruthy()
  })

  it('removes one at once, and no older list brings it back while removals overlap', async () => {
    const other: Preset = { ...own, id: 'pst_2', name: 'Spike' }
    // What each read of the list answers, in turn: the runtime is slow, so the first reads still have both.
    const lists = [[builtIn, own, other], [builtIn, own, other], [builtIn, other], [builtIn]]
    const listPresets = vi.fn(async () => lists.shift() ?? [builtIn])
    const removals = new Map<string, () => void>()
    const removePreset = vi.fn((id: string) => new Promise<void>((done) => removals.set(id, done)))
    const { client } = fakeClient({ listPresets, removePreset })
    withServices(<PresetsSection />, client)
    expect(await screen.findByText('Spike')).toBeTruthy()

    const [first, second] = screen.getAllByRole('button', { name: 'Remove' })
    await userEvent.click(first!)
    // Gone in the frame it is pressed, before the runtime answers.
    expect(screen.queryByText('Quick change')).toBeNull()
    await userEvent.click(second!)
    expect(screen.queryByText('Spike')).toBeNull()

    // The first is removed; the read after it is from before the runtime caught up, and still has both.
    removals.get('pst_1')!()
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Quick change')).toBeNull()
    expect(screen.queryByText('Spike')).toBeNull()

    // The second is removed: the reads after it have neither, and neither ever came back.
    removals.get('pst_2')!()
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('Quick change')).toBeNull()
    expect(screen.queryByText('Spike')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('brings one the runtime kept back, with a line', async () => {
    const { client } = fakeClient({
      listPresets: vi.fn(async () => [builtIn, own]),
      removePreset: vi.fn(async () => Promise.reject(new Error('That preset is in use by a running automation.'))),
    })
    withServices(<PresetsSection />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That preset is in use by a running automation.')
    expect(screen.getByText('Quick change')).toBeTruthy()
  })
})
