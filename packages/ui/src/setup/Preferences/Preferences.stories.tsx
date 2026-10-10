import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Logo } from '../../foundations/Logo/Logo'
import { States } from '../../storybook/States'
import {
  EdgePlaces,
  EdgeScene,
  KeepAwake,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  SettingList,
} from './Preferences'

const EDITORS = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'zed', label: 'Zed' },
  { value: 'xcode', label: 'Xcode' },
  { value: 'finder', label: 'Finder' },
]

const SOUNDS = ['Basso', 'Blow', 'Glass', 'Ping', 'Pop', 'Purr', 'Tink']

const ALL_ON: NotifyChoices = { calls: true, ready: true, stopped: true, badge: true }

/* What the stories' play functions look for, as a consumer would hear it. */
const onAwake = fn()
const onNotify = fn()
const onPlay = fn()
const onPlace = fn()

/* Stand-ins for what the app puts in the screen: the home layer's Island and EdgeSheet can't be drawn from here. */
const island = (
  <div style={{ width: 470, padding: '6px 14px 14px', borderRadius: '0 0 22px 22px', background: '#000', color: '#fff', fontSize: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', height: 20, alignItems: 'center' }}>
      <Logo size={13} />
      <span>2 need you</span>
    </div>
    <div style={{ display: 'grid', gap: 8, marginTop: 12, opacity: 0.85 }}>
      <span>Meridian · Publish to npm asks to run npm publish</span>
      <span>Halyard · Retry the checkout call is ready</span>
      <span>Tessera · Name the limits better, running 4 min</span>
    </div>
  </div>
)
const sheet = (
  <div
    style={{
      display: 'grid',
      gap: 8,
      padding: 14,
      borderRadius: 12,
      background: 'var(--paper)',
      fontSize: 12,
      boxShadow: 'var(--lift-pop)',
    }}
  >
    <b>Needs you · 2</b>
    <span>Meridian · Publish to npm asks to run npm publish</span>
    <span>Halyard · Retry the checkout call is ready</span>
    <b style={{ marginTop: 6 }}>In progress · 1</b>
    <span>Tessera · Name the limits better</span>
  </div>
)
const menuMark = (
  <>
    <Logo size={12} />2
  </>
)

/* The sections as a consumer keeps them: each change shows at once and goes out. */
function General() {
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
      <OpenFilesIn editors={EDITORS} value={editor} onChange={setEditor} />
    </SettingList>
  )
}

function Notifications() {
  const [value, setValue] = useState(ALL_ON)
  const [sound, setSound] = useState<string | null>(null)
  return (
    <SettingList>
      <NotificationSettings
        value={value}
        onChange={(key, on) => {
          setValue((was) => ({ ...was, [key]: on }))
          onNotify(key, on)
        }}
      />
      <NotificationSound sounds={SOUNDS} value={sound} onChange={setSound} onPlay={onPlay} />
    </SettingList>
  )
}

function Places() {
  const [place, setPlace] = useState<'island' | 'menu'>('island')
  return (
    <EdgePlaces
      label="While you’re in another app"
      value={place}
      onChange={(next) => {
        setPlace(next)
        onPlace(next)
      }}
      options={[
        {
          value: 'island',
          title: 'Round the notch',
          note: 'Point at it to see what needs you.',
          picture: <EdgeScene notch top={island} />,
        },
        {
          value: 'menu',
          title: 'In the menu bar',
          note: 'Click the mark to see what needs you.',
          picture: <EdgeScene menuItem={menuMark} sheet={sheet} />,
        },
      ]}
    />
  )
}

const meta = {
  title: 'Setup/Preferences',
  component: SettingList,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 440 }}>{Story()}</div>],
  args: { children: null },
} satisfies Meta<typeof SettingList>
export default meta
type Story = StoryObj<typeof meta>

/** Keep awake, with on battery in a well under it, and the editors by their icons. Turned off, the well rests. */
export const GeneralSettings: Story = {
  render: () => <General />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const awake = c.getByRole('switch', { name: 'Keep this Mac awake while work runs' })
    const battery = c.getByRole('switch', { name: 'On battery too' })
    await expect(awake).toHaveAccessibleDescription('Work stops when the Mac sleeps. The display can still sleep.')
    await userEvent.click(awake)
    await expect(onAwake).toHaveBeenCalledWith(false)
    await expect(battery).toBeDisabled()
    const editors = c.getByRole('radiogroup', { name: 'Open files in' })
    await expect(within(editors).getByRole('radio', { name: 'Cursor' })).toBeChecked()
    await userEvent.click(within(editors).getByRole('radio', { name: 'Zed' }))
    await expect(within(editors).getByRole('radio', { name: 'Zed' })).toBeChecked()
  },
}

/** What comes as a notification, each switch by its own key, and the sound, heard as it is chosen. */
export const NotificationChoices: Story = {
  render: () => <Notifications />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const ready = c.getByRole('switch', { name: 'A task is ready for you' })
    await userEvent.click(ready)
    await expect(onNotify).toHaveBeenCalledWith('ready', false)
    await expect(c.getByRole('combobox', { name: 'Sound' })).toHaveTextContent('None')
    await expect(c.queryByRole('button', { name: /^Play/ })).toBeNull()
    await userEvent.click(c.getByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Glass' }))
    await expect(onPlay).toHaveBeenCalledWith('Glass')
    await userEvent.click(c.getByRole('button', { name: 'Play Glass' }))
    await expect(onPlay).toHaveBeenCalledTimes(2)
  },
}

/** Where Althar shows in another app, each place as the screen would look. */
export const WhereItShows: Story = {
  decorators: [(Story) => <div style={{ width: 760 }}>{Story()}</div>],
  render: () => <Places />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
    await userEvent.click(c.getByRole('radio', { name: /In the menu bar/ }))
    await expect(onPlace).toHaveBeenCalledWith('menu')
    await expect(c.getByRole('radio', { name: /In the menu bar/ })).toBeChecked()
    await userEvent.click(c.getByRole('radio', { name: /Round the notch/ }))
    await expect(c.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
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
          state: 'awake off',
          node: (
            <SettingList>
              <KeepAwake on={false} onChange={fn()} onBattery={false} onBatteryChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'editors, one without its icon',
          node: (
            <SettingList>
              <OpenFilesIn editors={EDITORS} value="vscode" onChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'notifications as they start',
          node: (
            <SettingList>
              <NotificationSettings value={ALL_ON} onChange={fn()} />
              <NotificationSound sounds={SOUNDS} value={null} onChange={fn()} onPlay={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'only calls, no count, with Purr',
          node: (
            <SettingList>
              <NotificationSettings value={{ calls: true, ready: false, stopped: false, badge: false }} onChange={fn()} />
              <NotificationSound sounds={SOUNDS} value="Purr" onChange={fn()} onPlay={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'on Windows: no count, the system’s sound',
          node: (
            <SettingList>
              <NotificationSettings value={ALL_ON} onChange={fn()} count={false} />
              <NotificationSound
                sounds={[]}
                system="default"
                value="default"
                onChange={fn()}
                onPlay={fn()}
                text={{ note: 'The system’s own sound, with each notification, or none.' }}
              />
            </SettingList>
          ),
        },
        { state: 'the screen round the notch', node: <EdgeScene notch top={island} /> },
        { state: 'the screen with the menu bar', node: <EdgeScene menuItem={menuMark} sheet={sheet} /> },
      ]}
    />
  ),
}
