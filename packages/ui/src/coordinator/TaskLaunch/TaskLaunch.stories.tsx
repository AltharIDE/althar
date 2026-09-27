import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FROM_231, PLAN_432, PLAN_433 } from '../../fixtures/coordinator'
import { PROJECT } from '../../fixtures/meridian'
import { effortFor, model, useModelPrefs } from '../../fixtures/models'
import { ModelPick } from '../../composer/ModelPick/ModelPick'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { TaskLaunch, type LaunchPick, type LaunchStep } from './TaskLaunch'

/** The consumer's picker for one agent of a step: the composer's own, bordered. */
function usePicker(steps: readonly LaunchStep[], setSteps: (s: readonly LaunchStep[]) => void) {
  const prefs = useModelPrefs()
  const [efforts, setEfforts] = useState<Record<string, string>>({})
  return ({ step, agent, k, owner }: LaunchPick) => {
    const key = `${step.id}:${k}`
    return (
      <ModelPick
        variant="field"
        placement="below"
        owner={owner}
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
            ? () =>
                setSteps(
                  steps.map((st) => (st.id === step.id ? { ...st, agents: st.agents.filter((_, i) => i !== k), why: undefined } : st)),
                )
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
    await expect(c.getByText('Held. Starts when you say')).toBeInTheDocument()
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

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'counting down', node: <Launch /> },
        { state: 'an agent is out', node: <Launch plan={PLAN_433} limited={{ name: 'Claude Code', until: '14:00' }} /> },
        { state: 'a step skipped', node: <Launch plan={PLAN_432.map((st) => (st.id === 'dry' ? { ...st, skipped: true } : st))} /> },
      ]}
    />
  ),
}
