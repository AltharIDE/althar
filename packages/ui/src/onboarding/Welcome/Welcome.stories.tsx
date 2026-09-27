import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Welcome } from './Welcome'

const meta = {
  title: 'Onboarding/Welcome',
  component: Welcome,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh', minHeight: 640 }}>{Story()}</div>],
  args: { onDone: fn() },
} satisfies Meta<typeof Welcome>
export default meta
type Story = StoryObj<typeof meta>

/** The opening: the mark drawn close, the camera pulling back, the name. Press Begin, then Continue: the camera glides from plot to plot, the pencil route drawn beside it. */
export const Opening: Story = {}

/** 01. The project is sketched, uncovered, and a task visits it and leaves a note. */
export const AProject: Story = { args: { defaultStep: 1 } }

/** 02. The coordinator answers, the task is posted, and its lead works through the steps. */
export const ATaskAndItsLead: Story = { args: { defaultStep: 2 } }

/** 03. Work moves across the board on its own; a call arrives; the pointer answers it in the dock. */
export const TheCalls: Story = { args: { defaultStep: 3 } }

/** 04. The last checks pass, and the pointer accepts the change. */
export const TheChange: Story = { args: { defaultStep: 4 } }

/** 05. An agent finishes signing in, and the three are wired to the task they share. */
export const YourAgents: Story = { args: { defaultStep: 5 } }

/** The end: the camera pulls back over the whole table, built. */
export const TheWholeTable: Story = { args: { defaultStep: 6, still: true } }

/** A stop as it ends, with no motion: what reduced motion shows. */
export const Still: Story = { args: { defaultStep: 3, still: true } }

/** Enter walks through, with Continue holding focus; the arrows move too; the last press leaves. */
export const WalkingThrough: Story = {
  args: { still: true },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: /Begin/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('heading', { name: 'A project holds the work' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('heading', { name: 'Every task has a lead' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(c.getByRole('heading', { name: 'A project holds the work' })).toBeInTheDocument()
    for (let i = 0; i < 4; i++) await userEvent.click(c.getByRole('button', { name: /Continue/ }))
    await expect(c.getByRole('heading', { name: 'Your agents, signed in as you' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Continue/ }))
    await expect(c.getByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Back' }))
    await userEvent.click(c.getByRole('button', { name: /Continue/ }))
    await userEvent.click(c.getByRole('button', { name: /Find my agents/ }))
    await expect(args.onDone).toHaveBeenCalledTimes(1)
  },
}

/** Skip leaves from anywhere. */
export const Skipping: Story = {
  args: { defaultStep: 2, still: true },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Skip' }))
    await expect(args.onDone).toHaveBeenCalled()
  },
}

/** A narrow window: the scene above, the words below it. */
export const Narrow: Story = {
  args: { defaultStep: 2, still: true },
  decorators: [(Story) => <div style={{ width: 420, height: 860 }}>{Story()}</div>],
}
