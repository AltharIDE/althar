import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../Button/Button'
import { LinkButton } from '../LinkButton/LinkButton'
import { Popover } from './Popover'
import { States, statesParameters } from '../../storybook/States'

const body = (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--t-2)' }}>
    <span>
      Listening to <b style={{ color: 'var(--t-1)', fontWeight: 550 }}>PR 1206</b> for review comments and checks.
    </span>
    <LinkButton>Stop listening</LinkButton>
  </div>
)

const meta = {
  title: 'Primitives/Popover',
  component: Popover,
  args: {
    label: 'What the lead is listening to',
    width: 260,
    trigger: <Button>Listening</Button>,
    children: body,
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 180, paddingTop: 110 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const button = c.getByRole('button', { name: 'Listening' })
    await userEvent.click(button)
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'What the lead is listening to' })
    /* it eases in: wait for the transition to finish */
    await waitFor(() => expect(dialog).toBeVisible())
    await expect(page.getByRole('button', { name: 'Stop listening' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(page.queryByRole('dialog')).toBeNull()
    await expect(button).toHaveFocus()
  },
}
export const OpenBelow: Story = {
  args: { defaultOpen: true },
  decorators: [
    (Story) => (
      <div style={{ marginTop: -110 }}>
        <Story />
      </div>
    ),
  ],
}
export const OpenAbove: Story = { args: { defaultOpen: true, placement: 'above' } }
/** Near the edge it flips and shifts to stay on screen. */
export const AtTheEdge: Story = {
  args: { defaultOpen: true, placement: 'above', width: 320 },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -110 }}>
        <Story />
      </div>
    ),
  ],
}
export const AlignedToEnd: Story = {
  args: { defaultOpen: true, placement: 'above', align: 'end' },
  decorators: [
    (Story) => (
      <div style={{ paddingLeft: 200 }}>
        <Story />
      </div>
    ),
  ],
}

export const AllStates: Story = {
  parameters: statesParameters,
  decorators: [
    (Story) => (
      <div style={{ marginTop: -110 }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <States
      cells={[
        ...(['rest', 'hover', 'focus', 'pressed'] as const).map((state) => ({ state, node: <Popover {...args} /> })),
        { state: 'open', node: <Popover {...args} placement="below" defaultOpen /> },
      ]}
    />
  ),
}
