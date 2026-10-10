import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Button, type ButtonProps } from './Button'

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Open task', variant: 'default', onClick: fn() },
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** Violet is only for answering something that waits on you. */
export const Signal: Story = { args: { variant: 'signal', children: 'Allow', kbd: '↵' } }
export const Quiet: Story = { args: { variant: 'quiet', children: 'Hold' } }
/** Red words, for the one press that ends or throws something away, as a dialog's last word. */
export const Danger: Story = { args: { variant: 'danger', children: 'Remove project' } }
/** Inside a row of a thread or a card, beside 11–12px text. */
export const Small: Story = { args: { size: 'small', children: 'Undo' } }
export const WithIcon: Story = { args: { icon: 'plus', children: 'New task' } }
export const WithTrailingIcon: Story = { args: { trailingIcon: 'arrow', children: 'Open task' } }
export const WithShortcut: Story = { args: { kbd: '↵', children: 'Send' } }
export const Disabled: Story = { args: { disabled: true } }
export const Busy: Story = {
  args: { busy: true, children: 'Starting' },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Starting' })
    await userEvent.click(button)
    await expect(args.onClick).not.toHaveBeenCalled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
  },
}

const every = (props: Partial<ButtonProps>) => [
  { state: 'rest', node: <Button {...props}>{props.children}</Button> },
  { state: 'hover', node: <Button {...props}>{props.children}</Button> },
  { state: 'focus', node: <Button {...props}>{props.children}</Button> },
  { state: 'pressed', node: <Button {...props}>{props.children}</Button> },
  {
    state: 'disabled',
    node: (
      <Button {...props} disabled>
        {props.children}
      </Button>
    ),
  },
  {
    state: 'busy',
    node: (
      <Button {...props} busy>
        {props.children}
      </Button>
    ),
  },
]

/** Every variant, at both sizes, in every state. Hover, focus and pressed are forced. */
export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <States cells={every({ children: 'Open task' })} />
      <States cells={every({ variant: 'signal', children: 'Allow', kbd: '↵' })} />
      <States cells={every({ variant: 'quiet', children: 'Hold' })} />
      <States cells={every({ variant: 'danger', children: 'Remove project' })} />
      <States cells={every({ size: 'small', children: 'Undo' })} />
      <States cells={every({ size: 'small', variant: 'quiet', children: 'Hold' })} />
    </div>
  ),
}
