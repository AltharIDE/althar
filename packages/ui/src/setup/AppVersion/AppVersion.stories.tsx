import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { AppVersion } from './AppVersion'

const meta = {
  title: 'Setup/AppVersion',
  component: AppVersion,
  args: { version: '0.1.0', notes: 'https://github.com/AltharIDE/althar/releases/tag/v0.1.0' },
} satisfies Meta<typeof AppVersion>
export default meta
type Story = StoryObj<typeof meta>

/** The version, and its release notes a click away, in the browser. */
export const WithNotes: Story = {
  play: async ({ canvasElement }) => {
    const notes = within(canvasElement).getByRole('link', { name: 'What’s new' })
    await expect(notes).toHaveAttribute('href', 'https://github.com/AltharIDE/althar/releases/tag/v0.1.0')
    await expect(notes).toHaveAttribute('target', '_blank')
  },
}

/** Without notes, the version alone, and no link to nowhere. */
export const VersionAlone: Story = {
  args: { notes: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Althar 0.1.0')).toBeInTheDocument()
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'a', focus: 'a', pressed: 'a' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <AppVersion {...args} /> })),
        { state: 'no notes', node: <AppVersion {...args} notes={undefined} /> },
      ]}
    />
  ),
}
