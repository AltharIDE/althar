import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CO_AUTHOR_COMMIT, CO_AUTHOR_TRAILER } from '../../fixtures/setup'
import { Switch } from '../../primitives/Switch/Switch'
import { States } from '../../storybook/States'
import { CoAuthor, CoAuthorFace, type CoAuthorProps } from './CoAuthor'

const onChange = fn()

/* Kept as it is turned, the way a consumer keeps it, with its switch beside it as a page's head would hold it. */
function Kept(args: Pick<CoAuthorProps, 'on'>) {
  const [on, setOn] = useState(args.on)
  const turn = (next: boolean) => {
    setOn(next)
    onChange(next)
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Switch checked={on} onChange={turn} label="Althar as co-author" />
      <CoAuthor on={on} onChange={turn} trailer={CO_AUTHOR_TRAILER} author="dana-k" commit={CO_AUTHOR_COMMIT} />
    </div>
  )
}

const meta = {
  title: 'Setup/CoAuthor',
  component: CoAuthor,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 564 }}>{Story()}</div>],
  args: { on: true, onChange, trailer: CO_AUTHOR_TRAILER, author: 'dana-k', commit: CO_AUTHOR_COMMIT },
  render: (args) => <Kept on={args.on} />,
} satisfies Meta<typeof CoAuthor>
export default meta
type Story = StoryObj<typeof meta>

/** On, as it starts: what it does, and a commit with its line and Althar's face beside the person's. */
export const On: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const commit = c.getByRole('figure', { name: 'A commit as GitHub shows it' })
    await expect(within(commit).getByText(CO_AUTHOR_TRAILER)).toBeInTheDocument()
    await expect(commit).toHaveTextContent('dana-k and Althar committed 12 minutes ago')
    await expect(c.getByText(/Pull requests end with/)).toBeInTheDocument()
    await expect(c.getByRole('link', { name: 'Althar' })).toHaveAttribute('href', 'https://althar.ai')
  },
}

/** Turned off, it asks once, large, and puts it back from there; focus lands on what it does now. */
export const TurningItOff: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const it = c.getByRole('switch', { name: 'Althar as co-author' })
    await expect(c.queryByText(/no marketing budget/)).toBeNull()
    await userEvent.click(it)
    await expect(onChange).toHaveBeenCalledWith(false)
    await expect(c.getByText('Althar is free, and we have no marketing budget.')).toBeInTheDocument()
    await expect(c.getByRole('figure', { name: 'A commit as GitHub shows it' })).toHaveTextContent('dana-k committed 12 minutes ago')
    await expect(c.getByText('Your commits and pull requests go out with only your name.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Put Althar back on your commits' }))
    await expect(it).toHaveAttribute('aria-checked', 'true')
    await expect(c.queryByText(/no marketing budget/)).toBeNull()
    await expect(c.getByText(/^On your commits and pull requests/)).toHaveFocus()
  },
}

/** Opened while it is off, it says only what goes out: the ask was said when it was turned off. */
export const OffAlready: Story = {
  args: { on: false },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText(/no marketing budget/)).toBeNull()
    await expect(c.getByText('Your commits and pull requests go out with only your name.')).toBeInTheDocument()
  },
}

const commit = { trailer: CO_AUTHOR_TRAILER, author: 'dana-k', commit: CO_AUTHOR_COMMIT, onChange: fn() }

/** On, just turned off, off when opened, and the face alone at its sizes. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'on', node: <CoAuthor on {...commit} /> },
        { state: 'just turned off', node: <CoAuthor on={false} asking {...commit} /> },
        { state: 'off when opened', node: <CoAuthor on={false} {...commit} /> },
        {
          state: 'the face, on and gone',
          node: (
            <span style={{ display: 'flex', gap: 8 }}>
              <CoAuthorFace size={16} />
              <CoAuthorFace />
              <CoAuthorFace size={28} />
              <CoAuthorFace ghost />
            </span>
          ),
        },
      ]}
    />
  ),
}
