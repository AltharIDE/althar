import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MERIDIAN_MAP, ONE_REPOSITORY, READING_MAP, ROLES, useSourceMap } from '../../fixtures/setup'
import { PermissionPolicy } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { NewProject, type NewProjectProps } from './NewProject'

const meta = {
  title: 'Setup/NewProject',
  component: NewProject,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 820 }}>{Story()}</div>],
  args: {
    defaultName: 'Refunds v2',
    sources: MERIDIAN_MAP,
    roles: ROLES,
    onRoleChange: fn(),
    onOriginChange: fn(),
    onFindingChange: fn(),
    onRemove: fn(),
    onChooseFolders: fn(),
    onAddUrl: fn(),
    onCreate: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof NewProject>
export default meta
type Story = StoryObj<typeof meta>

/* The form, holding its sources' changes. */
function Live(args: NewProjectProps) {
  const map = useSourceMap(args.sources)
  return (
    <NewProject
      {...args}
      sources={map.sources}
      onRoleChange={map.onRoleChange}
      onOriginChange={map.onOriginChange}
      onFindingChange={map.onFindingChange}
      onRemove={map.onRemove}
      onAddUrl={args.onAddUrl && map.onAddUrl}
    />
  )
}

/** Four repositories, as read, with each finding's decision already made. It can be created as it stands. */
export const Default: Story = { render: (args) => <Live {...args} /> }

/** A project with no repositories, for planning or research. */
export const NoRepositories: Story = { args: { defaultName: '', sources: [] } }

/**
 * Opening one folder that needs nothing decided makes the project at once,
 * named after it. This is what it would have asked, had something needed you.
 */
export const OneRepository: Story = { args: { defaultName: 'Halyard API', sources: ONE_REPOSITORY } }

/** Opening one repository that needs a decision: the form says why it is asking. */
export const OpenedWithAQuestion: Story = {
  render: (args) => <Live {...args} />,
  args: {
    defaultName: 'Meridian web',
    sources: MERIDIAN_MAP.filter((x) => x.id === 'web'),
    because: 'Reading meridian-web found one thing to decide. Nothing else needs you.',
  },
}

/** Create waits while a repository is still being read. */
export const StillReading: Story = { args: { sources: READING_MAP } }

/** Naming it and choosing who answers, then creating it. */
export const Creating: Story = {
  args: { defaultName: '', sources: ONE_REPOSITORY },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const create = c.getByRole('button', { name: 'Create project' })
    await expect(create).toBeDisabled()
    await userEvent.type(c.getByLabelText(/^Name/), '  Halyard  ')
    await userEvent.click(c.getByRole('radio', { name: /Allow everything/ }))
    await userEvent.click(create)
    await expect(args.onCreate).toHaveBeenCalledWith({ name: 'Halyard', permissions: PermissionPolicy.AllowAll })
  },
}

export const Cancelling: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalled()
    await expect(args.onCreate).not.toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'as read', node: <NewProject {...args} /> },
        { state: 'no repositories', node: <NewProject {...args} defaultName="" sources={[]} /> },
        { state: 'still reading', node: <NewProject {...args} sources={READING_MAP} /> },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 440 }}>
              <NewProject {...args} sources={ONE_REPOSITORY} />
            </div>
          ),
        },
      ]}
    />
  ),
}
