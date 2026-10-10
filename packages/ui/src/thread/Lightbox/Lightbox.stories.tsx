import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Dash } from '../../fixtures/meridian'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_BROKEN, SHOT_LOADING, SHOT_NOT_KEPT, SHOT_RUN } from '../../fixtures/shots'
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
