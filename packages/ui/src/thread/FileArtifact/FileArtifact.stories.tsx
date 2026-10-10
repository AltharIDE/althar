import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { refDoc } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { ThreadShellProvider } from '../Shell/Shell'
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
export const Written: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Read in the panel' }))
    await expect(c.getByRole('complementary', { name: 'refunds-rate-limits.md' })).toBeInTheDocument()
  },
}

/** Its contents are still being read. */
export const Loading: Story = { args: { body: undefined, lines: undefined, size: undefined, loading: true } }

/** Its contents couldn't be read: the file went, or is too large to show. */
export const ReadFailed: Story = {
  args: { body: undefined, lines: undefined, error: 'This file isn’t in the task’s worktree any more.' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/isn’t in the task’s worktree/)).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Read in the panel' })).not.toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument()
  },
}

/** A file with nothing in it. */
export const Empty: Story = { args: { body: '', lines: 0, size: '0 B' } }

/** Not a document: what it is and where, and a way into the editor; no preview. */
export const NotADocument: Story = {
  args: { path: 'exports/refunds-2026-10.csv', kind: 'CSV', size: '48 KB', lines: 1204, body: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('refunds-2026-10.csv')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Read in the panel' })).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Open in editor' })).toBeInTheDocument()
  },
}

/** Only what the agent knows of it: its name and kind. */
export const NameAlone: Story = {
  args: { path: 'notes.pdf', kind: 'PDF', size: undefined, lines: undefined, body: undefined, onOpen: undefined },
}

/** A long document: the preview shows its start and fades. */
export const Long: Story = { args: { body: Array.from({ length: 12 }, () => refDoc.body).join('\n\n'), lines: 768, size: '25 KB' } }

export const AllStates: Story = {
  parameters: statesOn({ hover: '[class*="preview"]', focus: '[class*="more"]', pressed: '[class*="more"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'written', node: <FileArtifact {...args} /> },
        { state: 'no editor', node: <FileArtifact {...args} onOpen={undefined} /> },
        {
          state: 'no side panel in the shell',
          node: (
            <ThreadShellProvider value={{}}>
              <FileArtifact {...args} />
            </ThreadShellProvider>
          ),
        },
        { state: 'loading', node: <FileArtifact {...args} body={undefined} loading /> },
        {
          state: 'read failed',
          node: <FileArtifact {...args} body={undefined} error="This file isn’t in the task’s worktree any more." />,
        },
        { state: 'empty', node: <FileArtifact {...args} body="" lines={0} size="0 B" /> },
        {
          state: 'not a document',
          node: <FileArtifact {...args} path="exports/refunds-2026-10.csv" kind="CSV" size="48 KB" lines={1204} body={undefined} />,
        },
        { state: 'hover', node: <FileArtifact {...args} /> },
        { state: 'focus', node: <FileArtifact {...args} /> },
        { state: 'pressed', node: <FileArtifact {...args} /> },
      ]}
    />
  ),
}
