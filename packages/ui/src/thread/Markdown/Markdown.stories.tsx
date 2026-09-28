import type { Meta, StoryObj } from '@storybook/react-vite'

import { refDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from './Markdown'
import { States } from '../../storybook/States'

const meta = { title: 'Thread/Markdown', component: Markdown, decorators: [threadDecorator], args: { source: refDoc.body } } satisfies Meta<
  typeof Markdown
>
export default meta

const RICH = `- [x] Wrap the refund route
- [ ] Update the API reference

| Route | Limit |
| :-- | --: |
| charges | 600/min |
| refunds | shared |

See [the spec](https://docs.example.com/rate-limits) and ~~the old note~~.`

const UNSAFE = `A [link that runs script](javascript:alert(1)) stays text. <b onclick="x">So does this</b>.`
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
        { state: 'a preview: the first three blocks', node: <Markdown {...args} to={3} /> },
        { state: 'task list, table, link', node: <Markdown source={RICH} /> },
        { state: 'unsafe link and raw HTML, shown as text', node: <Markdown source={UNSAFE} /> },
        {
          state: 'one paragraph',
          node: <Markdown source="Refunds share the partner budget with charges; `429` carries `Retry-After`." />,
        },
      ]}
    />
  ),
}
