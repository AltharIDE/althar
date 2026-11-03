import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type BranchChoice, type RunPlace, RunPlacePicker } from './RunPlace'

const MAIN: RunPlace = { key: 'main', kind: 'main', label: 'main', running: ['Dashboard', 'API'] }

/* The default branch, two tasks, and a pull request something failed on. */
const PLACES: RunPlace[] = [
  MAIN,
  { key: 'task:t1', kind: 'task', label: 'Refunds: idempotency keys', running: ['Storybook'] },
  { key: 'task:t2', kind: 'task', label: 'Payout reconciliation report' },
  {
    key: ':#1206',
    kind: 'pull',
    label: 'PR #1206',
    detail: 'Bump the lockfile',
    failed: 'Dashboard exited 1',
    choice: { kind: 'pull', number: 1206, name: 'PR #1206', title: 'Bump the lockfile', branch: 'deps/lockfile' },
  },
]

/* What the remote has: pull requests, then branches. */
const REMOTE: BranchChoice[] = [
  { kind: 'pull', number: 1206, name: 'PR #1206', title: 'Bump the lockfile', branch: 'deps/lockfile', author: 'mira' },
  {
    kind: 'pull',
    number: 1211,
    name: 'PR #1211',
    title: 'Settle payouts in batches',
    branch: 'feature/payout-batches',
    author: 'ines',
    draft: true,
  },
  { kind: 'pull', number: 1198, name: 'PR #1198', title: 'Dark mode for the dashboard', branch: 'ui/dark', author: 'tom', fork: true },
  { kind: 'branch', branch: 'feature/payout-reconciliation' },
  { kind: 'branch', branch: 'release/2.4' },
]

const meta = {
  title: 'Chrome/RunPlace',
  component: RunPlacePicker,
  args: { current: MAIN, places: PLACES, remote: REMOTE, onPick: fn() },
  decorators: [(Story) => <div style={{ display: 'flex', justifyContent: 'flex-end', width: 600, minHeight: 520 }}>{Story()}</div>],
} satisfies Meta<typeof RunPlacePicker>
export default meta
type Story = StoryObj<typeof meta>

/** The chip beside Run: where it runs, as a branch switcher says it. */
export const Closed: Story = {}

/** Open: the default branch, the tasks, then pull requests and branches; what runs on each, quietly, and a failure in red. */
export const Open: Story = { args: { defaultOpen: true } }

/** On a pull request: the chip says its number. */
export const OnAPullRequest: Story = { args: { current: PLACES[3]! } }

/** While Althar asks the remote: what is known already is listed. */
export const Asking: Story = { args: { remote: null, defaultOpen: true } }

/** The remote out of reach: what is known, and why the rest isn't. */
export const OutOfReach: Story = {
  args: { remote: [], note: 'Althar couldn’t reach origin: you may be offline.', defaultOpen: true },
}

/** Typed: what it finds; a pull request's number nobody listed is still offered; Enter picks. */
export const Typed: Story = {
  args: { defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    const field = await page.findByRole('combobox', { name: 'Find a task, pull request or branch' })
    await expect(field).toHaveFocus()
    await userEvent.type(field, 'payout')
    await expect(page.getByText('Settle payouts in batches')).toBeInTheDocument()
    await expect(page.queryByText('Dark mode for the dashboard')).not.toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.type(field, '#1300{Enter}')
    await expect(args.onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pull', label: '#1300' }))
  },
}
