import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CoordinatorOff } from './CoordinatorOff'

const meta = {
  title: 'Coordinator/CoordinatorOff',
  component: CoordinatorOff,
  decorators: [(Story) => <div style={{ width: 560, minHeight: 320 }}>{Story()}</div>],
  args: { project: 'althar', onTurnOn: fn() },
} satisfies Meta<typeof CoordinatorOff>
export default meta
type Story = StoryObj<typeof meta>

/** A conversation that hasn't begun: what writing here does now, and the way back. */
export const Empty: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Turn it on' }))
    await expect(args.onTurnOn).toHaveBeenCalled()
  },
}

/** Under what the coordinator said before it was turned off. */
export const After: Story = { args: { after: true } }
