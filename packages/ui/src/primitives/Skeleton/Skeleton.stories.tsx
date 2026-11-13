import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

import { States } from '../../storybook/States'
import { Skeleton } from './Skeleton'

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  args: { width: '60%' },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

/** As wide as the place it holds. */
const fill = (node: ReactNode) => <div style={{ flex: 1 }}>{node}</div>

/**
 * A line of text not read yet; a block, for a message or a field; raised paper, where a card will be; and a
 * paragraph, its lines of uneven length.
 */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'line', node: fill(<Skeleton width="60%" />) },
        { state: 'block', node: fill(<Skeleton shape="block" width="70%" />) },
        { state: 'sheet', node: fill(<Skeleton shape="sheet" width="100%" />) },
        {
          state: 'paragraph',
          node: (
            <div style={{ flex: 1, display: 'grid', gap: 9 }}>
              <Skeleton width="94%" />
              <Skeleton width="88%" />
              <Skeleton width="61%" />
            </div>
          ),
        },
      ]}
    />
  ),
}
