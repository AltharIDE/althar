import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { expect, it, vi } from 'vitest'

import { Dialog } from '../src/primitives/Dialog/Dialog'

it('closes an ordinary dialog on Escape', async () => {
  const close = vi.fn()
  render(
    <Dialog title="Settings" onClose={close}>
      <input aria-label="Name" />
    </Dialog>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Name'))
  await user.keyboard('{Escape}')
  expect(close).toHaveBeenCalledOnce()
})

it('takes a dialog’s step back before closing it', async () => {
  const close = vi.fn()
  const back = vi.fn()
  render(
    <Dialog title="Settings" onClose={close} onBack={back}>
      <input aria-label="Name" />
    </Dialog>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Name'))
  await user.keyboard('{Escape}')
  expect(back).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
})

it('lets an editing module consume Escape before the dialog steps back or closes', async () => {
  const close = vi.fn()
  const back = vi.fn()
  const cancel = vi.fn((event: KeyboardEvent) => event.preventDefault())
  render(
    <Dialog title="Settings" onClose={close} onBack={back} onEscapeKeyDown={cancel}>
      <input aria-label="Name" />
    </Dialog>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Name'))
  await user.keyboard('{Escape}')
  expect(cancel).toHaveBeenCalledOnce()
  expect(back).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
