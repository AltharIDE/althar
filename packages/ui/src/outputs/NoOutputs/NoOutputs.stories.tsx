import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { NoOutputs, type NoOutputsProps } from './NoOutputs'

const LOOKED = [
  'src/lib/backoff.ts',
  'src/lib/http/client.ts',
  'src/checkout/retry.test.ts',
  'src/checkout/payment.ts',
  'src/checkout/index.ts',
  'docs/payments.md',
  'README.md',
]

const AHEAD: NoOutputsProps['ahead'] = [
  { title: 'Changes', note: 'As Claude Opus 5 edits the code, each file shows here.', state: 'now' },
  { title: 'Review', note: 'GPT-6.1 Sol reads the change and says what it finds; Claude Opus 5 settles it.', state: 'next' },
  { title: 'Into main', note: 'You merge it here, or ask for changes.', state: 'next' },
]

const WORKING = {
  title: 'Nothing changed yet',
  note: 'What Claude Opus 5 changes shows here as it goes.',
  working: true,
  looked: LOOKED,
  ahead: AHEAD,
}

const ENDED = {
  title: 'Nothing changed',
  note: 'It ended without changing a file. What it found is in the conversation.',
  working: false,
  looked: LOOKED,
  ahead: [
    { title: 'Changes', note: 'None: it changed no file.', state: 'done' as const },
    { title: 'Review', note: 'Nothing to review.', state: 'done' as const },
  ],
}

const meta = {
  title: 'Outputs/NoOutputs',
  component: NoOutputs,
  args: WORKING,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ display: 'flex', height: 560, background: 'var(--n-2)' }}>{Story()}</div>],
} satisfies Meta<typeof NoOutputs>
export default meta
type Story = StoryObj<typeof meta>

/** Althar's light, drifting while the lead works. */
export const Light: Story = { args: { look: 'light' } }
/** Still, once it ended with nothing changed. */
export const LightEnded: Story = { args: { ...ENDED, look: 'light' } }

/** Where the lead has looked, the latest first. */
export const Trail: Story = {
  args: { look: 'trail' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Looked at 7 files')).toBeVisible()
    await expect(c.getAllByRole('listitem')[0]).toHaveTextContent('backoff.ts')
  },
}
export const TrailEnded: Story = { args: { ...ENDED, look: 'trail' } }
/** The trail, over the light. */
export const Lit: Story = { args: { look: 'lit' } }
/** Nowhere looked yet: only the words. */
export const TrailNothingYet: Story = { args: { look: 'trail', looked: [] } }

/** What fills the page, and which part is under way. */
export const Outline: Story = {
  args: { look: 'outline' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Changes').closest('li')).toHaveAttribute('aria-current', 'step')
  },
}
export const OutlineEnded: Story = { args: { ...ENDED, look: 'outline' } }

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'light, working', node: <NoOutputs {...WORKING} look="light" style={{ height: 420 }} /> },
        { state: 'light, ended', node: <NoOutputs {...ENDED} look="light" style={{ height: 420 }} /> },
        { state: 'trail, working', node: <NoOutputs {...WORKING} look="trail" style={{ height: 420 }} /> },
        { state: 'trail, nothing yet', node: <NoOutputs {...WORKING} looked={[]} look="trail" style={{ height: 420 }} /> },
        { state: 'lit, working', node: <NoOutputs {...WORKING} look="lit" style={{ height: 420 }} /> },
        { state: 'outline, working', node: <NoOutputs {...WORKING} look="outline" style={{ height: 420 }} /> },
        { state: 'outline, ended', node: <NoOutputs {...ENDED} look="outline" style={{ height: 420 }} /> },
      ]}
    />
  ),
}
