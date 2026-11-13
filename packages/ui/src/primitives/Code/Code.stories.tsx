import type { Meta, StoryObj } from '@storybook/react-vite'

import { Code } from './Code'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/Code', component: Code, args: { children: 'withPartnerLimit' } } satisfies Meta<typeof Code>
export default meta
type Story = StoryObj<typeof meta>

export const InText: Story = {
  render: (args) => (
    <p style={{ margin: 0, maxWidth: 520, fontSize: 14, lineHeight: 1.62 }}>
      The webhook retry path calls the limiter through <Code {...args}>deliverWithRetry</Code>; reading it now.
    </p>
  ),
}

/** A path too long for its line breaks, its chip on every line. */
export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'short', node: <Code>limit</Code> },
        { state: 'path', node: <Code>src/refunds/router.ts</Code> },
        { state: 'command', node: <Code>pnpm test refunds</Code> },
        {
          state: 'long path, narrow',
          node: (
            <p style={{ margin: 0, width: 220, fontSize: 13, lineHeight: 1.6 }}>
              Moved to <Code>services/refunds-worker/src/limits/partnerBudget.ts</Code> today.
            </p>
          ),
        },
        {
          state: 'on raised',
          node: (
            <span style={{ padding: 6, borderRadius: 6, background: 'var(--n-1)' }}>
              <Code>Retry-After</Code>
            </span>
          ),
        },
      ]}
    />
  ),
}
