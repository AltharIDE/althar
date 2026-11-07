import type { Meta, StoryObj } from '@storybook/react-vite'

import { ChromeButton } from '../../chrome/ChromeButton/ChromeButton'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadHead } from './ThreadHead'

const meta = {
  title: 'Thread/ThreadHead',
  component: ThreadHead,
  decorators: [threadDecorator],
  args: { title: 'Coordinator' },
} satisfies Meta<typeof ThreadHead>
export default meta
type Story = StoryObj<typeof meta>

/** The bar over the coordinator's conversation: whose it is, and Clear. */
export const WithClear: Story = {
  render: (args) => (
    <ThreadHead {...args}>
      <ChromeButton icon="remove" label="Clear" />
    </ThreadHead>
  ),
}

/** Nothing to clear: the button is off. */
export const NothingToClear: Story = {
  render: (args) => (
    <ThreadHead {...args}>
      <ChromeButton icon="remove" label="Clear" disabled />
    </ThreadHead>
  ),
}
