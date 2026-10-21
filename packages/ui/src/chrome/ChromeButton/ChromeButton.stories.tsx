import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { ChromeButton } from './ChromeButton'

const meta = {
  title: 'Chrome/ChromeButton',
  component: ChromeButton,
  args: { icon: 'knowledge', label: 'Knowledge', expanded: false, onClick: fn() },
} satisfies Meta<typeof ChromeButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** What it opened is open. */
export const Open: Story = { args: { expanded: true } }
/** Only the glyph, in a narrow window; still named. */
export const Compact: Story = { args: { compact: true } }
/** With its key, said in its tooltip, as a task's "3 files" has ⌘D. */
export const WithKey: Story = {
  args: { icon: 'branch', label: 'Graph', kbd: 'g' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Graph' })
    await expect(within(button).queryByText('g')).toBeNull()
    await userEvent.hover(button)
    await expect(await within(document.body).findByText('g')).toBeInTheDocument()
  },
}
/** Something worth knowing before it opens: a dot on it, said in its tooltip and as its description, as a task's menu does where the task resolves conflicts otherwise than its project. */
export const Marked: Story = {
  args: { icon: 'more', label: 'More for this task', compact: true, mark: 'Resolve conflicts automatically: on' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'More for this task' })
    await expect(button).toHaveAccessibleDescription('Resolve conflicts automatically: on')
  },
}

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
        { state: 'on', node: <ChromeButton {...args} expanded /> },
        { state: 'compact', node: <ChromeButton {...args} compact /> },
        { state: 'compact, on', node: <ChromeButton {...args} compact expanded /> },
        { state: 'with key', node: <ChromeButton {...args} icon="branch" label="Graph" kbd="g" /> },
        { state: 'marked', node: <ChromeButton {...args} icon="more" label="More" compact mark="Resolve conflicts automatically: on" /> },
      ]}
    />
  ),
}
