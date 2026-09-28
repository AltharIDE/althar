import type { Meta, StoryObj } from '@storybook/react-vite'

import { CHECKS_FAILED, CHECKS_HELD, CHECKS_PASSED, CHECKS_RUNNING } from '../../fixtures/outputs'
import { States } from '../../storybook/States'
import { Checks } from './Checks'

const meta = {
  title: 'Primitives/Checks',
  component: Checks,
  decorators: [(Story) => <div style={{ maxWidth: 380 }}>{Story()}</div>],
  args: { checks: CHECKS_RUNNING },
} satisfies Meta<typeof Checks>
export default meta
type Story = StoryObj<typeof meta>

/** One running, one to come, and a review a rule added. */
export const Running: Story = {}
export const HeldOnYou: Story = { args: { checks: CHECKS_HELD } }
export const Failed: Story = { args: { checks: CHECKS_FAILED } }
export const AllPassed: Story = { args: { checks: CHECKS_PASSED } }

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: <Checks checks={CHECKS_RUNNING} /> },
        { state: 'held on you', node: <Checks checks={CHECKS_HELD} /> },
        { state: 'failed', node: <Checks checks={CHECKS_FAILED} /> },
        { state: 'all passed', node: <Checks checks={CHECKS_PASSED} /> },
      ]}
    />
  ),
}
