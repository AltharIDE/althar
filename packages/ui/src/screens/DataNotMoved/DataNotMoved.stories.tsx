import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DataNotMoved } from './DataNotMoved'

const meta = {
  title: 'Screens/DataNotMoved',
  component: DataNotMoved,
  parameters: { layout: 'fullscreen' },
  args: {
    stopped: 'moving',
    backup: '~/Library/Application Support/Althar/backups/althar-0018-2026-10-11-103248.sqlite',
    reason: 'Migration "19_task_numbers" failed: Failed to prepare statement: no such column: number',
    onShowBackup: fn(),
    onReport: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataNotMoved>
export default meta
type Story = StoryObj<typeof meta>

/** A migration in the update stopped; the copy from before it is kept, and can be shown and reported. */
export const Stopped: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('alert')).toHaveTextContent('A copy from before the update is kept.')
    await expect(page.getByRole('region', { name: 'Copy from before the update' })).toHaveTextContent(
      'althar-0018-2026-10-11-103248.sqlite',
    )
    await userEvent.click(page.getByRole('button', { name: 'Show in Finder' }))
    await expect(args.onShowBackup).toHaveBeenCalledOnce()
    await userEvent.click(page.getByRole('button', { name: 'Report this' }))
    await expect(args.onReport).toHaveBeenCalledOnce()
  },
}

/** Where the app can't send a report yet, nothing offers to; and off a Mac, the file manager has its own name. */
export const NoReport: Story = {
  args: {
    onReport: undefined,
    backup: 'C:\\Users\\ada\\AppData\\Roaming\\Althar\\backups\\althar-0018-2026-10-11-103248.sqlite',
    text: { show: 'Show in File Explorer' },
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('button', { name: 'Show in File Explorer' })).toBeVisible()
    await expect(page.queryByRole('button', { name: 'Report this' })).toBeNull()
  },
}

/** Data no earlier version had moved, as a new profile's: there was nothing to copy, and nothing changed. */
export const NothingCopied: Story = {
  args: { backup: null },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('alert')).toHaveTextContent('Your data is as it was.')
    await expect(page.queryByRole('region', { name: 'Copy from before the update' })).toBeNull()
  },
}

/** The copy couldn't be made, so the update moved nothing. */
export const CopyNotMade: Story = {
  args: {
    stopped: 'copying',
    backup: null,
    reason: "ENOSPC: no space left on device, open '/Users/ada/Library/Application Support/Althar/backups'",
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('alert')).toHaveTextContent('Your data is as it was.')
    await expect(page.getByRole('region', { name: 'What stopped it' })).toHaveTextContent('ENOSPC')
  },
}
