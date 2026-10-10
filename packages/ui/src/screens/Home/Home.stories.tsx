import type { Meta, StoryObj } from '@storybook/react-vite'
import { cloneElement, isValidElement, type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ProjectTabs } from '../../chrome/ProjectTabs/ProjectTabs'
import {
  DECISION,
  HALYARD,
  MERIDIAN,
  PROJECT_LIST,
  PROJECTS_QUIET,
  PUBLISH,
  READY,
  RUNNING,
  RUNNING_QUIET,
  SIGNED_OUT,
  SINCE,
  SINCE_QUIET,
  STUCK,
  TESSERA,
} from '../../fixtures/home'
import { MARKED, SEEDS } from '../../fixtures/marks'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { TaskStatus } from '../../foundations/vocabulary'
import { NeedLine, type NeedLineProps } from '../../home/NeedLine/NeedLine'
import type { ProjectRef } from '../../home/ProjectWord/ProjectWord'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { States } from '../../storybook/States'
import { Home, type HomeProject, type HomeProps, type HomeRun } from './Home'
import s from './Home.stories.module.css'

const meta = {
  title: 'Screens/Home',
  component: Home,
  parameters: { layout: 'fullscreen' },
  args: {
    waiting: 3,
    running: RUNNING,
    since: SINCE,
    looked: '3 h ago',
    projects: PROJECT_LIST,
    onOpenEvent: fn(),
    onOpenProject: fn(),
    onTalk: fn(),
    onOpenFolder: fn(),
  },
} satisfies Meta<typeof Home>
export default meta
type Story = StoryObj<typeof meta>

/* ---- the window around the home: its one bar, as the app draws it ---- */

function Window({ waiting, children }: { waiting: number; children: ReactNode }) {
  return (
    <div className={s.window}>
      <ProjectTabs
        lights="drawn"
        tabs={MARKED.map((p) => ({ id: p.id, name: p.name, seed: p.id, ink: p.ink, running: p.running, yours: 0 }))}
        current={null}
        yours={waiting}
        onSelect={fn()}
        onClose={fn()}
        end={<IconButton icon="gear" label="Settings" kbd="⌘," size="small" />}
      />
      <div className={s.body}>{children}</div>
    </div>
  )
}

/* ---- what waits on you, answered where it is or opened as the task ---- */

/** Opens a call's task, by its call. */
const openTask = fn()

/** What was said to a call answered here: the line's kind once answered, and what stands where its answers were. */
interface Said {
  kind: string
  said: string
  note: string
  denied?: boolean
}

