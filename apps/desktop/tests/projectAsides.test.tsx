import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardTask } from '@althar/contracts'
import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { card, coordinatorSnapshot, fakeClient, items, snapshot, task } from './fixtures'
import { useSettingsOf, withServices } from './render'

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      room={Room.Talk}
    />
  )
}

const aside: BoardTask = {
  ...card(),
  taskId: 'a1',
  threadId: 'tha',
  title: 'Retry',
  phase: 'ready',
  scratch: true,
  state: 'active',
  createdAt: '2026-11-12T10:00:00Z',
  settledAt: null,
  changed: null,
  here: [],
}

describe('asides in the project’s conversation', () => {
  it('starts from the project’s composer, sends to the aside, and returns to the coordinator', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.says('The coordinator is here.')] })),
      startTask: vi.fn(async () => ({ ...task, id: 'a1', threadId: 'tha' })),
      getThread: vi.fn(async () => {
        const thread = snapshot()
        return { ...thread, threadId: 'tha', task: { ...thread.task, id: 'a1', scratch: true }, items: [items.says('The aside is here.')] }
      }),
    })
    withServices(<Project />, client)
    await screen.findByText('The coordinator is here.')
    await userEvent.click(await screen.findByRole('button', { name: 'New aside' }))
    const composer = await screen.findByRole('textbox', { name: 'Ask on the side' })
    await userEvent.type(composer, 'Why twice?{Enter}')
    expect((await screen.findAllByText('The aside is here.')).length).toBeGreaterThan(0)
    expect(client.send).toHaveBeenCalledWith({ threadId: 'tha', body: 'Why twice?', disposition: 'after_current' })
    expect(client.renameTask).toHaveBeenCalledWith(expect.stringMatching(/^task_/), 'Why twice?')
    await userEvent.click(screen.getByRole('tab', { name: 'Coordinator' }))
    expect(await screen.findByText('The coordinator is here.')).toBeTruthy()
    expect(screen.queryByText('The aside is here.')).toBeNull()
  })

  it('returns refused words to the new aside’s composer and dismisses the error before a retry', async () => {
    const { client } = fakeClient({
      startTask: vi.fn(async () => ({ ...task, id: 'a1', threadId: 'tha' })),
      send: vi.fn(async () => {
        throw new ApiError({ reason: 'conflict', message: 'The lead signed out.' })
      }),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New aside' }))
    const composer = await screen.findByRole('textbox', { name: 'Ask on the side' })
    await userEvent.type(composer, 'Keep these words{Enter}')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Couldn’t start the aside. The lead signed out. Dismiss')
    expect(composer).toHaveProperty('value', 'Keep these words')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    vi.mocked(client.send).mockResolvedValueOnce(undefined)
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(2))
  })

  it('quotes the coordinator in the new composer, and lets the person drop that quote', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.you('Where?'), items.says('It retries in two places.')] })),
    })
    withServices(<Project />, client)
    const message = await screen.findByText('It retries in two places.')
    const range = document.createRange()
    range.selectNodeContents(message)
    range.getBoundingClientRect = () => new DOMRect(10, 20, 100, 20)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(document)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask in an aside' }))
    await screen.findByRole('textbox', { name: 'Ask about this, on the side' })
    await userEvent.click(screen.getByRole('button', { name: 'Drop the quote' }))
    expect(await screen.findByRole('textbox', { name: 'Ask on the side' })).toBeTruthy()
  })

  it('opens an existing aside, clears it immediately, and restores a refused clear on its tab', async () => {
    const { promise, reject } = Promise.withResolvers<void>()
    const { client } = fakeClient({
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [aside], calls: [], settledTotal: 0 })),
      getThread: vi.fn(async () => {
        const thread = snapshot()
        return { ...thread, threadId: 'tha', task: { ...thread.task, id: 'a1', scratch: true }, items: [items.says('The aside answered.')] }
      }),
      markTaskDone: vi.fn(() => promise),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('tab', { name: 'Retry' }))
    await screen.findByText('The aside answered.')
    await userEvent.click(screen.getByRole('button', { name: 'Clear Retry' }))
    expect(screen.queryByRole('tab', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText('The aside answered.')).toBeNull()
    await act(async () => reject(new ApiError({ reason: 'conflict', message: 'Still at work.' })))
    expect(await screen.findByRole('tab', { name: 'Retry' })).toBeTruthy()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Couldn’t clear “Retry”. Still at work. Dismiss')
  })
})
