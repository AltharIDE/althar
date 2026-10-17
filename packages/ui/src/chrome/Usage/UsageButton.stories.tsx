import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { UsageButton } from './UsageButton'

const meta = {
  title: 'Chrome/UsageButton',
  component: UsageButton,
  args: { onClick: fn() },
} satisfies Meta<typeof UsageButton>
export default meta
type Story = StoryObj<typeof meta>

export const Quiet: Story = {
  args: { kbd: '⌘U' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Usage' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

/** Warnings not yet seen: a count, and a name that says how many. */
export const Waiting: Story = {
  args: { waiting: 3 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Usage, 3 warnings not seen' })).toBeVisible()
  },
}

export const OneWaiting: Story = { args: { waiting: 1 } }

/** The view it opens is open. */
export const Open: Story = { args: { expanded: true, waiting: 2 } }
