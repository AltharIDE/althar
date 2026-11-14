import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadSnapshot } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's changed markdown file, in the window over the whole screen: a
 * page first, what changed marked, its pictures read where the task works;
 * its source, the diff, a click or a key away.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const file = (path: string, more: Partial<ThreadSnapshot['task']['files'][number]> = {}) => ({
  path,
  from: null,
  status: 'modified' as const,
  add: 1,
  del: 1,
  binary: false,
  uncommitted: false,
  ...more,
})

describe('a changed markdown file, in the task’s changes', () => {
  it('opens as a page from the outputs, its change marked and its picture drawn, with the diff as its source', async () => {
    const getFileDiff = vi.fn(async (_taskId: string, path: string) => ({
      file: file(path),
      lines:
        path === 'README.md'
          ? [
              { kind: 'hunk' as const, text: '@@ -1,5 +1,5 @@' },
              { kind: 'context' as const, old: 1, new: 1, text: '# Retries' },
              { kind: 'context' as const, old: 2, new: 2, text: '' },
              { kind: 'removed' as const, old: 3, text: 'Tried 2 times.' },
              { kind: 'added' as const, new: 3, text: 'Tried **3** times.' },
              { kind: 'context' as const, old: 4, new: 4, text: '' },
              { kind: 'context' as const, old: 5, new: 5, text: '![flow](docs/flow.png)' },
            ]
          : [
              { kind: 'hunk' as const, text: '@@ -1 +1 @@' },
              { kind: 'removed' as const, old: 1, text: 'const tries = 3' },
              { kind: 'added' as const, new: 1, text: 'const tries = 5' },
            ],
      truncated: false,
      whole: true,
    }))
    const readCode = vi.fn(async (_threadId: string, path: string, _at?: { readonly image?: boolean }) => ({
      path,
      text: '',
      from: 1,
      total: 0,
      cut: false,
      image: { type: 'image/png', data: 'iVBORw0KGgo=' },
    }))
    const { client } = fakeClient({
      getFileDiff,
      readCode,
      getThread: vi.fn(async () =>
        snapshot({
          task: {
            ...snapshot().task,
            branch: 'althar/retry',
            baseRef: 'origin/main',
            changes: [change()],
            files: [file('README.md'), file('src/limit.ts')],
          },
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.keyboard('o')
    await userEvent.click(await screen.findByRole('button', { name: 'Open the diff of README.md' }))
    const view = await screen.findByRole('dialog', { name: 'Changes' })

    // A page, with what changed marked: the new words added, the old ones where they were.
    expect(await within(view).findByRole('heading', { name: 'Retries' })).toBeTruthy()
    expect(
      within(view)
        .getByRole('radio', { name: /Rendered/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(within(view).getByRole('group', { name: 'Added' }).textContent).toContain('Tried 3 times.')
    expect(within(view).getByRole('group', { name: 'Removed' }).textContent).toContain('Tried 2 times.')
    // Its picture is a file of the task's own, read from where it works.
    const picture = await within(view).findByRole('img', { name: 'flow' })
    expect(picture.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(readCode).toHaveBeenCalledWith('th1', 'docs/flow.png', { image: true })

    // Source is the diff, as any file's; M goes back.
    await userEvent.click(within(view).getByRole('radio', { name: /Source/ }))
    expect(within(view).queryByRole('heading', { name: 'Retries' })).toBeNull()
    expect(within(view).getByText('Tried 2 times.')).toBeTruthy()
    await userEvent.keyboard('m')
    expect(await within(view).findByRole('heading', { name: 'Retries' })).toBeTruthy()

    // A file that isn't markdown is its diff, with no way to choose.
    await userEvent.click(within(view).getByRole('button', { name: /limit\.ts/ }))
    await waitFor(() => expect(within(view).getByText('const tries = 5')).toBeTruthy())
    expect(within(view).queryByRole('radio', { name: /Rendered/ })).toBeNull()
  })
})
