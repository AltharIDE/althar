import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { QuitWork } from './QuitWork'

const meta = {
  title: 'Chrome/QuitWork',
  component: QuitWork,
  parameters: { layout: 'fullscreen' },
  args: {
    work: { leads: 3, reviews: 1 },
    onQuit: fn(),
    onBackground: fn(),
    onCancel: fn(),
  },
  decorators: [(Story) => <div style={{ minHeight: 320 }}>{Story()}</div>],
} satisfies Meta<typeof QuitWork>
export default meta
type Story = StoryObj<typeof meta>

/** Leads and a review at work: what stops is named, Cancel has focus, and nothing happens until a button is pressed. */
export const Default: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toHaveTextContent('Quitting stops 3 leads at work and 1 review.')
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await expect(within(dialog).queryByRole('button', { name: 'Keep working in the background' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quit anyway' }))
    await expect(args.onQuit).toHaveBeenCalled()
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

/** One lead alone. */
export const OneLead: Story = {
  args: { work: { leads: 1 } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toHaveTextContent('Quitting stops 1 lead at work.')
  },
}

/** The runtime didn't say what is at work: Quit still asks, and says it may stop some. */
export const NotCounted: Story = {
  args: { work: {} },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toHaveTextContent('Quitting may stop work that is under way.')
  },
}

/** Runs and what agents left running count too. */
export const RunsAndLeftRunning: Story = {
  args: { work: { leads: 2, reviews: 1, runs: 2, left: 1 } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toHaveTextContent('Quitting stops 2 leads at work, 1 review, 2 runs and 1 thing left running.')
  },
}

/** With the edge or a tray to stay in reach by, the work can carry on with the windows closed. */
export const KeepWorkingInTheBackground: Story = {
  args: { background: true },
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep working in the background' }))
    await expect(args.onBackground).toHaveBeenCalled()
    await expect(args.onQuit).not.toHaveBeenCalled()
  },
}

/** An update that waits installs on this quit. */
export const WithAnUpdate: Story = {
  args: { background: true, update: '0.7.0' },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toHaveTextContent('Althar 0.7.0 waits for the work to finish. Quitting installs it now.')
  },
}

/** Cancel, and Escape, leave everything as it was. */
export const Cancelling: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Quit Althar?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalled()
    await expect(args.onQuit).not.toHaveBeenCalled()
  },
}
