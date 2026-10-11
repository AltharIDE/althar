import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

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

/** Opened from a button and closed, it gives focus back to the button. */
export const GivingFocusBack: Story = {
  render: function Opening(args) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Hand it over</Button>
        {open && (
          <Dialog
            {...args}
            onClose={() => {
              args.onClose()
              setOpen(false)
            }}
          />
        )}
      </>
    )
  },
  play: async ({ canvasElement }) => {
    const page = within(document.body)
    const opener = within(canvasElement).getByRole('button', { name: 'Hand it over' })
    await userEvent.click(opener)
    await page.findByRole('dialog', { name: 'Hand the conversation over?' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  },
}

/** Pages of its own, each with its own button: a way back before the title from the second on, which Escape takes before it closes. */
export const SteppingBack: Story = {
  args: { title: 'Connect GitHub', description: undefined, actions: undefined },
  render: function Stepping(args) {
    const [page, setPage] = useState(0)
    return (
      <Dialog {...args} width={480} {...(page === 0 ? {} : { onBack: () => setPage(page - 1) })} holding={page > 0} actions={undefined}>
        <p style={{ margin: 0 }}>{page === 0 ? 'Make a token on GitHub' : 'Paste the token'}</p>
        {page === 0 && <Button onClick={() => setPage(1)}>Continue</Button>}
      </Dialog>
    )
  },
  play: async ({ args }) => {
    const page = within(document.body)
    const shown = await page.findByRole('dialog', { name: 'Connect GitHub' })
    const dialog = within(shown)
    await expect(dialog.queryByRole('button', { name: 'Back' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Continue' }))
    await expect(dialog.getByText('Paste the token')).toBeInTheDocument()
    // Under way, a press outside, on the shade over the window, leaves it open.
    const shade = shown.previousElementSibling
    if (shade === null) throw new Error('no shade')
    await userEvent.click(shade)
    await expect(args.onClose).not.toHaveBeenCalled()
    // Escape steps back, then closes.
    await userEvent.keyboard('{Escape}')
    await expect(dialog.getByText('Make a token on GitHub')).toBeInTheDocument()
    await expect(args.onClose).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Continue' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Back' }))
    await expect(dialog.getByText('Make a token on GitHub')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}
