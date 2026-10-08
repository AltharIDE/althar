import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RenameProject } from './RenameProject'

const meta = {
  title: 'Chrome/RenameProject',
  component: RenameProject,
  parameters: { layout: 'fullscreen' },
  args: { name: 'meridian', onRename: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 360 }}>{Story()}</div>],
} satisfies Meta<typeof RenameProject>
export default meta
type Story = StoryObj<typeof meta>

/** Its name now, selected, to type over. */
export const Open: Story = {}
/** Renaming it. */
export const Busy: Story = { args: { busy: true } }
/** The runtime said no. */
export const Failed: Story = { args: { error: 'Althar couldn’t rename the project.' } }

export const Renaming: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    const field = await page.findByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.type(field, '  Refunds v2 {Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('Refunds v2')
  },
}

/** Empty, it says so, and nothing is renamed. */
export const Empty: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.clear(await page.findByRole('textbox', { name: 'Name' }))
    await userEvent.click(page.getByRole('button', { name: 'Rename' }))
    await expect(page.getByRole('alert')).toHaveTextContent('Name the project first')
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

/** The same name is no change: it closes. */
export const Unchanged: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Rename' }))
    await expect(args.onRename).not.toHaveBeenCalled()
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}

export const Cancelling: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Cancel' }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}
