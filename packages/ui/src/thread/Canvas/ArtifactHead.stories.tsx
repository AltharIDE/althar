import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ArtifactHead } from './ArtifactHead'

/* An artifact's own chat's top row: the way back, the artifact by its name (which opens every artifact), and who made it. */

const meta = {
  title: 'Thread/Canvas/Artifact head',
  component: ArtifactHead,
  args: {
    current: 'cnv_g',
    title: 'Gift a class',
    by: 'Lead of Gift a class',
    artifacts: [
      { id: 'task_mood', title: 'Mood board for the spring classes', drawing: true },
      { id: 'cnv_g', title: 'Gift a class' },
      { id: 'cnv_f', title: 'Booking flow' },
      { id: 'cnv_s', title: 'Sign-in, three directions' },
    ],
    onPick: fn(),
    onBack: fn(),
    kbd: 'esc',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 400, background: 'var(--paper)', border: '1px solid var(--line)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ArtifactHead>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Its name opens the project's artifacts: picking one goes to it. */
export const Others: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Gift a class/ }))
    const menu = within(document.body)
    await expect(await menu.findByRole('menuitemradio', { name: 'Gift a class' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Booking flow' }))
    await expect(args.onPick).toHaveBeenCalledWith('cnv_f')
  },
}

/** A long name in a narrow column gives way; the way back stays. */
export const Narrow: Story = {
  args: { title: 'Sign-in, three directions for the returning member', by: 'Coordinator' },
  decorators: [
    (Story) => (
      <div style={{ width: 300 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Back to Artifacts' }))
    await expect(args.onBack).toHaveBeenCalled()
  },
}
