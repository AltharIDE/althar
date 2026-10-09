import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { Select, type SelectProps } from './Select'

const EFFORT = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Max', label: 'Max', disabled: true },
]

function Example(props: Partial<SelectProps<string>>) {
  const [value, setValue] = useState('High')
  return <Select label="Default effort" options={EFFORT} value={value} onChange={setValue} width={104} {...props} />
}

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Default effort', options: EFFORT, value: 'High', onChange: fn(), width: 104 },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 180 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select<string>>
export default meta
type Story = StoryObj<typeof meta>

export const Quiet: Story = {
  render: () => <Example />,
}

/** Choosing from the list. */
export const Choosing: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('combobox', { name: 'Default effort' }))
    await userEvent.click(await page.findByRole('option', { name: 'Low' }))
    /* the rest of the page stays hidden from assistive technology until the list has finished closing */
    await expect(await c.findByRole('combobox', { name: 'Default effort' })).toHaveTextContent('Low')
  },
}
export const Filled: Story = { render: () => <Example variant="filled" width={220} /> }
export const Open: Story = { render: () => <Example defaultOpen /> }

/* A long list: an agent's models. */
const MODELS = [
  'Claude Opus 5.5',
  'Claude Fable 5.1',
  'Claude Sonnet 5.5',
  'Claude Haiku 4.5',
  'Claude Sonnet 5',
  'Claude Opus 5',
  'Claude Fable 5',
  'Claude Opus 4.8',
].map((label) => ({ value: label.toLowerCase().replaceAll(' ', '-'), label }))

function Finding(props: Partial<SelectProps<string>>) {
  const [value, setValue] = useState('claude-opus-5.5')
  return (
    <Select
      label="Claude Code model"
      options={MODELS}
      value={value}
      onChange={setValue}
      variant="filled"
      width={240}
      searchable
      {...props}
    />
  )
}

/** A long list opens with a field to find in it: typing narrows it, arrows move, Return chooses, and a press does too. */
export const Searchable: Story = {
  render: () => <Finding />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    const trigger = c.getByRole('button', { name: 'Claude Code model' })
    await expect(trigger).toHaveTextContent('Claude Opus 5.5')
    await userEvent.click(trigger)
    const find = await page.findByRole('combobox', { name: 'Search' })
    await expect(find).toHaveFocus()
    await expect(page.getByRole('option', { name: 'Claude Opus 5.5' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.type(find, 'sonnet')
    await expect(page.getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}')
    await expect(trigger).toHaveTextContent('Claude Sonnet 5')
    await userEvent.click(trigger)
    await userEvent.type(await page.findByRole('combobox', { name: 'Search' }), 'gpt')
    await expect(page.getByText('Nothing matches')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await userEvent.clear(page.getByRole('combobox', { name: 'Search' }))
    await userEvent.hover(page.getByRole('option', { name: 'Claude Haiku 4.5' }))
    await userEvent.click(page.getByRole('option', { name: 'Claude Haiku 4.5' }))
    await expect(trigger).toHaveTextContent('Claude Haiku 4.5')
  },
}

/** Nothing chosen yet: its placeholder; and one that can't be chosen. */
export const SearchableEmpty: Story = {
  render: () => (
    <Select
      label="Model"
      options={[...MODELS.slice(0, 2), { value: 'gone', label: 'Gone', disabled: true }]}
      value={null}
      onChange={fn()}
      placeholder="Pick a model"
      variant="filled"
      width={240}
      searchable
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await expect(c.getByRole('button', { name: 'Model' })).toHaveTextContent('Pick a model')
    await userEvent.click(c.getByRole('button', { name: 'Model' }))
    await userEvent.click(await page.findByRole('option', { name: 'Gone' }))
    await expect(page.getByRole('option', { name: 'Gone' })).toHaveAttribute('aria-disabled', 'true')
  },
}

const opened = fn()

/** Searchable, it opens as the consumer says, and says when it opens and closes, as the plain one does. */
export const SearchableOpenState: Story = {
  render: () => (
    <Select label="Model" options={MODELS.slice(0, 2)} value={null} onChange={fn()} searchable defaultOpen onOpenChange={opened} />
  ),
  play: async () => {
    const page = within(document.body)
    await expect(await page.findByRole('combobox', { name: 'Search' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect(opened).toHaveBeenLastCalledWith(false)
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      cells={[
        { state: 'rest', node: <Select {...args} /> },
        { state: 'hover', node: <Select {...args} /> },
        { state: 'focus', node: <Select {...args} /> },
        { state: 'pressed', node: <Select {...args} /> },
        { state: 'filled', node: <Select {...args} variant="filled" width={160} /> },
        { state: 'filled, hover', force: 'hover', node: <Select {...args} variant="filled" width={160} /> },
      ]}
    />
  ),
}
