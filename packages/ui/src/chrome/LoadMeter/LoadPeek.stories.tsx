import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import {
  LOAD_BUSY,
  LOAD_FIRST_READING,
  LOAD_MEMORY_SHORT,
  LOAD_NEAR_MAX,
  LOAD_NOTHING_RUNNING,
  LOAD_SLOTS,
  LOAD_UNKNOWN_WORK,
} from '../../fixtures/load'
import { States } from '../../storybook/States'
import { LoadPeek } from './LoadPeek'

const meta = {
  title: 'Chrome/LoadPeek',
  component: LoadPeek,
  args: { load: LOAD_BUSY, slots: LOAD_SLOTS, onOpen: fn(), onHide: fn() },
  // As wide as the meter's popover.
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ width: 300 }}>{Story()}</div>)],
} satisfies Meta<typeof LoadPeek>
export default meta
type Story = StoryObj<typeof meta>

/** Four pieces of work, most CPU first, and what the Mac's other apps use. */
export const Busy: Story = {}
/** Every core busy and memory tight. */
export const NearMax: Story = { args: { load: LOAD_NEAR_MAX } }
export const MemoryShort: Story = { args: { load: LOAD_MEMORY_SHORT } }
export const NothingRunning: Story = { args: { load: LOAD_NOTHING_RUNNING } }
/** Just opened: one reading. */
export const FirstReading: Story = { args: { load: LOAD_FIRST_READING } }
/** Where Althar's part can't be known, as on Windows: the Mac's figures alone. */
export const WorkUnknown: Story = { args: { load: LOAD_UNKNOWN_WORK } }
/** Without ways in or out: the rows say, and there is no switch. */
export const WithoutWays: Story = { args: { onOpen: undefined, onHide: undefined } }

/** The figures are words, the bars and the trace decoration: every number is read out. */
export const ReadsItsNumbers: Story = {
  play: async ({ canvasElement }) => {
    const peek = within(canvasElement)
    await expect(peek.getByText('63%')).toBeInTheDocument()
    await expect(peek.getByText('19.5 GB of 32 GB')).toBeInTheDocument()
    await expect(peek.getByText('Althar’s work 54%')).toBeInTheDocument()
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
        { state: 'nothing running', node: <LoadPeek {...args} load={LOAD_NOTHING_RUNNING} /> },
        { state: 'first reading', node: <LoadPeek {...args} load={LOAD_FIRST_READING} /> },
        { state: 'work unknown', node: <LoadPeek {...args} load={LOAD_UNKNOWN_WORK} /> },
        { state: 'without ways', node: <LoadPeek {...args} onOpen={undefined} onHide={undefined} /> },
      ]}
    />
  ),
}
