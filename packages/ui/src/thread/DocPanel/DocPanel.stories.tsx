import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

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

/** Still being read. */
export const Loading: Story = { args: { loading: true, doc: { path: 'docs/api/refunds-rate-limits.md', body: '' } }, decorators: [beside] }
/** It couldn't be read: the file went, or is too large to show here. */
export const ReadFailed: Story = {
  args: { error: 'This file isn’t in the task’s worktree any more.', doc: { path: 'docs/api/refunds-rate-limits.md', body: '' } },
  decorators: [beside],
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/isn’t in the task’s worktree/)).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument()
  },
}
/** Nothing in it. */
export const Empty: Story = { args: { doc: { path: 'docs/notes.md', body: '  ' } }, decorators: [beside] }
/** Long: the body scrolls under its head. */
export const Long: Story = {
  args: { doc: { path: 'docs/api/refunds-rate-limits.md', body: Array.from({ length: 8 }, () => refDoc.body).join('\n\n') } },
  decorators: [beside],
}

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
          state: 'loading',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} loading doc={{ path: 'docs/api/refunds-rate-limits.md', body: '' }} />
            </div>
          ),
        },
        {
          state: 'read failed',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} error="This file isn’t in the task’s worktree any more." />
            </div>
          ),
        },
        {
          state: 'empty',
          node: (
            <div style={{ height: 360, display: 'grid' }}>
              <DocPanel {...args} doc={{ path: 'docs/notes.md', body: '' }} />
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
