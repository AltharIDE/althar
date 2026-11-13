import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { forgetDrafts } from '../src/renderer/shared/drafts'
import { changed, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}
const message = (text: string) => {
  const item = items.you(text)
  if (item.kind !== 'user_message') throw new Error('The fixture must be a user message')
  return item
}

beforeEach(() => forgetDrafts())

describe('undo in the task chat', () => {
  it('asks first, restores the prompt beside an unsent draft, and removes the undone conversation', async () => {
    const user = userEvent.setup()
    const kept = message('Keep retries bounded.')
    const target = message('Raise the retry limit to twenty.')
    const answer = items.says('The retry limit is now twenty.')
    let now = snapshot({ conversationVersion: 1, undoable: [target.id], items: [kept, target, answer] })
    const undoTurn = vi.fn(async () => {
      now = snapshot({ conversationVersion: 2, undoable: [], items: [kept] })
      return { prompt: target.content.text, messages: [target.content], restored: 1 }
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => now), undoTurn })
    withServices(<Task />, client)
    await screen.findByText(target.content.text)
    const composer = screen.getByRole('textbox')
    await user.type(composer, 'Keep my unsent note.')
    await user.click(screen.getByRole('button', { name: 'Undo from here' }))
    await screen.findByRole('dialog', { name: 'Undo from here?' })
    expect(undoTurn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Undo files and conversation' }))
    await waitFor(() => expect(undoTurn).toHaveBeenCalledExactlyOnceWith(target.id))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(answer.kind === 'agent_message' ? answer.content.text : '')).toBeNull()
    expect((composer as HTMLTextAreaElement).value).toBe(`Keep my unsent note.\n\n${target.content.text}`)
    expect(screen.getByText('Files and conversation restored.').getAttribute('role')).toBe('status')
  })

  it('keeps a refusal in the dialog and leaves the prompt and conversation intact', async () => {
    const user = userEvent.setup()
    const target = message('Change retry.ts.')
    const undoTurn = vi.fn(async () => {
      throw new ApiError({ reason: 'UndoRefused', message: 'retry.ts changed after this turn. Keep or move those edits first.' })
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ undoable: [target.id], items: [target] })), undoTurn })
    withServices(<Task />, client)
    await user.click(await screen.findByRole('button', { name: 'Undo from here' }))
    await user.click(screen.getByRole('button', { name: 'Undo files and conversation' }))
    expect((await screen.findByRole('alert')).textContent).toContain('retry.ts changed after this turn')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText(target.content.text)).toBeTruthy()
  })

  it('drops the removed messages when another window undoes the thread', async () => {
    const kept = message('Keep this decision.')
    const removed = message('Undo this message.')
    let now = snapshot({ conversationVersion: 1, items: [kept, removed] })
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => now) })
    withServices(<Task />, client)
    await screen.findByText(removed.content.text)
    now = snapshot({ conversationVersion: 2, items: [kept] })
    act(() => emit(changed('thread', 'th1', 'th1', 'p1')))
    await waitFor(() => expect(screen.queryByText(removed.content.text)).toBeNull())
    expect(screen.getByText(kept.content.text)).toBeTruthy()
  })
})
