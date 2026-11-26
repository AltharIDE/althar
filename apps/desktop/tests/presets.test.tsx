import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Preset } from '@althar/contracts'

import { PresetsSection } from '../src/renderer/features/settings/PresetsSection'
import { agents, fakeClient, remoteConnection } from './fixtures'
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

  it('resets a tuned built-in one at once, model-free, and no older list brings its tuning back while reads overlap', async () => {
    const tuned: Preset = {
      ...builtIn,
      tuned: true,
      about: 'a worktree, reviewed before it ships, a draft pull request, led by GPT-5',
      parts: { ...builtIn.parts, lead: 'codex/gpt-5' },
      asBuilt: { parts: builtIn.parts, about: builtIn.about },
    }
    // The runtime is slow: the read after the reset is from before it caught up, and still has it tuned.
    const lists = [[tuned], [tuned]]
    const listPresets = vi.fn(async () => lists.shift() ?? [builtIn])
    let done = () => {}
    const resetPreset = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    const { client } = fakeClient({ listPresets, resetPreset })
    withServices(<PresetsSection agents={agents} />, client)
    expect(await screen.findByText('Tuned')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    // The built-in, naming no model, in the frame it is pressed.
    expect(screen.queryByText('Tuned')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
    expect(screen.getByText(builtIn.about)).toBeTruthy()
    // Reset; the read after it, from before the runtime caught up, never brings its tuning back.
    done()
    await waitFor(() => expect(listPresets).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Tuned')).toBeNull()
    expect(screen.queryByText(tuned.about)).toBeNull()
    expect(screen.getByText(builtIn.about)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('brings a tuning the runtime kept back with a line, where Reset was refused', async () => {
    const tuned: Preset = {
      ...builtIn,
      tuned: true,
      parts: { ...builtIn.parts, lead: 'codex/gpt-5' },
      asBuilt: { parts: builtIn.parts, about: builtIn.about },
    }
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

  it('on another computer’s home, resets a tuned preset there and leaves removing one of the person’s own to them', async () => {
    const tuned = { ...builtIn, tuned: true }
    const { client } = fakeClient({ connection: remoteConnection(), listPresets: vi.fn(async () => [tuned, own]) })
    withServices(<PresetsSection />, client)
    expect(await screen.findByRole('button', { name: 'Reset' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('opens a tuned one with its own lead, and sets a reviewer where one was picked for each task', async () => {
    const tuned: Preset = {
      ...builtIn,
      tuned: true,
      parts: { ...builtIn.parts, lead: 'codex/default', effort: 'high', reviewer: null, reviewerEffort: null },
    }
    const { client } = fakeClient({ listPresets: vi.fn(async () => [tuned]) })
    withServices(<PresetsSection agents={agents} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Tune' }))
    // Its reviewer is picked for each task, until one is set.
    expect(screen.getAllByText('Picked for each task')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a model' }))
    expect(screen.queryByText('Picked for each task')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.tunePreset).toHaveBeenCalledWith('builtin:change', {
        lead: 'codex/default',
        effort: 'high',
        reviewer: `${agents[0]!.id}/default`,
        reviewerEffort: null,
        brief: '',
      }),
    )
  })

  it('keeps a tuning the runtime refused open, saying why, and leaves it as it was on Cancel', async () => {
    const { client } = fakeClient({
      listPresets: vi.fn(async () => [builtIn]),
      tunePreset: vi.fn(async () => Promise.reject(new Error('That model isn’t on this computer.'))),
    })
    withServices(<PresetsSection agents={agents} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Tune' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That model isn’t on this computer.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('edits where one works, how it ends and where it sits, back to the project’s own ending, for a preset saved anywhere', async () => {
    const anywhere: Preset = { ...own, keptTo: undefined, from: undefined, parts: { ...own.parts, end: 'draft' } }
    const { client } = fakeClient({ listPresets: vi.fn(async () => [anywhere]) })
    withServices(<PresetsSection />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    // Saved from no project: nothing to keep it to.
    expect(screen.queryByRole('switch')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Local' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Scratch' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Here' }))
    await userEvent.click(screen.getByRole('radio', { name: 'As the project says' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(client.editPreset).toHaveBeenCalledTimes(1))
    const [sent] = vi.mocked(client.editPreset).mock.calls[0]!
    expect(sent).toEqual({
      id: 'pst_1',
      name: 'Quick change',
      parts: { ...own.parts, workspace: 'local', shelf: 'scratch', end: undefined },
    })
    expect('end' in sent.parts).toBe(false)
    expect('projectOnly' in sent).toBe(false)
  })

  it('keeps an edit the runtime refused open, saying why, and closes it on Cancel', async () => {
    const { client } = fakeClient({
      listPresets: vi.fn(async () => [own]),
      editPreset: vi.fn(async () => Promise.reject(new Error('Another preset is called that.'))),
    })
    withServices(<PresetsSection />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Another preset is called that.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).toBeNull()
  })
})
