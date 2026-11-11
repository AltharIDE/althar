import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FROM_231, PLAN_432, PLAN_433 } from '../../fixtures/coordinator'
import { PROJECT } from '../../fixtures/meridian'
import { CODEX, effortFor, model, OPUS, useModelPrefs } from '../../fixtures/models'
import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Thread } from '../../thread/Thread/Thread'
import { Turn } from '../../thread/Turn/Turn'
import { You } from '../../thread/You/You'
import { TaskEnd, WorksIn } from '../../foundations/vocabulary'
import { TaskLaunch, type LaunchPick, type LaunchStep } from './TaskLaunch'

/** The consumer's picker for one agent of a step: the composer's own, bordered. */
function usePicker(
  steps: readonly LaunchStep[],
  setSteps: (s: readonly LaunchStep[]) => void,
  room?: ComponentProps<typeof ModelPick>['room'],
) {
  const prefs = useModelPrefs()
  const [efforts, setEfforts] = useState<Record<string, string>>({})
  return ({ step, agent, k, owner }: LaunchPick) => {
    const key = `${step.id}:${k}`
    return (
      <ModelPick
        variant="field"
        placement="below"
        owner={owner}
        room={room}
        model={agent}
        pinned={prefs.pinned}
        effort={efforts[key] ?? effortFor(agent, prefs.efforts)}
        defaultEffort={effortFor(agent, prefs.efforts)}
        onChange={(id) =>
          setSteps(steps.map((st) => (st.id === step.id ? { ...st, agents: st.agents.map((a, i) => (i === k ? model(id) : a)) } : st)))
        }
        onEffort={(level) => setEfforts({ ...efforts, [key]: level })}
        /* a step with several agents can go down to one; its reason was about the pair, so it goes too */
        onRemove={
          step.agents.length > 1
            ? () => setSteps(steps.map((st) => (st.id === step.id ? { ...st, agents: st.agents.filter((_, i) => i !== k) } : st)))
            : undefined
        }
      />
    )
  }
}

function Launch({
  plan = PLAN_432,
  wait,
  onStart = () => {},
  room,
  ...rest
}: Partial<Parameters<typeof TaskLaunch>[0]> & { plan?: LaunchStep[]; room?: ComponentProps<typeof ModelPick>['room'] }) {
  const [steps, setSteps] = useState<readonly LaunchStep[]>(plan)
  const picker = usePicker(steps, setSteps, room)
  return (
    <TaskLaunch
      task="432"
      title="Backfill idempotency keys on refunds created before PR 1184"
      from={FROM_231}
      project={PROJECT}
      estimate="About 40 min · about $2 on your subscriptions"
      steps={steps}
      onStepsChange={setSteps}
      picker={picker}
      wait={wait}
      onStart={onStart}
      {...rest}
    />
  )
}

const meta = {
  title: 'Coordinator/TaskLaunch',
  component: TaskLaunch,
  decorators: [threadDecorator],
  args: { task: '432', title: '', project: PROJECT, estimate: '', picker: () => null, onStart: fn() },
} satisfies Meta<typeof TaskLaunch>
export default meta
type Story = StoryObj<typeof meta>

/** The plan, counting down once you can see it. Change an agent, skip an optional step, or pick what happens when it is done. */
export const AboutToStart: Story = { render: () => <Launch /> }

/** Its kicker names the preset its parts are first (a task is a conversation plus parts), in the kicker's own type. */
export const NamesItsPreset: Story = { render: () => <Launch preset="Change" /> }

const PRESETS = [
  { name: 'Chat', about: 'a copy, no review, ends here, the coordinator picks its lead' },
  { name: 'Change', about: 'a worktree, reviewed before it ships, a draft pull request, the coordinator picks its lead' },
  { name: 'Small change', about: 'a worktree, reviewed after it merges, a pull request ready for review, the coordinator picks its lead' },
  { name: 'Prototype', about: 'a worktree, reviewed after it merges, ends here, led by claude-opus-5-5' },
]

/** A press on the preset lists the others, each with what it holds: picking one changes the plan's parts to match. */
export const PicksAnotherPreset: Story = {
  render: function Render() {
    const [preset, setPreset] = useState('Change')
    return <Launch preset={preset} presets={PRESETS} onPresetChange={setPreset} />
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitemradio', { name: /Prototype/ })).toBeVisible()
  },
}

