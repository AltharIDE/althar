import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadSnapshot } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { changed, fakeClient, items, NOW, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A sanity pass over the composer: what the person picks and sends, as the
 * window holds it against what the runtime has. Each test here is marked as
 * failing: it shows a defect, and flips to passing once that is fixed.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const pickFromDialog = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name: /^Lead: / }))
  await userEvent.click(screen.getByRole('button', { name: /All models/ }))
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }))
}

describe('the model picked for a task with no lead on it', () => {
  // Finding (sanity pass): a model picked while no lead is held (`pick` in TaskView) is never cleared, so once the lead it
  // started is moved to another model and then stops, the picker snaps back to that old pick, and the next message starts
  // the lead on it rather than on the model it was last moved to. Flips to passing when fixed.
  it.fails('isn’t picked again once the lead it started was moved to another model and stopped', async () => {
    const base = snapshot()
    const stopped = (model: string): ThreadSnapshot => ({
      ...base,
      session: null,
      task: { ...base.task, phase: 'stopped', actions: ['abandon'], lead: { agentId: 'claude-code', model, account: null } },
    })
    let current = stopped('opus')
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => current) })
    withServices(<Task />, client)

    // No lead on it: the person picks Sonnet, and what they say starts the lead on it.
    await pickFromDialog('Use Claude Sonnet')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Tell Claude Code something' }), 'Carry on.{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'sonnet' }))

    // The lead runs on Sonnet; the person moves it to Opus, which the runtime takes.
    current = { ...base, session: { ...base.session!, model: 'sonnet', effort: 'high', held: true } }
    emit(changed('provider_session', 's1'))
    await screen.findByRole('button', { name: /^Lead: Claude Sonnet/ })
    await pickFromDialog('Use Claude Opus')
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'opus' }))

    // The task stops, its last lead on Opus, as the runtime says.
    current = stopped('opus')
    emit(changed('provider_session', 's1'))
    await screen.findByText('Stopped')
    // What the person says next starts the lead it had last: Opus, not the Sonnet picked before it ran.
    vi.mocked(client.startSession).mockClear()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell Claude Code something' }), 'Go on.{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalled())
    expect(client.startSession).toHaveBeenLastCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'opus' })
  })
})

describe('a recorded setup that couldn’t copy a file it names, in a task’s thread', () => {
  // Finding (sanity pass): rounds.ts folds a setup whose exit code is 0 into the round's work as "Installed dependencies in
  // meridian", without looking at `missing`, so a recorded setup that couldn't copy `.env` (failed, as the lead is told) reads
  // as gone through. ThreadBlocks' own line for it ("Couldn't copy .env into meridian's folder.") is never reached in a task.
  // Flips to passing when fixed.
  it.fails('says it couldn’t copy the file, rather than that it went through', async () => {
    const failed = items.setup({
      ended: { at: NOW, code: 0, timedOut: false, stopped: false, last: 'Not in the checkout: .env', missing: ['.env'] },
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ items: [items.you('Fix the login'), failed, items.says('Looking at it.')] })),
    })
    withServices(<Task />, client)
    await screen.findByText('Looking at it.')
    expect(screen.queryByText('Couldn’t copy .env into meridian’s folder.')).not.toBeNull()
  })
})
