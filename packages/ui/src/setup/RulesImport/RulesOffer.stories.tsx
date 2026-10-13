import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RulesOffer } from './RulesImport'

const meta = {
  title: 'Setup/RulesOffer',
  component: RulesOffer,
  parameters: { layout: 'padded' },
  args: { count: 5, onReview: fn(), onDecline: fn() },
} satisfies Meta<typeof RulesOffer>
export default meta
type Story = StoryObj<typeof meta>

/** As a project opens: its agents' own settings name rules it could start from. */
export const Default: Story = {}

/** One rule. */
export const One: Story = { args: { count: 1 } }

/** Turning it down. */
export const Declining: Story = { args: { declining: true } }

export const Answering: Story = {
  play: async ({ args, canvasElement }) => {
    const card = within(canvasElement)
    await userEvent.click(card.getByRole('button', { name: 'Review' }))
    await expect(args.onReview).toHaveBeenCalledOnce()
    await userEvent.click(card.getByRole('button', { name: 'Take none' }))
    await expect(args.onDecline).toHaveBeenCalledOnce()
  },
}
