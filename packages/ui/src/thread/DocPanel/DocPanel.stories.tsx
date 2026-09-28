import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { refDoc, reviewDoc } from '../../fixtures/meridian'
import { DocPanel } from './DocPanel'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/DocPanel',
  component: DocPanel,
  parameters: { layout: 'fullscreen' },
  args: { doc: { path: 'docs/api/refunds-rate-limits.md', body: refDoc.body }, onClose: fn(), onOpen: fn() },
} satisfies Meta<typeof DocPanel>
export default meta
type Story = StoryObj<typeof meta>

/* Where the panel lives: a column beside the thread. */
const beside: Decorator = (Story) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 520px', height: '100vh' }}>
    <div />
    <Story />
  </div>
)

export const AFile: Story = { decorators: [beside] }
/** Written in the thread, not a file: its title stands in. */
export const ADocument: Story = { args: { doc: reviewDoc }, decorators: [beside] }

/* The panel is a column beside the thread; its states side by side, the header actions forced. */
export const AllStates: Story = {
  parameters: {
    ...statesOn({ hover: 'button:first-of-type', focus: 'button:last-child', pressed: 'button:first-of-type' }),
    layout: 'padded',
  },
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'a file',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} />
            </div>
          ),
        },
        {
          state: 'a document',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} doc={reviewDoc} />
            </div>
          ),
        },
        {
          state: 'no editor',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} onOpen={undefined} />
            </div>
          ),
        },
        {
          state: 'hover',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
