import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { Button } from '../../primitives/Button/Button'
import { States } from '../../storybook/States'
import type { WorkNeed } from '../WorkStatus/WorkStatus'
import { type ProjectPart, ProjectFront } from './ProjectFront'

/* Meridian on a Tuesday afternoon: three repositories on GitHub, the Linear issues its tasks name, and two things waiting. */
const PARTS: ProjectPart[] = [
  { id: 'api', name: 'meridian-api', brand: Brand.GitHub },
  { id: 'web', name: 'meridian-web', brand: Brand.GitHub },
  { id: 'infra', name: 'meridian-infra', brand: Brand.GitHub },
  { id: 'tracker', name: 'MER issues', brand: Brand.Linear },
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

/* The way to its settings, as the app puts it there. */
const SETTINGS = (
  <Button size="small" variant="quiet" icon="gear">
    Settings
  </Button>
)

const meta = {
  title: 'Chrome/ProjectFront',
  component: ProjectFront,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'Meridian',
    seed: 'meridian',
    ink: ProjectInk.Teal,
    yours: 2,
    needs: NEEDS,
    onYours: fn(),
    inProgress: 3,
    last: 'PR 1184 merged 3h ago',
    parts: PARTS,
    settings: SETTINGS,
  },
} satisfies Meta<typeof ProjectFront>
export default meta
type Story = StoryObj<typeof meta>

/** How the project stands in a line, what it is made of under it, and its settings at the end. */
export const Standing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { level: 1, name: 'Meridian' })).toBeInTheDocument()
    await expect(c.getByText('3 in progress')).toBeInTheDocument()
    const made = c.getByRole('list', { name: 'Made of' })
    await expect(
      within(made)
        .getAllByRole('listitem')
        .map((part) => part.textContent),
    ).toEqual(['meridian-api', 'meridian-web', 'meridian-infra', 'MER issues'])
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

/** Nothing needs you and nothing is in progress: only what settled last. */
export const Quiet: Story = {
  args: { yours: 0, inProgress: 0 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /need/ })).toBeNull()
    await expect(c.queryByText(/in progress/)).toBeNull()
    await expect(c.getByText('PR 1184 merged 3h ago')).toBeInTheDocument()
  },
}

/** A new project: its name and its one repository, nothing to say yet of how it stands. */
export const New: Story = {
  args: {
    name: 'northwind',
    seed: 'northwind',
    ink: ProjectInk.Rose,
    yours: 0,
    inProgress: 0,
    last: undefined,
    parts: [PARTS[0] ?? { id: 'api', name: 'api' }],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('p')).toBeNull()
  },
}

/** A repository on a host Althar doesn't know: an empty place where its mark would be. */
export const UnknownHost: Story = {
  args: {
    parts: [
      { id: 'api', name: 'meridian-api', brand: Brand.GitHub },
      { id: 'ops', name: 'meridian-ops' },
    ],
  },
}

/** A long name and many repositories, in a narrow window: the name ends short, and what it is made of wraps. */
export const Crowded: Story = {
  args: {
    name: 'Payments platform, refunds and partner webhooks (2026 rewrite)',
    parts: [
      ...PARTS.slice(0, 3),
      { id: 'mobile', name: 'meridian-mobile', brand: Brand.GitHub },
      { id: 'docs', name: 'meridian-docs', brand: Brand.GitHub },
      { id: 'ops', name: 'meridian-ops', brand: Brand.GitLab },
      PARTS[3] ?? { id: 'tracker', name: 'MER issues' },
    ],
  },
  decorators: [(Story) => <div style={{ width: 640 }}>{Story()}</div>],
}

/** In each ink, the wash follows the mark. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'standing', node: <ProjectFront {...args} /> },
        { state: 'quiet', node: <ProjectFront {...args} yours={0} inProgress={0} /> },
        ...[ProjectInk.Clay, ProjectInk.Moss, ProjectInk.Slate, ProjectInk.Umber].map((ink) => ({
          state: ink,
          node: <ProjectFront {...args} ink={ink} seed={ink} name={ink[0]?.toUpperCase() + ink.slice(1)} />,
        })),
      ]}
    />
  ),
}
