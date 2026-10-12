import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Switch, type SwitchProps } from './Switch'

function Kept(args: SwitchProps) {
  const [on, setOn] = useState(args.checked)
  return (
    <Switch
      {...args}
      checked={on}
      onChange={(x) => {
        setOn(x)
        args.onChange(x)
      }}
    />
  )
}

const meta = {
  title: 'Primitives/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
  args: { checked: true, onChange: fn(), label: 'Keep awake' },
} satisfies Meta<typeof Switch>
export default meta
type Story = StoryObj<typeof meta>

/** A press turns it over; so does Space, with focus on it. */
export const Turning: Story = {
  render: (args) => <Kept {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const it = c.getByRole('switch', { name: 'Keep awake' })
    await expect(it).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(it)
    await expect(it).toHaveAttribute('aria-checked', 'false')
    await expect(args.onChange).toHaveBeenCalledWith(false)
    await userEvent.keyboard(' ')
    await expect(it).toHaveAttribute('aria-checked', 'true')
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <States
      cells={[
        { state: 'on', node: <Switch checked onChange={fn()} label="On" /> },
        { state: 'off', node: <Switch checked={false} onChange={fn()} label="Off" /> },
        { state: 'hover', node: <Switch checked={false} onChange={fn()} label="Hover" /> },
        { state: 'focus', node: <Switch checked onChange={fn()} label="Focus" /> },
        { state: 'pressed', node: <Switch checked onChange={fn()} label="Pressed" /> },
        { state: 'disabled', node: <Switch checked disabled onChange={fn()} label="Disabled" /> },
      ]}
    />
  ),
}
