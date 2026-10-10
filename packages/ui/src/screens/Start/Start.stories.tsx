import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { FIRST_RUN, NONE_READY } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { Start } from './Start'

const meta = {
  title: 'Screens/Start',
  component: Start,
  parameters: { layout: 'padded' },
  args: {
    runtimes: FIRST_RUN,
    step: 'agents',
    canContinue: true,
    onContinue: fn(),
    onSkip: fn(),
    onBack: fn(),
    onSignIn: fn(),
    onCancel: fn(),
    onCheck: fn(),
    onHelp: fn(),
    onCreate: fn(),
  },
} satisfies Meta<typeof Start>
export default meta
type Story = StoryObj<typeof meta>

/** The first run: the agents Althar found, what a project is, and making one. */
export const FirstRun: Story = {}

/** No agent ready: sign in or explicitly set it up later. */
export const NoneReady: Story = { args: { runtimes: NONE_READY, canContinue: false } }

export const Beginning: Story = {
  args: { step: 'project' },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Open a folder/ }))
    await expect(args.onCreate).toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'first run', node: <Start {...args} /> },
        { state: 'none ready', node: <Start {...args} runtimes={NONE_READY} canContinue={false} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 380 }}>
              <Start {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
