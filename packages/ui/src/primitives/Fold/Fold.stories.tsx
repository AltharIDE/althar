import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Caret, Disclosure, DisclosureTrigger, Fold } from './Fold'
import { States, statesParameters } from '../../storybook/States'

function Example({ initial = false }: { initial?: boolean }) {
  return (
    <Disclosure defaultOpen={initial}>
      <DisclosureTrigger>
        <button type="button" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--t-2)' }}>
          Worked for 12m 40s <Caret />
        </button>
      </DisclosureTrigger>
      <Fold>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--t-2)' }}>
          Read three files, edited the refund router, ran the refund tests. <a href="#x">A link that is only reachable when open</a>.
        </p>
      </Fold>
    </Disclosure>
  )
}

const meta = { title: 'Primitives/Fold', component: Fold, args: { children: null } } satisfies Meta<typeof Fold>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: () => <Example />,
}

/** Opening it eases the content in. */
export const Opening: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const trigger = c.getByRole('button', { name: /Worked for/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(c.queryByRole('link')).toBeNull()
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    /* it eases in: wait for the transition to finish */
    await waitFor(() => expect(c.getByRole('link')).toBeVisible())
  },
}
export const Open: Story = { render: () => <Example initial /> }

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      size="wide"
      cells={[
        ...(['closed', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state,
          force: state === 'closed' ? undefined : state,
          node: <Example />,
        })),
        { state: 'open', node: <Example initial /> },
      ]}
    />
  ),
}
