import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { ProjectMenu } from './ProjectMenu'

const meta = {
  title: 'Chrome/ProjectMenu',
  component: ProjectMenu,
  args: { repositories: 3, onRename: fn(), onRepositories: fn(), onRules: fn(), onRemove: fn() },
  decorators: [
    (Story, { parameters }) =>
      parameters.pseudo ? (
        Story()
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: 360, minHeight: 220 }}>{Story()}</div>
      ),
  ],
} satisfies Meta<typeof ProjectMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
/** Rename, its repositories with how many, its rules, and removing it, apart. */
export const Open: Story = { args: { defaultOpen: true } }
/** Where only some apply, only those. */
export const RulesOnly: Story = {
  args: { defaultOpen: true, onRename: undefined, onRepositories: undefined, onRemove: undefined },
}
/** With nothing to offer, there is no menu at all. */
export const NothingToDo: Story = {
  args: { onRename: undefined, onRepositories: undefined, onRules: undefined, onRemove: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

export const Renaming: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this project' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }))
    await expect(args.onRename).toHaveBeenCalledOnce()
  },
}

export const Removing: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More for this project' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Remove from Althar' }))
    await expect(args.onRemove).toHaveBeenCalledOnce()
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <ProjectMenu {...args} /> }))} />,
}
