import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { SHOT_AFTER, SHOT_BEFORE, SHOT_NOT_KEPT } from '../../fixtures/shots'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Gallery, type GalleryShot } from './Gallery'

const shot = (id: string, caption: string, from = SHOT_AFTER, size?: { width: number; height: number }): GalleryShot => ({
  ...from,
  id,
  caption,
  name: `${id}.png`,
  ...size,
})

/* Named as leads name them: a letter for each direction, a number for each state, the first saying what the direction is. */
const NAMED: GalleryShot[] = [
  shot('a1', 'A1 · One quiet line: the reason lands under the refused refund'),
  shot('a2', 'A2 · With two refunds refused, each says its own reason', SHOT_BEFORE),
  shot('a3', 'A3 · Later: the refund window shown on the order'),
  shot('b1', 'B1 · Inline: the reason in the row, under the amount', SHOT_BEFORE),
  shot('b2', 'B2 · The same on a narrow window'),
  shot('z', 'Z · The comparison page: every direction in order (full page)', SHOT_BEFORE, { width: 1440, height: 4200 }),
]
const PLAIN: GalleryShot[] = [
  shot('before', 'Before: the refund button with no reason', SHOT_BEFORE),
  shot('after', 'After: the reason under the refused refund'),
  shot('narrow', 'After, on a narrow window'),
]
const RETAKEN: GalleryShot[] = [
  shot('a2-again', 'A2 · Again, from the comparison page', SHOT_BEFORE),
  shot('b2-again', 'B2 · Again, from the comparison page'),
]

const meta = {
  title: 'Thread/Gallery',
  component: Gallery,
  decorators: [threadDecorator],
  args: { shots: NAMED },
} satisfies Meta<typeof Gallery>
export default meta
type Story = StoryObj<typeof meta>

/** Named pictures in their groups, each group under what its first says it is; a full page shows its top. */
export const Grouped: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'A · One quiet line' })).toBeInTheDocument()
    await expect(c.getByText('A1 · the reason lands under the refused refund')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /View B2 · The same on a narrow window/ }))
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** Pictures with no names: two across, each with its whole caption. */
export const Plain: Story = { args: { shots: PLAIN } }

/** One alone: wider still. */
export const One: Story = { args: { shots: [PLAIN[1] as GalleryShot] } }

/** Views shown earlier and taken again aren't shown twice: a line counts them, and opens them on a click. */
export const Retaken: Story = {
  args: { shots: PLAIN.slice(0, 2), retaken: RETAKEN },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Also retook 2 shown earlier' })).toBeInTheDocument()
  },
}

/** Only retakes: the line alone. */
export const OnlyRetaken: Story = { args: { shots: [], retaken: RETAKEN } }

/** A picture Althar couldn't keep says so, and doesn't open. */
export const NotKept: Story = { args: { shots: [shot('gone', 'The whole page', SHOT_NOT_KEPT), PLAIN[1] as GalleryShot] } }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'grouped', node: <Gallery shots={NAMED.slice(0, 4)} /> },
        { state: 'plain', node: <Gallery shots={PLAIN} /> },
        { state: 'one', node: <Gallery shots={[PLAIN[1] as GalleryShot]} /> },
        { state: 'retaken', node: <Gallery shots={PLAIN.slice(0, 2)} retaken={RETAKEN} /> },
        { state: 'only retaken', node: <Gallery shots={[]} retaken={RETAKEN} /> },
        { state: 'not kept', node: <Gallery shots={[shot('gone', 'The whole page', SHOT_NOT_KEPT)]} /> },
        { state: 'dark', node: <Gallery shots={PLAIN} />, dark: true },
      ]}
    />
  ),
}
