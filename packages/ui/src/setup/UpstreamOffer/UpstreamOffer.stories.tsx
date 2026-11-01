import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { UpstreamOffer } from './UpstreamOffer'

const meta = {
  title: 'Setup/UpstreamOffer',
  component: UpstreamOffer,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
  args: { upstream: 'AltharIDE/althar', onAccept: fn(), onNotNow: fn() },
} satisfies Meta<typeof UpstreamOffer>
export default meta
type Story = StoryObj<typeof meta>

/** The host says they can push there now: asked once, and either answer is the last of it. */
export const Offered: Story = {
  play: async ({ args, canvasElement }) => {
    const offer = within(canvasElement)
    await expect(
      offer.getByText('You can push to AltharIDE/althar now. Push new tasks’ branches there instead of your fork?'),
    ).toBeVisible()
    await userEvent.click(offer.getByRole('button', { name: 'Not now' }))
    await expect(args.onNotNow).toHaveBeenCalledOnce()
    await userEvent.click(offer.getByRole('button', { name: 'Push there' }))
    await expect(args.onAccept).toHaveBeenCalledOnce()
  },
}

/** The host took the access away in the meantime: it says so where the answer was given. */
export const Refused: Story = {
  args: { error: 'You can’t push to the repository it was forked from yet. Its owners can give you access.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Its owners can give you access.')
  },
}
