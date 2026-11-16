import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FilePicture } from '../src/renderer/shared/code/FilePicture'
import { useImagesFollow } from '../src/renderer/shared/code/finds'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/* A document's pictures follow it: one replaced at the same path while the page is open is read again. */

const picture = (data: () => string) =>
  vi.fn(async (_threadId: string, path: string) => ({
    path,
    text: '',
    from: 1,
    total: 1,
    cut: false,
    image: { type: 'image/png', data: data() },
  }))

/** A page as the panel draws one: its words are a query, and its picture follows each read of them. */
function Page({ words, onRead }: { words: () => string; onRead: (again: () => void) => void }) {
  const read = useQuery({ queryKey: ['words'], queryFn: async () => ({ text: words() }) })
  onRead(() => void read.refetch())
  useImagesFollow(read.dataUpdatedAt)
  return read.data === undefined ? null : <FilePicture threadId="th1" path="docs/flow.png" alt="flow" />
}

describe('a document’s pictures', () => {
  it('are read again when the document is read again with the very same words, so a picture replaced at the same path shows as it is now', async () => {
    let data = 'AAAA'
    const readCode = picture(() => data)
    const { client } = fakeClient({ readCode })
    let again: () => void = () => undefined
    withServices(<Page words={() => 'Same words.'} onRead={(next) => (again = next)} />, client)
    expect((await screen.findByRole('img', { name: 'flow' })).getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(readCode).toHaveBeenCalledTimes(1)
    // The agent replaces the picture; the document is read again, and says what it said (the query keeps its first answer).
    data = 'BBBB'
    act(() => again())
    await waitFor(() => expect(screen.getByRole('img', { name: 'flow' }).getAttribute('src')).toBe('data:image/png;base64,BBBB'))
    expect(readCode).toHaveBeenCalledTimes(2)
  })

  it('are not asked for again by the document being read the first time', async () => {
    const readCode = picture(() => 'AAAA')
    const { client } = fakeClient({ readCode })
    withServices(<Page words={() => 'Same words.'} onRead={() => undefined} />, client)
    await screen.findByRole('img', { name: 'flow' })
    expect(readCode).toHaveBeenCalledTimes(1)
  })
})
