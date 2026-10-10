import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SEEDS } from '../../fixtures/marks'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { TaskStatus } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { type ProjectListItem, ProjectList } from './ProjectList'

const INKS = Object.values(ProjectInk)
const ref = (seed: string, i: number) => ({
  seed,
  ink: INKS[i % INKS.length]!,
  name: seed.charAt(0).toUpperCase() + seed.slice(1).replace(/-/g, ' '),
})
const task = (id: string, status?: TaskStatus) => ({ id, ...(status ? { status } : {}) })

/* A few projects: one with calls, two with work in progress, one held, one quiet. */
const FEW: ProjectListItem[] = [
  {
    id: 'meridian',
    project: ref('meridian', 4),
    yours: 2,
    tasks: [task('m1'), task('m2')],
  },
  {
    id: 'halyard',
    project: ref('halyard', 0),
    yours: 0,
    tasks: [task('h1'), task('h2', TaskStatus.Paused)],
  },
  { id: 'tessera', project: ref('tessera', 3), yours: 0, tasks: [task('t1')] },
  { id: 'ferrous', project: ref('ferrous', 1), yours: 0, tasks: [], note: 'Last task 11 days ago' },
]

/* Many: sixteen projects, a dozen with work, the rest quiet and folded. */
const MANY: ProjectListItem[] = SEEDS.map((seed, i) => ({
  id: seed,
  project: ref(seed, i),
  yours: i === 0 ? 3 : i === 2 ? 1 : 0,
  tasks:
    i < 11 ? Array.from({ length: (i % 4) + 1 }, (_, k) => task(`${seed}-${k}`, i === 5 && k === 0 ? TaskStatus.Stopped : undefined)) : [],
  ...(i >= 11 ? { note: 'Last task last week' } : {}),
}))

const meta = {
  title: 'Home/ProjectList',
  component: ProjectList,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 320, height: 560, display: 'flex' }}>{Story()}</div>],
  args: { projects: FEW, onOpenProject: fn(), onOpenFolder: fn() },
} satisfies Meta<typeof ProjectList>
export default meta
type Story = StoryObj<typeof meta>

/** What needs you first, then work in progress as still ticks, then the quiet; under each name, what is off, or how much is in progress. */
export const Few: Story = {}

/** Sixteen projects: the list scrolls, and the quiet ones fold into one line. */
export const Many: Story = { args: { projects: MANY } }

/** A row opens its project, where its tasks are. */
export const OpensProject: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /^Halyard/ }))
    await expect(args.onOpenProject).toHaveBeenCalledWith('halyard')
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      cells={[
        {
          state: 'few',
          node: (
            <div style={{ width: 320, height: 300, display: 'flex' }}>
              <ProjectList {...args} />
            </div>
          ),
        },
        {
          state: 'many',
          node: (
            <div style={{ width: 320, height: 420, display: 'flex' }}>
              <ProjectList {...args} projects={MANY} />
            </div>
          ),
        },
      ]}
    />
  ),
}
