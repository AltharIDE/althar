import { act, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FilePicture } from '../src/renderer/shared/code/FilePicture'
import { useImagesFollow } from '../src/renderer/shared/code/finds'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/* A document's pictures follow it: one replaced at the same path while the page is open is read again. */

function Page({ onVersion }: { onVersion: (set: (version: string) => void) => void }) {
  const [version, setVersion] = useState('one')
  onVersion(setVersion)
  // What the page is read from, as the panel reads it: a new read is a new value.
  useImagesFollow(version)
  return <FilePicture threadId="th1" path="docs/flow.png" alt="flow" />
}

describe('a document’s pictures', () => {
  it('are read again when the document is read again, so a picture replaced at the same path shows as it is now', async () => {
    let data = 'AAAA'
    const readCode = vi.fn(async (_threadId: string, path: string) => ({
      path,
      text: '',
      from: 1,
      total: 1,
      cut: false,
      image: { type: 'image/png', data },
    }))
    const { client } = fakeClient({ readCode })
    let set: (version: string) => void = () => undefined
    withServices(<Page onVersion={(next) => (set = next)} />, client)
    const first = await screen.findByRole('img', { name: 'flow' })
    expect(first.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(readCode).toHaveBeenCalledTimes(1)
    // The agent replaces the picture; the document is read again.
    data = 'BBBB'
    act(() => set('two'))
    await waitFor(() => expect(screen.getByRole('img', { name: 'flow' }).getAttribute('src')).toBe('data:image/png;base64,BBBB'))
    expect(readCode).toHaveBeenCalledTimes(2)
  })

  it('are not asked for again by the document being read the first time', async () => {
    const readCode = vi.fn(async (_threadId: string, path: string) => ({
      path,
      text: '',
      from: 1,
      total: 1,
      cut: false,
      image: { type: 'image/png', data: 'AAAA' },
    }))
    const { client } = fakeClient({ readCode })
    withServices(<Page onVersion={() => undefined} />, client)
    await screen.findByRole('img', { name: 'flow' })
    expect(readCode).toHaveBeenCalledTimes(1)
  })
})
