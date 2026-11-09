import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States } from '../../storybook/States'
import { NewProjectDefaults, newProjectDefault, type NewProjectDefaultsValue } from './NewProjectDefaults'

/* The rows, their choices kept as Settings keeps them. */
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
    await expect(c.getByRole('combobox', { name: 'When a task is done' })).toHaveTextContent('Open a draft pull request')
    await expect(c.getByRole('switch', { name: 'Push the lead’s commits automatically' })).toBeChecked()
    await expect(c.getByRole('switch', { name: 'Post screenshots to pull requests automatically' })).not.toBeChecked()
    await expect(c.getByRole('switch', { name: 'Resolve merge conflicts automatically' })).toBeChecked()
    await expect(c.getByRole('switch', { name: 'Move issues along with their tasks' })).toBeChecked()
    await expect(c.getByRole('combobox', { name: 'When an account runs out' })).toHaveTextContent(
      'Move to the strongest model with usage left',
    )
    await expect(c.getByRole('switch', { name: 'Try an agent’s other accounts first' })).not.toBeChecked()
    await expect(c.queryByRole('button', { name: /^Use / })).toBeNull()
  },
}

/** A choice goes out at once, its line says what it does, and the row offers the start back. */
export const Changed: Story = {
  render: () => <Rows onChange={onChange} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('combobox', { name: 'When a task is done' }))
    await userEvent.click(await page.findByRole('option', { name: 'Push the branch only' }))
    await expect(onChange).toHaveBeenLastCalledWith({ end: 'none' })
    await expect(c.getByText(/You open the pull request when you want one\./)).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Use Open a draft pull request' }))
    await expect(onChange).toHaveBeenLastCalledWith({ end: 'draft' })
  },
}

/** Each switch goes out at once. */
export const Switches: Story = {
  render: () => <Rows onChange={onChange} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('switch', { name: 'Post screenshots to pull requests automatically' }))
    await expect(onChange).toHaveBeenLastCalledWith({ postScreenshots: true })
    await userEvent.click(c.getByRole('switch', { name: 'Try an agent’s other accounts first' }))
    await expect(onChange).toHaveBeenLastCalledWith({ rotateAccounts: true })
  },
}

/** Where a project's own value is another: under the row's line, who has what, and the way to bring them in line. */
export const WhereProjectsDiffer: Story = {
  render: () => (
    <NewProjectDefaults
      value={newProjectDefault}
      onChange={fn()}
      differs={{
        end: (
          <span>
            fnt: Open a pull request for review · <LinkButton onClick={fn()}>Use this in every project</LinkButton>
          </span>
        ),
        postScreenshots: (
          <span>
            fnt: On · <LinkButton onClick={fn()}>Use this in every project</LinkButton>
          </span>
        ),
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('button', { name: 'Use this in every project' })).toHaveLength(2)
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'starting values', node: <NewProjectDefaults value={newProjectDefault} onChange={fn()} /> },
        {
          state: 'branch only, nothing pushed, screenshots posted, no conflicts or issues, wait for the reset, other accounts first',
          node: (
            <NewProjectDefaults
              value={{
                end: 'none',
                pushCommits: false,
                postScreenshots: true,
                resolveConflicts: false,
                moveIssues: false,
                usageLimit: 'wait',
                rotateAccounts: true,
              }}
              onChange={fn()}
            />
          ),
        },
        {
          state: 'ready for review, ask me',
          node: <NewProjectDefaults value={{ ...newProjectDefault, end: 'ready', usageLimit: 'ask' }} onChange={fn()} />,
        },
      ]}
    />
  ),
}
