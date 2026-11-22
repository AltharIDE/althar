import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CLOUD_AT_LIMIT, CLOUD_USE } from '../../fixtures/computers'
import { CloudPage } from './Cloud'

/*
 * Althar Cloud's own page of Settings, for when a home has it: nothing in
 * the app does yet. Computers keeps a line for it (Setup/Computers, With
 * Althar Cloud) that opens it here.
 */

const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const onBack = fn()

const meta = {
  title: 'Setup/Computers/AltharCloud',
  component: CloudPage,
  parameters: { layout: 'padded' },
  decorators: [width(900)],
  args: { use: CLOUD_USE, onAuto: fn(), onLimit: fn(), onLeave: fn() },
} satisfies Meta<typeof CloudPage>
export default meta
type Story = StoryObj<typeof meta>

/** Opened from Computers' line: a way back to Computers at its top, then this month, what runs now and when it runs. */
export const FromComputers: Story = {
  args: { onBack },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Computers' }))
    await expect(onBack).toHaveBeenCalled()
  },
}

/** Opened from Settings' side, it is a section like any other: no way back. */
export const FromTheSide: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Computers' })).toBeNull()
  },
}

/** At its limit: said in ink, the one line here that asks something of the person; nothing runs. */
export const AtTheLimit: Story = { args: { use: CLOUD_AT_LIMIT, onBack } }

export const Narrow: Story = { args: { onBack }, decorators: [width(460)] }
