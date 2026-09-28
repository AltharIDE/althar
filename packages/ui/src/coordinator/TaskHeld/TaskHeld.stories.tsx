import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Composer } from '../../composer/Composer/Composer'
import { LEAD_OPTIONS, LEAD_REASONS } from '../../fixtures/coordinator'
import { OPUS } from '../../fixtures/models'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { LeadPick } from '../../thread/LeadPick/LeadPick'
import { TaskHeld } from './TaskHeld'

const meta = {
  title: 'Coordinator/TaskHeld',
  component: TaskHeld,
  decorators: [threadDecorator],
  args: {
    task: '432',
    title: 'Backfill idempotency keys on refunds created before PR 1184',
    plan: '4 steps · Opus 5 leads · draft PR at the end',
    onStart: fn(),
  },
} satisfies Meta<typeof TaskHeld>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Start as planned' }))
    await expect(args.onStart).toHaveBeenCalled()
  },
}

/** In the task's face: who leads can still change, and the composer is how it starts. */
function InFace(args: Parameters<typeof TaskHeld>[0]) {
  const [lead, setLead] = useState(OPUS.id)
  const [draft, setDraft] = useState('')
  const short = LEAD_OPTIONS.find((l) => l.model.id === lead)?.model.short ?? ''
  return (
    <>
      <TaskHeld {...args} plan={`4 steps · ${short} leads · draft PR at the end`} />
      <LeadPick value={lead} onChange={setLead} options={LEAD_OPTIONS} recommended={OPUS.id} reasons={LEAD_REASONS} />
      <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} placeholder={`Tell ${short} how to start`} hint="/" />
    </>
  )
}

export const WithComposer: Story = { render: (args) => <InFace {...args} /> }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States size="thread" cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <TaskHeld {...args} /> }))} />
  ),
}
