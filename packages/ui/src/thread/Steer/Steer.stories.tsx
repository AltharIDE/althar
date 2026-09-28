import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { STEPS } from '../../fixtures/meridian'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadShellProvider, type ThreadShell } from '../Shell/Shell'
import { SteerLine, Steers, type SteerNote } from './Steer'

const meta = {
  title: 'Thread/Steer',
  component: SteerLine,
  decorators: [threadDecorator],
  args: { step: STEPS.security, said: 'Also check the webhook retry path; it calls the same limiter.', at: '2m ago' },
} satisfies Meta<typeof SteerLine>
export default meta
type Story = StoryObj<typeof meta>

const openStep = fn()
const shell: ThreadShell = { openStep }
const steers: SteerNote[] = [
  { id: '1', step: STEPS.security, text: 'And how refunds are logged when refused.', at: 'just now' },
  { id: '2', step: STEPS.review, text: 'Not this one.', at: '4m ago' },
]

/** The step's name opens its thread, through the host. */
export const Line: Story = {
  render: (args) => (
    <ThreadShellProvider value={shell}>
      <SteerLine {...args} />
    </ThreadShellProvider>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open the thread of Security review' }))
    await expect(openStep).toHaveBeenCalledWith(STEPS.security)
  },
}

/** What you said from the step's own thread, for this step only. */
export const FromTheStepsThread: Story = {
  render: () => (
    <ThreadShellProvider value={shell}>
      <Steers step="security" steers={steers} />
    </ThreadShellProvider>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'said', node: <SteerLine {...args} /> },
        {
          state: 'host opens no threads',
          node: (
            <ThreadShellProvider value={{}}>
              <SteerLine {...args} />
            </ThreadShellProvider>
          ),
        },
        { state: 'no time', node: <SteerLine {...args} at={undefined} /> },
        {
          state: 'long',
          node: (
            <SteerLine
              {...args}
              said={
                'Also check the webhook retry path; it calls the same limiter, and the backoff it uses was copied from charges before the limiter existed.'
              }
            />
          ),
        },
        { state: 'step, hover', force: 'hover', node: <SteerLine {...args} /> },
        { state: 'step, focus', force: 'focus', node: <SteerLine {...args} /> },
      ]}
    />
  ),
}
