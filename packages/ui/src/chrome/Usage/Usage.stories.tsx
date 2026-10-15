import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FAULTS, HEALTHY, RUNNING_LOW, WITH_KEY } from '../../fixtures/usage'
import { Button } from '../../primitives/Button/Button'
import { Usage } from './Usage'

const meta = {
  title: 'Chrome/Usage',
  component: Usage,
  parameters: { layout: 'fullscreen' },
  args: { groups: HEALTHY, onRefresh: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 720 }}>{Story()}</div>],
} satisfies Meta<typeof Usage>
export default meta
type Story = StoryObj<typeof meta>

/** The view behind the button that opens it. */
function Example() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Usage</Button>
      {open && <Usage groups={RUNNING_LOW} onRefresh={fn()} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Every account healthy: a meter per window, with what is left and when it resets. */
export const AllHealthy: Story = {
  play: async () => {
    const page = within(document.body)
    await expect(page.getByRole('dialog', { name: 'Plan usage' })).toBeVisible()
    await expect(page.getAllByRole('meter')).toHaveLength(7)
    await expect(page.getByRole('meter', { name: 'Claude Code work, 5 hours' })).toHaveAttribute('aria-valuetext', '72% left, Resets 17:00')
  },
}

/** Running down: warm at half and a quarter, red at a tenth and a twentieth, always with the share in words. */
export const RunningLow: Story = {
  args: { groups: RUNNING_LOW },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('4% left')).toBeVisible()
    await expect(page.getByText('9% left')).toBeVisible()
  },
}

/** One account for each kind of fault, with the last numbers kept beside a few, dimmed. */
export const Faults: Story = {
  args: { groups: FAULTS },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Sign in again')).toBeVisible()
    await expect(page.getByText('No usage data yet')).toBeVisible()
    await expect(page.getByText('Codex did not answer in time.')).toBeVisible()
  },
}

/** An account on an API key has no plan window, and nothing is wrong. */
export const ApiKey: Story = {
  args: { groups: WITH_KEY },
  play: async () => {
    await expect(within(document.body).getByText('API key – no plan window')).toBeVisible()
  },
}

/** No agent has an account yet. */
export const Empty: Story = { args: { groups: [] } }

/** Every source is being read again. */
export const Reading: Story = {
  args: { groups: RUNNING_LOW, reading: true },
  play: async () => {
    await expect(within(document.body).getByRole('button', { name: 'Reading…' })).toBeVisible()
  },
}

/** Read again asks for fresh numbers; Close closes. */
export const ReadAgain: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(page.getByRole('button', { name: 'Read again' }))
    await expect(args.onRefresh).toHaveBeenCalledOnce()
    await userEvent.click(page.getByRole('button', { name: 'Close' }))
    await expect(args.onClose).toHaveBeenCalledOnce()
  },
}

/** Escape closes it and gives focus back to what opened it. */
export const EscapeGivesFocusBack: Story = {
  render: () => <Example />,
  play: async () => {
    const page = within(document.body)
    const opener = page.getByRole('button', { name: 'Usage' })
    await userEvent.click(opener)
    await expect(await page.findByRole('dialog', { name: 'Plan usage' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await expect(opener).toHaveFocus()
  },
}
