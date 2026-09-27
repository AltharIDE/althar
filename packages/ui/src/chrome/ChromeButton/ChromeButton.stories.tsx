import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { ChromeButton } from './ChromeButton'

const meta = {
  title: 'Chrome/ChromeButton',
  component: ChromeButton,
  args: { icon: 'knowledge', label: 'Knowledge', pressed: false, onClick: fn() },
} satisfies Meta<typeof ChromeButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** What it opened is open. */
export const Pressed: Story = { args: { pressed: true } }
/** Only the glyph, in a narrow window; still named. */
export const Compact: Story = { args: { compact: true } }
/** With its key, as a task's Graph and Code show it. */
export const WithKey: Story = { args: { icon: 'branch', label: 'Graph', kbd: 'g' } }

export const Pressing: Story = {
  args: { compact: true },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Knowledge' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <ChromeButton {...args} /> })),
        { state: 'on', node: <ChromeButton {...args} pressed /> },
        { state: 'compact', node: <ChromeButton {...args} compact /> },
        { state: 'compact, on', node: <ChromeButton {...args} compact pressed /> },
        { state: 'with key', node: <ChromeButton {...args} icon="branch" label="Graph" kbd="g" /> },
      ]}
    />
  ),
}
