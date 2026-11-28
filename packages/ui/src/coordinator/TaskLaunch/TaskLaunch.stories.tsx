import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
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
import { BlockerStands, TaskEnd, WorksIn } from '../../foundations/vocabulary'
import { TaskLaunch, type LaunchPick, type LaunchPlace, type LaunchStep } from './TaskLaunch'

/** The consumer's picker for one agent of a step: the composer's own, bordered. */
function usePicker(steps: readonly LaunchStep[], setSteps: (s: readonly LaunchStep[]) => void) {
  const prefs = useModelPrefs()
  // Each seat keeps its own pick; a step with one seat names it on its row too.
  const [efforts, setEfforts] = useState<Readonly<Record<string, string | undefined>>>({})
  return ({ step, agent, k, owner, onOpenChange, skip }: LaunchPick) => {
    const key = `${step.id}:${k}`
    const alone = step.agents.length === 1
    const byDefault = (alone ? step.defaultEffort : undefined) ?? effortFor(agent, prefs.efforts)
    const set = (patch: Partial<LaunchStep>) => setSteps(steps.map((st) => (st.id === step.id ? { ...st, ...patch } : st)))
    return (
      <ModelPick
        variant="field"
        placement="below"
        owner={owner}
        model={agent}
        pinned={prefs.pinned}
        effort={efforts[key] ?? (alone ? step.effort : undefined) ?? byDefault}
        defaultEffort={byDefault}
        onChange={(id) => {
          setEfforts((was) => ({ ...was, [key]: undefined }))
          set({
            agents: step.agents.map((a, i) => (i === k ? model(id) : a)),
            ...(alone ? { effort: null, defaultEffort: effortFor(model(id), prefs.efforts) } : {}),
          })
        }}
        onEffort={(level) => {
          setEfforts((was) => ({ ...was, [key]: level }))
          if (alone) set({ effort: level })
        }}
        onOpenChange={onOpenChange}
        /* a step with several agents can go down to one; one that can be skipped is skipped from here, as the app does */
        onRemove={
          step.agents.length > 1
            ? () => setSteps(steps.map((st) => (st.id === step.id ? { ...st, agents: st.agents.filter((_, i) => i !== k) } : st)))
            : skip?.onSkip
        }
        {...(step.agents.length === 1 && skip !== undefined ? { text: { remove: skip.label } } : {})}
      />
    )
  }
}

