import type { Meta, StoryObj } from '@storybook/react-vite'

import { refDoc, summaryDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Document } from './Document'
import { States, statesOn } from '../../storybook/States'

const meta = { title: 'Thread/Document', component: Document, decorators: [threadDecorator], args: summaryDoc } satisfies Meta<
  typeof Document
>
export default meta
type Story = StoryObj<typeof meta>

export const Long: Story = {}
/** Short enough to show whole. */
export const Short: Story = { args: { title: 'Next', body: refDoc.body.slice(0, 2) } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-of-type', focus: 'button:last-of-type', pressed: 'button:last-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'long, folded', node: <Document {...args} /> },
        { state: 'short', node: <Document {...args} title="Next" body={refDoc.body.slice(0, 2)} /> },
        { state: 'hover', node: <Document {...args} /> },
        { state: 'focus', node: <Document {...args} /> },
      ]}
    />
  ),
}
