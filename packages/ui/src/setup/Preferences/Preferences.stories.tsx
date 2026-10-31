import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { Logo } from '../../foundations/Logo/Logo'
import { BrandMark } from '../../foundations/Marks/Marks'
import { EdgeSpot } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { States } from '../../storybook/States'
import { ControlSheet } from '../ControlCenter/ControlCenter'
import { EdgeMini } from '../EdgeMini/EdgeMini'
import {
  AgentsAtOnce,
  CrashReports,
  CrashReportsLine,
  EdgeHere,
  EdgePlaces,
  EdgeScene,
  KeepAwake,
  NotificationSettings,
  NotificationSound,
  type NotifyChoices,
  OpenFilesIn,
  SettingGroup,
  SettingList,
  SettingRow,
  SettingSwitch,
  UsageData,
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

/* A 16 GB Mac with 10 cores, which runs four at once by default. */
const MACHINE = { count: 4, memory: 16, cores: 10 }

/* What the stories' play functions look for, as a consumer would hear it. */
const onAtOnce = fn()
const onAwake = fn()
const onNotify = fn()
const onPlay = fn()
const onPlace = fn()
const onUsage = fn()
const onCrashes = fn()

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

/* How many agents at once, as a consumer keeps it: the person's number, or none for the default. */
function AtOnce({ compact = false }: { compact?: boolean }) {
  const [own, setOwn] = useState<number | null>(null)
  return (
    <AgentsAtOnce
      compact={compact}
      count={own ?? MACHINE.count}
      machine={MACHINE}
      onChange={(count) => {
        setOwn(count)
        onAtOnce(count)
      }}
    />
  )
}

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
      <AtOnce />
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

function Usage() {
  const [on, setOn] = useState(true)
  return (
    <SettingList>
      <UsageData
        on={on}
        onChange={(next) => {
          setOn(next)
          onUsage(next)
        }}
      />
    </SettingList>
  )
}

function Crashes({ line = false }: { line?: boolean }) {
  const [on, setOn] = useState(true)
  const change = (next: boolean) => {
    setOn(next)
    onCrashes(next)
  }
  return line ? (
    <div style={{ maxWidth: 420 }}>
      <CrashReportsLine on={on} onChange={change} />
    </div>
  ) : (
    <SettingList>
      <Usage />
      <CrashReports on={on} onChange={change} />
    </SettingList>
  )
}

function Places() {
  const [place, setPlace] = useState<'island' | 'menu'>('island')
  return (
    <EdgePlaces
      label="In other apps"
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
    await expect(awake).toHaveAccessibleDescription('The display can still sleep.')
    await userEvent.click(awake)
    await expect(onAwake).toHaveBeenCalledWith(false)
    await expect(battery).toBeDisabled()
    const editors = c.getByRole('radiogroup', { name: 'Open files in' })
    await expect(within(editors).getByRole('radio', { name: 'Cursor' })).toBeChecked()
    await userEvent.click(within(editors).getByRole('radio', { name: 'Zed' }))
    await expect(within(editors).getByRole('radio', { name: 'Zed' })).toBeChecked()
  },
}

/** Anonymous usage data, on as it starts, with the line on what it sends and never sends; turned off at once. */
export const UsageDataSwitch: Story = {
  render: () => <Usage />,
  play: async ({ canvasElement }) => {
    const usage = within(canvasElement).getByRole('switch', { name: 'Usage data' })
    await expect(usage).toBeChecked()
    await expect(usage).toHaveAccessibleDescription('Anonymous. Never your code or any name.')
    await userEvent.click(usage)
    await expect(onUsage).toHaveBeenCalledWith(false)
    await expect(usage).not.toBeChecked()
  },
}

/** Crash reports, beside usage data with a switch of their own: on as they start, with the line on what they carry and never carry; turned off at once. */
export const CrashReportsSwitch: Story = {
  render: () => <Crashes />,
  play: async ({ canvasElement }) => {
    const crashes = within(canvasElement).getByRole('switch', { name: 'Crash reports' })
    await expect(crashes).toBeChecked()
    await expect(crashes).toHaveAccessibleDescription('What failed, and where. Never your code or any name.')
    await userEvent.click(crashes)
    await expect(onCrashes).toHaveBeenCalledWith(false)
    await expect(crashes).not.toBeChecked()
    await expect(within(canvasElement).getByRole('switch', { name: 'Usage data' })).toBeChecked()
  },
}

/** Crash reports asked once on a first screen: one quiet line with its switch, nothing to answer before going on. */
export const CrashReportsFirstScreen: Story = {
  render: () => <Crashes line />,
  play: async ({ canvasElement }) => {
    const crashes = within(canvasElement).getByRole('switch', { name: 'Crash reports' })
    await expect(crashes).toBeChecked()
    await expect(crashes).toHaveAccessibleDescription('go to Althar’s team. Never your code or any name.')
    await userEvent.click(crashes)
    await expect(onCrashes).toHaveBeenCalledWith(false)
  },
}

/** Off and locked while DO_NOT_TRACK is set, in Settings and on the first screen alike. */
export const CrashReportsDoNotTrack: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
      <SettingList>
        <CrashReports on onChange={fn()} doNotTrack />
      </SettingList>
      <CrashReportsLine on onChange={fn()} doNotTrack />
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const crashes of within(canvasElement).getAllByRole('switch', { name: 'Crash reports' })) {
      await expect(crashes).not.toBeChecked()
      await expect(crashes).toBeDisabled()
    }
  },
}

