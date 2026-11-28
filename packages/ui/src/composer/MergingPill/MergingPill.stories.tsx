import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { Behind } from '../Behind/Behind'
import { Composer } from '../Composer/Composer'
import type { RunningProcess } from '../Running/Running'
import { MergingBack, MergingPill, type MergingPillProps, type MergingRow } from './MergingPill'

/*
 * What is on its way into a branch, pinned on the composer's edge beside the
 * run chip, so it stays in view while the thread scrolls on; pressed, it grows
 * into a card of a row for each. One thing is open on the edge at a time.
 */

const pull = (number: number, title: string, state: MergingRow['state'], reason?: string): MergingRow => ({
  key: `#${number}`,
  label: `#${number}`,
  title,
  url: `https://github.com/meridian/api/pull/${number}`,
  state,
  ...(reason === undefined ? {} : { reason }),
})

/** A merge kept for later, whose pull request isn't open yet: by its task's name. */
const kept = (task: string, once: string): MergingRow => ({ key: task, label: task, title: '', url: null, state: 'waiting', once })

const FOUR: ReadonlyArray<MergingRow> = [
  pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
  pull(1226, 'Keep for later shelves a task without losing it', 'merging'),
  pull(1222, 'A home’s whole experience reviewed and made good', 'queued'),
  kept('Workers readiness', 'once its checks pass'),
]
const SENT_BACK: ReadonlyArray<MergingRow> = [
  pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
  pull(
    1226,
    'Keep for later shelves a task without losing it',
    'sent_back',
    'the queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it.',
  ),
  pull(1222, 'A home’s whole experience reviewed and made good', 'merging'),
]
const SITE: RunningProcess = { id: 'site', name: 'Site dev server', command: 'bun run dev', url: 'localhost:5173', since: '41m' }

/** On a composer's edge, beside the run chip, at a width: one of them open at a time, as the app holds them. */
function Edge({ width = 640, open: first = false, ...props }: MergingPillProps & { readonly width?: number }) {
  const [open, setOpen] = useState<'merging' | 'runs' | null>(first ? 'merging' : null)
  const opens = (which: 'merging' | 'runs') => (next: boolean) => setOpen((was) => (next ? which : was === which ? null : was))
  return (
    <div style={{ width, paddingTop: 300 }}>
      <Composer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Ask the coordinator"
        above={
          <>
            <Behind processes={[SITE]} open={open === 'runs'} onOpenChange={opens('runs')} />
            <MergingPill {...props} open={open === 'merging'} onOpenChange={opens('merging')} />
          </>
        }
        notice={open === 'merging' || !props.rows.some((row) => row.state === 'sent_back') ? null : <MergingBack rows={props.rows} />}
      />
    </div>
  )
}

const meta = {
  title: 'Composer/MergingPill',
  component: MergingPill,
  args: { rows: FOUR },
  render: (args) => <Edge {...args} />,
} satisfies Meta<typeof MergingPill>
export default meta
type Story = StoryObj<typeof meta>

/** Four on their way: one in, one merging, one in the queue, one whose pull request isn't open yet. */
export const OnTheirWay: Story = {
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /^Merging:/ })
    await expect(pill).toHaveAccessibleName('Merging: #1224 merged, #1226 merging, #1222 in the queue, Workers readiness not in line yet')
  },
}

/** Opened: a row for each, where it stands in a column of its own, and what it waits for under it. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getAllByRole('listitem')).toHaveLength(4)
  },
}

/** One sent back: why, on the notice line while folded, and under its row once opened. */
export const SentBack: Story = { args: { rows: SENT_BACK } }

export const SentBackOpened: Story = {
  args: { rows: SENT_BACK },
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getByText('The queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it.')).toBeVisible()
  },
}

/** One open on the edge at a time: the run chip's list folds the card back into its pill. */
export const OneAtATime: Story = {
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement)
    await userEvent.click(edge.getByRole('button', { name: /^Merging:/ }))
    await expect(edge.getByRole('region', { name: 'Merging' })).toBeVisible()
    await userEvent.click(edge.getByRole('button', { name: /Site dev server/ }))
    await expect(edge.queryByRole('region', { name: 'Merging' })).toBeNull()
    await expect(edge.getByRole('button', { name: /^Merging:/ })).toBeVisible()
  },
}

/** Narrow: what is in, and what isn't in line yet, keep only their marks; opened, titles end in "…". */
export const Narrow: Story = { render: (args) => <Edge {...args} width={380} /> }

export const NarrowOpened: Story = {
  render: (args) => <Edge {...args} width={380} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Merging:/ }))
  },
}

/** Into a branch that isn't the default, named. */
export const IntoABranch: Story = { args: { rows: FOUR.slice(0, 2), branch: 'release/0.10' } }
