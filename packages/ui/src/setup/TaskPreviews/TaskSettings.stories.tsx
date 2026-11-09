import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CODEX, OPUS } from '../../fixtures/models'
import { Icon } from '../../foundations/Icon/Icon'
import { TaskEnd } from '../../foundations/vocabulary'
import { taskEndText } from '../../foundations/vocabularyText'
import { Select } from '../../primitives/Select/Select'
import { type Countdown, plansAndReviewsText, type ReviewRounds, type RoundsOut } from '../PlansAndReviews/PlansAndReviews'
import { SettingGroup, SettingList, SettingRow, SettingSwitch } from '../Preferences/Preferences'
import { ReviewSealGlyph } from '../ReviewSeal/ReviewSeal'
import { DiffersLine } from './DiffersLine'
import { PlanPreview } from './PlanPreview'
import { PullRequestPreview } from './PullRequestPreview'
import { RoundsPreview } from './RoundsPreview'
import { PLAN_PREVIEW_SAMPLE, PULL_REQUEST_PREVIEW_SAMPLE, TASK_PREVIEW_SEAL } from './samples'
import { SettingPreviews } from './SettingPreviews'

/*
 * The previews where they sit: Althar's Tasks, a plan and its review over
 * what every task does and what new projects start with; a project's
 * Tasks, the pull request a finished task opens over the settings that
 * make it. Each group is the kit's SettingGroup, each row has its round
 * glyph, and a row of what new projects start with names the projects that
 * differ. The page's frame and its words are the consumer's.
 */

const PLAN = {
  ...PLAN_PREVIEW_SAMPLE,
  steps: PLAN_PREVIEW_SAMPLE.steps.map((step) => ({ ...step, who: step.id === 'review' ? CODEX : OPUS })),
}
const glyph = (name: Parameters<typeof Icon>[0]['name']) => <Icon name={name} size={15} />
const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

function AltharTasks() {
  const [countdown, setCountdown] = useState<Countdown>(25)
  const [rounds, setRounds] = useState<ReviewRounds>(3)
  const [out, setOut] = useState<RoundsOut>('settled')
  const [push, setPush] = useState(true)
  const [shots, setShots] = useState(false)
  const t = plansAndReviewsText
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <SettingPreviews>
        <PlanPreview countdown={countdown} sample={PLAN} />
        <RoundsPreview rounds={rounds} out={out} facts={TASK_PREVIEW_SEAL} />
      </SettingPreviews>
      <div>
        <SettingGroup title="Every task" headingLevel={3}>
          <SettingList>
            <SettingRow title={t.countdown.title} note={t.countdown.note(countdown)} glyph={glyph('clock')}>
              {() => (
                <Select<string>
                  label={t.countdown.title}
                  value={String(countdown)}
                  onChange={(next) => setCountdown(Number(next) as Countdown)}
                  options={([0, 10, 25, 60] as const).map((one) => ({ value: String(one), label: t.countdown.label(one) }))}
                />
              )}
            </SettingRow>
            <SettingRow title={t.rounds.title} mark={<ReviewSealGlyph facts={TASK_PREVIEW_SEAL} />}>
              {() => (
                <Select<string>
                  label={t.rounds.title}
                  value={String(rounds)}
                  onChange={(next) => setRounds(Number(next) as ReviewRounds)}
                  options={([1, 2, 3, 5] as const).map((one) => ({ value: String(one), label: t.rounds.label(one) }))}
                />
              )}
            </SettingRow>
            <SettingRow title={t.roundsOut.title} note={t.roundsOut.note(out)} glyph={glyph('hold')}>
              {() => (
                <Select<RoundsOut>
                  label={t.roundsOut.title}
                  value={out}
                  onChange={setOut}
                  options={(['settled', 'ask'] as const).map((one) => ({ value: one, label: t.roundsOut.label(one) }))}
                />
              )}
            </SettingRow>
          </SettingList>
        </SettingGroup>
        <SettingGroup title="New projects start with" note="Changing one here leaves the projects you have as they are." headingLevel={3}>
          <SettingList>
            <SettingRow
              title="When a task is done"
              glyph={glyph('pr')}
              note={
                <>
                  {taskEndText[TaskEnd.DraftPr].note}
                  <DiffersLine projects={[{ id: 'fnt', name: 'fnt', value: taskEndText[TaskEnd.ReadyPr].title }]} onUseEverywhere={fn()} />
                </>
              }
            >
              {() => <span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>{taskEndText[TaskEnd.DraftPr].title}</span>}
            </SettingRow>
            <SettingSwitch title="Push the lead’s commits automatically" glyph={glyph('up')} checked={push} onChange={setPush} />
            <SettingSwitch
              title="Post screenshots to pull requests automatically"
              glyph={glyph('image')}
              note={<DiffersLine projects={[{ id: 'fnt', name: 'fnt', value: 'On' }]} onUseEverywhere={fn()} />}
              checked={shots}
              onChange={setShots}
            />
            <SettingSwitch
              title="Resolve merge conflicts automatically"
              glyph={glyph('conflict')}
              note={<DiffersLine projects={[{ id: 'althar', name: 'althar', value: 'On' }]} onUseEverywhere={fn()} />}
              checked={false}
              onChange={fn()}
            />
            <SettingSwitch
              title="Move issues along with their tasks"
              note="To In Progress, In Review, then Done"
              glyph={glyph('issues')}
              checked
              onChange={fn()}
            />
            <SettingRow title="When an account runs out" glyph={glyph('load')}>
              {() => <span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>Move to the strongest model with usage left</span>}
            </SettingRow>
            <SettingSwitch title="Try an agent’s other accounts first" glyph={glyph('reload')} checked onChange={fn()} />
          </SettingList>
        </SettingGroup>
      </div>
    </div>
  )
}

