import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { UpdateReady } from './UpdateReady'

const meta = {
  title: 'Chrome/UpdateReady',
  component: UpdateReady,
  args: { version: '0.1.1', onRestart: fn() },
} satisfies Meta<typeof UpdateReady>
export default meta
type Story = StoryObj<typeof meta>

/** Downloaded and in place, with nothing running: Restart installs it. */
export const Ready: Story = {}

/** Work runs, so there is no Restart: it installs as Althar quits. */
export const WhileWorkRuns: Story = { args: { onRestart: undefined } }

export const Restarting: Story = { args: { restarting: true } }

/** The restart didn't happen: why, with Restart to try again. */
export const RestartFailed: Story = { args: { error: 'the update isn’t signed as this Althar is' } }

export const RestartingOnClick: Story = {
  play: async ({ args, canvasElement }) => {
    const line = within(canvasElement).getByRole('status')
    await expect(line).toHaveTextContent('Althar 0.1.1 is ready')
    await userEvent.click(within(line).getByRole('button', { name: 'Restart' }))
    await expect(args.onRestart).toHaveBeenCalledOnce()
  },
}

export const NoRestartWhileWorkRuns: Story = {
  args: { onRestart: undefined },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByRole('status')
    await expect(line).toHaveTextContent('Installs when you quit')
    await expect(within(line).queryByRole('button')).toBeNull()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <UpdateReady {...args} /> })),
        { state: 'while work runs', node: <UpdateReady {...args} onRestart={undefined} /> },
        { state: 'restarting', node: <UpdateReady {...args} restarting /> },
        { state: 'restart failed', node: <UpdateReady {...args} error="the update isn’t signed as this Althar is" /> },
      ]}
    />
  ),
}
