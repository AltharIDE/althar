import type { Meta, StoryObj } from '@storybook/react-vite'

import { Skeleton } from './Skeleton'

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  args: { width: '60%' },
  decorators: [
    (Story) => (
      <div style={{ width: 420, padding: 24, background: 'var(--n-2)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

/** A line of text not read yet. */
export const Line: Story = {}

/** A block: a message, a field. */
export const Block: Story = { args: { shape: 'block', width: '70%' } }

/** Raised paper, where a card will be. */
export const Sheet: Story = { args: { shape: 'sheet', width: '100%' } }

/** A paragraph, its lines of uneven length. */
export const Paragraph: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 9 }}>
      <Skeleton width="94%" />
      <Skeleton width="88%" />
      <Skeleton width="61%" />
    </div>
  ),
}
