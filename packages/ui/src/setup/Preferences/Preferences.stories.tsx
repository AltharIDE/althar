import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { KeepAwake, NotificationSettings, type NotifyChoices, OpenFilesIn, SettingList } from './Preferences'

const EDITORS = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'zed', label: 'Zed' },
  { value: 'xcode', label: 'Xcode' },
  { value: 'finder', label: 'Finder' },
]

/* What the stories' play functions look for, as a consumer would hear it. */
const onAwake = fn()
const onNotify = fn()

const ALL_ON: NotifyChoices = { calls: true, ready: true, stopped: true, badge: true, sound: false }

/* The sections as a consumer keeps them: each change shows at once and goes out. */
function General({ onAwake, onEditor }: { onAwake: (on: boolean) => void; onEditor: (editor: string) => void }) {
  const [awake, setAwake] = useState(true)
  const [battery, setBattery] = useState(false)
  const [editor, setEditor] = useState('cursor')
  return (
    <SettingList>
      <KeepAwake
        on={awake}
        onChange={(on) => {
          setAwake(on)
          onAwake(on)
        }}
        onBattery={battery}
        onBatteryChange={setBattery}
      />
      <OpenFilesIn
        editors={EDITORS}
        value={editor}
        onChange={(next) => {
          setEditor(next)
          onEditor(next)
        }}
      />
    </SettingList>
  )
}

function Notifications({ onChange }: { onChange: (key: keyof NotifyChoices, on: boolean) => void }) {
  const [value, setValue] = useState(ALL_ON)
  return (
    <SettingList>
      <NotificationSettings
        value={value}
        onChange={(key, on) => {
          setValue((was) => ({ ...was, [key]: on }))
          onChange(key, on)
        }}
      />
    </SettingList>
  )
}

const meta = {
  title: 'Setup/Preferences',
  component: SettingList,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 416 }}>{Story()}</div>],
  args: { children: null },
} satisfies Meta<typeof SettingList>
export default meta
type Story = StoryObj<typeof meta>

/** Keep awake, and the editor files open in. Turned off, "On battery too" has nothing to add to and rests. */
export const GeneralSettings: Story = {
  render: () => <General onAwake={onAwake} onEditor={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const awake = c.getByRole('switch', { name: 'Keep this Mac awake while work runs' })
    const battery = c.getByRole('switch', { name: 'On battery too' })
    await expect(awake).toHaveAccessibleDescription('Work stops when the Mac sleeps. The display can still sleep.')
    await expect(battery).toBeEnabled()
    await userEvent.click(awake)
    await expect(onAwake).toHaveBeenCalledWith(false)
    await expect(battery).toBeDisabled()
    await expect(c.getByRole('combobox', { name: 'Open files in' })).toHaveTextContent('Cursor')
  },
}

/** What comes as a notification; each switch goes out by its own key. */
export const NotificationChoices: Story = {
  render: () => <Notifications onChange={onNotify} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const ready = c.getByRole('switch', { name: 'A task is ready for you' })
    await userEvent.click(ready)
    await expect(ready).toHaveAttribute('aria-checked', 'false')
    await expect(onNotify).toHaveBeenCalledWith('ready', false)
    await expect(c.getByRole('switch', { name: 'Play a sound' })).toHaveAttribute('aria-checked', 'false')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        {
          state: 'awake, plugged in only',
          node: (
            <SettingList>
              <KeepAwake on onChange={fn()} onBattery={false} onBatteryChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'awake on battery too',
          node: (
            <SettingList>
              <KeepAwake on onChange={fn()} onBattery onBatteryChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'awake off',
          node: (
            <SettingList>
              <KeepAwake on={false} onChange={fn()} onBattery={false} onBatteryChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'no editor chosen',
          node: (
            <SettingList>
              <OpenFilesIn editors={EDITORS} value={null} onChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'notifications as they start',
          node: (
            <SettingList>
              <NotificationSettings value={ALL_ON} onChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'only calls, with sound, no count',
          node: (
            <SettingList>
              <NotificationSettings value={{ calls: true, ready: false, stopped: false, badge: false, sound: true }} onChange={fn()} />
            </SettingList>
          ),
        },
      ]}
    />
  ),
}
