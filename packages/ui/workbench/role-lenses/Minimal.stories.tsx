import type { Meta, StoryObj } from '@storybook/react-vite'

import { RoleLensesWindow } from './Window'

/*
 * Role lenses, direction A · Minimal (README.md): storefront's home for each lens, a feature's timeline with a handoff
 * waiting on the next role, and the lens switch open. Everything in it can be pressed: the lens chip changes the lens, a
 * handoff opens its feature's timeline. Light and dark from the toolbar.
 */

const meta = {
  title: 'Workbench/Role lenses/A Minimal',
  component: RoleLensesWindow,
  parameters: { layout: 'fullscreen' },
  args: { d: 'a', role: 'engineering', feature: null, menu: false, pinned: [], unpinned: [] },
  argTypes: {
    d: { control: false },
    role: { control: 'inline-radio', options: ['product', 'design', 'engineering', 'devops'] },
    feature: { control: 'select', options: [null, 'saved-carts', 'guest-checkout', 'apple-pay', 'gift-cards', 'refund-webhooks'] },
  },
} satisfies Meta<typeof RoleLensesWindow>
export default meta
type Story = StoryObj<typeof meta>

export const ProductHome: Story = { args: { role: 'product' } }
export const DesignHome: Story = { args: { role: 'design' } }
export const EngineeringHome: Story = { args: { role: 'engineering' } }
export const DevOpsHome: Story = { args: { role: 'devops' } }
/** Saved carts, seen by DevOps: Build is done and its handoff waits on them, with a question sent back to Build. */
export const FeatureTimeline: Story = { args: { role: 'devops', feature: 'saved-carts' } }
/** The lens chip's menu, open on DevOps. */
export const LensSwitch: Story = { args: { role: 'devops', menu: true } }
