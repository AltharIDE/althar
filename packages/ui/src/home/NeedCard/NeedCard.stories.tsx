import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DECISION, PUBLISH, READY, SIGNED_OUT, STUCK } from '../../fixtures/home'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { States, statesOn } from '../../storybook/States'
import { NeedCard, NeedChange, NeedCommand, NeedOptions } from './NeedCard'
import s from './NeedCard.stories.module.css'

const meta = {
  title: 'Home/NeedCard',
  component: NeedCard,
  decorators: [(Story) => <div className={s.width}>{Story()}</div>],
  args: {
    kind: PUBLISH.kind,
    project: PUBLISH.project,
    task: PUBLISH.task,
    title: PUBLISH.title,
    at: PUBLISH.at,
    onOpen: fn(),
  },
} satisfies Meta<typeof NeedCard>
export default meta
type Story = StoryObj<typeof meta>

const permission = (
  <>
    <Button size="small">Deny</Button>
    <Button size="small" variant="signal">
      Allow once
    </Button>
  </>
)

/** An agent asks to run something on the project's always-ask list: allowed or denied where it is. */
export const Permission: Story = {
  args: { detail: <NeedCommand command={PUBLISH.command} agent={PUBLISH.agent} step={PUBLISH.step} />, actions: permission },
}

/** A change ready to accept: its pull request, size, checks and who led and reviewed it. Accepting means reading it first, so Review opens the dock. */
export const ReadyToAccept: Story = {
  args: {
    kind: READY.kind,
    project: READY.project,
    task: READY.task,
    title: READY.title,
    at: READY.at,
    detail: <NeedChange {...READY.change} />,
    actions: <Button size="small">Review</Button>,
  },
}

const change = (checks: { passed: number; failed: number; running: number }) => ({
  ...ReadyToAccept.args,
  detail: <NeedChange {...READY.change} checks={checks} />,
})

/** A check failed: said first, in violet, since only a person can take a change that fails. */
export const ChecksFailing: Story = { args: change({ passed: 2, failed: 1, running: 0 }) }

/** Some checks still run. */
export const ChecksRunning: Story = { args: change({ passed: 1, failed: 0, running: 2 }) }

/** No checks ran on it. */
export const NoChecks: Story = { args: change({ passed: 0, failed: 0, running: 0 }) }

/** A decision, with its choices on the card so you see what you're asked before you open it. */
export const Decision: Story = {
  args: {
    kind: DECISION.kind,
    project: DECISION.project,
    task: DECISION.task,
    title: DECISION.title,
    at: DECISION.at,
    detail: <NeedOptions options={DECISION.options} />,
    actions: <Button size="small">Decide</Button>,
  },
}

/** An agent work waits for is signed out: only a person can sign it in. */
export const SignIn: Story = {
  args: {
    kind: SIGNED_OUT.kind,
    project: SIGNED_OUT.project,
    task: SIGNED_OUT.task,
    title: SIGNED_OUT.title,
    at: SIGNED_OUT.at,
    detail: SIGNED_OUT.because,
    actions: (
      <Button size="small" variant="signal" icon="terminal">
        Sign in to Codex
      </Button>
    ),
  },
}

/** A step that went quiet twice, after Althar started it afresh once. */
export const Stuck: Story = {
  args: {
    kind: STUCK.kind,
    project: STUCK.project,
    task: STUCK.task,
    title: STUCK.title,
    at: STUCK.at,
    detail: STUCK.because,
    actions: (
      <>
        <Button size="small">Stop the spike</Button>
        <Button size="small" variant="signal">
          Try it on Codex
        </Button>
      </>
    ),
  },
}

/** Open in the dock beside the home: ringed in ink. */
export const Current: Story = { args: { ...Permission.args, current: true } }

/** Nowhere to open it: the title is words. */
export const WithoutOpening: Story = { args: { ...Permission.args, onOpen: undefined } }

/** Where tasks have no numbers, the title alone names the task. */
export const WithoutANumber: Story = { args: { ...ReadyToAccept.args, task: undefined } }

function Answerable() {
  const [answer, setAnswer] = useState<string | null>(null)
  if (answer)
    return (
      <AskAnswered said={answer} onUndo={() => setAnswer(null)} focusOnMount>
        <AskNote>went back to {PUBLISH.step}</AskNote>
      </AskAnswered>
    )
  return (
    <NeedCard
      kind={PUBLISH.kind}
      project={PUBLISH.project}
      task={PUBLISH.task}
      title={PUBLISH.title}
      at={PUBLISH.at}
      detail={<NeedCommand command={PUBLISH.command} agent={PUBLISH.agent} step={PUBLISH.step} />}
      actions={
        <>
          <Button size="small" onClick={() => setAnswer('Denied')}>
            Deny
          </Button>
          <Button size="small" variant="signal" onClick={() => setAnswer('Allowed npm publish')}>
            Allow once
          </Button>
        </>
      }
    />
  )
}

/** Answered where it is: the card folds to the line that says what you said, with Undo, and focus moves to it. */
export const Answering: Story = {
  render: () => <Answerable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    await expect(canvas.getByText('Allowed npm publish')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }))
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: '> article', focus: 'h3 button', pressed: 'h3 button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'permission', node: <NeedCard {...args} {...Permission.args} /> },
        { state: 'ready to accept', node: <NeedCard {...args} {...ReadyToAccept.args} /> },
        { state: 'checks failing', node: <NeedCard {...args} {...ChecksFailing.args} /> },
        { state: 'checks running', node: <NeedCard {...args} {...ChecksRunning.args} /> },
        { state: 'no checks', node: <NeedCard {...args} {...NoChecks.args} /> },
        { state: 'decision', node: <NeedCard {...args} {...Decision.args} /> },
        { state: 'sign-in', node: <NeedCard {...args} {...SignIn.args} /> },
        { state: 'stuck', node: <NeedCard {...args} {...Stuck.args} /> },
        { state: 'current', node: <NeedCard {...args} {...Permission.args} current /> },
        { state: 'hover', node: <NeedCard {...args} {...Permission.args} /> },
        { state: 'focus', node: <NeedCard {...args} {...Permission.args} /> },
        {
          state: 'answered',
          node: (
            <AskAnswered said="Allowed npm publish" onUndo={fn()}>
              <AskNote>went back to Release</AskNote>
            </AskAnswered>
          ),
        },
      ]}
    />
  ),
}
