import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { refDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { FileArtifact } from './FileArtifact'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/FileArtifact',
  component: FileArtifact,
  decorators: [threadDecorator],
  args: { path: 'docs/api/refunds-rate-limits.md', kind: 'Markdown', size: '2.1 KB', lines: 64, body: refDoc.body, onOpen: fn() },
} satisfies Meta<typeof FileArtifact>
export default meta
type Story = StoryObj<typeof meta>

/** Its preview opens the file in the side panel. */
export const Written: Story = {}

export const AllStates: Story = {
  parameters: statesOn({ hover: '[aria-label^="Read"]', focus: '[aria-label^="Read"]', pressed: '[aria-label^="Read"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'written', node: <FileArtifact {...args} /> },
        { state: 'no editor', node: <FileArtifact {...args} onOpen={undefined} /> },
        { state: 'hover', node: <FileArtifact {...args} /> },
        { state: 'focus', node: <FileArtifact {...args} /> },
        { state: 'pressed', node: <FileArtifact {...args} /> },
      ]}
    />
  ),
}
