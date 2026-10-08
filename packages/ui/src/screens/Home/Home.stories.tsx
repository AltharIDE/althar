import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TitleBar } from '../../chrome/TitleBar/TitleBar'
import { WorkStatus } from '../../chrome/WorkStatus/WorkStatus'
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
import { Logo } from '../../foundations/Logo/Logo'
import { TaskStatus } from '../../foundations/vocabulary'
import { NeedCard, NeedChange, NeedCommand, NeedOptions } from '../../home/NeedCard/NeedCard'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { States } from '../../storybook/States'
import { Home, type HomeProject, type HomeProps } from './Home'
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
    onOpenTask: fn(),
    onOpenEvent: fn(),
    onOpenProject: fn(),
    onTalk: fn(),
    onOpenFolder: fn(),
  },
} satisfies Meta<typeof Home>
export default meta
type Story = StoryObj<typeof meta>

/* ---- the window around the home: its bar, as the app draws it ---- */

function Window({ running, waiting, onYours, children }: { running: number; waiting: number; onYours?: () => void; children: ReactNode }) {
  return (
    <div className={s.window}>
      <TitleBar
        lights="drawn"
        end={
          <>
            <WorkStatus running={running} yours={waiting} {...(onYours ? { onYours } : {})} />
            <IconButton icon="gear" label="Settings" kbd="⌘," size="small" />
          </>
        }
      >
        <span className={s.brand}>
          <Logo size={15} />
          Althar
        </span>
      </TitleBar>
      <div className={s.body}>{children}</div>
    </div>
  )
}

/* ---- what waits on you, answered where it is or opened as the task ---- */

interface Said {
  said: string
  note: string
  denied?: boolean
}

function Day({ troubled = false, ...props }: Omit<HomeProps, 'needs' | 'waiting'> & { troubled?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, Said>>({})
  const answer = (id: string, said: Said) => setAnswers((now) => ({ ...now, [id]: said }))
  const undo = (id: string) =>
    setAnswers((now) => {
      const { [id]: _, ...rest } = now
      return rest
    })

  const cards: { id: string; project: string; node: ReactNode }[] = [
    ...(troubled
      ? [
          {
            id: 'signin',
            project: SIGNED_OUT.project.seed,
            node: (
              <NeedCard
                kind={SIGNED_OUT.kind}
                project={SIGNED_OUT.project}
                task={SIGNED_OUT.task}
                title={SIGNED_OUT.title}
                at={SIGNED_OUT.at}
                detail={SIGNED_OUT.because}
                actions={
                  <Button
                    size="small"
                    variant="signal"
                    icon="terminal"
                    onClick={() => answer('signin', { said: 'Codex signed in', note: 'the review on 88 carries on' })}
                  >
                    Sign in to Codex
                  </Button>
                }
              />
            ),
          },
          {
            id: 'stuck',
            project: STUCK.project.seed,
            node: (
              <NeedCard
                kind={STUCK.kind}
                project={STUCK.project}
                task={STUCK.task}
                title={STUCK.title}
                at={STUCK.at}
                detail={STUCK.because}
                actions={
                  <>
                    <Button
                      size="small"
                      onClick={() => answer('stuck', { said: 'Stopped Spike C', note: 'Compare runs on A and B', denied: true })}
                    >
                      Stop the spike
                    </Button>
                    <Button
                      size="small"
                      variant="signal"
                      onClick={() => answer('stuck', { said: 'Started afresh on Codex', note: 'a different agent this time' })}
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
      project: PUBLISH.project.seed,
      node: (
        <NeedCard
          kind={PUBLISH.kind}
          project={PUBLISH.project}
          task={PUBLISH.task}
          title={PUBLISH.title}
          at={PUBLISH.at}
          detail={<NeedCommand command={PUBLISH.command} agent={PUBLISH.agent} step={PUBLISH.step} />}
          actions={
            <>
              <Button
                size="small"
                onClick={() => answer('publish', { said: 'Denied', note: 'the lead hears why at Release', denied: true })}
              >
                Deny
              </Button>
              <Button
                size="small"
                variant="signal"
                onClick={() => answer('publish', { said: 'Allowed npm publish', note: 'went back to Release' })}
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
            project: READY.project.seed,
            node: (
              <NeedCard
                kind={READY.kind}
                project={READY.project}
                task={READY.task}
                title={READY.title}
                at={READY.at}
                onOpen={() => props.onOpenTask?.('accept')}
                detail={<NeedChange {...READY.change} />}
                actions={
                  <Button size="small" onClick={() => props.onOpenTask?.('accept')}>
                    Review
                  </Button>
                }
              />
            ),
          },
          {
            id: 'decision',
            project: DECISION.project.seed,
            node: (
              <NeedCard
                kind={DECISION.kind}
                project={DECISION.project}
                task={DECISION.task}
                title={DECISION.title}
                at={DECISION.at}
                onOpen={() => props.onOpenTask?.('decision')}
                detail={<NeedOptions options={DECISION.options} />}
                actions={
                  <Button size="small" onClick={() => props.onOpenTask?.('decision')}>
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
  const projects = props.projects.map((p) => ({ ...p, yours: waiting.filter((c) => c.project === p.id).length }))

  return (
    <Window running={props.running.length} waiting={waiting.length}>
      <Home
        {...props}
        projects={projects}
        waiting={waiting.length}
        needs={cards.map(({ id, node }) => {
          const said = answers[id]
          return said ? (
            <AskAnswered key={id} said={said.said} denied={said.denied ?? false} onUndo={() => undo(id)} focusOnMount>
              <AskNote>{said.note}</AskNote>
            </AskAnswered>
          ) : (
            <div key={id}>{node}</div>
          )
        })}
      />
    </Window>
  )
}

/** A busy afternoon: three calls across projects, five tasks running, and what the loop did in the three hours since you looked. Answer the permission where it is; Review and Decide open the task. */
export const Busy: Story = {
  render: (args) => <Day {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    await expect(await canvas.findByText('Allowed npm publish')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Decide' }))
    await expect(args.onOpenTask).toHaveBeenCalledWith('decision')
  },
}

/** A quiet morning: nothing waits on you, one task runs, and the night's work is listed. */
export const Quiet: Story = {
  args: { needs: [], running: RUNNING_QUIET, since: SINCE_QUIET, looked: 'last night, 23:40', projects: PROJECTS_QUIET },
  render: (args) => (
    <Window running={args.running.length} waiting={0}>
      <Home {...args} waiting={0} />
    </Window>
  ),
}

/** Something's wrong: a task stuck and another held for a sign-in. What needs a person comes first. */
export const SomethingWrong: Story = {
  args: {
    running: RUNNING.map((run) =>
      run.id === 'm424'
        ? { ...run, status: TaskStatus.Yours, note: 'Stuck: waits on you' }
        : run.id === 't88'
          ? { ...run, status: TaskStatus.Paused, note: 'Waits for Codex to sign in' }
          : run,
    ),
  },
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
  running: 0,
  yours: 0,
  note: 'No tasks yet',
  fresh: true,
})

function Resting(args: HomeProps) {
  return (
    <Window running={0} waiting={0}>
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
    <Window running={working ? 1 : 0} waiting={0}>
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
              <Window running={1} waiting={0}>
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