function Day({ troubled = false, ...props }: Omit<HomeProps, 'needs' | 'waiting'> & { troubled?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, Said>>({})
  const answer = (id: string, said: Said) => setAnswers((now) => ({ ...now, [id]: said }))

  const cards: { id: string; project: ProjectRef; node: ReactNode }[] = [
    ...(troubled
      ? [
          {
            id: 'signin',
            project: SIGNED_OUT.project,
            node: (
              <NeedLine
                kind={SIGNED_OUT.kind}
                project={SIGNED_OUT.project}
                task={SIGNED_OUT.task}
                title={SIGNED_OUT.title}
                brief={SIGNED_OUT.because}
                actions={
                  <Button
                    size="small"
                    variant="signal"
                    icon="terminal"
                    onClick={() => answer('signin', { kind: 'Signed in', said: 'Codex', note: 'the review on 88 carries on' })}
                  >
                    Sign in to Codex
                  </Button>
                }
              />
            ),
          },
          {
            id: 'stuck',
            project: STUCK.project,
            node: (
              <NeedLine
                kind={STUCK.kind}
                project={STUCK.project}
                task={STUCK.task}
                title={STUCK.title}
                brief={STUCK.because}
                actions={
                  <>
                    <Button
                      size="small"
                      onClick={() => answer('stuck', { kind: 'Stopped', said: 'Spike C', note: 'Compare runs on A and B', denied: true })}
                    >
                      Stop the spike
                    </Button>
                    <Button
                      size="small"
                      variant="signal"
                      onClick={() => answer('stuck', { kind: 'Started afresh', said: 'On Codex', note: 'a different agent this time' })}
                    >
                      Try it on Codex
                    </Button>
                  </>
                }
              />
            ),
          },
        ]
      : []),
    {
      id: 'publish',
      project: PUBLISH.project,
      node: (
        <NeedLine
          kind={PUBLISH.kind}
          project={PUBLISH.project}
          task={PUBLISH.task}
          title={PUBLISH.title}
          command={PUBLISH.command}
          actions={
            <>
              <Button
                size="small"
                onClick={() => answer('publish', { kind: 'Denied', said: 'Once', note: 'the lead hears why at Release', denied: true })}
              >
                Deny
              </Button>
              <Button
                size="small"
                variant="signal"
                onClick={() => answer('publish', { kind: 'Allowed', said: 'Once', note: 'in Halyard' })}
              >
                Allow once
              </Button>
            </>
          }
        />
      ),
    },
    ...(troubled
      ? []
      : [
          {
            id: 'accept',
            project: READY.project,
            node: (
              <NeedLine
                kind={READY.kind}
                project={READY.project}
                task={READY.task}
                title={READY.title}
                onOpen={() => openTask('accept')}
                brief={`${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`}
                actions={
                  <Button size="small" onClick={() => openTask('accept')}>
                    Review
                  </Button>
                }
              />
            ),
          },
          {
            id: 'decision',
            project: DECISION.project,
            node: (
              <NeedLine
                kind={DECISION.kind}
                project={DECISION.project}
                task={DECISION.task}
                title={DECISION.title}
                onOpen={() => openTask('decision')}
                brief={DECISION.options.map((o) => o.label).join('  or  ')}
                actions={
                  <Button size="small" onClick={() => openTask('decision')}>
                    Decide
                  </Button>
                }
              />
            ),
          },
        ]),
  ]
  const waiting = cards.filter((c) => !answers[c.id])
  // each project's dot and count follow the calls this day shows
  const projects = props.projects.map((p) => ({ ...p, yours: waiting.filter((c) => c.project.seed === p.id).length }))

  return (
    <Window waiting={waiting.length}>
      <Home
        {...props}
        projects={projects}
        waiting={waiting.length}
        needs={cards.map(({ id, project, node }) => {
          const said = answers[id]
          // Answered, a line stays where it was, quiet: its kind says which way, and what was said stands where its answers were.
          return said && isValidElement<NeedLineProps>(node)
            ? {
                key: id,
                project,
                answered: true,
                line: cloneElement(node, {
                  kind: said.kind,
                  actions: undefined,
                  answer: { said: said.said, note: said.note, ...(said.denied ? { denied: true } : {}) },
                  focusOnMount: true,
                }),
              }
            : { key: id, project, line: node }
        })}
      />
    </Window>
  )
}

/** A busy afternoon: three calls across projects, five tasks running, and what the loop did in the three hours since you looked. Answer the permission where it is; Review and Decide open the task. */
export const Busy: Story = {
  render: (args) => <Day {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    // The line stays where it was, quiet: allowed, once.
    await expect(await canvas.findByText('Allowed')).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { name: '2 things need you', level: 2 })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Decide' }))
    await expect(openTask).toHaveBeenCalledWith('decision')
  },
}

/** A quiet morning: nothing waits on you, one task runs, and the night's work is listed. */
export const Quiet: Story = {
  args: { needs: [], running: RUNNING_QUIET, since: SINCE_QUIET, looked: 'last night, 23:40', projects: PROJECTS_QUIET },
  render: (args) => (
    <Window waiting={0}>
      <Home {...args} waiting={0} />
    </Window>
  ),
}

/** Something's wrong: a task stuck and another held for a sign-in. What needs a person comes first. */
export const SomethingWrong: Story = {
  args: {
    running: RUNNING.map((run) =>
      run.id === 'm424' ? { ...run, status: TaskStatus.Yours } : run.id === 't88' ? { ...run, status: TaskStatus.Paused } : run,
    ),
  },
  render: (args) => <Day {...args} troubled />,
}

/* ---- a heavy day: many projects, many tasks in progress ---- */

