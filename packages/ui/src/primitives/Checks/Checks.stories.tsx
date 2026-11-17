import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

import { CHECKS_FAILED, CHECKS_HELD, CHECKS_PASSED, CHECKS_RUNNING } from '../../fixtures/outputs'
import { States } from '../../storybook/States'
import { Checks } from './Checks'

const meta = {
  title: 'Primitives/Checks',
  component: Checks,
  args: { checks: CHECKS_RUNNING },
} satisfies Meta<typeof Checks>
export default meta
type Story = StoryObj<typeof meta>

/** As wide as the card it sits in. */
const fill = (node: ReactNode) => <div style={{ flex: 1 }}>{node}</div>

/** Running: one running, one to come, and a review a rule added. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: fill(<Checks checks={CHECKS_RUNNING} />) },
        { state: 'held on you', node: fill(<Checks checks={CHECKS_HELD} />) },
        { state: 'failed', node: fill(<Checks checks={CHECKS_FAILED} />) },
        { state: 'all passed', node: fill(<Checks checks={CHECKS_PASSED} />) },
      ]}
    />
  ),
}
