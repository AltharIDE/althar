import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { PROJECTS, MERIDIAN } from '../../fixtures/chrome'
import { Room } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { BackCrumb } from '../BackCrumb/BackCrumb'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import { Elsewhere } from '../Elsewhere/Elsewhere'
import { ProjectSwitcher } from '../ProjectSwitcher/ProjectSwitcher'
import { RoomSwitch } from '../RoomSwitch/RoomSwitch'
import { WorkStatus } from '../WorkStatus/WorkStatus'
import type { WindowControls } from '../WindowButtons/WindowButtons'
import { TitleBar, TitleBarRule } from './TitleBar'

/* A project window's bar, put together as the app does. */
function ProjectBar({
  compact = false,
  lights = 'drawn' as const,
  controls,
}: {
  compact?: boolean
  lights?: 'space' | 'drawn' | 'none'
  controls?: WindowControls
}) {
  const [room, setRoom] = useState(Room.Board)
  const [panel, setPanel] = useState<'know' | 'art' | null>(null)
  const toggle = (p: 'know' | 'art') => setPanel((v) => (v === p ? null : p))
  return (
    <TitleBar
      lights={lights}
      {...(controls === undefined ? {} : { controls })}
      window={{ onClose: fn(), onMinimize: fn(), onToggleMaximize: fn() }}
      end={
        <>
          <WorkStatus running={5} yours={4} onYours={fn()} />
          <TitleBarRule />
          <ChromeButton
            icon="knowledge"
            label="Knowledge"
            compact={compact}
            expanded={panel === 'know'}
            onClick={() => toggle('know')}
            kbd="k"
          />
          <ChromeButton
            icon="artifact"
            label="Artifacts"
            compact={compact}
            expanded={panel === 'art'}
            onClick={() => toggle('art')}
            kbd="a"
          />
        </>
      }
    >
      <ProjectSwitcher current={MERIDIAN} projects={PROJECTS} onPick={fn()} onRename={fn()} onNew={fn()} />
      <Elsewhere projects={PROJECTS.slice(1)} onPick={fn()} onMore={fn()} />
      <RoomSwitch value={room} onChange={setRoom} news={room === Room.Board} />
    </TitleBar>
  )
}

