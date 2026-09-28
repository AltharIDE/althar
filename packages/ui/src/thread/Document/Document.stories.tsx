import type { Meta, StoryObj } from '@storybook/react-vite'

import { summaryDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadShellProvider } from '../Shell/Shell'
import { Document } from './Document'
import { States, statesOn } from '../../storybook/States'

const meta = { title: 'Thread/Document', component: Document, decorators: [threadDecorator], args: summaryDoc } satisfies Meta<
  typeof Document
>
export default meta

const SHORT = '# Rate limits on refunds\n\nRefunds draw on the same per-partner budget as charges.'
type Story = StoryObj<typeof meta>

export const Long: Story = {}
/** Short enough to show whole. */
export const Short: Story = { args: { title: 'Next', body: SHORT } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-of-type', focus: 'button:last-of-type', pressed: 'button:last-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'long, folded', node: <Document {...args} /> },
        { state: 'short', node: <Document {...args} title="Next" body={SHORT} /> },
        {
          state: 'no side panel in the shell',
          node: (
            <ThreadShellProvider value={{}}>
              <Document {...args} />
            </ThreadShellProvider>
          ),
        },
        { state: 'hover', node: <Document {...args} /> },
        { state: 'focus', node: <Document {...args} /> },
      ]}
    />
  ),
}
