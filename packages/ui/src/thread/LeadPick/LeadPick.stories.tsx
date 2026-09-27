import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LEAD_OPTIONS as OPTIONS, LEAD_REASONS as REASONS } from '../../fixtures/coordinator'
import { CODEX, OPUS } from '../../fixtures/models'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { LeadPick } from './LeadPick'

const meta = {
  title: 'Thread/LeadPick',
  component: LeadPick,
  decorators: [threadDecorator],
  args: { value: OPUS.id, options: OPTIONS, reasons: REASONS, onChange: fn() },
} satisfies Meta<typeof LeadPick>
export default meta
type Story = StoryObj<typeof meta>

function Picking() {
  const [lead, setLead] = useState(OPUS.id)
  return <LeadPick value={lead} onChange={setLead} options={OPTIONS} reasons={REASONS} />
}

/** The coordinator's pick, with its reasons. Take another from Change; the reasons give way to what you chose. */
export const Recommended: Story = {
  render: () => <Picking />,
}

/** Choosing another lead keeps the recommendation beside your choice. */
export const ChoosingAnother: Story = {
  render: () => <Picking />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Change' }))
    await userEvent.click(await page.findByRole('menuitemradio', { name: /Codex/ }))
    await waitFor(() => expect(c.getByText('your choice · the coordinator recommended Opus 5')).toBeInTheDocument())
  },
}

/** You chose another. */
export const YourChoice: Story = { args: { value: CODEX.id } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'recommended', node: <LeadPick {...args} /> },
        { state: 'your choice', node: <LeadPick {...args} value={CODEX.id} /> },
        { state: 'no reasons', node: <LeadPick {...args} reasons={[]} /> },
        { state: 'change, hover', force: 'hover', node: <LeadPick {...args} /> },
        { state: 'change, focus', force: 'focus', node: <LeadPick {...args} /> },
      ]}
    />
  ),
}
