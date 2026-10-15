import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Dash } from '../../fixtures/meridian'
import {
  SHOT_AFTER,
  SHOT_BEFORE,
  SHOT_BROKEN,
  SHOT_LOADING,
  SHOT_NOT_KEPT,
  SHOT_PORTRAIT,
  SHOT_RUN,
  SHOT_SMALL,
  SHOT_UNSIZED,
} from '../../fixtures/shots'
import { Lightbox } from './Lightbox'

const meta = {
  title: 'Thread/Lightbox',
  component: Lightbox,
  parameters: { layout: 'fullscreen' },
  args: { images: [{ name: 'refund-refused-after.png', meta: '1440 × 900 · 212 KB', view: <Dash after /> }], onClose: fn(), onOpen: fn() },
} satisfies Meta<typeof Lightbox>
export default meta
type Story = StoryObj<typeof meta>

export const Image: Story = {}
/** No preview to show: the name stands in. */
export const NoPreview: Story = { args: { images: [{ name: '429-response.png' }] } }

/** A picture at its src, at full size. */
export const Picture: Story = { args: { images: [SHOT_AFTER] } }

/** Taller than wide: it keeps its shape rather than sitting in a 16:9 frame. */
export const Portrait: Story = { args: { images: [SHOT_PORTRAIT] } }

/** Smaller than the screen: shown at its own size, not enlarged. */
export const Small: Story = { args: { images: [SHOT_SMALL] } }

/** The browser's word that a picture has loaded, at the size it gave. */
const loadedAt = (img: HTMLElement, width: number, height: number) => {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  img.dispatchEvent(new Event('load'))
}

/** No size given: the frame stays as it was while the picture arrives, so nothing moves. */
export const Unsized: Story = {
  args: { images: [SHOT_UNSIZED] },
  play: async ({ canvasElement }) => {
    const img = within(canvasElement.ownerDocument.body).getByRole('img')
    const box = img.parentElement!
    await expect(box.style.getPropertyValue('--w')).toBe('')
    loadedAt(img, 1600, 600)
    await expect(box.style.getPropertyValue('--w')).toBe('')
  },
}

/** Unsized and small: the frame stays, and the picture is held to its own size inside it. */
export const UnsizedSmall: Story = {
  args: { images: [{ ...SHOT_SMALL, width: undefined, height: undefined }] },
  play: async ({ canvasElement }) => {
    const img = within(canvasElement.ownerDocument.body).getByRole('img')
    const box = img.parentElement!
    loadedAt(img, 240, 120)
    await waitFor(() => expect(box).toHaveAttribute('data-measured'))
    await expect(box.style.getPropertyValue('--nw')).toBe('240')
    await expect(box.style.getPropertyValue('--w')).toBe('')
  },
}

/** Only a width given: as good as none, so the frame stays when the height arrives. */
export const WidthOnly: Story = {
  args: { images: [{ ...SHOT_PORTRAIT, height: undefined }] },
  play: async ({ canvasElement }) => {
    const img = within(canvasElement.ownerDocument.body).getByRole('img')
    const box = img.parentElement!
    loadedAt(img, 390, 1200)
    await waitFor(() => expect(box).toHaveAttribute('data-measured'))
    await expect(box.style.getPropertyValue('--w')).toBe('')
  },
}

/** A click or Z shows the picture at its actual size, and again to fit. */
export const ActualSize: Story = {
  args: { images: [SHOT_AFTER] },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const box = page.getByRole('img').parentElement!
    await expect(box).not.toHaveAttribute('data-actual')
    await userEvent.keyboard('z')
    await expect(box).toHaveAttribute('data-actual')
    await userEvent.click(box)
    await expect(box).not.toHaveAttribute('data-actual')
  },
}

/** Actual size lasts for one showing: leaving and coming back starts fitted. */
export const ActualSizeResets: Story = {
  args: { images: [SHOT_BEFORE, SHOT_AFTER] },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.keyboard('z')
    await expect(page.getByRole('img').parentElement).toHaveAttribute('data-actual')
    await userEvent.keyboard('{ArrowRight}{ArrowLeft}')
    await expect(page.getByRole('img').parentElement).not.toHaveAttribute('data-actual')
  },
}

/**
 * Opened from a set: the arrows and the buttons beside the name move
 * between them, round from the last to the first, and the move is said.
 */
export const Gallery: Story = {
  args: { images: [SHOT_BEFORE, SHOT_AFTER, ...SHOT_RUN.slice(0, 2)], defaultIndex: 1 },
  play: async ({ canvasElement, args }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
    await expect(page.getByText('2 of 4')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    await expect(page.getByRole('dialog', { name: 'Empty' })).toBeInTheDocument()
    await expect(page.getByRole('status')).toHaveTextContent('Empty, 3 of 4')
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('{ArrowRight}')
    await expect(page.getByRole('dialog', { name: 'Before' })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Previous image' }))
    await expect(page.getByRole('dialog', { name: 'One refund' })).toBeInTheDocument()
    await userEvent.keyboard('{Home}')
    await userEvent.click(page.getByRole('button', { name: 'Next image' }))
    await expect(page.getByRole('dialog', { name: 'After' })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Open in Preview' }))
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: SHOT_AFTER.name }))
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}

/** Still on its way: its box holds its shape. */
export const Loading: Story = { args: { images: [SHOT_LOADING] } }

/** One the host couldn't keep, and one whose file is gone: each says so in its place. */
export const Failed: Story = { args: { images: [SHOT_NOT_KEPT, SHOT_BROKEN] } }

/** A long set: only the one showing is drawn, and the position says how far along it is. */
export const Long: Story = { args: { images: SHOT_RUN, defaultIndex: 6 } }

/** Nothing to show: nothing opens. */
export const Empty: Story = {
  args: { images: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/* A modal shows one at a time: with a preview and both actions, Close hovered. The rest are the stories above. */
export const AllStates: Story = {
  parameters: { pseudo: { hover: ['[role="dialog"] button:last-child'] } },
}
