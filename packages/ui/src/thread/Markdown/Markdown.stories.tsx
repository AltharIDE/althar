import type { Meta, StoryObj } from '@storybook/react-vite'

import { refDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from './Markdown'
import { States } from '../../storybook/States'

const meta = { title: 'Thread/Markdown', component: Markdown, decorators: [threadDecorator], args: { blocks: refDoc.body } } satisfies Meta<
  typeof Markdown
>
export default meta
type Story = StoryObj<typeof meta>

export const InTheThread: Story = {}
/** A size up, in the side panel. */
export const InThePanel: Story = { args: { size: 'panel' } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'thread', node: <Markdown {...args} /> },
        { state: 'panel', node: <Markdown {...args} size="panel" /> },
        {
          state: 'one paragraph',
          node: <Markdown blocks={['Refunds share the partner budget with charges; `429` carries `Retry-After`.']} />,
        },
      ]}
    />
  ),
}
