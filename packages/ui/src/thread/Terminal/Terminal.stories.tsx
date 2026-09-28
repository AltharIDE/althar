import type { Meta, StoryObj } from '@storybook/react-vite'

import { expect, userEvent, within } from 'storybook/test'

import { LINT_OUTPUT, TEST_EARLIER, TEST_OUTPUT } from '../../fixtures/meridian'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { Terminal } from './Terminal'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Terminal',
  component: Terminal,
  args: { command: 'pnpm test refunds', lines: TEST_OUTPUT, exit: 0 },
  decorators: [
    (Story, { parameters }) => (
      <ThreadFrame term={parameters.term === 'dark' ? 'dark' : 'paper'}>
        <Story />
      </ThreadFrame>
    ),
  ],
} satisfies Meta<typeof Terminal>
export default meta
type Story = StoryObj<typeof meta>

export const Passed: Story = {}
/** A long run shows its end; what came before is one click away. */
export const WithEarlierLines: Story = {
  args: { earlier: TEST_EARLIER },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: '6 earlier lines' }))
    await expect(c.getByText(/keeps the idempotency key/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Hide earlier lines' }))
    await expect(c.queryByText(/keeps the idempotency key/)).not.toBeInTheDocument()
  },
}
export const Failed: Story = { args: { command: 'pnpm lint', lines: LINT_OUTPUT, exit: 1 } }
export const Live: Story = { args: { lines: [' ✓ charges/limit (14)'], exit: undefined, live: ' ⋯ webhooks/deliver (running 22 of 41)' } }
/** In a Tool's sheet, whose row already shows the command. */
export const WithoutTheCommand: Story = { args: { command: undefined } }
export const Dark: Story = {
  args: { command: 'pnpm lint', lines: LINT_OUTPUT, exit: 1, earlier: TEST_EARLIER },
  parameters: { term: 'dark' },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'passed', node: <Terminal command="pnpm test refunds" lines={TEST_OUTPUT} exit={0} /> },
        { state: 'failed', node: <Terminal command="pnpm lint" lines={LINT_OUTPUT} exit={1} /> },
        { state: 'earlier lines', node: <Terminal command="pnpm test refunds" lines={TEST_OUTPUT} earlier={TEST_EARLIER} exit={0} /> },
        {
          state: 'live',
          node: <Terminal command="pnpm test" lines={[' ✓ charges/limit (14)']} live=" ⋯ webhooks/deliver (running 22 of 41)" />,
        },
        { state: 'no exit yet', node: <Terminal command="pnpm test refunds" lines={TEST_OUTPUT.slice(0, 3)} /> },
        { state: 'without the command', node: <Terminal lines={TEST_OUTPUT} exit={0} /> },
        {
          state: 'earlier, hover',
          force: 'hover',
          node: <Terminal command="pnpm test refunds" lines={TEST_OUTPUT} earlier={TEST_EARLIER} exit={0} />,
        },
        {
          state: 'earlier, focus',
          force: 'focus',
          node: <Terminal command="pnpm test refunds" lines={TEST_OUTPUT} earlier={TEST_EARLIER} exit={0} />,
        },
        {
          state: 'dark',
          node: (
            <div data-term="dark">
              <Terminal command="pnpm lint" lines={LINT_OUTPUT} earlier={TEST_EARLIER} exit={1} />
            </div>
          ),
        },
      ]}
    />
  ),
}
