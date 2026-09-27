import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ThreadFrame, threadDecorator } from '../../storybook/ThreadFrame'
import { Snippet } from './Snippet'
import { States, statesOn } from '../../storybook/States'

const LONG = "curl -i -X POST localhost:4000/v1/refunds -H 'Partner: acme' -H 'Idempotency-Key: 7f3c9e' -d @fixtures/refund.json"

const meta = { title: 'Thread/Snippet', component: Snippet, decorators: [threadDecorator], args: { cmd: 'pnpm dev' } } satisfies Meta<
  typeof Snippet
>
export default meta
type Story = StoryObj<typeof meta>

export const Short: Story = {}
/** Too long for the line: it can be shown whole before you copy it. */
export const Long: Story = {
  args: { cmd: LONG },
}

/** Show all opens the whole command. */
export const ShowingAll: Story = {
  args: { cmd: LONG },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const more = c.getByRole('button', { name: 'Show all' })
    await userEvent.click(more)
    await expect(c.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
  },
}
export const Dark: Story = {
  args: { cmd: LONG },
  decorators: [
    (Story) => (
      <ThreadFrame term="dark">
        <Story />
      </ThreadFrame>
    ),
  ],
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-child', focus: 'button:last-child', pressed: 'button:last-child' }),
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'short', node: <Snippet cmd="pnpm dev" /> },
        { state: 'long, cut', node: <Snippet cmd={LONG} /> },
        {
          state: 'on ink',
          dark: true,
          node: (
            <div data-term="dark">
              <Snippet cmd="pnpm dev" />
            </div>
          ),
        },
        { state: 'hover', node: <Snippet cmd="pnpm dev" /> },
        { state: 'focus', node: <Snippet cmd="pnpm dev" /> },
        { state: 'pressed', node: <Snippet cmd="pnpm dev" /> },
      ]}
    />
  ),
}
