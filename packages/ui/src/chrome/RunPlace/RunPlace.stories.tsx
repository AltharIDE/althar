import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type BranchChoice, type RunPlace, RunPlacePicker, type RunRepository } from './RunPlace'

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
  args: { remote: [], problem: 'Althar couldn’t reach origin. Check this computer is online.', defaultOpen: true },
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

/**
 * A branch's name the remote doesn't have, typed: offered last, to make from the default branch; picked, it is made,
 * and no place is picked. The foot says what a branch picked here does (ADR-093).
 */
export const CreatingABranch: Story = {
  args: {
    onCreate: fn(),
    createFrom: 'main',
    defaultOpen: true,
    note: 'A branch picked here is what new tasks work toward too. A task or pull request is only where Run runs.',
  },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('combobox', { name: 'Find a task, pull request or branch' }), 'release/2.5')
    const row = page.getByRole('option', { name: /Create release\/2\.5/ })
    await expect(row).toHaveTextContent('from main')
    await userEvent.keyboard('{Enter}')
    await expect(args.onCreate).toHaveBeenCalledWith('release/2.5', undefined)
    await expect(args.onPick).not.toHaveBeenCalled()
  },
}

/** A name a branch has, or one git wouldn't take, is never offered to make. */
export const NothingToCreate: Story = {
  args: { onCreate: fn(), createFrom: 'main', defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    const find = await page.findByRole('combobox', { name: 'Find a task, pull request or branch' })
    await userEvent.type(find, 'release/2.4')
    await expect(page.queryByRole('option', { name: /Create/ })).toBeNull()
    await userEvent.clear(find)
    await userEvent.type(find, 'two words')
    await expect(page.queryByRole('option', { name: /Create/ })).toBeNull()
  },
}

const PAIR: RunRepository[] = [
  { name: 'api', defaultBranch: 'main', branch: 'main' },
  { name: 'web', defaultBranch: 'main', branch: 'main' },
]

/** In a project of several repositories, a row for each, with its name. */
export const CreatingInOneOfSeveral: Story = {
  args: { onCreate: fn(), createFrom: 'main', repositories: PAIR, defaultOpen: true },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('combobox', { name: 'Find a task, pull request or branch' }), 'release/2.5')
    await expect(page.getAllByRole('option', { name: /Create release\/2\.5/ })).toHaveLength(2)
    await userEvent.click(page.getAllByRole('option', { name: /Create release\/2\.5/ })[1]!)
    await expect(args.onCreate).toHaveBeenCalledWith('release/2.5', 'web')
  },
}

/** Open on a name the remote doesn't have, the foot saying what a branch picked here does. */
export const CreateOffered: Story = {
  args: {
    onCreate: fn(),
    createFrom: 'main',
    defaultOpen: true,
    defaultQuery: 'release/2.5',
    note: 'A branch picked here is what new tasks work toward too. A task or pull request is only where Run runs.',
  },
}
export const CreateOfferedDark: Story = { ...CreateOffered, globals: { theme: 'dark' } }

/* The fnt project: five repositories, three on main, one on develop, one on master; engine moved to a branch. */
const FNT: RunRepository[] = [
  { name: 'engine', defaultBranch: 'main', branch: 'fix/redirects' },
  { name: 'frontend', defaultBranch: 'main', branch: 'main' },
  { name: 'api', defaultBranch: 'develop', branch: 'develop' },
  { name: 'docs', defaultBranch: 'master', branch: 'master' },
  { name: 'shared', defaultBranch: 'main', branch: 'main' },
]
const FNT_MAIN: RunPlace = { key: 'main', kind: 'main', label: 'engine: fix/redirects · 4 on defaults', several: true }
const FNT_REMOTE: BranchChoice[] = [
  { kind: 'branch', branch: 'main', repository: 'engine' },
  { kind: 'branch', branch: 'fix/redirects', repository: 'engine' },
  { kind: 'branch', branch: 'main', repository: 'frontend' },
  { kind: 'branch', branch: 'fix/redirects', repository: 'frontend' },
  { kind: 'branch', branch: 'develop', repository: 'api' },
  { kind: 'branch', branch: 'master', repository: 'docs' },
  { kind: 'branch', branch: 'main', repository: 'shared' },
]
const SEVERAL = {
  current: FNT_MAIN,
  places: [FNT_MAIN, { key: 'task:t1', kind: 'task', label: 'Cache the redirect table' }] satisfies RunPlace[],
  remote: FNT_REMOTE,
  repositories: FNT,
  defaultOpen: true,
} as const

