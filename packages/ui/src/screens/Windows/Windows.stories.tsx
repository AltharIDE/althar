import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement, ReactNode } from 'react'
import { fn } from 'storybook/test'

import { BackCrumb } from '../../chrome/BackCrumb/BackCrumb'
import { ChromeButton } from '../../chrome/ChromeButton/ChromeButton'
import { ProjectHeader, type ProjectPart } from '../../chrome/ProjectHeader/ProjectHeader'
import { ProjectTabs } from '../../chrome/ProjectTabs/ProjectTabs'
import { TaskHeader, type TaskHeaderStep } from '../../chrome/TaskHeader/TaskHeader'
import { TaskMenu } from '../../chrome/TaskMenu/TaskMenu'
import { TaskParts, type TaskPartModel } from '../../chrome/TaskParts/TaskParts'
import { TitleBar } from '../../chrome/TitleBar/TitleBar'
import { MARKED } from '../../fixtures/marks'
import { CODEX, OPUS } from '../../fixtures/models'
import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { Room, TaskStatus } from '../../foundations/vocabulary'
import type { ChangeViewProps } from '../../outputs/ChangeView/ChangeView'
import changeStories, { Findings } from '../../outputs/ChangeView/ChangeView.stories'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { trackOf } from '../../primitives/StepTrack/StepTrack'
import { StepGraph } from '../../thread/StepGraph/StepGraph'
import graphStories, { RoundUntilClean } from '../../thread/StepGraph/StepGraph.stories'
import { WithACanvas, WithTheBrowser } from '../../thread/TaskFace/TaskFace.stories'
import { Automations } from '../Automations/Automations'
import automationStories from '../Automations/Automations.stories'
import s from './Windows.stories.module.css'

/*
 * Whole windows of the app, as the desktop draws them (apps/desktop's
 * TaskView and ProjectView), round what the kit's own stories show of them:
 * a task's bar over its Graph face, or over its conversation with a canvas or
 * the browser beside it; a project's tabs and header over its automations.
 * Drawn on the demo cast for the brand pack's screenshots
 * (brand/src/screenshots.ts), which the landing page's gallery shows.
 */

type Face = 'talk' | 'out' | 'graph'
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
  { value: 'graph' as const, label: 'Graph', kbd: 'g' },
]

/** Its plan's steps, each with who does it, at the step it is on. */
const plan = (names: readonly string[], at: number, done = false): TaskHeaderStep[] =>
  trackOf(names, at, at, done).map((step, i) => ({ ...step, who: i % 2 === 0 ? OPUS.name : CODEX.name }))

const worktree = (branch: string, changed: string): TaskPartModel => ({
  id: 'worktree',
  icon: 'folder',
  name: 'Worktree',
  detail: changed,
  facts: [['Branch', branch]],
})

/** A task's window: the way back and the task, where it stands, its parts and faces, then the face. */
function TaskWindow({
  title,
  status,
  state,
  steps,
  took,
  elapsed,
  face,
  parts,
  children,
}: {
  title: string
  status: TaskStatus
  state: string
  steps: TaskHeaderStep[]
  took?: string
  elapsed?: string
  face: Face
  parts: TaskPartModel[]
  children: ReactNode
}) {
  return (
    <div className={s.window}>
      <TitleBar
        lights="drawn"
        end={
          <TaskHeader
            title={title}
            status={status}
            state={state}
            steps={steps}
            {...(took === undefined ? {} : { took })}
            {...(elapsed === undefined ? {} : { elapsed })}
            faces={FACES}
            face={face}
            onFace={fn()}
            parts={<TaskParts parts={parts} kinds={[]} />}
            actions={
              <>
                <ChromeButton icon="play" label="Run" onClick={fn()} />
                <TaskMenu onStop={fn()} onAbandon={fn()} />
              </>
            }
          />
        }
      >
        <BackCrumb to="Meridian" kbd="esc" title={title} titleLevel={1} onBack={fn()} />
      </TitleBar>
      {children}
    </div>
  )
}

const PARTS: ProjectPart[] = [
  { id: 'api', name: 'meridian-api', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'web', name: 'meridian-web', brand: Brand.GitHub, openLabel: 'Open on GitHub', onOpen: fn() },
  { id: 'tracker', name: 'MER issues', brand: Brand.Linear, openLabel: 'Open in Linear', onOpen: fn() },
]

