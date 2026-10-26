import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Offline } from './Offline'

const meta = {
  title: 'Chrome/Offline',
  component: Offline,
} satisfies Meta<typeof Offline>
export default meta
type Story = StoryObj<typeof meta>

/** The computer is offline: one word for the whole app, read out as it appears. */
export const Shown: Story = {
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByRole('status')
    await expect(line).toHaveTextContent('Offline')
  },
}
