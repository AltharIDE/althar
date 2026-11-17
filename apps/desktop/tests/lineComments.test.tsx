import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChangedFile, LineCommentNow, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { viewedSent } from '../src/renderer/features/task/useLineComments'
import { queuedOf } from '../src/renderer/shared/items'
import { outgoingOf } from '../src/renderer/shared/useAttachments'
import { fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * Comments on lines of a task's diff (DEV-175): picked and written in the
 * Changes view, gathered, sent to the lead in one message with each one's
 * file, lines and code; shown in the person's message, opening the diff on
 * its line; and addressed once a commit since changed those lines.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 1, del: 1, binary: false, uncommitted: false }

const diff = {
  file,
  lines: [
    { kind: 'hunk' as const, text: '@@ -1,4 +1,4 @@' },
    { kind: 'context' as const, old: 1, new: 1, text: 'export const pay = async () => {' },
    { kind: 'removed' as const, old: 2, text: '  return charge()' },
    { kind: 'added' as const, new: 2, text: '  return retry(charge)' },
    { kind: 'context' as const, old: 3, new: 3, text: '}' },
  ],
  truncated: false,
}

const ready = (extra: ReadonlyArray<ThreadItem> = []): ThreadSnapshot => {
  const base = snapshot({ items: [items.you('Add a retry'), ...extra] })
  return { ...base, task: { ...base.task, phase: 'ready', files: [file] } }
}

const sentComment: LineCommentNow = {
  id: 'item_said:0',
  itemId: 'item_said',
  sentAt: new Date().toISOString(),
  path: 'src/checkout.ts',
  side: 'new',
  start: 2,
  end: 2,
  code: [{ kind: 'added', text: '  return retry(charge)' }],
  note: 'Cap the retries.',
  at: { path: 'src/checkout.ts', line: 2 },
  addressed: false,
}

describe('comments on the diff', () => {
  it('gathers comments on lines and sends them to the lead in one message, each with its file, lines and code', async () => {
    const user = userEvent.setup()
    const { client } = fakeClient({ getThread: vi.fn(async () => ready()), getFileDiff: vi.fn(async () => diff) })
    withServices(<Task />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    fireEvent.keyDown(window, { key: 'd', metaKey: true })
    const view = await screen.findByRole('dialog', { name: 'Changes' })

    // A line: its number picks it, and the box under it takes what the person says.
    await user.click(await within(view).findByRole('button', { name: 'Comment on line 2' }))
    await user.type(within(view).getByRole('textbox', { name: 'Comment on line 2' }), 'Cap the retries.')
    await user.click(within(view).getByRole('button', { name: 'Comment' }))
    // A range, Shift held: a removed line and the one put in its place.
    await user.click(within(view).getByRole('button', { name: 'Comment on removed line 2' }))
    await user.keyboard('{Shift>}')
    await user.click(within(view).getByRole('button', { name: 'Comment on line 3' }))
    await user.keyboard('{/Shift}')
    await user.type(within(view).getByRole('textbox'), 'Why not keep the old call?')
    await user.keyboard('{Enter}')

    // Gathered, nothing goes until Send, which takes both in one message.
    expect(client.send).not.toHaveBeenCalled()
    await user.click(within(view).getByRole('button', { name: 'Send 2 comments' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1))
    const [sent] = vi.mocked(client.send).mock.calls[0] ?? []
    expect(sent?.threadId).toBe('th1')
    expect(sent?.comments).toEqual([
      {
        path: 'src/checkout.ts',
        side: 'new',
        start: 2,
        end: 2,
        code: [{ kind: 'added', text: '  return retry(charge)' }],
        note: 'Cap the retries.',
      },
      expect.objectContaining({
        path: 'src/checkout.ts',
        code: [
          { kind: 'removed', text: '  return charge()' },
          { kind: 'added', text: '  return retry(charge)' },
          { kind: 'context', text: '}' },
        ],
        note: 'Why not keep the old call?',
      }),
    ])
    // Sent, the view reads them back from Althar, and none wait to go.
    await waitFor(() => expect(vi.mocked(client.getLineComments).mock.calls.length).toBeGreaterThan(1))
    expect(within(view).queryByRole('button', { name: /^Send/ })).toBeNull()
  })

  it('shows a sent comment in the person’s message with its code, opening the diff at its line', async () => {
    const user = userEvent.setup()
    const you = items.you('') as Extract<ThreadItem, { kind: 'user_message' }>
    const said: ThreadItem = { ...you, id: 'item_said', content: { ...you.content, comments: [{ ...sentComment, id: 'item_said:0' }] } }
    const { client } = fakeClient({
      getThread: vi.fn(async () => ready([said])),
      getFileDiff: vi.fn(async () => diff),
      getLineComments: vi.fn(async () => ({ comments: [sentComment] })),
    })
    withServices(<Task />, client)
    // Ready, it opens on its outputs: the conversation is a key away.
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    ;(document.activeElement as HTMLElement | null)?.blur()
    await user.keyboard('c')
    const place = await screen.findByRole('button', { name: 'Open src/checkout.ts, line 2, in the diff' })
    expect(screen.getByText('Cap the retries.')).toBeTruthy()
    expect(screen.getAllByText('return retry(charge)', { exact: false }).length).toBeGreaterThan(0)
    await user.click(place)
    const view = await screen.findByRole('dialog', { name: 'Changes' })
    expect(client.getLineComments).toHaveBeenCalledWith('t1')
    const note = await within(view).findByRole('article', { current: true })
    expect(note.textContent).toContain('Cap the retries.')
    expect(note.textContent).toContain('Sent')
  })

  it('shows a comment as addressed once Althar says a commit since changed its lines', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => ready()),
      getFileDiff: vi.fn(async () => diff),
      getLineComments: vi.fn(async () => ({ comments: [{ ...sentComment, addressed: true }] })),
    })
    withServices(<Task />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    fireEvent.keyDown(window, { key: 'd', metaKey: true })
    const view = await screen.findByRole('dialog', { name: 'Changes' })
    expect((await within(view).findByText('Addressed')).closest('article')?.textContent).toContain('Cap the retries.')
    // Addressed, it no longer counts on its file.
    expect(within(view).queryByText('1 comment')).toBeNull()
  })

  it('keeps a queued message’s comments when it is taken back to edit or sent now', () => {
    const you = items.you('', { state: 'queued', interrupting: false }) as Extract<ThreadItem, { kind: 'user_message' }>
    const { id: _id, itemId: _item, sentAt: _at, at: _where, addressed: _done, ...comment } = sentComment
    const queued = { ...you, content: { ...you.content, comments: [{ id: `${you.id}:0`, ...comment }] } }
    const [said] = queuedOf([queued], true)
    expect(said?.comments).toEqual([comment])
    expect(said === undefined ? undefined : outgoingOf(said).comments).toEqual([comment])
  })

  it('places a sent comment under the last of its lines where they are now', () => {
    const moved = viewedSent({ ...sentComment, start: 2, end: 4, at: { path: 'src/checkout.ts', line: 7 } })
    expect(moved).toMatchObject({ state: 'sent', line: 9 })
    expect(viewedSent({ ...sentComment, at: null }).line).toBeNull()
    expect(viewedSent({ ...sentComment, addressed: true }).state).toBe('addressed')
  })
})
