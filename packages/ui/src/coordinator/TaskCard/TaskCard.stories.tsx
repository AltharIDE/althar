import type { Meta, StoryObj } from '@storybook/react-vite'
import { Fragment, useRef, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { STAGES, T432 } from '../../fixtures/coordinator'
import { CODEX, OPUS, SONNET } from '../../fixtures/models'
import { TaskStatus } from '../../foundations/vocabulary'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Thread } from '../../thread/Thread/Thread'
import { TaskCard, TaskMark } from './TaskCard'

const meta = {
  title: 'Coordinator/TaskCard',
  component: TaskCard,
  decorators: [threadDecorator],
  args: {
    ...T432,
    status: TaskStatus.Running,
    at: 0,
    now: 'Implement · writing the backfill script',
    started: 'started 4m ago',
    onOpen: fn(),
  },
} satisfies Meta<typeof TaskCard>
export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Open task/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('432')
  },
}

/** Something in it waits on you: violet, and the button answers. */
export const WaitingOnYou: Story = {
  args: {
    task: '431',
    status: TaskStatus.Yours,
    title: 'Refunds rate-limit like charges',
    lead: CODEX,
    branch: 'ch/431-refund-limits',
    from: undefined,
    started: 'started 2h ago',
    now: 'Verify on staging · a command that reaches staging',
    steps: ['Triage', 'Implement', 'Review', 'Security review', 'Verify', 'Draft PR'],
    at: 4,
  },
}

export const Done: Story = {
  args: {
    task: '429',
    status: TaskStatus.Done,
    title: 'Webhook retries respect partner limits',
    lead: SONNET,
    branch: 'ch/429-webhook-retries',
    from: undefined,
    started: 'took 48m',
    now: 'Draft PR opened; checks passed',
    pr: 'Draft PR 1187',
    steps: ['Implement', 'Review', 'Draft PR'],
    at: 3,
  },
}

/** Paused for a usage limit: nothing moves, and it resumes on its own. Not violet: it does not wait on you. */
export const Paused: Story = {
  args: {
    task: '433',
    status: TaskStatus.Paused,
    title: 'Find why the nightly partner export got slow',
    lead: CODEX,
    branch: 'ch/433-export-speed',
    from: undefined,
    started: 'started 40m ago',
    now: 'Security review waits for Claude Code · resets 14:00',
    steps: ['Implement', 'Review', 'Security review', 'Draft PR'],
    at: 2,
  },
}

/** Stopped by you: it keeps its branch and record. */
export const Stopped: Story = {
  args: {
    task: '428',
    status: TaskStatus.Stopped,
    title: 'Move partner webhooks to the new queue',
    lead: OPUS,
    branch: 'ch/428-webhook-queue',
    from: undefined,
    started: 'ran 22m',
    now: 'during Implement · the branch is kept',
    steps: ['Implement', 'Review', 'Draft PR'],
    at: 0,
  },
}

/** Each status change posts a new card; the one before folds into a mark where it was. The latest mark says where the task is now. */
function OverTime() {
  const [stage, setStage] = useState(4)
  const card = useRef<HTMLDivElement>(null)
  const [found, setFound] = useState(0)
  const live = STAGES[stage] ?? STAGES[0]
  return (
    <Thread label="Task 432">
      {STAGES.slice(0, stage).map((st, i) => (
        <Fragment key={i}>
          <TaskMark
            task={T432.task}
            verb={st.verb}
            detail={st.detail}
            at={st.at}
            steps={T432.steps}
            step={st.step}
            seen={'seen' in st ? st.seen : undefined}
            now={live.label}
            last={i === stage - 1}
            onJump={() => {
              card.current?.scrollIntoView({ block: 'center' })
              setFound(found + 1)
            }}
          />
        </Fragment>
      ))}
      <TaskCard
        key={`${stage}-${found}`}
        ref={card}
        {...T432}
        fresh={stage > 0 && found === 0}
        found={found > 0}
        status={live.status}
        at={live.step}
        seen={'seen' in live ? live.seen : undefined}
        now={live.now}
        started={live.started}
        pr={'pr' in live ? live.pr : undefined}
        onOpen={() => {}}
      />
      <div style={{ display: 'flex', gap: 14 }}>
        <LinkButton disabled={stage === STAGES.length - 1} onClick={() => setStage(stage + 1)}>
          Next status change
        </LinkButton>
        <LinkButton disabled={stage === 0} onClick={() => setStage(0)}>
          Back to the start
        </LinkButton>
      </div>
    </Thread>
  )
}

export const TaskOverTime: Story = { render: () => <OverTime /> }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'running', node: <TaskCard {...args} /> },
        { state: 'waiting on you', node: <TaskCard {...args} {...WaitingOnYou.args} /> },
        { state: 'done', node: <TaskCard {...args} {...Done.args} /> },
        { state: 'paused', node: <TaskCard {...args} {...Paused.args} /> },
        { state: 'stopped', node: <TaskCard {...args} {...Stopped.args} /> },
        { state: 'sent back a step', node: <TaskCard {...args} at={0} seen={2} now="Implement · round 2" /> },
        { state: 'a question', node: <TaskCard {...args} question branch={undefined} steps={[]} title="Why do refunds fail fast?" /> },
        { state: 'no way in', node: <TaskCard {...args} onOpen={undefined} /> },
        { state: 'open, hover', force: 'hover', node: <TaskCard {...args} /> },
        { state: 'open, focus', force: 'focus', node: <TaskCard {...args} /> },
        {
          state: 'mark, latest',
          node: (
            <TaskMark
              task="432"
              verb="moved to Review"
              detail="dry run clean on 18,402 refunds"
              at="11:44"
              steps={T432.steps}
              step={2}
              now="Review"
              last
              onJump={() => {}}
            />
          ),
        },
        {
          state: 'mark, older',
          node: (
            <TaskMark
              task="432"
              verb="started"
              detail="Opus 5 leads"
              at="11:02"
              steps={T432.steps}
              step={0}
              now="Review"
              onJump={() => {}}
            />
          ),
        },
        {
          state: 'mark, sent back',
          node: <TaskMark task="432" verb="went back to Implement" at="11:50" steps={T432.steps} step={0} seen={2} now="Implement" last />,
        },
      ]}
    />
  ),
}
