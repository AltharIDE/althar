import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  AGENTS_BUSY,
  AGENTS_FEWER,
  AGENTS_FEWER_CPU,
  AGENTS_IDLE,
  LOAD_BUSY,
  LOAD_FIRST_READING,
  LOAD_MEMORY_SHORT,
  LOAD_NEAR_MAX,
  LOAD_NOTHING_RUNNING,
  LOAD_SLOTS,
  LOAD_UNKNOWN_WORK,
} from '../../fixtures/load'
import { LOAD_WORKERS } from '../../fixtures/computers'
import { States } from '../../storybook/States'
import { LoadPeek } from './LoadPeek'

const meta = {
  title: 'Chrome/LoadPeek',
  component: LoadPeek,
  args: { load: LOAD_BUSY, agents: AGENTS_BUSY, slots: LOAD_SLOTS, onOpen: fn(), onHide: fn() },
  // As wide as the meter's popover.
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ width: 300 }}>{Story()}</div>)],
} satisfies Meta<typeof LoadPeek>
export default meta
type Story = StoryObj<typeof meta>

/** Four pieces of work, most CPU first, and what the Mac's other apps use. */
export const Busy: Story = {}
/** Every core busy and memory tight. */
export const NearMax: Story = { args: { load: LOAD_NEAR_MAX } }
/** Memory short: fewer agents may work for now than the person's number, until it frees up, and what waits says so. */
export const MemoryShort: Story = { args: { load: LOAD_MEMORY_SHORT, agents: AGENTS_FEWER } }
/** The CPU busy for a while: fewer for now, for the CPU. */
export const FewerForTheCpu: Story = { args: { load: LOAD_NEAR_MAX, agents: AGENTS_FEWER_CPU } }
export const NothingRunning: Story = { args: { load: LOAD_NOTHING_RUNNING, agents: AGENTS_IDLE } }
/**
 * A home with workers: each under the home's readings, where it stands; a row opens it in Settings › Computers. The
 * agents' number counts those on its workers too, and says how many run there.
 */
export const WithWorkers: Story = {
  args: { workers: LOAD_WORKERS, onWorker: fn(), agents: { ...AGENTS_BUSY, onWorkers: 1 } },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('1 more on a worker')).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'Workers' })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'Running on This Mac' })).toBeInTheDocument()
    await expect(c.getByText('Offline')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Linux worker 98b21d/ }))
    await expect(args.onWorker).toHaveBeenCalledWith(LOAD_WORKERS[1]?.id)
  },
}
/** Where its agents can't be read, as from a home on an older Althar: CPU and memory alone. */
export const AgentsUnknown: Story = { args: { agents: null } }
/** Just opened: one reading. */
export const FirstReading: Story = { args: { load: LOAD_FIRST_READING } }
/** A trace that begins part way, after a gap: it starts at a dot, with nothing drawn before it. */
export const TraceBeginsPartWay: Story = { args: { load: { ...LOAD_BUSY, history: LOAD_BUSY.history.slice(-12) } } }
/** Where Althar's part can't be known, as on Windows: the Mac's figures alone. */
export const WorkUnknown: Story = { args: { load: LOAD_UNKNOWN_WORK } }
/** Without ways in or out: the rows say, and there is no switch. */
export const WithoutWays: Story = { args: { onOpen: undefined, onHide: undefined } }

/** Fewer for now says how many, and until when; what waits for them is counted under it. */
export const SaysFewerForNow: Story = {
  args: { load: LOAD_MEMORY_SHORT, agents: AGENTS_FEWER },
  play: async ({ canvasElement }) => {
    const peek = within(canvasElement)
    await expect(peek.getByText('2 of 5')).toBeInTheDocument()
    await expect(peek.getByText('1 at a time until memory frees up')).toBeInTheDocument()
    await expect(peek.getByText('2 tasks waiting')).toBeInTheDocument()
  },
}

/** The figures are words, the bars and the trace decoration: every number is read out. */
export const ReadsItsNumbers: Story = {
  play: async ({ canvasElement }) => {
    const peek = within(canvasElement)
    await expect(peek.getByText('63%')).toBeInTheDocument()
    await expect(peek.getByText('19.5 GB of 32 GB')).toBeInTheDocument()
    await expect(peek.getByText('Althar’s work 54%')).toBeInTheDocument()
    await expect(peek.getByText('Agents')).toBeInTheDocument()
    await expect(peek.getByText('3 of 4')).toBeInTheDocument()
    await expect(peek.getByRole('heading', { name: 'Running' })).toBeInTheDocument()
    await expect(peek.getByRole('button', { name: /Coordinator.*Meridian · Claude Code · 4 processes.*5%.*0\.8 GB/ })).toBeInTheDocument()
    // Althar itself, in its part, with nothing to open.
    await expect(peek.getByText('Althar')).toBeInTheDocument()
    await expect(peek.getByText('9 processes')).toBeInTheDocument()
    await expect(peek.queryByRole('button', { name: /^Althar/ })).toBeNull()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'busy', node: <LoadPeek {...args} /> },
        { state: 'near max', node: <LoadPeek {...args} load={LOAD_NEAR_MAX} /> },
        { state: 'fewer for now, memory', node: <LoadPeek {...args} load={LOAD_MEMORY_SHORT} agents={AGENTS_FEWER} /> },
        { state: 'fewer for now, CPU', node: <LoadPeek {...args} load={LOAD_NEAR_MAX} agents={AGENTS_FEWER_CPU} /> },
        { state: 'nothing running', node: <LoadPeek {...args} load={LOAD_NOTHING_RUNNING} agents={AGENTS_IDLE} /> },
        { state: 'agents unknown', node: <LoadPeek {...args} agents={null} /> },
        { state: 'first reading', node: <LoadPeek {...args} load={LOAD_FIRST_READING} /> },
        { state: 'trace begins part way', node: <LoadPeek {...args} load={{ ...LOAD_BUSY, history: LOAD_BUSY.history.slice(-12) }} /> },
        { state: 'work unknown', node: <LoadPeek {...args} load={LOAD_UNKNOWN_WORK} /> },
        { state: 'without ways', node: <LoadPeek {...args} onOpen={undefined} onHide={undefined} /> },
      ]}
    />
  ),
}
