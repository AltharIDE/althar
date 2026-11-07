import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { SignInEnds } from './SignInEnds'

const meta = {
  title: 'Chrome/SignInEnds',
  component: SignInEnds,
  args: { whose: 'Claude Code', when: 'Mon 14:00', onSignIn: fn(), onDismiss: fn() },
} satisfies Meta<typeof SignInEnds>
export default meta
type Story = StoryObj<typeof meta>

/** Within its last days: whose, and when. */
export const Ending: Story = {}

/** One of several accounts: named after the agent. */
export const OneOfSeveral: Story = { args: { whose: 'Claude Code (work)' } }

/** It has ended, and the person hasn't signed in again or put it aside. */
export const Ended: Story = { args: { when: undefined } }

export const SignsInAgain: Story = {
  play: async ({ args, canvasElement }) => {
    const line = within(canvasElement).getByRole('status')
    await expect(line).toHaveTextContent('Claude Code’s sign-in ends Mon 14:00')
    await userEvent.click(within(line).getByRole('button', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledOnce()
  },
}

export const PutAside: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Dismiss' }))
    await expect(args.onDismiss).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <SignInEnds {...args} /> })),
        { state: 'one of several', node: <SignInEnds {...args} whose="Claude Code (work)" /> },
        { state: 'ended', node: <SignInEnds {...args} when={undefined} /> },
      ]}
    />
  ),
}