/** A review proposed with two agents can go down to one: the second's picker has Remove from this step. */
export const OneReviewerInsteadOfTwo: Story = {
  render: () => <Launch />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Reviewer 2 · Review/ }))
    await userEvent.click(await within(document.body).findByRole('button', { name: 'Remove from this step' }))
    await waitFor(() => expect(c.queryByRole('button', { name: /Reviewer 2 · Review/ })).not.toBeInTheDocument())
    await expect(c.getByRole('button', { name: 'Review: Sonnet 5 High' })).toBeInTheDocument()
  },
}

/** Hold stops the clock; it starts when you say. Skipping a step strikes it through, and Add back undoes it. */
export const Held: Story = {
  render: () => <Launch />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Hold' }))
    await expect(c.getByText('Held')).toBeInTheDocument()
    const [skip] = c.getAllByRole('button', { name: 'Skip' })
    if (!skip) throw new Error('no Skip')
    await userEvent.click(skip)
    await expect(c.getByText('skipped')).toBeInTheDocument()
  },
}

const started = fn()

/** Left alone, it starts on its own. */
export const StartsOnItsOwn: Story = {
  render: () => <Launch wait={1} onStart={started} />,
  play: async () => {
    await waitFor(() => expect(started).toHaveBeenCalled(), { timeout: 3000 })
  },
}

const due = fn()

/** The runtime keeps the time: the plan starts at a set time whether or not a window shows it, so the clock counts down to then from the moment it is drawn, and then says it is starting, since the runtime starts it. Here, with no ending to pick, as for a task that ends on its branch. */
export const KeptByTheRuntime: Story = {
  render: () => <Launch wait={25} startsAt={Date.now() + 2500} hideEnd estimate={undefined} onStart={due} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/^Starts in [23]s$/)).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /When the work is done/ })).not.toBeInTheDocument()
    await waitFor(() => expect(c.getByText('Starting…')).toBeInTheDocument(), { timeout: 4000 })
    await expect(due).not.toHaveBeenCalled()
  },
}

const reviewStarted = fn()

/** A review of someone else's pull request: one step, its lead, which reviews, with the coordinator's reason; nothing to skip and no ending to pick, as its review is posted from its own card. The person can change the lead and how hard it thinks, hold it, or start it now. */
export const AReview: Story = {
  render: () => (
    <Launch
      plan={[{ id: 'implement', label: 'Review', agents: [OPUS] }]}
      task="review-1199-send-back"
      title="Review #1199: Send back won’t restart a dead lead session"
      from={undefined}
      wait={25}
      startsAt={Date.now() + 20_000}
      hideEnd
      estimate={undefined}
      onStart={reviewStarted}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Review')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: /^Lead for this task/ })).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    await expect(c.queryByRole('button', { name: /When the work is done/ })).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Hold' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Start now' })).toBeInTheDocument()
    await expect(reviewStarted).not.toHaveBeenCalled()
  },
}

/** The reviewer's model nearly out: its note sits beside the chip, a quiet aside, and the plan still starts. */
const reviewerNearly = (left: number): Story => ({
  render: () => <Launch plan={PLAN_ASKED} room={(x) => (x.runtime === CODEX.runtime ? { left, until: '18:05', account: null } : null)} />,
  play: async ({ canvasElement }) => {
    const said = left === 0 ? 'Out · until 18:05' : `${left}% left · until 18:05`
    await expect(within(canvasElement).getByText(said)).toBeInTheDocument()
  },
})
export const ReviewerNearlyOut: Story = reviewerNearly(4)
export const ReviewerOut: Story = reviewerNearly(0)

const heldChanged = fn()
const startedHeld = fn()

/** A plan whose hold the consumer keeps, as a runtime does. */
function HeldElsewhere() {
  const [held, setHeld] = useState(false)
  const [startsAt] = useState(() => Date.now() + 20_000)
  return (
    <Launch
      wait={25}
      startsAt={startsAt}
      held={held}
      onHeldChange={(next) => {
        heldChanged(next)
        setHeld(next)
      }}
      onStart={startedHeld}
    />
  )
}

