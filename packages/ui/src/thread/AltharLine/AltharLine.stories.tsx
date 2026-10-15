import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { AltharLine } from './AltharLine'

const meta = {
  title: 'Thread/AltharLine',
  component: AltharLine,
  decorators: [threadDecorator],
  args: { children: 'PR #157 conflicts with main, in 4 files. Althar asked the lead to resolve it, as the project’s rules say.' },
} satisfies Meta<typeof AltharLine>
export default meta
type Story = StoryObj<typeof meta>

/** Althar saying what the person should know, by name. */
export const Said: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Althar')).toBeInTheDocument()
  },
}

/** Something that is now the person's. */
export const Warning: Story = {
  args: {
    tone: 'warning',
    children:
      'The lead couldn’t resolve the conflict with main, in 4 files. The merge isn’t committed: it’s yours to settle, or to ask the lead again.',
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'said', node: <AltharLine {...args} /> },
        {
          state: 'with a link',
          node: (
            <AltharLine>
              Opened <a href="https://github.com/acme/refunds/pull/142">PR #142</a>: Say why a refund is refused
            </AltharLine>
          ),
        },
        { state: 'warning', node: <AltharLine tone="warning">The lead couldn’t resolve the conflict with main, in 4 files.</AltharLine> },
        { state: 'dark', node: <AltharLine {...args} />, dark: true },
      ]}
    />
  ),
}
