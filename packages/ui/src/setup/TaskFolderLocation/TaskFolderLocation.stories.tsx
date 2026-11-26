import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SettingList } from '../Preferences/Preferences'
import { TaskFolderLocation, type TaskFolderLocationProps } from './TaskFolderLocation'

const onChange = fn()

/** The row as Settings keeps it: Change picks a folder, and an unusable one is refused in a line. */
function Row(props: Partial<TaskFolderLocationProps>) {
  const [folder, setFolder] = useState('/home/ada/Althar')
  const [refusal, setRefusal] = useState<string | undefined>(props.refusal)
  return (
    <SettingList>
      <TaskFolderLocation
        folder={folder}
        from="default"
        refusal={refusal}
        onChange={() => {
          onChange()
          if (refusal === undefined) setRefusal('That folder is inside a repository; choose one outside any checkout.')
          else {
            setRefusal(undefined)
            setFolder('/data/task-folders')
          }
        }}
        {...props}
      />
    </SettingList>
  )
}

const meta = {
  title: 'Setup/TaskFolderLocation',
  component: TaskFolderLocation,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 760 }}>{Story()}</div>],
  args: { folder: '/home/ada/Althar', from: 'default', onChange },
} satisfies Meta<typeof TaskFolderLocation>
export default meta
type Story = StoryObj<typeof meta>

/** The folder as it stands, what a change leaves alone, and Change. */
export const Default: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('/home/ada/Althar')).toBeVisible()
    await expect(c.getByText(/Folders already made stay where they are/)).toBeVisible()
    await expect(c.getByRole('button', { name: /Change/ })).toBeEnabled()
  },
}

/** A folder Althar won't use is refused in one line, and the folder stays as it was; a good one takes its place. */
export const Refused: Story = {
  render: () => <Row />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Change/ }))
    await expect(c.getByRole('alert')).toHaveTextContent('inside a repository')
    await expect(c.getByText('/home/ada/Althar')).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: /Change/ }))
    await expect(c.getByText('/data/task-folders')).toBeVisible()
  },
}

/** A folder the person chose is gone (a drive not connected): a calm line saying what it stops and the way out, and Use the default as the main action. */
export const Missing: Story = {
  args: {
    folder: '/Volumes/Ext/Althar',
    from: 'setting',
    defaultFolder: '/home/ada/Althar',
    problem:
      'Althar can’t find /Volumes/Ext/Althar, perhaps a drive that isn’t connected, so new tasks are made in /home/ada/Althar for now. Reconnect it, choose another folder, or use the default.',
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/can’t find \/Volumes\/Ext\/Althar/)).toBeVisible()
    await expect(c.queryByRole('alert')).toBeNull()
    await expect(c.getByRole('button', { name: /Use the default/ })).toBeEnabled()
    await expect(c.getByRole('button', { name: /Change/ })).toHaveAccessibleDescription(/can’t find/)
  },
  render: (args) => (
    <SettingList>
      <TaskFolderLocation {...args} onUseDefault={fn()} />
    </SettingList>
  ),
}

/** The folder is gone and the last pick was refused too: both lines show, the lasting one calm and the answer in red. */
export const MissingAndRefused: Story = {
  args: { ...Missing.args, refusal: 'That folder is inside a repository; choose one outside any checkout.' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/can’t find/)).toBeVisible()
    await expect(c.getByRole('alert')).toHaveTextContent('inside a repository')
  },
  render: (args) => (
    <SettingList>
      <TaskFolderLocation {...args} onUseDefault={fn()} />
    </SettingList>
  ),
}

/** The environment sets it: the row says so and Change is off. */
export const SetByEnvironment: Story = {
  args: { folder: '/srv/althar', from: 'environment' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Set by ALTHAR_WORKTREES/)).toBeVisible()
    await expect(c.getByRole('button', { name: /Change/ })).toBeDisabled()
  },
  render: (args) => (
    <SettingList>
      <TaskFolderLocation {...args} />
    </SettingList>
  ),
}
