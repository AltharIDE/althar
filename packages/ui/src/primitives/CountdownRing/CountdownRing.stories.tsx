import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { States } from '../../storybook/States'
import { CountdownRing } from './CountdownRing'

const meta = {
  title: 'Primitives/CountdownRing',
  component: CountdownRing,
  args: { left: 0.6 },
} satisfies Meta<typeof CountdownRing>
export default meta
type Story = StoryObj<typeof meta>

/** Part of the wait gone: the ring empties from the top, and is hidden from a screen reader, as the words beside it say the time. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const ring = canvasElement.querySelector('svg')
    await expect(ring).toHaveAttribute('aria-hidden', 'true')
  },
}

/** Out of range, it holds at full or empty. */
export const Clamped: Story = {
  args: { left: 3 },
  play: async ({ canvasElement }) => {
    const left = canvasElement.querySelectorAll('circle')[1]
    await expect(left?.style.strokeDashoffset).toBe('0')
  },
}

/** Full, most of it, a little, and none left. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'full', node: <CountdownRing left={1} /> },
        { state: 'most', node: <CountdownRing left={0.75} /> },
        { state: 'a little', node: <CountdownRing left={0.15} /> },
        { state: 'none left', node: <CountdownRing left={0} /> },
      ]}
    />
  ),
}