function Launch({
  plan = PLAN_432,
  wait,
  onStart = () => {},
  ...rest
}: Partial<Parameters<typeof TaskLaunch>[0]> & { plan?: LaunchStep[] }) {
  const [steps, setSteps] = useState<readonly LaunchStep[]>(plan)
  const picker = usePicker(steps, setSteps)
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
  { name: 'Small change', about: 'a worktree, reviewed after it merges, ends as the project says, the coordinator picks its lead' },
  { name: 'Prototype', about: 'a worktree, no review, ends here, led by Claude Opus 5.5' },
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

/** Planned from Prototype: its lead and its ending, the branch, and no review row, skipped or not. */
export const APrototype: Story = {
  render: () => (
    <Launch
      plan={[{ id: 'implement', label: 'Implement', agents: [OPUS], fixed: 'the lead', defaultEffort: 'High' }]}
      preset="Prototype"
      presets={PRESETS}
      hideEnd
      estimate={undefined}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Implement')).toBeVisible()
    await expect(c.queryByText('Review')).not.toBeInTheDocument()
    await expect(c.queryByText('Add back')).not.toBeInTheDocument()
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

/** Hold stops the clock; it starts when you say. Skipping a step, from its dropdown, strikes it through, and Add back undoes it. */
export const Held: Story = {
  render: () => <Launch />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Hold' }))
    await expect(c.getByText('Held')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Dry run on a copy/ }))
    await userEvent.click(await within(document.body).findByRole('button', { name: 'Skip the dry run on a copy' }))
    await expect(await c.findByText('skipped')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add back: Dry run on a copy' }))
    await waitFor(() => expect(c.queryByText('skipped')).not.toBeInTheDocument())
  },
}

const PLACES: readonly LaunchPlace[] = [
  { value: 'home', label: 'This Mac', kind: 'home' },
  { value: 'auto', label: 'Any free worker', kind: 'any' },
  { value: 'wrk_3f9a2c', label: 'Linux worker 3f9a2c', kind: 'worker', hint: '12 GB free' },
  { value: 'wrk_b71e04', label: 'Linux worker b71e04', kind: 'worker', hint: 'At work', disabled: true },
  { value: 'wrk_c0d2f8', label: 'Linux worker c0d2f8', kind: 'worker', hint: 'No Claude Code', disabled: true },
]

/** Held, where the home has workers: where it runs, beside where it works, a menu of the home and its workers. */
export const HeldWithWorkers: Story = {
  render: function Render() {
    const [place, choose] = useState('home')
    return (
      <Launch
        held
        estimate={undefined}
        worksIn={WorksIn.Worktree}
        runsOn={{ value: place, places: PLACES, onChange: choose, note: 'The setup and lead run on the worker, the review on This Mac.' }}
      />
    )
  },
}

/** Its menu open: each worker with how it stands at its row's end, one that can't take it greyed, and what a worker runs at its foot. */
export const WorkersOpen: Story = {
  ...HeldWithWorkers,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Runs on: This Mac' }))
    await expect(await within(document.body).findByRole('menuitemradio', { name: 'Linux worker b71e04' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

const CHECKED: readonly LaunchPlace[] = [
  { value: 'home', label: 'This Mac', kind: 'home' },
  { value: 'auto', label: 'Any free worker', kind: 'any' },
  { value: 'wrk_runner1', label: 'runner-1', kind: 'worker', hint: '12 GB free' },
  { value: 'wrk_runner2', label: 'runner-2', kind: 'worker', hint: 'Sandbox can’t start', disabled: true },
  { value: 'wrk_runner3', label: 'runner-3', kind: 'worker', hint: 'Claude Code signed out', disabled: true },
]

/** Workers as their own checks found them: one ready; one whose sandbox can't start, and one whose agent is signed out, greyed with why. */
export const WorkersChecked: Story = {
  render: function Render() {
    const [place, choose] = useState('home')
    return (
      <Launch
        held
        estimate={undefined}
        worksIn={WorksIn.Worktree}
        runsOn={{ value: place, places: CHECKED, onChange: choose, note: 'The setup and lead run on the worker, the review on This Mac.' }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Runs on: This Mac' }))
    await expect(await within(document.body).findByRole('menuitemradio', { name: 'runner-2' })).toHaveAttribute('aria-disabled', 'true')
  },
}

/** Set to run on a worker whose agent doesn't offer the lead's model: Start waits until the picker has one it does. */
export const ModelNotOnTheWorker: Story = {
  render: () => (
    <Launch
      held
      estimate={undefined}
      worksIn={WorksIn.Worktree}
      runsOn={{
        value: 'wrk_runner1',
        places: CHECKED,
        onChange: fn(),
        problem: 'runner-1 doesn’t offer Claude Opus 5. Pick a model it has.',
      }}
      startDisabled
    />
  ),
}

/** Set to run on any free worker. */
export const OnAnyFreeWorker: Story = {
  ...HeldWithWorkers,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Runs on: This Mac' }))
    await userEvent.click(await within(document.body).findByRole('menuitemradio', { name: 'Any free worker' }))
    await expect(within(canvasElement).getByRole('button', { name: 'Runs on: Any free worker' })).toBeInTheDocument()
  },
}

/** The worker it was set to run on took another task: Start waits, and the line under the head goes back to the home. */
export const WorkerTaken: Story = {
  render: function Render() {
    const [place, choose] = useState('wrk_3f9a2c')
    return (
      <Launch
        held
        estimate={undefined}
        worksIn={WorksIn.Worktree}
        runsOn={{
          value: place,
          places: PLACES,
          onChange: choose,
          ...(place === 'home' ? {} : { problem: 'Linux worker 3f9a2c is at work on another task.' }),
        }}
        startDisabled={place !== 'home'}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Start' })).toBeDisabled()
    await userEvent.click(c.getByRole('button', { name: 'Use This Mac' }))
    await expect(c.getByRole('button', { name: 'Start' })).toBeEnabled()
  },
}

/** Counting down, where the home has workers: a worker chosen now is where the countdown starts it, and the clock goes on. */
export const CountingDownWithWorkers: Story = {
  render: function Render() {
    const [place, choose] = useState('home')
    return (
      <Launch
        wait={60}
        startsAt={Date.now() + 60_000}
        estimate={undefined}
        worksIn={WorksIn.Worktree}
        runsOn={{ value: place, places: PLACES, onChange: choose, note: 'The setup and lead run on the worker, the review on This Mac.' }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Runs on: This Mac' }))
    await userEvent.click(await within(document.body).findByRole('menuitemradio', { name: 'Linux worker 3f9a2c' }))
    await expect(c.getByRole('button', { name: 'Runs on: Linux worker 3f9a2c' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Start now' })).toBeEnabled()
  },
}

export const CountingDownWithWorkersDark: Story = { ...CountingDownWithWorkers, globals: { theme: 'dark' } }

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
  render: () => <Launch queued="Waiting · 4 agents busy" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('status')).toHaveTextContent('Waiting · 4 agents busy')
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
      {...(held ? {} : { queued: 'Waiting · 4 agents busy' })}
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

const stopWaitingForHosts = fn()
const startedWithout = fn()

/**
 * It waits for other tasks (tasks wait for their blockers): each is a stop on
 * its line before its lead, "Pairing merges", turning while it runs, and how
 * it stands at the row's end. The foot says when it starts, where the clock
 * was; no clock runs. A row's menu lets go of that task, or starts it anyway.
 */
export const WaitsForOtherTasks: Story = {
  render: () => (
    <Launch
      onStart={startedWithout}
      waitsFor={[
        { id: 'pairing', name: 'Pair a device', stands: BlockerStands.Review, onOpen: fn() },
        { id: 'hosts', name: 'Hosts screen', stands: BlockerStands.Working, onOpen: fn(), onStopWaiting: stopWaitingForHosts },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Pair a device merges')).toBeInTheDocument()
    await expect(c.getByText('In review')).toBeInTheDocument()
    await expect(c.getByRole('status')).toHaveTextContent('Starts when both merge')
    await expect(c.queryByRole('button', { name: 'Start now' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'After Hosts screen: Working' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Stop waiting for Hosts screen' }))
    await expect(stopWaitingForHosts).toHaveBeenCalled()
    await expect(startedWithout).not.toHaveBeenCalled()
  },
}

/** One it waits for was abandoned: struck through, in red, and the plan waits for the person's answer. */
export const WaitsForAnAbandonedTask: Story = {
  render: () => <Launch waitsFor={[{ id: 'seal', name: 'Seal secrets', stands: BlockerStands.Abandoned, onReopen: fn() }]} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('status')).toHaveTextContent('Waits for your answer')
    await userEvent.click(c.getByRole('button', { name: 'After Seal secrets: Abandoned' }))
    await expect(await within(document.body).findByRole('menuitem', { name: 'Reopen Seal secrets' })).toBeInTheDocument()
    await expect(within(document.body).getByRole('menuitem', { name: 'Start now, without it' })).toBeInTheDocument()
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
  { id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead', defaultEffort: 'High' },
  { id: 'review', label: 'Review', agents: [CODEX], optional: true, defaultEffort: 'High' },
]

/** An effort set for a step, and one nobody set, which the step runs at by default: named all the same, a little dimmer. */
export const SetAndDefaultEffort: Story = {
  render: () => (
    <Launch
      plan={[
        { id: 'impl', label: 'Implement', agents: [OPUS], fixed: 'the lead', effort: 'Extra high', defaultEffort: 'High' },
        { id: 'review', label: 'Review', agents: [CODEX], optional: true, defaultEffort: 'Medium' },
      ]}
      defaultHeld
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // What the rows say, not the pickers lying over them, which name the effort too.
    const row = { ignore: 'button, button *' }
    await expect(c.getByText('Extra high', row)).toBeVisible()
    await expect(c.getByText('Medium', row)).toHaveTextContent('Medium by default')
  },
}
export const SetAndDefaultEffortDark: Story = { ...SetAndDefaultEffort, globals: { theme: 'dark' } }

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

/** Drafted, and its plan didn't come: it says so, still, and offers to plan or discard it. */
export const NoPlanYet: Story = {
  render: () => (
    <TaskLaunch
      task="901"
      title="Explore: what the team looks like before multiplayer"
      project={PROJECT}
      steps={[
        { id: 'implement', label: 'Implement', agents: [] },
        { id: 'review', label: 'Review', agents: [] },
      ]}
      picker={() => null}
      onStart={() => {}}
      drafting={{ phase: 'sizing', ended: 'unplanned' }}
      onPlan={fn()}
      onDiscard={fn()}
    />
  ),
}

/** Discarded while it was drafted: it says so where it was, with nothing left to do. */
export const DiscardedWhileDrafted: Story = {
  render: () => (
    <TaskLaunch
      task="900"
      title="Explore: roles and guardrails for non-engineers"
      preset="Prototype"
      project={PROJECT}
      steps={[{ id: 'implement', label: 'Implement', agents: [OPUS], effort: 'Extra high' }]}
      picker={() => null}
      onStart={() => {}}
      drafting={{ phase: 'end', ended: 'discarded' }}
    />
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
