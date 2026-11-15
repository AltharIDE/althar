import type { Meta, StoryObj } from '@storybook/react-vite'
import { type CSSProperties, useState } from 'react'
import { fn } from 'storybook/test'

import { PROJECTS, MERIDIAN } from '../../fixtures/chrome'
import { Room } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { BackCrumb } from '../BackCrumb/BackCrumb'
import { ChromeButton } from '../ChromeButton/ChromeButton'
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

/** A project's window: the project, the views, the work's status, and the panels. */
export const ProjectWindow: Story = {}

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

/* A project's bar needs a window's width, not a thread's: each cell takes the whole row. */
const WINDOW_WIDE = { '--measure': '100vw' } as CSSProperties

/** Every way a window's bar stands: the panel buttons keep only their glyphs in a narrow one; the system's lights, Althar's, or none. */
export const AllStates: Story = {
  render: () => (
    <div style={WINDOW_WIDE}>
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
    </div>
  ),
}
