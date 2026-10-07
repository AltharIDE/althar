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

/** Beside the board, narrow. */
export const Side: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 380 }}>
        <Story />
      </div>
    ),
  ],
  args: { side: true },
}

/** With nothing to do from it: no menu. */
export const NoMenu: Story = { args: { menu: undefined } }

/** A notice under it, as when the project's code host isn't connected. */
export const WithNotice: Story = {
  args: { children: <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--t-2)' }}>GitHub isn’t connected.</p> },
}