/** A project's window, as ProjectHome draws it: its tabs, its header on a room, then the room. */
function ProjectWindow({ room, children }: { room: Room; children: ReactNode }) {
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={MARKED.map((p) => ({
          id: p.id,
          name: p.name,
          seed: p.id,
          ink: p.ink,
          running: p.running,
          yours: p.id === 'meridian' ? 1 : 0,
        }))}
        current="meridian"
        yours={1}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" kbd="⌘," size="small" />}
      />
      <ProjectHeader
        name="Meridian"
        seed="meridian"
        ink={ProjectInk.Teal}
        yours={1}
        inProgress={3}
        onYours={fn()}
        room={room}
        onRoom={fn()}
        parts={PARTS}
      />
      <div className={s.room}>{children}</div>
    </div>
  )
}

/* The faces the kit's stories draw, each a story with no arguments of its own; and a review's findings, open in the code. */
const CanvasBeside = WithACanvas.render as () => ReactElement
const BrowserBeside = WithTheBrowser.render as () => ReactElement
const FindingsSheet = Findings.render as (args: ChangeViewProps) => ReactElement
const FINDINGS = { ...changeStories.args, ...Findings.args, lights: 'space' } as ChangeViewProps

const meta = {
  title: 'Screens/Windows',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The VAT fix from the project's home, done: a lane for each agent, a card for each step, round until the review passed, its draft pull request open. */
export const TaskAsAGraph: Story = {
  render: () => (
    <TaskWindow
      title="Fix the VAT rate on EU invoice PDFs"
      status={TaskStatus.Yours}
      state="Ready to accept"
      steps={plan(['Implement', 'Review'], 1, true)}
      face="graph"
      parts={[
        worktree('meridian/vat-rate-eu-invoices', '5 files changed'),
        { id: 'pr', icon: 'pr', name: '#1214', detail: 'Draft · checks pass', tone: 'you' },
      ]}
    >
      <div className={s.graph}>
        <StepGraph {...graphStories.args} {...RoundUntilClean.args} />
      </div>
    </TaskWindow>
  ),
}

/** A task at work with its canvas beside it: the launch page its lead drew, at the version that answers a comment. */
export const TaskWithACanvas: Story = {
  render: () => (
    <TaskWindow
      title="Draw the Payouts launch page"
      status={TaskStatus.Running}
      state="Implementing"
      steps={plan(['Implement'], 0)}
      took="15m"
      elapsed="15m"
      face="talk"
      parts={[worktree('meridian/payouts-launch', '3 files changed')]}
    >
      <div className={s.face}>
        <CanvasBeside />
      </div>
    </TaskWindow>
  ),
}

/** A task at work with the browser beside it: the page its run serves, and the lead trying its fix on it. */
export const TaskWithTheBrowser: Story = {
  render: () => (
    <TaskWindow
      title="Retry does nothing on a failed refund"
      status={TaskStatus.Running}
      state="Implementing"
      steps={plan(['Implement', 'Review'], 0)}
      took="11m"
      elapsed="11m"
      face="talk"
      parts={[
        worktree('meridian/refund-retry', '2 files changed'),
        { id: 'run', icon: 'globe', name: 'localhost:5173', detail: 'Running', tone: 'live' },
      ]}
    >
      <div className={s.face}>
        <BrowserBeside />
      </div>
    </TaskWindow>
  ),
}

/**
 * A review's findings open in the code, over the task's window: the files they
 * name first, worst first, and each finding a note under its line.
 */
export const ReviewInTheCode: Story = {
  render: () => (
    <TaskWindow
      title="Show full model names in the model browser"
      status={TaskStatus.Running}
      state="Settling"
      steps={plan(['Implement', 'Review'], 0)}
      took="4m"
      elapsed="38m"
      face="talk"
      parts={[worktree('althar/model-browser-full-model-names', '7 files changed')]}
    >
      <div className={s.face} />
      <FindingsSheet {...FINDINGS} />
    </TaskWindow>
  ),
}

/** The project's automations, under its header: work that starts itself, on a schedule, and how each has run. */
export const ProjectAutomations: Story = {
  render: () => (
    <ProjectWindow room={Room.Automations}>
      <Automations {...automationStories.args} />
    </ProjectWindow>
  ),
}
