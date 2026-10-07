import type { Meta, StoryObj } from '@storybook/react-vite'

import { MenuItem } from '../../primitives/Menu/Menu'
import { ProjectHead } from './ProjectHead'

const menu = (
  <>
    <MenuItem icon="gear" onSelect={() => undefined}>
      Project rules
    </MenuItem>
    <MenuItem icon="plus" onSelect={() => undefined}>
      New task
    </MenuItem>
  </>
)

const meta = {
  title: 'Coordinator/ProjectHead',
  component: ProjectHead,
  parameters: { layout: 'fullscreen' },
  args: { title: 'Prepare 2.14 for release', meta: 'Project intent · set 3 days ago', menu },
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--n-2)', paddingBottom: 40 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectHead>

export default meta
type Story = StoryObj<typeof meta>

/** Over the conversation, with the project's intent. */
export const Intent: Story = {}

/** A project without an intent: its name, and where it is. */
export const Named: Story = { args: { title: 'meridian', meta: '~/Projects/meridian' } }

/** Beside the board, narrow, on the conversation's raised column. */
export const Side: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 380, background: 'var(--n-1)' }}>
        <Story />
      </div>
    ),
  ],
  args: { side: true },
}

/** With nothing to do from it: no menu. */
export const NoMenu: Story = { args: { menu: undefined } }
