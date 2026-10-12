import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { EvidenceKind } from '../src/foundations/vocabulary'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_NOT_KEPT } from '../src/fixtures/shots'
import { Evidence, type EvidencePiece } from '../src/thread/Evidence/Evidence'
import { Lightbox } from '../src/thread/Lightbox/Lightbox'
import { ThreadShellProvider, type ImageRef } from '../src/thread/Shell/Shell'

const SHOTS: EvidencePiece[] = [
  { id: 'before', kind: EvidenceKind.Screenshot, caption: 'Before', form: 'picture', shot: SHOT_BEFORE },
  { id: 'after', kind: EvidenceKind.Screenshot, caption: 'After the fix', form: 'picture', shot: SHOT_AFTER },
]
const RUN: EvidencePiece = {
  id: 'run',
  kind: EvidenceKind.TestRun,
  caption: 'The tests',
  form: 'output',
  command: 'bun run test',
  exit: 1,
  lines: ['1 failed'],
}

/* A thread's host with a lightbox, as the app has one. */
function Host({ pieces, unverified }: { pieces: EvidencePiece[]; unverified?: string[] }) {
  const [open, setOpen] = useState<{ set: readonly ImageRef[]; at: number } | null>(null)
  return (
    <ThreadShellProvider value={{ openImage: (image, set = [image]) => setOpen({ set, at: set.indexOf(image) }) }}>
      <Evidence pieces={pieces} {...(unverified === undefined ? {} : { unverified })} />
      {open && <Lightbox images={open.set} defaultIndex={open.at} onClose={() => setOpen(null)} />}
    </ThreadShellProvider>
  )
}

describe('Evidence', () => {
  it('opens its screenshots in the lightbox as one set, by their captions', async () => {
    const user = userEvent.setup()
    render(<Host pieces={[...SHOTS, RUN]} />)
    await user.click(screen.getByRole('button', { name: 'View After the fix full size' }))
    const dialog = await screen.findByRole('dialog', { name: 'After the fix' })
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('folds what a run printed under its row, which says how it exited', async () => {
    const user = userEvent.setup()
    render(<Host pieces={[RUN]} />)
    const row = screen.getByRole('button', { name: 'What it printed: The tests' })
    expect(row).toHaveTextContent('Test runThe testsexit 1')
    expect(screen.queryByText('1 failed')).not.toBeInTheDocument()
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('bun run test')).toBeVisible()
    expect(screen.getByText('1 failed')).toBeVisible()
    // The row says the exit; the output doesn't say it again.
    expect(screen.getAllByText('exit 1')).toHaveLength(1)
  })

  it('lists what couldn’t be shown, alone where nothing was', () => {
    render(<Host pieces={[]} unverified={['Not tried with a real microphone']} />)
    expect(screen.queryByRole('heading', { name: 'Evidence' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unverified' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('Not tried with a real microphone')
  })

  it('shows a note as said, a picture not kept as still, and nothing with nothing to show', () => {
    const { container, rerender } = render(
      <Host
        pieces={[
          { id: 'note', kind: EvidenceKind.Note, caption: 'A typo: nothing to show', form: 'note' },
          { id: 'gone', kind: EvidenceKind.Screenshot, caption: 'Gone', form: 'picture', shot: SHOT_NOT_KEPT },
        ]}
      />,
    )
    expect(screen.getByText('A typo: nothing to show')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<Host pieces={[]} />)
    expect(container.querySelector('section')).toBeNull()
  })
})
