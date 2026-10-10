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
/** Just started: nothing printed yet, the cursor waits. */
export const Starting: Story = { args: { lines: [], exit: undefined, live: '' } }
/** Ended having printed nothing. */
export const Empty: Story = {
  args: { command: 'git add -A', lines: [], exit: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No output')).toBeInTheDocument()
  },
}
/** What it printed is still being read. */
export const Loading: Story = { args: { command: undefined, lines: [], exit: undefined, loading: true } }
/** What it printed couldn't be read. */
export const ReadFailed: Story = {
  args: { command: undefined, lines: [], exit: 0, error: 'Althar didn’t keep what this printed.' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/didn’t keep/)).toBeInTheDocument()
    await expect(c.queryByText('No output')).not.toBeInTheDocument()
  },
}
/** A long run: its end shows, with hundreds of earlier lines one click away. */
export const Long: Story = {
  args: {
    lines: TEST_OUTPUT,
    earlier: Array.from({ length: 480 }, (_, i) => ` ✓ refunds/case ${i + 1} (${(i % 7) + 2} ms)`),
    exit: 0,
  },
}
/** Longer than Althar keeps: its start wasn't kept, and says how much. */
export const StartNotKept: Story = {
  args: { lines: TEST_OUTPUT, earlier: TEST_EARLIER, omitted: 1204, exit: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('1,204 earlier lines weren’t kept')).toBeInTheDocument()
  },
}
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
        { state: 'starting', node: <Terminal command="pnpm test" lines={[]} live="" /> },
        { state: 'empty', node: <Terminal command="git add -A" lines={[]} exit={0} /> },
        { state: 'loading', node: <Terminal lines={[]} loading /> },
        { state: 'read failed', node: <Terminal lines={[]} exit={0} error="Althar didn’t keep what this printed." /> },
        { state: 'start not kept', node: <Terminal lines={TEST_OUTPUT} earlier={TEST_EARLIER} omitted={1204} exit={0} /> },
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
