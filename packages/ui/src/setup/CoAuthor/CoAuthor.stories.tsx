import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CO_AUTHOR_TRAILER } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { CoAuthor, type CoAuthorProps } from './CoAuthor'

/* Kept as it is turned, the way a consumer keeps it. */
function Kept(args: CoAuthorProps) {
  const [on, setOn] = useState(args.on)
  return (
    <CoAuthor
      {...args}
      on={on}
      onChange={(x) => {
        setOn(x)
        args.onChange(x)
      }}
    />
  )
}

const meta = {
  title: 'Setup/CoAuthor',
  component: CoAuthor,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 520 }}>{Story()}</div>],
  args: { on: true, onChange: fn(), trailer: CO_AUTHOR_TRAILER },
  render: (args) => <Kept {...args} />,
} satisfies Meta<typeof CoAuthor>
export default meta
type Story = StoryObj<typeof meta>

/** On, as it starts: one line, and the switch. */
export const On: Story = {}

/** Turned off, it asks once, quietly, and turns back on from there. */
export const TurningItOff: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const it = c.getByRole('switch', { name: 'Althar as co-author' })
    await expect(c.queryByText(/no marketing budget/)).toBeNull()
    await userEvent.click(it)
    await expect(args.onChange).toHaveBeenCalledWith(false)
    await expect(c.getByText(/no marketing budget/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Turn it back on' }))
    await expect(it).toHaveAttribute('aria-checked', 'true')
    await expect(c.queryByText(/no marketing budget/)).toBeNull()
  },
}

/** The exact line it adds, for anyone who wants to know. */
export const SeeingTheLine: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const see = c.getByRole('button', { name: 'See the line' })
    await expect(see).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(see)
    await expect(c.getByText(CO_AUTHOR_TRAILER)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Hide the line' })).toHaveAttribute('aria-expanded', 'true')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'on', node: <CoAuthor on onChange={fn()} trailer={CO_AUTHOR_TRAILER} /> },
        { state: 'off', node: <CoAuthor on={false} onChange={fn()} trailer={CO_AUTHOR_TRAILER} /> },
      ]}
    />
  ),
}