/** Held where the plan is kept, not only on screen: Hold says so, and a plan held elsewhere shows held. */
export const HeldByTheRuntime: Story = {
  render: () => <HeldElsewhere />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Hold' }))
    await expect(heldChanged).toHaveBeenCalledWith(true)
    await expect(c.getByText('Held')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Start' }))
    await expect(startedHeld).toHaveBeenCalled()
  },
}

/** Started, it waits for a free agent: it says so where the clock was, its steps can still change, and Hold takes it out of the line until you start it. */
export const WaitingForAFreeAgent: Story = {
  render: () => <Launch queued="Waiting: 4 of 4 agents busy on this Mac" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('status')).toHaveTextContent('Waiting: 4 of 4 agents busy on this Mac')
    await expect(c.queryByRole('button', { name: /Start/ })).toBeNull()
    await expect(c.getByRole('button', { name: 'Hold' })).toBeInTheDocument()
  },
}

const heldQueued = fn()

/** A queued plan held where the plan is kept: Hold says so, and the card shows held, with Start. */
function HeldWhileQueued() {
  const [held, setHeld] = useState(false)
  return (
    <Launch
      {...(held ? {} : { queued: 'Waiting: 4 of 4 agents busy on this Mac' })}
      held={held}
      onHeldChange={(next) => {
        heldQueued(next)
        setHeld(next)
      }}
    />
  )
}

export const HeldWhileWaitingForAFreeAgent: Story = {
  render: () => <HeldWhileQueued />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Hold' }))
    await expect(heldQueued).toHaveBeenCalledWith(true)
    await expect(c.getByText('Held')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    await expect(c.queryByRole('status')).toBeNull()
  },
}

/** Where it works, in its head (ADR-091): Local, the person's own checkout, or a worktree, changeable until it starts. */
function Placed({ worksIn: start = WorksIn.Local, ...rest }: Partial<Parameters<typeof TaskLaunch>[0]>) {
  const [worksIn, setWorksIn] = useState(start)
  return <Launch worksIn={worksIn} onWorksInChange={setWorksIn} {...rest} />
}

/** Planned Local, the project's default: the switch says where it works, and what each gives up is in its tooltip, not a line under it. */
export const Local: Story = {
  render: () => <Placed />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('radio', { name: 'Local' })).toBeChecked()
    await expect(c.queryByText('One task at a time; your own edits share it.')).toBeNull()
    await userEvent.click(c.getByRole('radio', { name: 'Worktree' }))
    await expect(c.queryByText('Side by side with other tasks. Builds from cold.')).toBeNull()
    await userEvent.click(c.getByRole('radio', { name: 'Local' }))
  },
}

/** Another task works Local: the coordinator planned this one in a worktree and says why; Local would wait for it. */
export const LocalTaken: Story = {
  render: () => <Placed worksIn={WorksIn.Worktree} localTaken="Dark mode for Settings" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Local is taken by Dark mode for Settings.')).toBeVisible()
    await userEvent.click(c.getByRole('radio', { name: 'Local' }))
    await expect(c.getByText('Waits for Dark mode for Settings.')).toBeVisible()
    await userEvent.click(c.getByRole('radio', { name: 'Worktree' }))
  },
}

const BRANCHES = ['main', 'release/0.8.0', 'release/0.7.x', 'feature/onboarding'] as const

/** What it works toward (ADR-093), after how it ends: the remote's branches, changeable until it starts, and a new one made. */
function Toward({ toward: start, branches: known = BRANCHES, ...rest }: Partial<Parameters<typeof TaskLaunch>[0]>) {
  const [toward, setToward] = useState(start)
  const [branches, setBranches] = useState<readonly string[]>(known)
  const [worksIn, setWorksIn] = useState(WorksIn.Worktree)
  return (
    <Launch
      worksIn={worksIn}
      onWorksInChange={setWorksIn}
      defaultBranch="main"
      branches={branches}
      {...(toward === undefined ? {} : { toward })}
      onTowardChange={setToward}
      onCreateBranch={(name) => {
        setBranches((was) => [...was, name])
        setToward(name)
      }}
      {...rest}
    />
  )
}

