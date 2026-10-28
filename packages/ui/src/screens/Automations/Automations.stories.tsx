import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ALL_PAUSED, AUTOMATIONS, MORNING_REVIEW, NIGHTLY_BUMP, STARTERS, WEEKLY_E2E } from '../../fixtures/automations'
import { States } from '../../storybook/States'
import { Automations } from './Automations'

const meta = {
  title: 'Screens/Automations',
  component: Automations,
  parameters: { layout: 'fullscreen' },
  // On the project's ground, as its tab shows it under the front page.
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--n-2)', height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  args: { automations: AUTOMATIONS, onOpen: fn(), onNew: fn(), onPauseAll: fn(), starters: STARTERS },
} satisfies Meta<typeof Automations>
export default meta
type Story = StoryObj<typeof meta>

/** The one that paused itself first, violet, saying why; one paused by you, quiet; one running, its chip live. Each opens as its own page. */
export const AGoodMorning: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Automations' })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: /On a schedule/ })).toHaveTextContent('5')
    const names = c.getAllByRole('button', { name: /review|bump|end-to-end|changelog|sweep/i }).map((button) => button.textContent)
    await expect(names[0]).toBe('Sunday end-to-end')
    await expect(c.getByText(/Failed three Sundays running/)).toBeInTheDocument()
    await expect(c.getByText('Running since 9:21')).toBeInTheDocument()
    await expect(c.getByText('Hasn’t run yet')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Morning review' }))
    await expect(args.onOpen).toHaveBeenCalledWith('auto_review')
    await userEvent.click(c.getByRole('button', { name: 'New automation' }))
    await expect(args.onNew).toHaveBeenCalled()
  },
}

/** Its last runs, as marks: each says when and what came of it, to the pointer and the keyboard. */
export const ItsRuns: Story = {
  args: { automations: [MORNING_REVIEW] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const marks = c.getByRole('list', { name: 'Its last 7 runs' })
    await expect(within(marks).getAllByRole('listitem')).toHaveLength(7)
    // After its name, the oldest first.
    c.getByRole('button', { name: 'Morning review' }).focus()
    await userEvent.tab()
    await waitFor(() => expect(within(marks).getByRole('listitem', { name: 'Mon 9:00 · No new pull requests' })).toHaveFocus())
    await expect(c.getByText('Review #264')).toBeInTheDocument()
  },
}

/** A few runs leave the rest of the strip empty, the newest on the right. */
export const AFewRuns: Story = { args: { automations: [NIGHTLY_BUMP] } }

/** Pause them all from the menu; once paused, a band under the head says so, with Resume all, and every card goes quiet. */
function Pausing() {
  const [paused, setPaused] = useState(false)
  return (
    <Automations
      automations={paused ? ALL_PAUSED : AUTOMATIONS}
      onOpen={() => {}}
      onNew={() => {}}
      allPaused={paused}
      onPauseAll={setPaused}
    />
  )
}

export const PausingAll: Story = {
  render: () => <Pausing />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Pause all automations' }))
    const band = c.getByRole('status', { name: 'Every automation is paused' })
    await expect(within(band).getByText('None starts until you resume them. Runs under way finish.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'More' }))
    await expect(await within(document.body).findByRole('menuitem', { name: 'Resume all' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(within(band).getByRole('button', { name: 'Resume all' }))
    await expect(c.queryByRole('status', { name: 'Every automation is paused' })).toBeNull()
  },
}

/** All paused: the band, with its pause mark and Resume all; every card lies flat and faded, but the one that paused itself, which still waits on you. */
export const AllPaused: Story = {
  args: { automations: ALL_PAUSED, allPaused: true },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    const band = c.getByRole('status', { name: 'Every automation is paused' })
    await userEvent.click(within(band).getByRole('button', { name: 'Resume all' }))
    await expect(args.onPauseAll).toHaveBeenCalledWith(false)
    await expect(c.getAllByText('Paused').length).toBeGreaterThan(0)
  },
}

/** While Althar isn't opened at login, one quiet line says where they run, with the way to have it so. */
export const WhereTheyRun: Story = {
  args: { where: true, onOpenAtLogin: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/They run on this Mac while Althar is open\./)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Open Althar at login' }))
    await expect(args.onOpenAtLogin).toHaveBeenCalled()
  },
}

/**
 * None yet: what they are for, three to start from, each opening a new one
 * filled in, and New automation for a blank one, or what to say to the
 * coordinator. Nothing is said about where they run until there is one, and
 * there is nothing to pause.
 */
export const NoneYet: Story = {
  args: { automations: [], where: true, onOpenAtLogin: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Nothing runs by itself yet' })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'Start from one of these' })).toBeInTheDocument()
    await expect(c.getByText('“every weekday at 9, review the new pull requests”')).toBeInTheDocument()
    await expect(c.queryByText(/They run on this Mac/)).toBeNull()
    await expect(c.queryByRole('heading', { name: /On a schedule/ })).toBeNull()
    await expect(c.queryByRole('button', { name: 'More' })).toBeNull()
    await expect(c.getAllByRole('button', { name: 'New automation' })).toHaveLength(1)
    await userEvent.click(c.getByRole('button', { name: /^Weekly pull request review/ }))
    await expect(args.onNew).toHaveBeenLastCalledWith('pullRequests')
    await userEvent.click(c.getByRole('button', { name: 'New automation' }))
    await expect(args.onNew).toHaveBeenLastCalledWith()
  },
}

/** What went wrong with the last thing asked of them, under the head. */
export const Failed: Story = { args: { error: 'Althar couldn’t pause them. Try again.' } }

/** Without a way to make or pause them, only the cards. */
export const ReadOnly: Story = { args: { onNew: undefined, onPauseAll: undefined } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'a good morning', node: <Automations {...args} /> },
        { state: 'paused itself', node: <Automations {...args} automations={[WEEKLY_E2E]} /> },
        { state: 'all paused', node: <Automations {...args} automations={ALL_PAUSED.slice(0, 3)} allPaused /> },
        { state: 'where they run', node: <Automations {...args} automations={[MORNING_REVIEW]} where onOpenAtLogin={() => {}} /> },
        { state: 'none yet', node: <Automations {...args} automations={[]} /> },
      ]}
    />
  ),
}
