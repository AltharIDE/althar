import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { IssueSummary } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { changed, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What a task's conversation opens with: the issue it came from, as its
 * tracker shows it; and a permission waiting, which takes focus once, so a
 * later one doesn't take it from what the person moved on to.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const issue = (overrides: Partial<IssueSummary> = {}): IssueSummary => ({
  product: 'jira_cloud',
  ref: 'MER-12',
  key: 'MER-12',
  title: 'Refunds skip the rate limiter',
  url: 'https://meridian.atlassian.net/browse/MER-12',
  status: { name: 'In Progress', category: 'started' },
  priority: { level: 'high', name: 'High' },
  container: 'Payments',
  ...overrides,
})

describe('the issue a task came from', () => {
  it('shows above the conversation with its priority and where it is kept', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, issue: issue() } })) })
    withServices(<Task />, client)
    const card = (await screen.findByText('Refunds skip the rate limiter')).closest('a')
    expect(card?.getAttribute('href')).toBe('https://meridian.atlassian.net/browse/MER-12')
    expect(card?.textContent).toContain('High')
    expect(card?.textContent).toContain('Payments')
  })

  it('says no priority where its tracker gives it none', async () => {
    const plain = issue({ product: 'linear', priority: { level: 'none', name: 'No priority' }, container: null })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ task: { ...snapshot().task, issue: plain } })) })
    withServices(<Task />, client)
    const card = (await screen.findByText('Refunds skip the rate limiter')).closest('a')
    expect(card?.textContent).not.toContain('No priority')
  })
})

describe('a permission waiting as the task opens', () => {
  it('takes focus once: answered, the next one doesn’t take it from the composer', async () => {
    const call = (id: string) => ({
      id,
      kind: 'permission' as const,
      stuck: null,
      title: `Run git push ${id}`,
      reason: 'It asks.',
      command: `git push ${id}`,
      createdAt: '2026-09-29T12:00:00.000Z',
    })
    let attention = [call('a1')]
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => snapshot({ attention })) })
    withServices(<Task />, client)
    await waitFor(() => expect(screen.getByRole('radio', { name: /Yes, this once/ })).toBe(document.activeElement))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
    // Answered, it is gone; the person writes to the lead.
    attention = []
    act(() => emit(changed('attention_request', 'a1')))
    const box = await screen.findByPlaceholderText(/^Tell .+ something$/)
    await waitFor(() => expect(screen.queryByText('Needs your permission')).toBeNull())
    box.focus()
    attention = [call('a2')]
    act(() => emit(changed('attention_request', 'a2')))
    await screen.findByText('Needs your permission')
    await act(async () => {})
    expect(box).toBe(document.activeElement)
  })
})
