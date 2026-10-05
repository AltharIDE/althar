import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AgentMarks, type AgentMark } from '../../chrome/AgentMarks/AgentMarks'
import { TitleBar, TitleBarRule } from '../../chrome/TitleBar/TitleBar'
import { WorkStatus } from '../../chrome/WorkStatus/WorkStatus'
import { AcceptPeek } from '../../dock/AcceptPeek/AcceptPeek'
import { CallPeek } from '../../dock/CallPeek/CallPeek'
import { Dock } from '../../dock/Dock/Dock'
import { ACCEPT, CALL } from '../../fixtures/dock'
import {
  AGENTS_READY,
  AGENTS_TROUBLED,
  DECISION,
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
} from '../../fixtures/home'
import { Logo } from '../../foundations/Logo/Logo'
import { TaskStatus } from '../../foundations/vocabulary'
import { NeedCard, NeedChange, NeedCommand, NeedOptions } from '../../home/NeedCard/NeedCard'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { States } from '../../storybook/States'
import { Home, type HomeProps } from './Home'
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
    onOpenFolder: fn(),
  },
} satisfies Meta<typeof Home>
export default meta
type Story = StoryObj<typeof meta>

/* ---- the window around the home: its bar, as the app draws it ---- */

function Window({
  agents,
  running,
  waiting,
  onYours,
  children,
}: {
  agents: readonly AgentMark[]
  running: number
  waiting: number
  onYours?: () => void
  children: ReactNode
}) {
  return (
    <div className={s.window}>
      <TitleBar
        lights="drawn"
        end={
          <>
            <AgentMarks agents={agents} />
            <TitleBarRule />
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

/* ---- what waits on you, answered where it is or opened in the dock ---- */

type Open = 'decision' | 'accept' | null
interface Said {
  said: string
  note: string
  denied?: boolean
}

function Day({
  initial = null,
  troubled = false,
  ...props
}: Omit<HomeProps, 'needs' | 'dock' | 'waiting'> & { initial?: Open; troubled?: boolean }) {
  const [open, setOpen] = useState<Open>(initial)
  const [answers, setAnswers] = useState<Record<string, Said>>({})
  const answer = (id: string, said: Said) => {
    setAnswers((now) => ({ ...now, [id]: said }))
    setOpen(null)
  }
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
                current={open === 'accept'}
                onOpen={() => setOpen('accept')}
                detail={<NeedChange {...READY.change} />}
                actions={
                  <Button size="small" onClick={() => setOpen('accept')}>
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
                current={open === 'decision'}
                onOpen={() => setOpen('decision')}
                detail={<NeedOptions options={DECISION.options} />}
                actions={
                  <Button size="small" onClick={() => setOpen('decision')}>
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

  const dock =
    open === 'decision' ? (
      <Dock label="Decision" name="Decision" sub="Meridian · task 423 · 1h ago" call onClose={() => setOpen(null)}>
        <CallPeek {...CALL} onRecord={() => answer('decision', { said: 'Decided: queue and retry', note: 'releases 422' })} />
      </Dock>
    ) : open === 'accept' ? (
      <Dock label="Ready to accept" name="Ready to accept" sub="Meridian · task 416 · 22m ago" onClose={() => setOpen(null)}>
        <AcceptPeek
          {...ACCEPT}
          onAccept={() => answer('accept', { said: 'Accepted #1191', note: 'merging into main' })}
          onSendBack={() => answer('accept', { said: 'Sent back', note: 'the lead has your note', denied: true })}
        />
      </Dock>
    ) : undefined

  return (
    <Window agents={troubled ? AGENTS_TROUBLED : AGENTS_READY} running={props.running.length} waiting={waiting.length}>
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
        {...(dock ? { dock } : {})}
      />
    </Window>
  )
}

/** A busy afternoon: three calls across projects, five tasks running, and what the loop did in the three hours since you looked. Answer the permission where it is; Review and Decide open the dock. */
export const Busy: Story = {
  render: (args) => <Day {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    await expect(await canvas.findByText('Allowed npm publish')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Decide' }))
    await expect(await canvas.findByRole('button', { name: 'Record decision' })).toBeInTheDocument()
  },
}

/** A quiet morning: nothing waits on you, one task runs, and the night's work is listed. */
export const Quiet: Story = {
  args: { needs: [], running: RUNNING_QUIET, since: SINCE_QUIET, looked: 'last night, 23:40', projects: PROJECTS_QUIET },
  render: (args) => (
    <Window agents={AGENTS_READY} running={args.running.length} waiting={0}>
      <Home {...args} waiting={0} />
    </Window>
  ),
}

/** Something's wrong: an agent signed out, another out until its reset, and a task stuck. The bar says which agents; what needs a person comes first. */
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

/** A decision open in the dock, which takes the projects' place. */
export const WithTheDock: Story = { render: (args) => <Day {...args} initial="decision" /> }

/** Without a way to open a folder, the projects' head has no button. */
export const WithoutOpeningAFolder: Story = {
  args: { onOpenFolder: undefined, waiting: 0, running: RUNNING_QUIET, since: SINCE_QUIET, projects: PROJECTS_QUIET },
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
              <Window agents={AGENTS_READY} running={1} waiting={0}>
                <Home {...args} {...Quiet.args} waiting={0} />
              </Window>
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
        {
          state: 'dock open',
          node: (
            <div className={s.cell}>
              <Day {...args} initial="decision" />
            </div>
          ),
        },
      ]}
    />
  ),
}
