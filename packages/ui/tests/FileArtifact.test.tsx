import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { FileArtifact } from '../src/thread/FileArtifact/FileArtifact'
import { ThreadShellProvider } from '../src/thread/Shell/Shell'

describe('FileArtifact', () => {
  it('opens its document in the panel by where the host reads it, shown by its name as the person reads it', async () => {
    const openDoc = vi.fn()
    render(
      <ThreadShellProvider value={{ openDoc }}>
        <FileArtifact path="docs/notes.md" source="/t/meridian/task/api/docs/notes.md" kind="Markdown" body="# Notes" />
      </ThreadShellProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read in the panel' }))
    expect(openDoc).toHaveBeenCalledWith({ path: 'docs/notes.md', source: '/t/meridian/task/api/docs/notes.md', body: '# Notes' })
  })

  it('opens it by its path alone where the host gives no other', async () => {
    const openDoc = vi.fn()
    render(
      <ThreadShellProvider value={{ openDoc }}>
        <FileArtifact path="docs/notes.md" kind="Markdown" body="# Notes" />
      </ThreadShellProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read in the panel' }))
    expect(openDoc).toHaveBeenCalledWith({ path: 'docs/notes.md', body: '# Notes' })
  })
})
