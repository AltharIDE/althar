import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PRS_418 } from '../../fixtures/outputs'
import { States, statesOn } from '../../storybook/States'
import { Delta, DiffStat, FileChanges } from './FileChanges'

const FILES = PRS_418[0]!.files

const meta = {
  title: 'Primitives/FileChanges',
  component: FileChanges,
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ maxWidth: 420, paddingLeft: 8 }}>{Story()}</div>)],
  args: { files: FILES, onOpen: fn() },
} satisfies Meta<typeof FileChanges>
export default meta
type Story = StoryObj<typeof meta>

/** Each file's size against the largest, split by addition and deletion. */
export const Default: Story = {}
/** Not links: nothing to open them into. */
export const Plain: Story = { args: { onOpen: undefined } }
/** On a larger scale, shared with another list, so the bars compare across both. */
export const OnAScale: Story = { args: { most: 200 } }

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open the diff of src/auth/session.ts' }))
    await expect(args.onOpen).toHaveBeenCalledWith('src/auth/session.ts')
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'links', node: <FileChanges {...args} /> },
        { state: 'plain', node: <FileChanges {...args} onOpen={undefined} /> },
        { state: 'on a scale', node: <FileChanges {...args} most={200} /> },
        { state: 'hover', node: <FileChanges {...args} /> },
        { state: 'focus', node: <FileChanges {...args} /> },
        {
          state: 'delta and diff stat',
          node: (
            <span style={{ display: 'inline-flex', gap: 16, alignItems: 'center' }}>
              <Delta add={14} del={3} />
              <Delta add={61} />
              <Delta del={48} />
              <DiffStat add={140} del={34} />
              <DiffStat add={0} del={0} />
            </span>
          ),
        },
      ]}
    />
  ),
}
