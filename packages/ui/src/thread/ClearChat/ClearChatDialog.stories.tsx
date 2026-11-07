import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ClearChatDialog } from './ClearChatDialog'

const meta = {
  title: 'Thread/ClearChatDialog',
  component: ClearChatDialog,
  parameters: { layout: 'fullscreen' },
  args: { clearable: true, onClear: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 360 }}>{Story()}</div>],
} satisfies Meta<typeof ClearChatDialog>
export default meta
type Story = StoryObj<typeof meta>

/** From the bar above the thread, or /clear: it opens on clearing only the view, and forgetting is one choice away. */
export const ClearTheView: Story = {
  play: async ({ args }) => {
    const dialog = within(document.body)
    await userEvent.click(await dialog.findByRole('button', { name: 'Clear the view' }))
    await expect(args.onClear).toHaveBeenCalledWith('view')
  },
}

/** From the context ring: it opens on forgetting, so it reads as the warning it is; the red button is pressed, not defaulted to. */
export const Forget: Story = {
  args: { startOn: 'forget' },
  play: async ({ args }) => {
    const dialog = within(document.body)
    await expect(await dialog.findByRole('radio', { name: /Forget the conversation too/ })).toBeChecked()
    await userEvent.click(dialog.getByRole('button', { name: 'Clear and forget' }))
    await expect(args.onClear).toHaveBeenCalledWith('forget')
  },
}

/** The view has nothing in it: clearing it is off, and forgetting is chosen. */
export const ViewAlreadyClear: Story = { args: { clearable: false } }
