import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PLAN_432, T432 } from '../../fixtures/coordinator'
import { PROJECT } from '../../fixtures/meridian'
import { TaskStatus } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { TaskCard } from '../TaskCard/TaskCard'
import { TaskLaunch } from '../TaskLaunch/TaskLaunch'
import { PresetOffer, type PresetOfferProps } from './PresetOffer'

/** The offer as the app shows it: in the foot of the task's card, its plan before it starts. */
function OnPlan(props: PresetOfferProps) {
  return (
    <TaskLaunch
      task="432"
      preset="Change"
      title="Fix the typo in the onboarding copy"
      project={PROJECT}
      steps={PLAN_432}
      /* the row draws who it is; the picker lies unseen over it, as the app's does */
      picker={({ owner }) => <button type="button" aria-label={owner} />}
      held
      onStart={() => {}}
      footNote={<PresetOffer {...props} />}
    />
  )
}

const meta = {
  title: 'Coordinator/PresetOffer',
  component: PresetOffer,
  decorators: [threadDecorator],
  args: { name: 'Local, no review', onKeep: fn(), onDecline: fn(), onUndo: fn() },
  render: (args) => <OnPlan {...args} />,
} satisfies Meta<typeof PresetOffer>
export default meta
type Story = StoryObj<typeof meta>

/** Offered: a link below Start; it opens the name, which the person may change, and Keep. */
export const Offered: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(c.getByRole('button', { name: 'Keep as a preset' }))
    const name = await page.findByLabelText('Preset name')
    await expect(name).toHaveValue('Local, no review')
    await userEvent.clear(name)
    await userEvent.type(name, 'Quick local fix')
    await userEvent.click(page.getByRole('button', { name: 'Keep' }))
    await expect(args.onKeep).toHaveBeenCalledWith('Quick local fix')
  },
}

/** The form open, its name the one offered. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep as a preset' }))
    await expect(await within(canvasElement.ownerDocument.body).findByLabelText('Preset name')).toHaveValue('Local, no review')
  },
}

/** A name another preset has: the form stays open and says so, and a new name clears it. */
export const NameTaken: Story = {
  args: { onKeep: fn(async (name: string) => Promise.reject(new Error(`Another preset is called ${name}.`))) },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep as a preset' }))
    await userEvent.click(await page.findByRole('button', { name: 'Keep' }))
    await expect(await page.findByRole('alert')).toHaveTextContent('Another preset is called Local, no review.')
    await expect(page.getByLabelText('Preset name')).toHaveAttribute('aria-invalid', 'true')
  },
}

/** Don't offer again, from the form. */
export const Declined: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep as a preset' }))
    await userEvent.click(await page.findByRole('button', { name: 'Don’t offer again' }))
    await expect(args.onDecline).toHaveBeenCalled()
    await expect(args.onKeep).not.toHaveBeenCalled()
  },
}

/** A built-in preset but for one thing: it says which, and offers no new one. */
export const Nearly: Story = {
  args: { near: { preset: 'Prototype', differs: 'without its review after merge' } },
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Nearly Prototype' }))
    await expect(await page.findByText('These are Prototype, without its review after merge.')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Got it' }))
    await expect(args.onDecline).toHaveBeenCalled()
  },
}

/** Kept: it says so, with Undo. */
export const Kept: Story = {
  args: { kept: 'Quick local fix' },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Kept as Quick local fix')).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalled()
  },
}

/** Its info mark says what parts and presets are. */
export const About: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: 'What are parts and presets?' }))
    await expect(await within(canvasElement.ownerDocument.body).findByText(/is a named set of parts/)).toBeVisible()
  },
}

/** Once the task runs, the same, at the end of its card's foot. */
export const OnARunningTask: Story = {
  render: function Render(args) {
    const [kept, setKept] = useState<string>()
    return (
      <TaskCard
        {...T432}
        status={TaskStatus.Running}
        at={0}
        now="Implement · writing the fix"
        started="2m ago"
        footNote={
          <PresetOffer
            {...args}
            {...(kept === undefined ? {} : { kept })}
            onKeep={(name) => {
              args.onKeep(name)
              setKept(name)
            }}
            onUndo={() => setKept(undefined)}
          />
        }
      />
    )
  },
}
