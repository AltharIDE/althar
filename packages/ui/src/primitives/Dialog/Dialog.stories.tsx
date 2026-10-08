import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Button } from '../Button/Button'
import { Field } from '../Field/Field'
import { Dialog } from './Dialog'

const meta = {
  title: 'Primitives/Dialog',
  component: Dialog,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Hand the conversation over?',
    description: 'The coordinator’s turn stops, and Codex takes over from a brief.',
    onClose: fn(),
    actions: (
      <>
        <Button variant="quiet">Cancel</Button>
        <Button>Hand it over</Button>
      </>
    ),
  },
  decorators: [(Story) => <div style={{ minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof Dialog>
export default meta
type Story = StoryObj<typeof meta>

/** A question and its buttons. */
export const Question: Story = {}

/** With more under the description: a list of what happens. */
export const WithBody: Story = {
  args: {
    children: (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li>Its two tasks stop.</li>
        <li>Their worktrees stay in ~/Althar/meridian.</li>
      </ul>
    ),
  },
}

/** A form: Enter in its field submits it. */
export const Form: Story = {
  args: {
    title: 'Rename the project',
    description: undefined,
    onSubmit: fn(),
    children: <Field aria-label="Name" defaultValue="meridian" />,
    actions: (
      <>
        <Button variant="quiet">Cancel</Button>
        <Button type="submit">Rename</Button>
      </>
    ),
  },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('textbox', { name: 'Name' }), ' web{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledOnce()
  },
}

/** Escape closes it. */
export const Escaping: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await page.findByRole('dialog', { name: 'Hand the conversation over?' })
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}
