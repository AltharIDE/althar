import type { Meta, StoryObj } from '@storybook/react-vite'

import { ThreadMeasure } from '../Thread/Thread'
import { ThreadSkeleton } from './ThreadSkeleton'

const meta = {
  title: 'Thread/ThreadSkeleton',
  component: ThreadSkeleton,
  args: { label: 'Reading the conversation' },
  decorators: [
    (Story) => (
      <div style={{ padding: '32px 0', background: 'var(--n-2)' }}>
        <ThreadMeasure>
          <Story />
        </ThreadMeasure>
      </div>
    ),
  ],
} satisfies Meta<typeof ThreadSkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** A thread taking longer than a glance to read. */
export const Reading: Story = {}
