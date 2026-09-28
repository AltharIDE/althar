import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { CopyButton } from './CopyButton'

const ok = () => Promise.resolve()
const refused = () => Promise.reject(new Error('refused'))

const meta = { title: 'Primitives/CopyButton', component: CopyButton, args: { value: 'pnpm test refunds', write: ok } } satisfies Meta<
  typeof CopyButton
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Copying says so, for a moment. */
export const Copying: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(c.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  },
}
/** Icon only, until it has copied. */
export const Ghost: Story = { args: { ghost: true, text: { copy: 'Copy command' } } }
export const Refused: Story = {
  args: { write: refused },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(c.getByRole('button', { name: 'Couldn’t copy' })).toBeInTheDocument())
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <CopyButton value="x" write={ok} /> }))} />
  ),
}
