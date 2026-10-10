import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { SHOT_AFTER, SHOT_BEFORE, SHOT_RUN } from '../src/fixtures/shots'
import { Shots } from '../src/thread/Shots/Shots'
import { ImageView, Lightbox } from '../src/thread/Lightbox/Lightbox'
import { ThreadShellProvider, type ImageRef } from '../src/thread/Shell/Shell'

/* A thread's host, as an app has one: Shots opens the Lightbox with the set it came from. */
function Host({ items }: { items: ReadonlyArray<ImageRef & { id: string }> }) {
  const [open, setOpen] = useState<{ set: readonly ImageRef[]; at: number } | null>(null)
  return (
    <ThreadShellProvider value={{ openImage: (image, set = [image]) => setOpen({ set, at: set.indexOf(image) }) }}>
      <button type="button">Before the screenshots</button>
      <Shots items={items} />
      {open && <Lightbox images={open.set} defaultIndex={open.at} onClose={() => setOpen(null)} />}
    </ThreadShellProvider>
  )
}

describe('Lightbox', () => {
  it('takes focus, keeps it inside while open, and gives it back to the shot that opened it', async () => {
    const user = userEvent.setup()
    render(<Host items={[SHOT_BEFORE, SHOT_AFTER]} />)
    const shot = screen.getByRole('button', { name: 'View After full size' })
    await user.click(shot)
    const dialog = await screen.findByRole('dialog', { name: 'After' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /Close/ })).toHaveFocus())
    // Tab goes round the dialog's own controls and never out of it.
    for (let i = 0; i < 5; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(shot).toHaveFocus())
  })

  it('moves between shots with the arrows, round the ends, and says where it is', async () => {
    const user = userEvent.setup()
    render(<Host items={[SHOT_BEFORE, SHOT_AFTER, SHOT_RUN[0] as ImageRef & { id: string }]} />)
    await user.click(screen.getByRole('button', { name: 'View Before full size' }))
    expect(await screen.findByRole('dialog', { name: 'Before' })).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: 'Empty' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Empty, 3 of 3')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'Before' })).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    // The picture's words are its alternative text.
    await user.keyboard('{Home}')
    expect(screen.getByRole('img', { name: SHOT_BEFORE.alt })).toBeInTheDocument()
  })

  it('shows one image without a position or arrows, and ignores the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Lightbox images={[SHOT_AFTER]} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
  })

  it('can be driven by its parent', async () => {
    const user = userEvent.setup()
    const seen: number[] = []
    function Driven() {
      const [index, setIndex] = useState(0)
      return (
        <Lightbox
          images={[SHOT_BEFORE, SHOT_AFTER]}
          index={index}
          onIndexChange={(next) => {
            seen.push(next)
            setIndex(next)
          }}
          onClose={() => {}}
        />
      )
    }
    render(<Driven />)
    await user.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
    expect(seen).toEqual([1])
  })

  it('keeps an index past the end inside the set', () => {
    render(<Lightbox images={[SHOT_BEFORE, SHOT_AFTER]} index={9} onIndexChange={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
  })
})

describe('ImageView', () => {
  it('loads lazily and off the main thread, at its size, from the smaller copy where asked', () => {
    render(<ImageView image={{ ...SHOT_AFTER, thumb: 'thumb.png' }} size="thumb" />)
    const img = screen.getByRole('img', { name: SHOT_AFTER.alt })
    expect(img).toHaveAttribute('src', 'thumb.png')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img).toHaveAttribute('width', '1440')
    expect(img).toHaveAttribute('height', '900')
    expect(img).toHaveAttribute('data-state', 'loading')
  })

  it('says it is loaded once the picture loads, and that it couldn’t be shown when it fails', async () => {
    const { rerender } = render(<ImageView image={SHOT_AFTER} />)
    const img = screen.getByRole('img')
    img.dispatchEvent(new Event('load'))
    await waitFor(() => expect(img).toHaveAttribute('data-state', 'loaded'))
    rerender(<ImageView image={{ ...SHOT_AFTER, src: 'gone.png' }} />)
    screen.getByRole('img').dispatchEvent(new Event('error'))
    expect(await screen.findByText('Couldn’t show this image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('stands in with its words, waits without a picture while loading, and draws a view', () => {
    const { rerender, container } = render(<ImageView image={{ name: 'plain.png' }} />)
    expect(screen.getByText('plain.png')).toBeInTheDocument()
    expect(screen.queryByText('Couldn’t show this image')).not.toBeInTheDocument()
    rerender(<ImageView image={{ name: 'slow.png', status: 'loading' }} />)
    expect(container.querySelector('[data-state="loading"]')).toBeInTheDocument()
    rerender(<ImageView image={{ name: 'drawn.png', view: <b>drawn</b> }} />)
    expect(screen.getByText('drawn')).toBeInTheDocument()
    rerender(<ImageView image={{ name: 'kept.png', status: 'failed', view: <b>drawn</b> }} />)
    expect(screen.getByText('Couldn’t show this image')).toBeInTheDocument()
  })
})
