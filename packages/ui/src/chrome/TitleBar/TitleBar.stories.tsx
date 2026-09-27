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
import { TitleBar, TitleBarRule } from './TitleBar'

/* A project window's bar, put together as the app does. */
function ProjectBar({ compact = false, lights = 'drawn' as const }: { compact?: boolean; lights?: 'space' | 'drawn' | 'none' }) {
  const [room, setRoom] = useState(Room.Board)
  const [panel, setPanel] = useState<'know' | 'art' | null>(null)
  const toggle = (p: 'know' | 'art') => setPanel((v) => (v === p ? null : p))
  return (
    <TitleBar
      lights={lights}
      end={
        <>
          <WorkStatus running={5} yours={4} onYours={fn()} />
          <TitleBarRule />
          <ChromeButton
            icon="knowledge"
            label="Knowledge"
            compact={compact}
            pressed={panel === 'know'}
            onClick={() => toggle('know')}
            title="Knowledge  k"
          />
          <ChromeButton
            icon="artifact"
            label="Artifacts"
            compact={compact}
            pressed={panel === 'art'}
            onClick={() => toggle('art')}
            title="Artifacts  a"
          />
        </>
      }
    >
      <ProjectSwitcher current={MERIDIAN} projects={PROJECTS} onPick={fn()} onRename={fn()} onNew={fn()} />
      <Elsewhere projects={PROJECTS.slice(1)} onPick={fn()} onMore={fn()} />
      <RoomSwitch value={room} onChange={setRoom} news={room === Room.Board} yours={4} />
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
