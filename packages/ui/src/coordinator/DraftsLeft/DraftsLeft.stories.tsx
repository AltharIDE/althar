import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DRAFT_LINEAR } from '../../fixtures/coordinator'
import { IssueDraftState } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { IssueDraft } from '../IssueDraft/IssueDraft'
import { DraftsLeft } from './DraftsLeft'

const LEFT = [
  {
    key: 'd1',
    task: 'Approval center and action ledger (ADR-010)',
    title: 'Browser end-to-end tests',
    body: 'The approval center has unit tests only. Add Playwright runs for approving, rejecting and undoing an action.',
  },
  {
    key: 'd2',
    task: 'Quick capture and natural-language entry (ADR-006)',
    title: 'Parse relative dates in other locales',
    body: '“next Friday” works; “jövő péntek” doesn’t.',
  },
]

/** The list as the coordinator's conversation keeps it: filing or discarding a draft takes it off at once. */
function Live({ onFile, onDiscard }: { onFile: (key: string) => void; onDiscard: (key: string) => void }) {
  const [gone, setGone] = useState<ReadonlyArray<string>>([])
  const shown = LEFT.filter((one) => !gone.includes(one.key))
  return (
    <DraftsLeft
      drafts={shown.map((one) => ({
        key: one.key,
        task: one.task,
        onOpenTask: () => undefined,
        card: (
          <IssueDraft
            {...DRAFT_LINEAR}
            title={one.title}
            body={one.body}
            labels={['testing']}
            state={IssueDraftState.Pending}
            headingLevel={3}
            onFile={() => {
              onFile(one.key)
              setGone((was) => [...was, one.key])
            }}
            onChange={() => undefined}
            onDiscard={() => {
              onDiscard(one.key)
              setGone((was) => [...was, one.key])
            }}
          />
        ),
      }))}
    />
  )
}

const meta = {
  title: 'Coordinator/DraftsLeft',
  component: Live,
  decorators: [threadDecorator],
  args: { onFile: fn(), onDiscard: fn() },
} satisfies Meta<typeof Live>
export default meta
type Story = StoryObj<typeof meta>

/** Two finished tasks' drafts, each under the task it came from. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('heading', { name: '2 issue drafts from finished tasks' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approval center and action ledger (ADR-010)' })).toBeVisible()
  },
}
export const Dark: Story = { ...Default, globals: { theme: 'dark' } }

/** One discarded: it leaves the list, and the heading counts what is left. */
export const OneDiscarded: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    const [discard] = page.getAllByRole('button', { name: 'Discard' })
    if (discard !== undefined) await userEvent.click(discard)
    await expect(args.onDiscard).toHaveBeenCalledWith('d1')
    await expect(page.getByRole('heading', { name: '1 issue draft from a finished task' })).toBeVisible()
    await expect(page.queryByText('Browser end-to-end tests')).toBeNull()
  },
}
export const OneDiscardedDark: Story = { ...OneDiscarded, globals: { theme: 'dark' } }