function ProjectTasks() {
  const [end, setEnd] = useState<TaskEnd>(TaskEnd.DraftPr)
  const [push, setPush] = useState(true)
  const [shots, setShots] = useState(false)
  const [conflicts, setConflicts] = useState(true)
  const [issues, setIssues] = useState(true)
  return (
    <div>
      <SettingGroup title="Where tasks start" headingLevel={3}>
        <SettingList>
          <SettingRow title="New tasks start in" note="Each task gets a copy of its own, side by side." glyph={glyph('folder')}>
            {() => <span style={{ fontSize: 12.5, color: 'var(--t-2)' }}>A worktree</span>}
          </SettingRow>
          <SettingRow
            title="Work toward"
            note="New tasks start from this branch, and their pull requests go into it."
            glyph={glyph('branch')}
          >
            {() => <code style={{ fontSize: 12 }}>main</code>}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      <SettingGroup title="Pull requests and issues" headingLevel={3}>
        <PullRequestPreview end={end} screenshots={shots} issues={issues} seal sample={PULL_REQUEST_PREVIEW_SAMPLE} />
        <SettingList>
          <SettingRow title="When a task is done" note={taskEndText[end].note} glyph={glyph('pr')}>
            {() => (
              <Select<TaskEnd>
                label="When a task is done"
                value={end}
                onChange={setEnd}
                options={ENDS.map((one) => ({ value: one, label: taskEndText[one].title }))}
              />
            )}
          </SettingRow>
          <SettingSwitch title="Push the lead’s commits automatically" glyph={glyph('up')} checked={push} onChange={setPush} />
          <SettingSwitch
            title="Post screenshots to pull requests automatically"
            glyph={glyph('image')}
            checked={shots}
            onChange={setShots}
          />
          <SettingSwitch
            title="Resolve merge conflicts automatically"
            glyph={glyph('conflict')}
            checked={conflicts}
            onChange={setConflicts}
          />
          <SettingSwitch title="Move issues along with their tasks" glyph={glyph('issues')} checked={issues} onChange={setIssues} />
        </SettingList>
      </SettingGroup>
    </div>
  )
}

const meta = {
  title: 'Setup/TaskPreviews/In Settings',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 880 }}>{Story()}</div>],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Althar's Tasks: the plan and its review side by side, what every task does, and what new projects start with, with the projects that differ. */
export const AltharsTasks: Story = {
  render: () => <AltharTasks />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Every task', level: 3 })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'New projects start with', level: 3 })).toBeInTheDocument()
    await expect(c.getByText('Changing one here leaves the projects you have as they are.')).toBeInTheDocument()
    await expect(c.getByRole('figure', { name: 'A plan as the thread shows it' })).toHaveTextContent('Starts in 25s')
    await expect(c.getByRole('figure', { name: 'Rounds of review' })).toHaveTextContent('up to 3 rounds')
    await expect(c.getAllByRole('button', { name: 'Use this in every project' })).toHaveLength(3)
  },
}

/** A project's Tasks: the pull request a finished task opens follows its switches as they change. */
export const ProjectsTasks: Story = {
  render: () => <ProjectTasks />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const pr = c.getByRole('figure', { name: 'A pull request as GitHub shows it' })
    await expect(within(pr).queryByRole('img', { name: 'Screenshots from the task' })).toBeNull()
    await userEvent.click(c.getByRole('switch', { name: 'Post screenshots to pull requests automatically' }))
    await expect(within(pr).getByRole('img', { name: 'Screenshots from the task' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('switch', { name: 'Move issues along with their tasks' }))
    await expect(pr).toHaveTextContent('Todo')
  },
}

export const AltharsTasksDark: Story = { ...AltharsTasks, globals: { theme: 'dark' } }
export const ProjectsTasksDark: Story = { ...ProjectsTasks, globals: { theme: 'dark' } }

/** In an 800 px window's sheet: the plan and its review one under the other, notes and their buttons wrapping. */
export const AltharsTasksNarrow: Story = {
  ...AltharsTasks,
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
}

export const ProjectsTasksNarrow: Story = {
  ...ProjectsTasks,
  decorators: [(Story) => <div style={{ width: 420 }}>{Story()}</div>],
}
