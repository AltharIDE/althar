import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { CodeFile, CodeFound } from '@althar/contracts'
import type { Client } from '../src/renderer/data/client'

import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'

import { useCodeHost, type CodeOpen, whereOf } from '../src/renderer/shared/code/CodeHost'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

const file: CodeFile = {
  kind: 'file',
  name: 'retry.ts',
  path: 'src/retry.ts',
  byName: true,
  bytes: 20,
  lines: 2,
  content: 'text',
  changed: null,
  since: null,
}

function Code({
  found = file,
  width = 800,
  taskId = 't1',
  onTop = false,
}: {
  found?: CodeFound
  width?: number
  taskId?: string | null
  onTop?: boolean
}) {
  const [open, setOpen] = useState<CodeOpen | null>({ found, from: null, onTop })
  const [peek, setPeek] = useState(false)
  const host = useCodeHost({
    threadId: 'th1',
    taskId,
    open,
    onOpen: (found, from) => setOpen({ found, from, onTop }),
    onClose: () => setOpen(null),
    onCloseAll: () => setOpen(null),
  })
  return (
    <>
      <button type="button" onClick={() => setPeek(!peek)}>
        Peek
      </button>
      {peek ? host.shell?.peek(found, document.body) : host.panel(width)}
    </>
  )
}

describe('code references whose contents or editor cannot be read', () => {
  it('says when a file read fails and still opens that path in the sole available editor, without a line', async () => {
    const { client } = fakeClient({
      readCode: vi.fn(async () => {
        throw new Error('Gone')
      }),
      listEditors: vi.fn(async () => [{ id: 'zed', name: 'Zed' }]),
    })
    withServices(<Code width={300} />, client)
    expect(await screen.findByText('Couldn’t read this file.')).toBeTruthy()
    expect(client.readCode).toHaveBeenCalledWith('th1', 'src/retry.ts', {})
    await userEvent.click(await screen.findByRole('button', { name: 'Zed' }))
    expect(client.openCode).toHaveBeenCalledWith({ threadId: 'th1', path: 'src/retry.ts', editor: 'zed' })
  })

  it('opens in the existing editor without changing preferences, or chooses another from the menu', async () => {
    const host = fakeHost({ preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, editor: 'zed' })) })
    const { client } = fakeClient()
    withServices(<Code />, client, host)
    const panel = await screen.findByRole('complementary', { name: 'retry.ts' })
    const open = await within(panel).findByRole('button', { name: 'Open in Zed' })
    fireEvent.keyDown(panel, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(client.openCode).toHaveBeenCalledOnce())
    expect(host.setPreference).not.toHaveBeenCalled()
    await userEvent.click(within(panel).getByRole('button', { name: 'Open in another editor' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show in Finder' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('editor', 'finder'))
    expect(client.openCode).toHaveBeenLastCalledWith({ threadId: 'th1', path: 'src/retry.ts', editor: 'finder' })
    expect(open).toBeTruthy()
  })

  it.each(['binary', 'large'] as const)('does not try to read a %s file as text', async (content) => {
    const { client } = fakeClient({ listEditors: vi.fn(async () => []) })
    withServices(<Code found={{ ...file, content }} />, client)
    expect(await screen.findByText(content === 'binary' ? 'Not text' : 'Too large to show')).toBeTruthy()
    expect(client.readCode).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Open in/ })).toBeNull()
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Enter', ctrlKey: true })
    expect(client.openCode).not.toHaveBeenCalled()
  })

  it('lets a missing or ambiguous reference choose a concrete file, and keeps no editor action on an ambiguous name', async () => {
    const { client } = fakeClient({
      findCode: vi.fn<Client['findCode']>(async (_id, messages) => ({
        place: { kind: 'task', repositories: [{ slug: 'api', name: 'api', branch: 'main' }] },
        messages: messages.map((message) => ({ found: [{ ...file, name: message.names[0] ?? file.name }] })),
      })),
    })
    withServices(<Code found={{ kind: 'several', name: 'retry.ts', paths: ['src/retry.ts', 'tests/retry.ts'] }} />, client)
    expect(await screen.findByText('2 files are called retry.ts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Open in/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'src/retry.ts' }))
    await waitFor(() => expect(client.readCode).toHaveBeenCalledWith('th1', 'src/retry.ts', {}))
    expect(screen.queryByText('2 files are called retry.ts')).toBeNull()
  })

  it('keeps an unresolved near-name on screen, without opening an invented result', async () => {
    const { client } = fakeClient()
    withServices(<Code found={{ kind: 'missing', name: 'reties.ts', path: 'src/reties.ts', near: ['src/retry.ts'] }} onTop />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'src/retry.ts' }))
    await waitFor(() => expect(client.findCode).toHaveBeenCalled())
    expect(screen.getByText('There’s no such file')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the document' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows a peek in a coordinator with no task and no editor, and offers no beside action', async () => {
    const { client } = fakeClient({ listEditors: vi.fn(async () => []) })
    withServices(<Code taskId={null} />, client)
    await userEvent.click(screen.getByRole('button', { name: 'Peek' }))
    await waitFor(() => expect(client.readCode).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Open beside' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Open in/ })).toBeNull()
  })

  it('uses no branch for an ambiguous reference across repositories, and none before its place is read', () => {
    expect(whereOf(undefined, file)).toBeUndefined()
    expect(
      whereOf(
        {
          kind: 'task',
          repositories: [
            { slug: 'api', name: 'api', branch: 'main' },
            { slug: 'web', name: 'web', branch: 'next' },
          ],
        },
        { kind: 'several', name: 'retry.ts', paths: [] },
      ),
    ).toEqual({ kind: 'task', branch: '' })
  })
})
