import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BranchSelect, branchNameable, type BranchSelectProps } from './BranchSelect'

const BRANCHES = ['main', 'release/0.8.0', 'release/0.7.x', 'feature/onboarding', 'fix/checkout-retry'] as const

function Example({ onCreate, ...props }: Partial<BranchSelectProps>) {
  const [value, setValue] = useState(props.value ?? 'main')
  const [branches, setBranches] = useState<readonly string[]>(BRANCHES)
  return (
    <BranchSelect
      label="Work toward"
      branches={branches}
      defaultBranch="main"
      onChange={setValue}
      onCreate={(name) => {
        onCreate?.(name)
        setBranches((was) => [...was, name])
        setValue(name)
      }}
      {...props}
      value={value}
    />
  )
}

const meta = {
  title: 'Primitives/BranchSelect',
  component: BranchSelect,
  args: { label: 'Work toward', value: 'main', branches: BRANCHES, defaultBranch: 'main', onChange: fn() },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BranchSelect>
export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = { render: () => <Example variant="filled" value="release/0.8.0" /> }
/** Open, with a line under the list on what picking one changes. */
export const Open: Story = {
  render: () => <Example defaultOpen note="New tasks start from it. Tasks already made keep theirs." />,
}
/** Typing finds a branch by any part of its name; the arrows move, Enter picks. */
export const Finding: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    const trigger = c.getByRole('button', { name: 'Work toward: main' })
    await userEvent.click(trigger)
    const find = await page.findByRole('combobox', { name: 'Find or name a branch' })
    await expect(find).toHaveFocus()
    await expect(page.getByRole('option', { name: /main/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.type(find, 'release')
    // The two it has, then the name typed, to make.
    await expect(page.getAllByRole('option').map((one) => one.textContent)).toEqual([
      'release/0.8.0',
      'release/0.7.x',
      'Create release from main',
    ])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(c.getByRole('button', { name: 'Work toward: release/0.7.x' })).toBeInTheDocument()
  },
}

/** A name it doesn't have is offered last, made from the default branch; one git wouldn't take says why, and can't be picked. */
export const Creating: Story = {
  args: { onCreate: fn() },
  render: (args) => <Example onCreate={args.onCreate} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Work toward: main' }))
    const find = await page.findByRole('combobox', { name: 'Find or name a branch' })
    await userEvent.type(find, 'my branch')
    await expect(page.getByRole('option', { name: /can’t have spaces/ })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(args.onCreate).not.toHaveBeenCalled()
    await userEvent.clear(find)
    await userEvent.type(find, 'release/0.9.0')
    await expect(page.getByRole('option', { name: 'Create release/0.9.0 from main' })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCreate).toHaveBeenCalledWith('release/0.9.0')
    await expect(c.getByRole('button', { name: 'Work toward: release/0.9.0' })).toBeInTheDocument()
  },
}

/** Without a way to make one, a name it doesn't have finds nothing. */
export const OnlyListed: Story = {
  render: () => <BranchSelect label="Works toward" value="main" branches={BRANCHES} defaultBranch="main" onChange={fn()} defaultOpen />,
  play: async () => {
    const page = within(document.body)
    await userEvent.type(await page.findByRole('combobox', { name: 'Find or name a branch' }), 'release/0.9.0')
    await expect(page.getByText('No branch called “release/0.9.0”')).toBeInTheDocument()
    await expect(page.queryByRole('option')).toBeNull()
  },
}

/** The names git takes, near enough for a list. */
export const Names: Story = {
  render: () => <Example />,
  play: async () => {
    for (const name of ['release/0.9.0', 'fix/a.b', 'v1']) await expect(branchNameable(name)).toBe(true)
    for (const name of ['my branch', 'release/', 'a..b', '-x', '.x', 'x.lock', 'HEAD', 'a@{1}'])
      await expect(branchNameable(name)).toBe(false)
  },
}
