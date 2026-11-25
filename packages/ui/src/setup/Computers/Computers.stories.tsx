import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { CLOUD_USE, WORKER_AT_WORK, WORKER_FREE, WORKER_OFFLINE, WORKERS } from '../../fixtures/computers'
import { AGENTS_BUSY, AGENTS_FEWER, LOAD_BUSY, LOAD_MEMORY_SHORT, LOAD_SLOTS } from '../../fixtures/load'
import { AgentsAtOnce, SettingList } from '../Preferences/Preferences'
import { AddWorkerByHandDialog, Computers, type ComputersProps, HOME } from './Computers'

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

/**
 * Gone offline during a task: it holds that task's workspace until it reconnects and says the work stopped, so Remove
 * waits for that, and says how to get there.
 */
export const OfflineDuringATask: Story = {
  args: {
    opened: WORKER_AT_WORK.id,
    workers: {
      enabled: true,
      list: [{ ...WORKER_AT_WORK, state: 'offline', stranded: true, memoryFree: null, diskFree: null, kind: null }],
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Went offline during Repair token refresh on privilege change')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Remove Linux worker 3c3f9a' })).toBeDisabled()
    await expect(c.getByText(/Start it again so it can stop that work/)).toBeInTheDocument()
  },
}

/** A window on a device paired over the network can't take workers out: Remove says who can. */
export const OnAPairedDevice: Story = {
  args: { opened: WORKER_FREE.id, canRemove: false, home: { name: 'studio', load: LOAD_BUSY, agents: AGENTS_BUSY } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Remove Linux worker 98b21d' })).toBeDisabled()
    await expect(
      c.getByText('From a paired device, this window can’t remove workers. A window on studio itself, or over SSH, can.'),
    ).toBeInTheDocument()
  },
}

/**
 * Add a worker to a home that takes workers only by its operator's certificates: what it takes, and each line to run
 * for it, the worker left running with its agents; the first step only where the home takes none yet.
 */
export const AddAWorkerByHand: Story = {
  render: () => <AddWorkerByHandDialog home="This Mac" enabled={false} onClose={fn()} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Add a worker to This Mac' })).toBeInTheDocument()
    await expect(page.getByText('Let this home take workers, then restart Althar.')).toBeInTheDocument()
    await expect(page.getByText(/althar workers enroll/)).toBeInTheDocument()
    await expect(page.getByText(/agents\.conf --watch$/)).toBeInTheDocument()
  },
}

/** On a Linux home of its own: set up there with althar-host. */
export const AddAWorkerByHandToALinuxHome: Story = {
  render: () => <AddWorkerByHandDialog home="studio" enabled={false} standalone onClose={fn()} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await expect(page.getByRole('dialog', { name: 'Add a worker to studio' })).toBeInTheDocument()
    // Bound where a worker on another computer reaches it, and the home's ID read from its status: enrolling gives only the worker's.
    await expect(page.getByText(/althar-host configure-workers --listen-address <private-ip>/)).toBeInTheDocument()
    await expect(page.getByText(/althar-host enroll-worker .* && althar-host status --wait --json$/)).toBeInTheDocument()
    await expect(page.getByText(/at a name the home’s certificate covers/)).toBeInTheDocument()
    await expect(page.queryByText(/althar workers/)).toBeNull()
  },
}

const PROJECTS = [
  { id: 'proj_meridian', name: 'meridian' },
  { id: 'proj_ledger', name: 'ledger-api' },
  { id: 'proj_site', name: 'site' },
]
/** A worker its home set up, just added: connected, its agents from its release, one signed in; no project yet. */
const ADDED = {
  ...WORKER_FREE,
  id: 'wrk_build_box',
  name: 'build-box',
  managed: true,
  reachable: true,
  projects: [],
  projectIds: [],
  agents: [
    { id: 'claude-code', name: 'Claude Code', mark: Brand.ClaudeCode, signedIn: true },
    { id: 'codex', name: 'Codex', mark: Brand.Codex, signedIn: false },
  ],
}

/** A worker just added: its projects picked here, none yet, and its agents each signed in or not, with Sign in. */
export const WorkerJustAdded: Story = {
  args: {
    opened: ADDED.id,
    workers: { enabled: true, list: [ADDED] },
    allProjects: PROJECTS,
    onProjects: fn(),
    onSignIn: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Pick the projects it works on/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('checkbox', { name: 'meridian' }))
    await expect(args.onProjects).toHaveBeenCalledWith(ADDED.id, ['proj_meridian'])
    await expect(c.getByText('Signed in')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith(ADDED.id, 'codex')
  },
}

/** Its agent signing in, with a one-time code to enter on the provider's page. */
export const WorkerSigningIn: Story = {
  args: {
    opened: ADDED.id,
    workers: { enabled: true, list: [{ ...ADDED, projects: ['meridian'], projectIds: ['proj_meridian'] }] },
    allProjects: PROJECTS,
    onProjects: fn(),
    onSignIn: fn(),
    onCancelSignIn: fn(),
    onOpenLink: fn(),
    signingIn: {
      workerId: ADDED.id,
      agent: 'codex',
      step: { kind: 'code', code: 'K7QF-2MXD', page: 'https://auth.openai.com/codex/device' },
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('K7QF-2MXD')).toBeInTheDocument()
    await expect(c.getByText('Enter this code at auth.openai.com/codex/device')).toBeInTheDocument()
  },
}