/** How many agents work at once, and why: the default from this Mac's memory and cores, a number of the person's own, and back to the default. */
export const AgentsAtOnceSetting: Story = {
  render: () => (
    <SettingList>
      <AtOnce />
    </SettingList>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const count = c.getByRole('slider', { name: 'Agents at once' })
    await expect(count).toHaveAttribute('aria-valuenow', '4')
    await expect(c.getByText('Default for 16 GB and 10 cores')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Use the default' })).toBeNull()
    count.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(onAtOnce).toHaveBeenLastCalledWith(6)
    await expect(count).toHaveAttribute('aria-valuenow', '6')
    await expect(c.getByText('Tests may slow down')).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    await expect(c.getByText('May run hot')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Use the default' }))
    await expect(onAtOnce).toHaveBeenLastCalledWith(null)
    await expect(count).toHaveAttribute('aria-valuenow', '4')
    // Back on the default by the keys: the default again, not a number of the person's own.
    count.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(onAtOnce).toHaveBeenLastCalledWith(3)
    await expect(count).toHaveAttribute('aria-valuenow', '3')
    await userEvent.keyboard('{ArrowRight}')
    await expect(onAtOnce).toHaveBeenLastCalledWith(null)
    await expect(count).toHaveAttribute('aria-valuenow', '4')
  },
}

/** Compact, alone on a sheet, as the quick settings have it: one plain line, a step for each number, no scale. */
export const AgentsAtOnceCompact: Story = {
  render: () => (
    <div style={{ width: 416 }}>
      <ControlSheet>
        <AtOnce compact />
      </ControlSheet>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const count = c.getByRole('slider', { name: 'Agents at once' })
    await expect(count).toHaveAttribute('aria-valuetext', '4, this Mac’s default')
    await expect(c.getByText('The rest wait their turn')).toBeInTheDocument()
    count.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(count).toHaveAttribute('aria-valuenow', '6')
    // Past the default the line stays the same; the way back follows it.
    await expect(c.getByText('The rest wait their turn')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Use the default' }))
    await expect(count).toHaveAttribute('aria-valuenow', '4')
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

/** Where Althar shows in another app, each place as the screen would look; arrows move between them. */
export const WhereItShows: Story = {
  decorators: [(Story) => <div style={{ width: 564 }}>{Story()}</div>],
  render: () => <Places />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('radiogroup', { name: 'In other apps' })).toBeInTheDocument()
    await expect(c.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
    await userEvent.click(c.getByRole('radio', { name: /In the menu bar/ }))
    await expect(onPlace).toHaveBeenCalledWith('menu')
    await expect(c.getByRole('radio', { name: /In the menu bar/ })).toBeChecked()
    await userEvent.click(c.getByRole('radio', { name: /Round the notch/ }))
    await expect(c.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
    // Arrows move between them, choosing as they go, and back round from the last.
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('radio', { name: /In the menu bar/ })).toBeChecked()
    await expect(c.getByRole('radio', { name: /In the menu bar/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(c.getByRole('radio', { name: /Round the notch/ })).toBeChecked()
    // Tab leaves the group rather than going through it.
    await userEvent.tab()
    await expect(c.getByRole('radio', { name: /In the menu bar/ })).not.toHaveFocus()
    await expect(c.getByRole('radio', { name: /Round the notch/ })).not.toHaveFocus()
    // Its picture is beside its radio, never inside it.
    await expect(
      c
        .getByRole('radio', { name: /Round the notch/ })
        .closest('label')
        ?.querySelector('[aria-hidden]:not([class*=radio])'),
    ).toBeNull()
  },
}

/** Where it shows with nothing to choose, as on Windows: the screen beside where, and what Windows may do with it. */
export const NothingToChoose: Story = {
  decorators: [(Story) => <div style={{ width: 564 }}>{Story()}</div>],
  render: () => (
    <EdgeHere
      title="In the system tray"
      note="Click Althar’s mark beside the clock to see what needs you and what runs."
      why="Windows may tuck it under the ^ beside the clock. Drag it onto the taskbar to keep it in sight."
      picture={<EdgeMini spot={EdgeSpot.WindowsTray} scale={2.6} />}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('In the system tray')).toBeInTheDocument()
    await expect(c.queryByRole('radio')).toBeNull()
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
          state: 'agents at once: the default, fewer, well past it, a small Mac past its one, and a big Mac under its sixteen',
          node: (
            <SettingList>
              <AgentsAtOnce count={4} machine={MACHINE} onChange={fn()} />
              <AgentsAtOnce count={2} machine={MACHINE} onChange={fn()} />
              <AgentsAtOnce count={11} machine={MACHINE} onChange={fn()} />
              <AgentsAtOnce count={2} machine={{ count: 1, memory: 8, cores: 8 }} onChange={fn()} />
              <AgentsAtOnce count={12} machine={{ count: 16, memory: 128, cores: 16 }} onChange={fn()} />
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
              <NotificationSound sounds={[]} system="default" value="default" onChange={fn()} onPlay={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'usage data on',
          node: (
            <SettingList>
              <UsageData on onChange={fn()} />
            </SettingList>
          ),
        },
        {
          state: 'usage data with DO_NOT_TRACK set',
          node: (
            <SettingList>
              <UsageData on onChange={fn()} doNotTrack />
            </SettingList>
          ),
        },
        { state: 'the screen round the notch', node: <EdgeScene notch top={island} /> },
        { state: 'the screen with the menu bar', node: <EdgeScene menuItem={menuMark} sheet={sheet} /> },
        { state: 'the screen, drawn small', node: <EdgeScene notch top={island} height={260} /> },
        {
          state: 'a Mac without a notch',
          node: (
            <EdgeHere
              title="In the menu bar"
              note="Click Althar’s mark to see what needs you and what runs."
              why="This Mac’s screen has no notch, so Althar shows in the menu bar."
              picture={<EdgeScene menuItem={menuMark} sheet={sheet} />}
            />
          ),
        },
        {
          state: 'Linux, in the tray',
          node: (
            <EdgeHere
              title="In the system tray"
              note="Click Althar’s mark to see what needs you and what runs."
              why="Where the desktop has no tray, Althar shows only in its window."
              picture={<EdgeMini spot={EdgeSpot.LinuxTray} scale={2.6} />}
            />
          ),
        },
        {
          state: 'Linux, no tray',
          node: (
            <EdgeHere
              title="Only in Althar’s window"
              note="This desktop has no system tray, so Althar shows only in its own window."
              picture={<EdgeMini spot={EdgeSpot.WindowOnly} scale={2.6} />}
            />
          ),
        },
      ]}
    />
  ),
}

/** A section's parts, each under its name with what is done for all of it; a product's own mark before its row as it is, with no round glyph. */
export const Groups: Story = {
  render: () => (
    <>
      <SettingGroup
        title="Trackers"
        note="Where its tasks’ issues are."
        action={
          <Button size="small" icon="plug">
            Connect a tracker
          </Button>
        }
      >
        <SettingList>
          <SettingRow title="Linear · MER issues" note="Connected as balazs" mark={<BrandMark brand={Brand.Linear} size={18} />}>
            {() => null}
          </SettingRow>
          <SettingRow title="Jira · OPS issues" note="Not connected" mark={<BrandMark brand={Brand.Jira} size={18} />}>
            {() => (
              <Button size="small" variant="signal">
                Connect
              </Button>
            )}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      <SettingGroup title="How its tasks work">
        <SettingList>
          <SettingSwitch
            title="Resolve merge conflicts automatically"
            note="The lead fixes them and says what it did."
            checked
            onChange={fn()}
          />
        </SettingList>
      </SettingGroup>
    </>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('region', { name: 'Trackers' })).toBeVisible()
    await expect(c.getByRole('heading', { name: 'How its tasks work', level: 2 })).toBeVisible()
  },
}
