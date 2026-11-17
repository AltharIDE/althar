import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { IssueChangeLine } from '@althar/contracts'

import { ChangesCard, type ChangesActions } from '../src/renderer/shared/ChangesCard'
import { detailOf, DraftCard, type DraftActions } from '../src/renderer/shared/DraftCard'
import { items } from './fixtures'

const draftActions = (): DraftActions => ({
  onFile: vi.fn(),
  onChange: vi.fn(async () => undefined),
  onDiscard: vi.fn(),
  onPrefer: vi.fn(),
})
const changeActions = (): ChangesActions => ({ onApply: vi.fn(), onDiscard: vi.fn(), onPrefer: vi.fn() })

describe('tracker changes from their cards', () => {
  it('files the current draft when choosing to file later drafts at once, and keeps Discard separate', async () => {
    const draft = items.draft({ priority: 'high', fields: [{ field: 'project', to: 'Launch' }], leftOff: ['Assignee'] })
    if (draft.kind !== 'issue_draft') throw new Error('Expected an issue draft')
    const actions = draftActions()
    render(<DraftCard draft={draft.content} actions={actions} />)
    expect(screen.getByText(/Priority: High/)).toBeTruthy()
    expect(screen.getByText(/Project: Launch/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Always file at once' }))
    expect(actions.onFile).toHaveBeenCalledExactlyOnceWith('idr_1')
    expect(actions.onPrefer).toHaveBeenCalledExactlyOnceWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(actions.onDiscard).toHaveBeenCalledExactlyOnceWith('idr_1')
  })

  it('leaves priority None off a draft and carries its edited words and labels back to the runtime', async () => {
    const draft = items.draft({ priority: 'none', fields: [] })
    if (draft.kind !== 'issue_draft') throw new Error('Expected an issue draft')
    const actions = draftActions()
    render(<DraftCard draft={draft.content} actions={actions} />)
    expect(screen.queryByText(/^Priority:/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const title = screen.getByRole('textbox', { name: 'Title' })
    await userEvent.clear(title)
    await userEvent.type(title, 'Keep the retry')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.onChange).toHaveBeenCalledWith('idr_1', expect.objectContaining({ title: 'Keep the retry', labels: ['payments'] }))
  })

  it('applies the current changes when choosing to change later issues at once', async () => {
    const item = items.changes({ note: 'For the release', task: 'Retry the checkout' })
    if (item.kind !== 'issue_changes') throw new Error('Expected issue changes')
    const actions = changeActions()
    render(<ChangesCard changes={item.content} actions={actions} />)
    await userEvent.click(screen.getByRole('button', { name: 'Always change at once' }))
    expect(actions.onApply).toHaveBeenCalledExactlyOnceWith('ich_1')
    expect(actions.onPrefer).toHaveBeenCalledExactlyOnceWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(actions.onDiscard).toHaveBeenCalledExactlyOnceWith('ich_1')
  })

  it('offers to ask first after automatic field changes, but not after a comment or a pull request’s status change', async () => {
    const item = items.changes({ state: 'applied', direct: true })
    if (item.kind !== 'issue_changes') throw new Error('Expected issue changes')
    const actions = changeActions()
    const view = render(<ChangesCard changes={item.content} actions={actions} />)
    await userEvent.click(screen.getByRole('button', { name: 'Always ask first' }))
    expect(actions.onPrefer).toHaveBeenCalledExactlyOnceWith(false)
    view.rerender(
      <ChangesCard
        changes={{
          ...item.content,
          issues: item.content.issues.map((issue) => ({ ...issue, changes: [{ field: 'comment', to: 'Ready.' }] })),
        }}
        actions={actions}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Always ask first' })).toBeNull()
    view.rerender(<ChangesCard changes={{ ...item.content, noteUrl: 'https://github.com/meridian/api/pull/12' }} actions={actions} />)
    expect(screen.queryByRole('button', { name: 'Always ask first' })).toBeNull()
  })

  it('shows the runtime’s status transition and per-issue refusal, with an empty task name left off', () => {
    const item = items.changes({ state: 'failed', task: '', note: 'After merge', noteUrl: 'https://github.com/meridian/api/pull/12' })
    if (item.kind !== 'issue_changes') throw new Error('Expected issue changes')
    render(
      <ChangesCard
        changes={{
          ...item.content,
          issues: item.content.issues.map((issue) => ({
            ...issue,
            from: 'Open',
            became: 'Done',
            applied: false,
            error: 'You cannot change this issue.',
          })),
        }}
        actions={changeActions()}
      />,
    )
    expect(screen.getAllByText('You cannot change this issue.')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /After merge/ }).getAttribute('href')).toBe('https://github.com/meridian/api/pull/12')
  })

  it.each([
    [{ field: 'labels', add: ['payments'], remove: [] }, 'Labels: payments'],
    [{ field: 'assignees', add: ['Sam'], remove: [] }, 'Assignees: Sam'],
    [{ field: 'project', to: null }, 'Project: none'],
    [{ field: 'priority', to: 'High' }, 'priority: High'],
  ] satisfies ReadonlyArray<readonly [IssueChangeLine, string]>)('names a draft’s extra field %#', (line, words) => {
    expect(detailOf(line)).toBe(words)
  })
})
