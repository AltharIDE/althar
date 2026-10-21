import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SettingList } from '../Preferences/Preferences'
import { type FinishedFolder, type FolderWait, type HeldFolder, TaskFolders, type TaskFoldersProps } from './TaskFolders'

const GB = 1024 ** 3

/** This Mac: 460 GB, 429 of them used. */
const DISK = { total: 460 * GB, used: 429 * GB }

const GOES: ReadonlyArray<FinishedFolder> = [
  { id: 't1', title: 'CI on Windows: checks, unit tests and an e2e smoke', kind: 'merged', when: 'today', bytes: 2.4 * GB },
  { id: 't2', title: 'Research: what leads and the coordinator can’t do', kind: 'done', when: 'yesterday', bytes: 2.1 * GB },
  { id: 't3', title: 'Out of usage: say what happened, let me pick another', kind: 'merged', when: '2 days ago', bytes: 2.3 * GB },
  { id: 't4', title: 'Windows: stop an agent’s whole process tree', kind: 'abandoned', when: '5 days ago', bytes: 2.3 * GB },
  { id: 't5', title: 'Review: #301 from ninemate', kind: 'review', when: 'today', bytes: 0.4 * GB },
]

const HELD: ReadonlyArray<HeldFolder> = [
  {
    id: 'h1',
    title: 'Make the coordinator’s notes searchable',
    kind: 'abandoned',
    when: '16 days ago',
    bytes: 2.3 * GB,
    why: 'unpushed',
    count: 4,
  },
  {
    id: 'h2',
    title: 'Prototype: collapsible board lanes',
    kind: 'done',
    when: '9 days ago',
    bytes: 2.3 * GB,
    why: 'uncommitted',
    count: 3,
  },
  { id: 'h3', title: 'Resolve merge conflicts automatically', kind: 'merged', when: '12 days ago', bytes: 2.4 * GB, why: 'running' },
]

const onCleanUp = fn()
const onRemove = fn()
const onOpen = fn()

/** The row in Work on this Mac, its choice kept, as Settings keeps it. */
function Row(props: Partial<TaskFoldersProps>) {
  const [wait, setWait] = useState<FolderWait>(props.wait ?? 'smart')
  return (
    <SettingList>
      <TaskFolders
        wait={wait}
        onWait={setWait}
        disk={DISK}
        goes={GOES}
        held={HELD}
        onCleanUp={onCleanUp}
        onRemove={onRemove}
        onOpen={onOpen}
        {...props}
      />
    </SettingList>
  )
}

const meta = {
  title: 'Setup/TaskFolders',
  component: TaskFolders,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 680 }}>{Story()}</div>],
  args: { wait: 'smart', onWait: fn(), disk: DISK, goes: GOES, held: HELD, onCleanUp, onRemove },
} satisfies Meta<typeof TaskFolders>
export default meta
type Story = StoryObj<typeof meta>

/** Smart, to start: what it does in a line, the disk as a bar, and the legend, which opens the folders. Another choice says its own line. */
export const Smart: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Reviews right away, merged after 3 days/)).toBeVisible()
    await expect(c.getByRole('button', { name: /Can go now 9\.5 GB.*Held back 7\.0 GB/ })).toBeVisible()
    await userEvent.click(c.getByRole('combobox', { name: 'Remove finished tasks’ folders' }))
    await userEvent.click(within(document.body).getByRole('option', { name: 'After a week' }))
    await expect(c.getByText('A week after a task settles. Their branches stay.')).toBeVisible()
  },
}

/** The legend opens the folders: what Clean up takes, then what is held back, each with why; a row opens its task. */
export const Folders: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Can go now/ }))
    const body = within(document.body)
    const goes = await body.findByRole('region', { name: 'Goes with Clean up' })
    await expect(within(goes).getAllByRole('listitem')).toHaveLength(5)
    const held = body.getByRole('region', { name: 'Held back' })
    await expect(within(held).getByText('Never pushed')).toBeVisible()
    await expect(within(held).getByText('Not committed')).toBeVisible()
    // Running has no Remove: it is stopped first.
    await expect(within(held).getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    await userEvent.click(within(goes).getByText('Review: #301 from ninemate'))
    await expect(onOpen).toHaveBeenCalledWith('t5')
  },
}

/** Remove asks first, under the row: what goes with it, in red where work would be lost, or what stays. */
export const RemoveAsksFirst: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Can go now/ }))
    const held = within(await within(document.body).findByRole('region', { name: 'Held back' }))
    await userEvent.click(held.getAllByRole('button', { name: 'Remove' })[1]!)
    const asking = held.getByRole('group', { name: 'Remove: Prototype: collapsible board lanes' })
    await expect(within(asking).getByText('3 changed files go with it.')).toBeVisible()
    await userEvent.click(within(asking).getByRole('button', { name: 'Remove anyway' }))
    await expect(onRemove).toHaveBeenCalledWith('h2')
    await userEvent.click(held.getAllByRole('button', { name: 'Remove' })[0]!)
    await expect(held.getByText('Its 4 commits stay on its branch, on this Mac.')).toBeVisible()
    await userEvent.click(held.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(held.queryByRole('group')).toBeNull())
  },
}

/** Clean up goes at once: nothing it takes is lost for good. */
export const CleanUp: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Clean up' }))
    await expect(onCleanUp).toHaveBeenCalled()
  },
}

/** Just cleaned up: what it freed, measured after; nothing left to clean up but what is held back. */
export const Freed: Story = {
  render: () => <Row goes={[]} freed={8.7 * GB} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Freed 8.7 GB just now')).toBeVisible()
    await expect(c.queryByRole('button', { name: 'Clean up' })).toBeNull()
  },
}

/** Their sizes still being worked out, the first time Settings opens. */
export const Measuring: Story = {
  render: () => <Row goes={[]} held={[]} measuring />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Measuring…')).toBeVisible()
  },
}

/** Only when the person cleans up: nothing goes by itself, and Clean up takes every finished task's folder. */
export const OnlyWhenICleanUp: Story = {
  render: () => <Row wait="never" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nothing goes by itself.')).toBeVisible()
  },
}

/** What went wrong, said under the bar. */
export const Failed: Story = {
  render: () => <Row error="Althar couldn’t remove 1 folder: it is in use." />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Althar couldn’t remove 1 folder: it is in use.')
  },
}

/** The legend open: what Clean up takes, then what is held back, apart. */
export const ListOpen: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Can go now/ }))
    await expect(await within(document.body).findByRole('region', { name: 'Held back' })).toBeVisible()
  },
}

/** Remove on a folder with changes not committed, asking first, in red. */
export const Asking: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Can go now/ }))
    const held = within(await within(document.body).findByRole('region', { name: 'Held back' }))
    await userEvent.click(held.getAllByRole('button', { name: 'Remove' })[1]!)
    await expect(held.getByRole('button', { name: 'Remove anyway' })).toBeVisible()
  },
}