/** Toward the default branch, as most tasks are: Open a draft PR into main. */
export const TowardMain: Story = {
  render: () => <Toward />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Works toward: main' })).toBeInTheDocument()
    await expect(c.getByText('into')).toBeInTheDocument()
  },
}

/** Pointed at a release branch, from the coordinator or the person: it starts there and its pull request goes there. */
export const TowardARelease: Story = {
  render: () => <Toward toward="release/0.8.0" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Works toward: release/0.8.0' })).toBeInTheDocument()
  },
}
export const TowardAReleaseDark: Story = { ...TowardARelease, globals: { theme: 'dark' } }

/** Pushed only, no pull request: the branch it works toward, all the same. */
export const TowardPushOnly: Story = {
  render: () => <Toward toward="release/0.8.0" defaultEnd={TaskEnd.PushOnly} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('toward')).toBeInTheDocument()
  },
}

/** A branch the remote doesn't have, named in the list and made from main, for this task. */
export const TowardANewBranch: Story = {
  render: () => <Toward />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Works toward: main' }))
    await userEvent.type(await page.findByRole('combobox', { name: 'Find or name a branch' }), 'hotfix/0.8.1')
    await userEvent.click(page.getByRole('option', { name: 'Create hotfix/0.8.1 from main' }))
    await expect(await c.findByRole('button', { name: 'Works toward: hotfix/0.8.1' })).toBeInTheDocument()
  },
}

/** A remote with only its default branch: still a list, to make the first release branch from it. */
export const TowardTheOnlyBranch: Story = {
  render: () => <Toward branches={['main']} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Works toward: main' }))
    await userEvent.type(await page.findByRole('combobox', { name: 'Find or name a branch' }), 'release/0.8.0')
    await userEvent.click(page.getByRole('option', { name: 'Create release/0.8.0 from main' }))
    await expect(await c.findByRole('button', { name: 'Works toward: release/0.8.0' })).toBeInTheDocument()
  },
}

/** With no row for how it ends, the branch has a row of its own. */
export const TowardWithNoEnd: Story = {
  render: () => <Toward toward="release/0.8.0" hideEnd />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Works toward: release/0.8.0' })).toBeInTheDocument()
  },
}

/** Started Local, it waits for the checkout: said where the clock was. */
export const WaitingForLocal: Story = {
  render: () => <Placed localTaken="Dark mode for Settings" queued="Waits for Local: Dark mode for Settings is there" />,
}

/** A runtime is out: its steps wait for the reset, unless you move them. */
export const AgentOut: Story = {
  render: () => (
    <Launch
      plan={PLAN_433}
      task="433"
      from={undefined}
      title="Find why the nightly partner export got slow"
      estimate="About 25 min of work"
      limited={{ name: 'Claude Code', until: '14:00' }}
    />
  ),
}

/** A lead and one reviewer from another maker: the plan the coordinator proposes most days. */
const PLAN_ASKED: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [CODEX], optional: true },
]

/** Where a plan comes from: what you asked, the coordinator's answer, and the plan under it. */
export const InTheConversation: Story = {
  render: () => (
    <Thread label="Conversation">
      <You at="11:01">EU customers are seeing the wrong VAT rate on their invoice PDFs since Monday. Can you fix it?</You>
      <Turn voice="Coordinator" at="11:01">
        One task. Opus 5 fixes the rate lookup and adds a test for each EU country, and Codex reviews it.
      </Turn>
      <Launch
        plan={PLAN_ASKED}
        from={undefined}
        title="Fix the VAT rate on EU invoice PDFs"
        estimate="About 25 min · about $1 on your subscriptions"
      />
    </Thread>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'counting down', node: <Launch /> },
        { state: 'an agent is out', node: <Launch plan={PLAN_433} limited={{ name: 'Claude Code', until: '14:00' }} /> },
        { state: 'a step skipped', node: <Launch plan={PLAN_432.map((st) => (st.id === 'dry' ? { ...st, skipped: true } : st))} /> },
        {
          state: 'kept by the runtime, no ending',
          node: <Launch wait={25} startsAt={Date.now() + 600_000} hideEnd estimate={undefined} />,
        },
        { state: 'held', node: <Launch defaultHeld hideEnd /> },
      ]}
    />
  ),
}
