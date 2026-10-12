import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { NoOutputs } from './NoOutputs'

const LOOKED = [
  'src/lib/backoff.ts',
  'src/lib/http/client.ts',
  'src/checkout/retry.test.ts',
  'src/checkout/payment.ts',
  'src/checkout/index.ts',
  'docs/payments.md',
  'README.md',
]

const WORKING = {
  title: 'Nothing changed yet',
  note: 'What Claude Opus 5 changes shows here as it goes.',
  working: true,
  looked: LOOKED,
}

const ENDED = {
  title: 'Nothing changed',
  note: 'It ended without changing a file. What it found is in the conversation.',
  working: false,
  looked: LOOKED,
}

const MANY = Array.from({ length: 16 }, (_, i) => `src/area-${i}/part-${i}.ts`)

const meta = {
  title: 'Outputs/NoOutputs',
  component: NoOutputs,
  args: WORKING,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ display: 'flex', height: 560, background: 'var(--n-2)' }}>{Story()}</div>],
} satisfies Meta<typeof NoOutputs>
export default meta
type Story = StoryObj<typeof meta>

/** Its lead at work: where it has looked, the latest first, over a drifting light. */
export const Working: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Looked at 7 files')).toBeVisible()
    await expect(c.getAllByRole('listitem')[0]).toHaveTextContent('backoff.ts')
  },
}
/** Ended with nothing changed: the light still. */
export const Ended: Story = { args: ENDED }
/** Nowhere looked yet: only the words. */
export const NothingLookedAt: Story = { args: { looked: [] } }
/** More than it shows: the count says how many in all. */
export const Many: Story = {
  args: { looked: MANY },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Looked at 16 files')).toBeVisible()
    await expect(c.getAllByRole('listitem')).toHaveLength(9)
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'working', node: <NoOutputs {...WORKING} style={{ height: 420 }} /> },
        { state: 'ended', node: <NoOutputs {...ENDED} style={{ height: 420 }} /> },
        { state: 'nothing looked at', node: <NoOutputs {...WORKING} looked={[]} style={{ height: 420 }} /> },
        { state: 'one file', node: <NoOutputs {...WORKING} looked={['README.md']} style={{ height: 420 }} /> },
      ]}
    />
  ),
}
