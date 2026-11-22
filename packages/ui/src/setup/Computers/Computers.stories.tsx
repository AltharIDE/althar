import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CLOUD_USE, WORKER_AT_WORK, WORKER_FREE, WORKER_OFFLINE, WORKERS } from '../../fixtures/computers'
import { AGENTS_BUSY, AGENTS_FEWER, LOAD_BUSY, LOAD_MEMORY_SHORT, LOAD_SLOTS } from '../../fixtures/load'
import { AgentsAtOnce, SettingList } from '../Preferences/Preferences'
import { AddWorkerDialog, Computers, type ComputersProps, HOME } from './Computers'

const width = (px: number) => (Story: () => ReactNode) => <div style={{ maxWidth: px }}>{Story()}</div>

const onAdd = fn()
const onRemove = fn()
const onTask = fn()
const onCloud = fn()

/** The home's own Agents at once, as Settings passes it to the home opened out. */
function AtOnce() {
  const [count, setCount] = useState(5)
  return (
    <SettingList>
      <AgentsAtOnce
        count={count}
        machine={{ count: 4, memory: 32, cores: 10 }}
        fewer={{ atOnce: 1, why: 'memory' }}
        onChange={(n) => setCount(n ?? 4)}
      />
    </SettingList>
  )
}

/** Computers as Settings holds it: what is opened out is its own. */
function Held(props: Omit<ComputersProps, 'opened' | 'onOpen'> & { opened?: string | null }) {
  const [opened, setOpened] = useState<string | null>(props.opened ?? null)
  return <Computers {...props} opened={opened} onOpen={setOpened} />
}

const meta = {
  title: 'Setup/Computers',
  component: Held,
  parameters: { layout: 'padded' },
  decorators: [width(900)],
  args: {
    home: { name: 'This Mac', load: LOAD_BUSY, agents: AGENTS_BUSY },
    workers: { enabled: true, list: WORKERS },
    slots: LOAD_SLOTS,
    onAdd,
    onRemove,
    onTask,
    homeSettings: <AtOnce />,
  },
} satisfies Meta<typeof Held>
export default meta
type Story = StoryObj<typeof meta>

/** The home with its readings, as its load popover has them; its workers, at work, free, full and offline. */
export const Default: Story = {}

/** A home with no workers yet: one tile that says what one is and adds one. */
export const NoWorkers: Story = { args: { workers: { enabled: false, list: [] } } }

/** The home short of memory: one at a time for now, and what waits says so. */
export const HomeShortOfMemory: Story = {
  args: { home: { name: 'This Mac', load: LOAD_MEMORY_SHORT, agents: AGENTS_FEWER }, workers: { enabled: true, list: [WORKER_FREE] } },
}

/** Before the first reading: the home and its workers say so, and nothing jumps when they come. */
export const Reading: Story = { args: { home: { name: 'This Mac', load: null, agents: null }, workers: null } }

/** A worker opened out: the task it runs, with a way to it, what it has free, what it is; it can't be taken out while at work. */
export const WorkerAtWork: Story = { args: { opened: WORKER_AT_WORK.id } }

/** Offline, it says so in red, with nothing it has reported. */
export const WorkerOffline: Story = { args: { opened: WORKER_OFFLINE.id } }

/** The home opened out: its readings beside its memory and its workers, then its Agents at once. */
export const HomeOpened: Story = { args: { opened: HOME, home: { name: 'This Mac', load: LOAD_MEMORY_SHORT, agents: AGENTS_FEWER } } }

/** Where the home has Althar Cloud: a line for it under Cloud, this month's spend at its end, opening its own page. */
export const WithAltharCloud: Story = { args: { cloud: CLOUD_USE, onCloud } }

/** As narrow as Settings goes: the workers two to a row, then one. */
export const Narrow: Story = { decorators: [width(460)] }

/** A worker opens out from its module and back; a free one is taken out only once the person says so. */
export const OpensAndRemoves: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Linux worker 98b21d/ }))
    await expect(c.getByRole('heading', { name: 'Linux worker 98b21d' })).toBeInTheDocument()
    await expect(c.getByText('Ready for a task')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Remove Linux worker 98b21d' }))
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Remove Linux worker 98b21d?' })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Remove' }))
    await expect(onRemove).toHaveBeenCalledWith(WORKER_FREE.id)
    await userEvent.click(c.getByRole('button', { name: 'Computers' }))
    await expect(c.getByRole('heading', { name: 'Workers' })).toBeInTheDocument()
  },
}

/** A worker at work keeps its task: Remove waits for it, and its task opens from its sheet. */
export const AtWorkKeepsItsTask: Story = {
  args: { opened: WORKER_AT_WORK.id },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Remove Linux worker 3c3f9a' })).toBeDisabled()
    await expect(c.getByText('You can remove it once its task finishes.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Open its task' }))
    await expect(onTask).toHaveBeenCalledWith('task_418')
  },
}

/** Add a worker: what it takes, and each line to run for it; the first step only where the home takes none yet. */
export const AddAWorker: Story = {
  render: () => <AddWorkerDialog home="This Mac" enabled={false} onClose={fn()} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Add a worker to This Mac' })).toBeInTheDocument()
    await expect(page.getByText('Let this home take workers, then restart Althar.')).toBeInTheDocument()
    await expect(page.getByText(/althar workers enroll/)).toBeInTheDocument()
  },
}
