import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { NewProjectDefaults, newProjectDefault, type NewProjectDefaultsValue } from './NewProjectDefaults'

/* The four rows, their choices kept as Settings keeps them. */
function Rows({
  start = newProjectDefault,
  onChange,
}: {
  start?: NewProjectDefaultsValue
  onChange?: (change: Partial<NewProjectDefaultsValue>) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <NewProjectDefaults
      value={value}
      onChange={(change) => {
        onChange?.(change)
        setValue((was) => ({ ...was, ...change }))
      }}
    />
  )
}

const onChange = fn()

/* The open list is drawn over the page, outside the story. */
const page = within(document.body)

const meta = {
  title: 'Setup/NewProjectDefaults',
  component: NewProjectDefaults,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 680 }}>{Story()}</div>],
  args: { value: newProjectDefault, onChange },
} satisfies Meta<typeof NewProjectDefaults>
export default meta
type Story = StoryObj<typeof meta>

/** What a project starts with where nothing was chosen: no way back is offered. */
export const Starting: Story = {
  render: () => <Rows />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Permission requests' })).toHaveTextContent('Allow, except what you keep')
    await expect(c.getByRole('combobox', { name: 'When an account runs out' })).toHaveTextContent('Move to the next agent')
    await expect(c.getByRole('switch', { name: 'Try an agent’s other accounts first' })).not.toBeChecked()
    await expect(c.getByRole('combobox', { name: 'When a task is done' })).toHaveTextContent('Open a draft pull request')
    await expect(c.queryByRole('button', { name: /^Use / })).toBeNull()
  },
}

/** A choice goes out at once, its line says what it does, and the row offers the start back. */
export const Changed: Story = {
  render: () => <Rows onChange={onChange} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('combobox', { name: 'Permission requests' }))
    await userEvent.click(await page.findByRole('option', { name: 'The coordinator decides' }))
    await expect(onChange).toHaveBeenLastCalledWith({ permissions: 'coordinator' })
    await expect(c.getByText(/What it can’t decide waits for you\./)).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Use Allow, except what you keep' }))
    await expect(onChange).toHaveBeenLastCalledWith({ permissions: 'rules' })
  },
}

/** The switch for an agent's other accounts. */
export const OtherAccounts: Story = {
  render: () => <Rows onChange={onChange} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('switch', { name: 'Try an agent’s other accounts first' }))
    await expect(onChange).toHaveBeenLastCalledWith({ rotateAccounts: true })
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'starting values', node: <NewProjectDefaults value={newProjectDefault} onChange={fn()} /> },
        {
          state: 'the coordinator decides, wait for the reset, other accounts first, branch only',
          node: (
            <NewProjectDefaults
              value={{ permissions: 'coordinator', usageLimit: 'wait', rotateAccounts: true, end: 'none' }}
              onChange={fn()}
            />
          ),
        },
        {
          state: 'ask me, ask me, ready for review',
          node: (
            <NewProjectDefaults value={{ permissions: 'ask', usageLimit: 'ask', rotateAccounts: false, end: 'ready' }} onChange={fn()} />
          ),
        },
      ]}
    />
  ),
}
