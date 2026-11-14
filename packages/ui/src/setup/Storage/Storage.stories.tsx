import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type StoragePlaceRow, Storage, storageSize } from './Storage'

const MB = 1024 ** 2
const GB = 1024 ** 3

const places = (figures: Partial<Record<string, StoragePlaceRow['figure']>> = {}): ReadonlyArray<StoragePlaceRow> => [
  {
    id: 'profile',
    title: 'Profile',
    note: 'Projects, tasks and settings. ',
    path: '/home/me/.local/share/althar',
    figure: figures.profile ?? { state: 'done', bytes: 184 * MB },
  },
  {
    id: 'logs',
    title: 'Logs',
    note: 'What Althar writes as it runs. ',
    path: '/home/me/.local/share/althar/logs',
    figure: figures.logs ?? { state: 'done', bytes: 12.4 * MB },
  },
  {
    id: 'worktrees',
    title: 'Task folders',
    note: 'A copy of each project for each task. ',
    path: '/home/me/Althar',
    figure: figures.worktrees ?? { state: 'done', bytes: 23.6 * GB },
  },
]

const meta = {
  title: 'Setup/Storage',
  component: Storage,
  args: { places: places(), onShow: fn(), onMeasureAgain: fn() },
  render: (args) => (
    <div style={{ width: 640 }}>
      <Storage {...args} />
    </div>
  ),
} satisfies Meta<typeof Storage>
export default meta
type Story = StoryObj<typeof meta>

/** Three places, each with its path, its size and a button to show it in the file manager. */
export const WithSizes: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.getByText('24 GB')).toBeInTheDocument()
    await userEvent.click(
      view.getByRole('button', {
        name: 'Show in Files, Task folders',
      }),
    )
    await expect(args.onShow).toHaveBeenCalledWith('worktrees')
  },
}

/** Sizes still being worked out: task folders can take a while, and Measure again waits. */
export const Measuring: Story = {
  args: {
    places: places({
      profile: { state: 'measuring' },
      logs: { state: 'done', bytes: 12 * MB },
      worktrees: { state: 'measuring' },
    }),
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getAllByText('measuring…')).toHaveLength(2)
    await expect(view.getByRole('button', { name: 'Measure again' })).toBeDisabled()
  },
}

/** The walk ran out of time: what it counted so far, said to be a lower bound. */
export const Approximate: Story = {
  args: {
    places: places({
      worktrees: { state: 'done', bytes: 41 * GB, approximate: true },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('at least 41 GB')).toBeInTheDocument()
  },
}

/** Some entries couldn't be read: the size is a lower bound, and the count of what was left out shows under it. */
export const Unreadable: Story = {
  args: {
    places: places({
      worktrees: { state: 'done', bytes: 12 * GB, unreadable: 3 },
    }),
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getByText('at least 12 GB')).toBeInTheDocument()
    await expect(view.getByText('3 items couldn’t be read')).toBeInTheDocument()
  },
}

/** A folder that isn't there yet, such as task folders before the first task: no size, and nothing to show. */
export const MissingFolder: Story = {
  args: {
    places: places({
      worktrees: { state: 'missing' },
      logs: { state: 'failed' },
    }),
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getByText('not there yet')).toBeInTheDocument()
    await expect(view.getByText('couldn’t be measured')).toBeInTheDocument()
    await expect(
      view.getByRole('button', {
        name: 'Show in Files, Task folders',
      }),
    ).toBeDisabled()
  },
}

/** Measure again takes the figures anew. */
export const MeasureAgain: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Measure again' }))
    await expect(args.onMeasureAgain).toHaveBeenCalledOnce()
  },
}

export const Sizes: Story = {
  render: () => <p>{[0, 900, 5 * 1024, 640 * MB, 2.3 * GB, 14 * GB].map(storageSize).join(' · ')}</p>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('0 B · 900 B · 5 KB · 640 MB · 2.3 GB · 14 GB')).toBeInTheDocument()
  },
}

/** Show failed, as where no file manager opens: the row says why, and the path stays there to copy. */
export const ShowFailed: Story = {
  args: {
    places: places().map((place) => (place.id === 'logs' ? { ...place, problem: 'No application is registered to open folders' } : place)),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'Couldn’t open it: No application is registered to open folders',
    )
  },
}
