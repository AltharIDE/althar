import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { States } from '../../storybook/States'
import { SettingGroup, SettingList } from '../Preferences/Preferences'
import { type ContainerChoice, TrackerBinding, type TrackerBindingProps } from './TrackerBinding'

const TRACKERS = [
  { id: 'conn_4', label: 'Linear · Meridian', brand: Brand.Linear },
  { id: 'conn_5', label: 'Linear · Halyard', brand: Brand.Linear },
  { id: 'conn_3', label: 'Jira · northwind.atlassian.net', brand: Brand.Jira },
]
const TEAMS: ContainerChoice[] = [
  { id: 'team-1', label: 'MER (Meridian)' },
  { id: 'team-2', label: 'PLT (Platform)' },
]

const meta = {
  title: 'Setup/TrackerBinding',
  component: TrackerBinding,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: 640 }}>
        <SettingGroup title="Trackers" headingLevel={3}>
          <SettingList>{Story()}</SettingList>
        </SettingGroup>
      </div>
    ),
  ],
  args: {
    trackers: TRACKERS,
    value: null,
    container: null,
    containers: TEAMS,
    onChange: fn(),
    onContainer: fn(),
  },
} satisfies Meta<typeof TrackerBinding>
export default meta
type Story = StoryObj<typeof meta>

/** Unset: the project's issues go where they already are, as Althar learns from them. */
export const Learned: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Issues go to' })).toHaveTextContent('Where its issues are')
    await expect(c.queryByRole('combobox', { name: 'Team' })).toBeNull()
  },
}

/** Bound to one of two Linear workspaces, and a team there. */
export const Bound: Story = {
  args: { value: 'conn_4', container: { id: 'team-1', label: 'MER (Meridian)' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Issues go to' })).toHaveTextContent('Linear · Meridian')
    await expect(c.getByRole('combobox', { name: 'Team' })).toHaveTextContent('MER (Meridian)')
  },
}

/** Bound to a workspace disconnected since: it says so, and stays until connected again or another is chosen. */
export const Gone: Story = {
  args: {
    trackers: [...TRACKERS.slice(1), { id: 'conn_4', label: 'Linear · Meridian (disconnected)', brand: Brand.Linear }],
    value: 'conn_4',
    container: { id: 'team-1', label: 'MER (Meridian)' },
    containers: null,
    gone: true,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('combobox', { name: 'Issues go to' })).toHaveTextContent('Linear · Meridian (disconnected)')
    await expect(c.getByText(/Disconnected\./)).toBeVisible()
    await expect(c.queryByRole('combobox', { name: 'Team' })).toBeNull()
  },
}

/** The binding as the person changes it: a tracker chosen clears where on it. */
function Chosen(args: TrackerBindingProps) {
  const [value, setValue] = useState<string | null>(null)
  const [container, setContainer] = useState<ContainerChoice | null>(null)
  return (
    <TrackerBinding
      {...args}
      value={value}
      container={container}
      onChange={(tracker) => {
        args.onChange(tracker)
        setValue(tracker)
        setContainer(null)
      }}
      onContainer={(picked) => {
        args.onContainer(picked)
        setContainer(picked)
      }}
    />
  )
}

/** Choosing a workspace, then a team on it, as the person does. */
export const Choosing: Story = {
  render: (args) => <Chosen {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(c.getByRole('combobox', { name: 'Issues go to' }))
    await userEvent.click(await body.findByRole('option', { name: 'Linear · Halyard' }))
    await expect(args.onChange).toHaveBeenCalledWith('conn_5')
    await userEvent.click(c.getByRole('combobox', { name: 'Team' }))
    await userEvent.click(await body.findByRole('option', { name: 'PLT (Platform)' }))
    await expect(args.onContainer).toHaveBeenCalledWith({ id: 'team-2', label: 'PLT (Platform)' })
  },
}

/** Its tracker's teams still being read: the one chosen shows, and can't be changed yet. */
export const ReadingTeams: Story = {
  args: { value: 'conn_5', container: { id: 'team-9', label: 'HAL (Halyard)' }, containers: null },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'learned', node: <TrackerBinding {...args} /> },
        {
          state: 'bound, with a team',
          node: <TrackerBinding {...args} value="conn_4" container={{ id: 'team-1', label: 'MER (Meridian)' }} />,
        },
        { state: 'bound, as its issues say', node: <TrackerBinding {...args} value="conn_5" /> },
        {
          state: 'reading its teams',
          node: <TrackerBinding {...args} value="conn_5" container={{ id: 'team-9', label: 'HAL (Halyard)' }} containers={null} />,
        },
      ]}
    />
  ),
}