/** Several repositories: the first row sums them up; each repository is a group with its default, and the one moved off it says where it is. */
export const SeveralRepositories: Story = {
  args: SEVERAL,
  play: async () => {
    const page = within(document.body)
    await expect(await page.findByRole('group', { name: 'engine' })).toBeInTheDocument()
    // Two repositories have a fix/redirects; each is in its own group, and only engine's is where Run copies.
    const there = (repository: string) =>
      within(page.getByRole('group', { name: repository })).getAllByRole('option', { name: /fix\/redirects/ })
    await expect(there('engine')).toHaveLength(1)
    await expect(there('frontend')).toHaveLength(1)
    await expect(page.getByRole('option', { name: /^engine: fix\/redirects · 4 on defaults/ })).toBeInTheDocument()
  },
}
export const SeveralRepositoriesDark: Story = { ...SeveralRepositories, globals: { theme: 'dark' } }

/** A branch picked in one repository is that repository's; the pick says which. */
export const PickingInOneRepository: Story = {
  args: SEVERAL,
  play: async ({ args }) => {
    const page = within(document.body)
    const api = await page.findByRole('group', { name: 'frontend' })
    await userEvent.click(within(api).getByRole('option', { name: /fix\/redirects/ }))
    await expect(args.onPick).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'branch', label: 'fix/redirects', choice: expect.objectContaining({ repository: 'frontend' }) }),
    )
  },
}

/** Typing a repository's name finds all it has; its group stays whole. */
export const FindingARepository: Story = {
  args: SEVERAL,
  play: async () => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('combobox', { name: 'Find a task, pull request or branch' }), 'docs')
    await expect(page.queryByRole('group', { name: 'engine' })).toBeNull()
    await expect(within(page.getByRole('group', { name: 'docs' })).getByRole('option', { name: /master/ })).toBeInTheDocument()
  },
}

/** The remote out of reach: each repository's default is still there to go back to. */
export const SeveralOutOfReach: Story = {
  args: { ...SEVERAL, remote: [], problem: 'Althar couldn’t reach engine’s remote. Check this computer is online.' },
  play: async () => {
    const page = within(document.body)
    await expect(await page.findAllByRole('option', { name: /Default/ })).toHaveLength(5)
  },
}

/** A host Althar has no connection to is named, with the way to connect it. */
export const HostNotConnected: Story = {
  args: { ...SEVERAL, hosts: ['gitlab.fnt.example'], onConnect: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByText('gitlab.fnt.example')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Connect gitlab.fnt.example' }))
    await expect(args.onConnect).toHaveBeenCalledWith('gitlab.fnt.example')
  },
}
export const HostNotConnectedDark: Story = { ...HostNotConnected, globals: { theme: 'dark' } }

/** A host name too long for the band gives way to ellipsis; the button keeps its size. */
export const LongHostName: Story = {
  args: { hosts: ['git.engineering.internal.a-very-long-company-name.example.com'], onConnect: fn(), defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    const button = await page.findByRole('button', { name: /^Connect / })
    await expect(button).toBeVisible()
    const picker = button.closest('[role="dialog"]')!
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(picker.getBoundingClientRect().right)
  },
}

/** One repository: the picker is as it was, with no grouping and no repository's name. */
export const OneRepository: Story = {
  args: { repositories: [{ name: 'api', defaultBranch: 'main', branch: 'main' }], defaultOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.queryByRole('group', { name: 'api' })).toBeNull()
  },
}