const meta = {
  title: 'Chrome/TitleBar',
  component: ProjectBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProjectBar>
export default meta
type Story = StoryObj<typeof meta>

/** A project's window: the project, one elsewhere that needs you, the views, the work's status, and the panels. */
export const ProjectWindow: Story = {}
/** A narrow window: the panel buttons keep only their glyphs. */
export const Narrow: Story = { args: { compact: true } }
/** In the app the system draws the lights; the bar keeps their space. */
export const NativeLights: Story = { args: { lights: 'space' } }

/** A task that has the window: the way back, which task this is, and what else needs you while you are in it. */
export const TaskTakeover: Story = {
  render: () => (
    <TitleBar lights="drawn" end={<WorkStatus running={5} yours={4} onYours={fn()} />}>
      <BackCrumb to="Meridian" kbd="esc" onBack={fn()} task="418" title="Repair token refresh on privilege change" />
    </TitleBar>
  ),
}

/* The desktops' own buttons (ADR-098), in their order and at their end, as Althar draws them where the window manager draws none. */
const GNOME: WindowControls = { look: 'gnome', tone: 'adwaita', start: [], end: ['minimize', 'maximize', 'close'] }
const GNOME_CLOSE: WindowControls = { look: 'gnome', tone: 'adwaita', start: [], end: ['close'] }
const GNOME_LEFT: WindowControls = { look: 'gnome', tone: 'adwaita', start: ['close', 'minimize', 'maximize'], end: [] }
const YARU: WindowControls = { look: 'gnome', tone: 'yaru', start: [], end: ['minimize', 'maximize', 'close'] }
const KDE: WindowControls = { look: 'kde', start: [], end: ['minimize', 'maximize', 'close'] }
const KDE_LEFT: WindowControls = { look: 'kde', start: ['close', 'maximize', 'minimize'], end: [] }
const WINDOWS: WindowControls = { look: 'windows', start: [], end: ['minimize', 'maximize', 'close'] }
const NEUTRAL: WindowControls = { look: 'gnome', tone: 'legacy', start: [], end: ['minimize', 'maximize', 'close'] }

/** GNOME: round buttons at the end, as its button-layout says. */
export const Gnome: Story = { args: { controls: GNOME } }
/** GNOME's own default layout: close alone, at the end. */
export const GnomeCloseOnly: Story = { args: { controls: GNOME_CLOSE } }
/** GNOME with its buttons moved to the left. */
export const GnomeLeft: Story = { args: { controls: GNOME_LEFT } }
/** Ubuntu's Yaru theme. */
export const Yaru: Story = { args: { controls: YARU } }
/** KDE's manner, for a Qt desktop on a compositor that draws no frame (KWin itself draws its own). */
export const Kde: Story = { args: { controls: KDE } }
/** KDE's manner with kwinrc's buttons on the left. */
export const KdeLeft: Story = { args: { controls: KDE_LEFT } }
/** Windows: caption buttons the bar's full height, square to the window's edge. */
export const Windows: Story = { args: { controls: WINDOWS } }
/** A desktop Althar doesn't know: neutral buttons at the end. */
export const Fallback: Story = { args: { controls: NEUTRAL } }
/** Where the window manager draws the frame (KDE, Xfce, MATE) or a tiling one has none: no buttons, no room for them. */
export const SystemFrame: Story = { args: { lights: 'none' } }

export const GnomeDark: Story = { ...Gnome, globals: { theme: 'dark' } }
export const GnomeCloseOnlyDark: Story = { ...GnomeCloseOnly, globals: { theme: 'dark' } }
export const KdeDark: Story = { ...Kde, globals: { theme: 'dark' } }
export const KdeLeftDark: Story = { ...KdeLeft, globals: { theme: 'dark' } }
export const WindowsDark: Story = { ...Windows, globals: { theme: 'dark' } }
export const FallbackDark: Story = { ...Fallback, globals: { theme: 'dark' } }
export const NativeLightsDark: Story = { ...NativeLights, globals: { theme: 'dark' } }

/* A task's bar, which fits a narrow cell: the way back, the task, the work's status. */
function TaskBar({ controls, lights = 'drawn' }: { controls?: WindowControls; lights?: 'space' | 'drawn' | 'none' }) {
  return (
    <TitleBar
      lights={lights}
      {...(controls === undefined ? {} : { controls })}
      window={{ onClose: fn(), onMinimize: fn(), onToggleMaximize: fn() }}
      end={<WorkStatus running={5} yours={4} onYours={fn()} />}
    >
      <BackCrumb to="Meridian" kbd="esc" onBack={fn()} task="418" title="Repair token refresh on privilege change" />
    </TitleBar>
  )
}

/** Every desktop's bar, one under another. */
export const Desktops: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'gnome', node: <TaskBar controls={GNOME} /> },
        { state: 'gnome · close only', node: <TaskBar controls={GNOME_CLOSE} /> },
        { state: 'gnome · left', node: <TaskBar controls={GNOME_LEFT} /> },
        { state: 'yaru', node: <TaskBar controls={YARU} /> },
        { state: 'kde', node: <TaskBar controls={KDE} /> },
        { state: 'kde · left', node: <TaskBar controls={KDE_LEFT} /> },
        { state: 'windows', node: <TaskBar controls={WINDOWS} /> },
        { state: 'fallback', node: <TaskBar controls={NEUTRAL} /> },
        { state: 'mac · system lights', node: <TaskBar lights="space" /> },
        { state: 'system frame · tiling', node: <TaskBar lights="none" /> },
      ]}
    />
  ),
}
export const DesktopsDark: Story = { ...Desktops, globals: { theme: 'dark' } }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'project window', node: <ProjectBar /> },
        { state: 'narrow', node: <ProjectBar compact /> },
        { state: 'native lights', node: <ProjectBar lights="space" /> },
        { state: 'no lights', node: <ProjectBar lights="none" /> },
        {
          state: 'task takeover',
          node: (
            <TitleBar lights="drawn">
              <BackCrumb to="Meridian" kbd="esc" onBack={fn()} task="418" title="Repair token refresh on privilege change" />
            </TitleBar>
          ),
        },
      ]}
    />
  ),
}
