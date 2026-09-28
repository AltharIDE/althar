import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Code } from '../Code/Code'
import { HoverCard } from './HoverCard'
import { States, statesParameters } from '../../storybook/States'

const card = (
  <>
    <span style={{ color: 'var(--t-1)' }}>
      <b style={{ fontWeight: 600 }}>61%</b> of the context used
    </span>
    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--t-3)' }}>122k of 200k tokens</span>
  </>
)

const button = (
  <button type="button" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--n-4)' }}>
    Context
  </button>
)

const meta = {
  title: 'Primitives/HoverCard',
  component: HoverCard,
  args: { card, width: 220, children: button },
  decorators: [
    (Story) => (
      <div style={{ paddingTop: 90 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HoverCard>
export default meta
type Story = StoryObj<typeof meta>

/** Opens on focus as well as on hover; Escape hides it. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.tab()
    await expect(c.getByRole('button', { name: 'Context' })).toHaveFocus()
    await waitFor(() => expect(within(document.body).getByRole('tooltip')).toBeInTheDocument())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull())
  },
}
export const Open: Story = { args: { defaultOpen: true } }
export const Below: Story = {
  args: { defaultOpen: true, placement: 'below' },
  decorators: [
    (Story) => (
      <div style={{ marginTop: -90, minHeight: 120 }}>
        <Story />
      </div>
    ),
  ],
}

/** A citation in running text: where the claim comes from. */
export const Citation: Story = {
  args: {
    width: 260,
    defaultOpen: true,
    card: (
      <>
        <Code>src/refunds/router.ts</Code>
        <span>Lines 88–121, read at the start of this step.</span>
      </>
    ),
    children: <a href="#router">[1]</a>,
  },
  render: (args) => (
    <p style={{ margin: 0, maxWidth: 480, fontSize: 14, lineHeight: 1.62 }}>
      The router retries twice before it gives up <HoverCard {...args} />.
    </p>
  ),
}

/** The trigger at rest, hovered, focused and pressed, and the card open. */
export const AllStates: Story = {
  parameters: statesParameters,
  decorators: [
    (Story) => (
      <div style={{ marginTop: -90, paddingTop: 70 }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <States
      cells={[
        ...(['rest', 'hover', 'focus', 'pressed'] as const).map((state) => ({ state, node: <HoverCard {...args}>{button}</HoverCard> })),
        {
          state: 'open',
          node: (
            <HoverCard {...args} defaultOpen>
              {button}
            </HoverCard>
          ),
        },
      ]}
    />
  ),
}
