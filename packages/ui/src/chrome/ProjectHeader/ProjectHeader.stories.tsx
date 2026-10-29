import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { Room } from '../../foundations/vocabulary'
import { RunButton, type RunTarget } from '../RunButton/RunButton'
import type { WorkNeed } from '../WorkStatus/WorkStatus'
import { type ProjectPart, ProjectHeader } from './ProjectHeader'

/* Meridian on a Tuesday afternoon: three repositories on GitHub, the Linear issues its tasks name, and two things waiting. */
const openApi = fn()
const PARTS: ProjectPart[] = [
  { id: 'api', name: 'meridian-api', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: openApi },
  { id: 'web', name: 'meridian-web', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'infra', name: 'meridian-infra', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'tracker', name: 'MER issues', brand: Brand.Linear, openLabel: 'Open in Linear', onOpen: fn() },
]

const NEEDS: WorkNeed[] = [
  {
    id: 'replay',
    kind: 'Permission',
    title: 'Run pnpm replay --env staging on last night’s refunds',
    meta: 'Backfill idempotency keys on refunds created before PR 1184',
    at: '4m ago',
    onOpen: fn(),
  },
  { id: '416', kind: 'Ready to accept', title: 'Return 409 when a refund idempotency key is reused', meta: 'api #1191', onOpen: fn() },
]

/* What it runs: its repository's own way, and Storybook beside it. */
const RUNS: RunTarget[] = [
  { id: 'dev', command: 'bun run dev', where: 'main', from: 'repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', where: 'main', from: 'person' },
]

const runIt = fn()
const run = <RunButton targets={RUNS} onRun={runIt} onStop={fn()} onOpen={fn()} onAdd={fn()} onEdit={fn()} />

const meta = {
  title: 'Chrome/ProjectHeader',
  component: ProjectHeader,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'Meridian',
    seed: 'meridian',
    ink: ProjectInk.Teal,
    yours: 2,
    needs: NEEDS,
    onYours: fn(),
    inProgress: 3,
    room: Room.Board,
    onRoom: fn(),
    parts: PARTS,
    run,
  },
} satisfies Meta<typeof ProjectHeader>
export default meta
type Story = StoryObj<typeof meta>

/** Its name as the screen's heading, where it stands in one violet chip, its five views, Run, and ⋯. */
export const Busy: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1, name: 'Meridian' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: '2 need you' })).toBeInTheDocument()
    // What waits is said; what runs is not said again beside it.
    await expect(c.queryByText(/running/)).toBeNull()
    const views = c.getByRole('radiogroup', { name: 'View' })
    await expect(
      within(views)
        .getAllByRole('radio')
        .map((view) => view.textContent),
    ).toEqual(['Home', 'Conversation', 'Board', 'Automations', 'Settings'])
    await expect(within(views).getByRole('radio', { name: 'Board' })).toBeChecked()
  },
}

/** The count opens the first thing that needs you; pointed at, it shows each, and each opens its own. */
export const WhatNeedsYou: Story = {
  play: async ({ args, canvasElement }) => {
    const count = within(canvasElement).getByRole('button', { name: '2 need you' })
    await userEvent.click(count)
    await expect(args.onYours).toHaveBeenCalledOnce()
    await userEvent.hover(count)
    const list = await screen.findByRole('list', { name: 'What needs you' })
    await userEvent.click(within(list).getByRole('button', { name: /Return 409/ }))
    await waitFor(() => expect(NEEDS[1]?.onOpen).toHaveBeenCalledOnce())
  },
}

/** Nothing waits on you while work runs: blue, and how much. */
export const Running: Story = {
  args: { yours: 0 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('3 running')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /need/ })).toBeNull()
  },
}

/** Nothing waits and nothing runs: grey, checked, and said so. */
export const Quiet: Story = {
  args: { yours: 0, inProgress: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nothing running')).toBeInTheDocument()
  },
}

/** Its work not read yet: no chip, rather than one that says nothing runs. */
export const Reading: Story = {
  args: { yours: undefined, inProgress: undefined, needs: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('Nothing running')).toBeNull()
    await expect(c.queryByText(/running|need/)).toBeNull()
    await expect(c.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
  },
}

/** Its views are its faces: picking one goes there; a violet dot where an automation paused itself or a connection waits. */
export const Views: Story = {
  args: { automationsNeedYou: true, settingsNeedYou: true },
  play: async ({ args, canvasElement }) => {
    const views = within(canvasElement).getByRole('radiogroup', { name: 'View' })
    await expect(within(views).getByRole('radio', { name: 'Automations, needs you' })).toBeVisible()
    await userEvent.click(within(views).getByRole('radio', { name: 'Settings, needs you' }))
    await expect(args.onRoom).toHaveBeenCalledWith(Room.Settings)
  },
}

/** ⋯ lists what it is made of, each with its mark, opening where it lives. */
export const MadeOf: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Made of' }))
    const menu = await screen.findByRole('menu', { name: 'Made of' })
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['meridian-apiOpen on GitHub', 'meridian-webOpen on GitHub', 'meridian-infraOpen on GitHub', 'MER issuesOpen in Linear'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: /meridian-api/ }))
    await expect(openApi).toHaveBeenCalledOnce()
  },
}

/** A repository on a host Althar doesn't know: an empty place where its mark would be, listed but not a way anywhere. */
export const UnknownHost: Story = {
  args: {
    parts: [PARTS[0] ?? { id: 'api', name: 'meridian-api' }, { id: 'ops', name: 'meridian-ops' }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Made of' }))
    const menu = await screen.findByRole('menu', { name: 'Made of' })
    await expect(within(menu).getByRole('menuitem', { name: 'meridian-ops' })).toHaveAttribute('aria-disabled', 'true')
  },
}

/** What it runs sits at the end: one press runs its default branch, with no agent; the chevron has the rest. */
export const Runs: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Run' }))
    await expect(runIt).toHaveBeenCalledWith('dev')
  },
}

/** A new project: one repository, nothing running, nothing to run yet. */
export const New: Story = {
  args: {
    name: 'northwind',
    seed: 'northwind',
    ink: ProjectInk.Rose,
    yours: 0,
    inProgress: 0,
    run: undefined,
    parts: [{ id: 'api', name: 'northwind', brand: Brand.GitHub }],
  },
}

/** A long name in a narrow window: the name ends short, and where it stands, its views and Run keep their room. */
export const Crowded: Story = {
  args: { name: 'Payments platform, refunds and partner webhooks (2026 rewrite)' },
  decorators: [(Story) => <div style={{ width: 820 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    const name = within(canvasElement).getByRole('heading', { level: 1 })
    await expect(name).toHaveAttribute('title', 'Payments platform, refunds and partner webhooks (2026 rewrite)')
  },
}
