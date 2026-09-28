import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { WorkStatus } from './WorkStatus'

const meta = {
  title: 'Chrome/WorkStatus',
  component: WorkStatus,
  args: { running: 5, yours: 4, onYours: fn() },
} satisfies Meta<typeof WorkStatus>
export default meta
type Story = StoryObj<typeof meta>

export const RunningAndYours: Story = {}
export const OneNeedsYou: Story = { args: { yours: 1 } }
/** Nothing waits on you: it says so, and isn't a button. */
export const NothingNeedsYou: Story = { args: { yours: 0 } }
export const NothingRunning: Story = { args: { running: 0, yours: 0 } }

export const OpeningTheFirst: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '4 need you' }))
    await expect(args.onYours).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'running and yours', node: <WorkStatus {...args} /> },
        { state: 'one needs you', node: <WorkStatus {...args} yours={1} /> },
        { state: 'nothing needs you', node: <WorkStatus {...args} yours={0} /> },
        { state: 'nothing running', node: <WorkStatus {...args} running={0} yours={0} /> },
        { state: 'hover', node: <WorkStatus {...args} /> },
        { state: 'focus', node: <WorkStatus {...args} /> },
        { state: 'pressed', node: <WorkStatus {...args} /> },
      ]}
    />
  ),
}
