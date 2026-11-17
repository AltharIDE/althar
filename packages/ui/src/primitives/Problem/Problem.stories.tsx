import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { Button } from '../Button/Button'
import { LinkButton } from '../LinkButton/LinkButton'
import { Problem } from './Problem'

const meta = {
  title: 'Primitives/Problem',
  component: Problem,
  args: { children: 'Claude Code is signed out.' },
} satisfies Meta<typeof Problem>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Claude Code is signed out.')
  },
}

/** What fixes it, beside the words. */
export const WithItsFix: Story = {
  args: {
    action: (
      <Button size="small" onClick={fn()}>
        Sign in again
      </Button>
    ),
  },
}

const LONG =
  'The folder /Users/sam/Projects/meridian-payments/services/refunds-worker isn’t a git repository any more; it was moved or deleted.'

/** Every way it stands: in a line, small in a row or card, wrapping, with its fix, and as a banner on its own. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'in a line', node: <Problem>The push was refused: main has moved on.</Problem> },
        { state: 'small', node: <Problem size="small">Couldn’t close the pull request.</Problem> },
        {
          state: 'with its fix',
          node: <Problem action={<LinkButton onClick={fn()}>Try again</LinkButton>}>Couldn’t read the plan usage.</Problem>,
        },
        { state: 'wrapping', node: <Problem>{LONG}</Problem> },
        {
          state: 'banner',
          node: (
            <Problem
              banner
              action={
                <Button size="small" onClick={fn()}>
                  Sign in again
                </Button>
              }
            >
              Claude Code is signed out.
            </Problem>
          ),
        },
        { state: 'banner, wrapping', node: <Problem banner>{LONG}</Problem> },
      ]}
    />
  ),
}
