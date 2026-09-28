import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MERIDIAN, PROJECTS } from '../../fixtures/chrome'
import { States, statesParameters } from '../../storybook/States'
import { ProjectSwitcher } from './ProjectSwitcher'

const meta = {
  title: 'Chrome/ProjectSwitcher',
  component: ProjectSwitcher,
  args: { current: MERIDIAN, projects: PROJECTS, onPick: fn(), onRename: fn(), onNew: fn() },
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ minHeight: 440 }}>{Story()}</div>)],
} satisfies Meta<typeof ProjectSwitcher>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
/** Open: this project, the others that wait on you first, then the rest. */
export const Open: Story = { args: { defaultOpen: true } }
/** Opened straight into renaming, from a project menu. */
export const Renaming: Story = { args: { defaultOpen: true, renaming: true } }
/** Without Rename and New project, it only switches. */
export const SwitchOnly: Story = { args: { defaultOpen: true, onRename: undefined, onNew: undefined } }

export const Picking: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Meridian/ }))
    await userEvent.click(await page.findByRole('button', { name: /Tessera/ }))
    await expect(args.onPick).toHaveBeenCalledWith('tessera')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
  },
}

/** Finding narrows the list; nothing found says so. */
export const Finding: Story = {
  play: async ({ canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Meridian/ }))
    await userEvent.type(await page.findByRole('textbox', { name: 'Find a project' }), 'fer')
    await expect(page.getByRole('button', { name: /Ferrous/ })).toBeInTheDocument()
    await expect(page.queryByRole('button', { name: /Halyard/ })).toBeNull()
    await userEvent.type(page.getByRole('textbox', { name: 'Find a project' }), 'zzz')
    await expect(page.getByText('No project by that name')).toBeInTheDocument()
  },
}

export const RenamingIt: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(document.body)
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Meridian/ }))
    await userEvent.click(await page.findByRole('button', { name: 'Rename' }))
    const field = page.getByRole('textbox', { name: 'The project’s name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Meridian Payments')
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await expect(args.onRename).toHaveBeenCalledWith('Meridian Payments')
    await expect(page.getByRole('button', { name: 'Rename' })).toHaveFocus()
    await userEvent.click(page.getByRole('button', { name: 'Rename' }))
    await userEvent.keyboard('{Escape}')
    await expect(page.getByRole('button', { name: 'Rename' })).toHaveFocus()
    await userEvent.click(page.getByRole('button', { name: 'New project' }))
    await expect(args.onNew).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States cells={['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <ProjectSwitcher {...args} /> }))} />
  ),
}
