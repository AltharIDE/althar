import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RepositoryPick, type RepositoryChoice, type RepositoryPickProps } from './RepositoryPick'

/* The repositories a first run finds where people keep code, most recently worked on first. */
const FOUND: RepositoryChoice[] = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'meridian-web', name: 'meridian-web', where: '~/Projects/meridian-web', facts: 'checkout-v2 · yesterday' },
  { id: 'halyard', name: 'halyard', where: '~/Developer/halyard', facts: 'main · 3 days ago' },
  { id: 'dotfiles', name: 'dotfiles', where: '~/code/dotfiles', facts: 'main · in August' },
]

const onPick = fn()

/* As a consumer keeps it: what is ticked. */
function Picking(props: Partial<RepositoryPickProps>) {
  const [picked, setPicked] = useState<readonly string[]>(props.picked ?? [])
  return (
    <div style={{ width: 520 }}>
      <RepositoryPick
        repositories={FOUND}
        onAdd={fn()}
        {...props}
        picked={picked}
        onPick={(id) => {
          onPick(id)
          setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Setup/RepositoryPick',
  component: RepositoryPick,
  render: (args) => <Picking {...args} />,
  args: { repositories: FOUND, picked: [], onPick, onAdd: fn() },
} satisfies Meta<typeof RepositoryPick>
export default meta
type Story = StoryObj<typeof meta>

/** Found where people keep code; none ticked yet. */
export const Found: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('checkbox', { name: /meridian-web/ }))
    await expect(c.getByRole('checkbox', { name: /meridian-web/ })).toBeChecked()
    await expect(onPick).toHaveBeenCalledWith('meridian-web')
  },
}

/** Two ticked into one project. */
export const Picked: Story = { args: { picked: ['meridian', 'meridian-web'] } }

/** Still looking in the usual places. */
export const Looking: Story = { args: { repositories: null } }

/** Nothing found: Add a folder stays. */
export const NoneFound: Story = { args: { repositories: [] } }

/** A long path is cut short, whole on hover. */
export const LongPath: Story = {
  args: {
    repositories: [
      {
        id: 'deep',
        name: 'payments-reconciliation-service',
        where: '~/Projects/northwind/platform/services/payments-reconciliation-service',
        facts: 'nw-1182-backfill-ledger-entries · 20 min ago',
      },
    ],
  },
}