const INKS = Object.values(ProjectInk)
const MANY_PROJECTS: HomeProject[] = [
  ...PROJECT_LIST,
  ...SEEDS.slice(4).map((seed, i) => ({
    id: seed,
    project: { seed, ink: INKS[i % INKS.length]!, name: seed.charAt(0).toUpperCase() + seed.slice(1).replace(/-/g, ' ') },
    yours: 0,
    note: i % 3 === 0 ? 'Last task last week' : 'Last task 11 days ago',
  })),
]
/** Two tasks or so in most of the busy projects, a few held or stopped. */
const MANY_RUNNING: HomeRun[] = MANY_PROJECTS.slice(0, 12).flatMap((p, i) =>
  Array.from({ length: (i % 3) + 1 }, (_, k) => {
    const base = RUNNING[(i + k) % RUNNING.length]!
    return {
      ...base,
      id: `${p.id}-${k}`,
      project: p.project,
      ...(i === 6 && k === 0 ? { status: TaskStatus.Paused } : {}),
      ...(i === 9 && k === 1 ? { status: TaskStatus.Stopped } : {}),
    }
  }),
)

/** Sixteen projects and two dozen tasks: the middle is still only what needs you, gathered by project; the side list scrolls and the quiet projects fold away. */
export const HeavyDay: Story = {
  args: { running: MANY_RUNNING, projects: MANY_PROJECTS },
  render: (args) => <Day {...args} troubled />,
}

/** Without a way to open a folder, the projects' head has no button. */
export const WithoutOpeningAFolder: Story = {
  args: { onOpenFolder: undefined, waiting: 0, running: RUNNING_QUIET, since: SINCE_QUIET, projects: PROJECTS_QUIET },
}

/* ---- at rest: nothing waits on you and nothing is in progress ---- */

const fresh = (id: string, project: typeof MERIDIAN): HomeProject => ({
  id,
  project,
  yours: 0,
  note: 'No tasks yet',
  fresh: true,
})

function Resting(args: HomeProps) {
  return (
    <Window waiting={0}>
      <Home {...args} waiting={0} running={[]} />
    </Window>
  )
}

/** One project, opened today, with no task yet: Althar's light at the foot, the mark over it, and the way to its coordinator. */
export const AtRestNewProject: Story = {
  args: { since: [], projects: [fresh('meridian', MERIDIAN)] },
  render: (args) => <Resting {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Talk to Meridian’s coordinator' }))
    await expect(args.onTalk).toHaveBeenCalledWith('meridian')
  },
}

/** Two projects, neither with a task yet: a way to each one's coordinator. */
export const AtRestNewProjects: Story = {
  args: { since: [], projects: [fresh('meridian', MERIDIAN), fresh('halyard', HALYARD)] },
  render: (args) => <Resting {...args} />,
}

/** Projects that have had work, and nothing going on: all quiet, with the last few things the loop did. */
export const AtRestAllQuiet: Story = {
  args: {
    since: SINCE_QUIET.slice(0, 3),
    looked: '3 h ago',
    projects: PROJECTS_QUIET.map((project) => ({ ...project, running: 0, now: undefined, note: project.note ?? 'Last task at 18:40' })),
  },
  render: (args) => <Resting {...args} />,
}

function WorkComing(args: HomeProps) {
  const [working, setWorking] = useState(false)
  return (
    <Window waiting={0}>
      <div className={s.toggle}>
        <Button size="small" onClick={() => setWorking((now) => !now)}>
          {working ? 'Settle the task' : 'Start a task'}
        </Button>
      </div>
      <Home {...args} waiting={0} since={[]} running={working ? RUNNING_QUIET.map((run) => ({ ...run, project: TESSERA })) : []} />
    </Window>
  )
}

/** When work comes the light lies down, as it does at the launch, and the stream arrives in its place; when it is done, the home rests again. */
export const AtRestWorkComes: Story = {
  args: { projects: [fresh('tessera', TESSERA)] },
  render: (args) => <WorkComing {...args} />,
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        {
          state: 'busy',
          node: (
            <div className={s.cell}>
              <Day {...args} />
            </div>
          ),
        },
        {
          state: 'quiet',
          node: (
            <div className={s.cell}>
              <Window waiting={0}>
                <Home {...args} {...Quiet.args} waiting={0} />
              </Window>
            </div>
          ),
        },
        {
          state: 'at rest',
          node: (
            <div className={s.cell}>
              <Resting {...args} {...AtRestNewProject.args} />
            </div>
          ),
        },
        {
          state: 'something wrong',
          node: (
            <div className={s.cell}>
              <Day {...args} {...SomethingWrong.args} troubled />
            </div>
          ),
        },
      ]}
    />
  ),
}
