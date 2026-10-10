import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DECISION, PUBLISH, QUESTION, READY, STATUS, STUCK } from '../../fixtures/home'
import { Button } from '../../primitives/Button/Button'
import { States } from '../../storybook/States'
import { NeedLine, NeedList } from './NeedLine'

const meta = {
  title: 'Home/NeedLine',
  component: NeedLine,
  parameters: { layout: 'padded' },
  args: {
    kind: PUBLISH.kind,
    project: PUBLISH.project,
    task: PUBLISH.task,
    title: PUBLISH.title,
    command: PUBLISH.command,
    onOpen: fn(),
  },
  render: (args) => (
    <NeedList style={{ maxWidth: 760 }}>
      <NeedLine
        {...args}
        actions={
          <>
            <Button size="small">Deny</Button>
            <Button size="small" variant="signal">
              Allow once
            </Button>
          </>
        }
      />
    </NeedList>
  ),
} satisfies Meta<typeof NeedLine>
export default meta
type Story = StoryObj<typeof meta>

/** A permission: the command asked for, answered where it is. */
export const Permission: Story = {}

const lines = (
  <>
    <NeedLine
      kind={PUBLISH.kind}
      project={PUBLISH.project}
      title={PUBLISH.title}
      command={PUBLISH.command}
      onOpen={fn()}
      actions={
        <>
          <Button size="small">Deny</Button>
          <Button size="small" variant="signal">
            Allow once
          </Button>
        </>
      }
    />
    <NeedLine
      kind={READY.kind}
      project={READY.project}
      title={READY.title}
      brief={`${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`}
      onOpen={fn()}
      actions={<Button size="small">Review</Button>}
    />
    <NeedLine
      kind={DECISION.kind}
      project={DECISION.project}
      title={DECISION.title}
      brief={DECISION.options.map((o) => o.label).join('  or  ')}
      onOpen={fn()}
      actions={<Button size="small">Decide</Button>}
    />
    <NeedLine
      kind={QUESTION.kind}
      project={QUESTION.project}
      title={QUESTION.title}
      onOpen={fn()}
      actions={
        <Button size="small" variant="signal">
          Answer
        </Button>
      }
    />
    <NeedLine
      kind={STUCK.kind}
      project={STUCK.project}
      title={STUCK.title}
      brief={STUCK.because}
      onOpen={fn()}
      actions={
        <>
          <Button size="small">Stop the spike</Button>
          <Button size="small" variant="signal">
            Try it on Codex
          </Button>
        </>
      }
    />
    <NeedLine
      kind="Allowed"
      project={STATUS.project}
      title={STATUS.title}
      command={STATUS.command}
      onOpen={fn()}
      answer={{ said: 'Always', note: `kept in ${STATUS.project.name}’s rules` }}
    />
  </>
)

/** Every kind on one sheet, and one just answered, settled where it was. */
export const EveryKind: Story = { render: () => <NeedList style={{ maxWidth: 820 }}>{lines}</NeedList> }

/** Narrow, whose it is goes under the title. */
export const Narrow: Story = { render: () => <NeedList style={{ maxWidth: 480 }}>{lines}</NeedList> }

/* ---- an agent's question: what it asks, and Answer opens the task to answer it there ---- */

const question = (props: Partial<Parameters<typeof NeedLine>[0]> = {}) => (
  <NeedLine
    kind={QUESTION.kind}
    project={QUESTION.project}
    task={QUESTION.task}
    title={QUESTION.title}
    onOpen={fn()}
    actions={
      <Button size="small" variant="signal">
        Answer
      </Button>
    }
    {...props}
  />
)

/** A question an agent asks, kept calm: what it asks, and Answer, which takes the person to it. Its options are where it is answered. */
export const Question: Story = {
  render: () => <NeedList style={{ maxWidth: 760 }}>{question()}</NeedList>,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: QUESTION.title })).toBeInTheDocument()
    await expect(c.queryByText(QUESTION.options[0]?.label ?? '')).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Answer' })).toBeInTheDocument()
  },
}

/** Several questions at once: the first, and how many more wait with it. */
export const QuestionsSeveral: Story = {
  render: () => <NeedList style={{ maxWidth: 760 }}>{question({ brief: 'and 2 more questions' })}</NeedList>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('and 2 more questions')).toBeInTheDocument()
  },
}

/** Answered: its kind grey, and what was said where Answer was. */
export const QuestionAnswered: Story = {
  render: () => (
    <NeedList style={{ maxWidth: 760 }}>{question({ kind: 'Answered', answer: { said: 'Postgres, beside refunds' } })}</NeedList>
  ),
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByRole('article')
    await expect(line).toHaveAccessibleDescription('Answered Postgres, beside refunds')
  },
}

/** At the edge's width, asking and answered: the title the whole width, Answer beside it. */
export const QuestionAtTheEdge: Story = {
  render: () => (
    <NeedList style={{ width: 360 }} bare>
      {question()}
      {question({ kind: 'Answered', answer: { said: 'Postgres, beside refunds' } })}
    </NeedList>
  ),
}

/* ---- answered where it is: the line stays, at its height, quiet ---- */

const settled = (answer: NonNullable<Parameters<typeof NeedLine>[0]['answer']>, kind = 'Allowed', command = PUBLISH.command) => (
  <NeedLine kind={kind} project={PUBLISH.project} title={PUBLISH.title} command={command} onOpen={fn()} answer={answer} />
)

/** Allowed once: its kind grey, what was said where its answers were. */
export const AllowedOnce: Story = {
  render: () => <NeedList style={{ maxWidth: 760 }}>{settled({ said: 'Once', note: 'in Halyard' })}</NeedList>,
}

/** Allowed always: kept in the project's rules. */
export const AllowedAlways: Story = {
  render: () => <NeedList style={{ maxWidth: 760 }}>{settled({ said: 'Always', note: 'kept in Halyard’s rules' })}</NeedList>,
}

/** Denied, with what to do instead: a cross, and the note. */
export const Denied: Story = {
  render: () => (
    <NeedList style={{ maxWidth: 760 }}>{settled({ said: 'Once', note: 'Publish from CI instead', denied: true }, 'Denied')}</NeedList>
  ),
}

/** Never allowed: kept in the project's rules. */
export const Never: Story = {
  render: () => (
    <NeedList style={{ maxWidth: 760 }}>{settled({ said: 'Never', note: 'kept in Halyard’s rules', denied: true }, 'Denied')}</NeedList>
  ),
}

/** A long command: the line clips it, as before, and what was said keeps its place. */
export const LongCommand: Story = {
  render: () => (
    <NeedList style={{ maxWidth: 760 }}>
      {settled(
        { said: 'Always', note: 'kept in Halyard’s rules' },
        'Allowed',
        'pnpm --filter @halyard/gateway exec vitest run src/routes/refunds/limits.test.ts --reporter=verbose --coverage',
      )}
    </NeedList>
  ),
}

/** Narrow, and as narrow as the edge's sheet: what was said stays where the answers were. */
export const AnsweredNarrowAndEdge: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <NeedList style={{ width: 480 }}>{settled({ said: 'Always', note: 'kept in Halyard’s rules' })}</NeedList>
      <NeedList style={{ width: 360 }} bare>
        {settled({ said: 'Once', note: 'in Halyard' })}
      </NeedList>
    </div>
  ),
}

/** Answering keeps the line's height; focus moves to it, and it says what was said. */
export const Answering: Story = {
  render: function Answering() {
    const [answered, setAnswered] = useState(false)
    return (
      <NeedList style={{ maxWidth: 760 }}>
        <NeedLine
          kind={answered ? 'Allowed' : PUBLISH.kind}
          project={PUBLISH.project}
          title={PUBLISH.title}
          command={PUBLISH.command}
          onOpen={fn()}
          focusOnMount={answered}
          {...(answered
            ? { answer: { said: 'Once', note: 'in Halyard' } }
            : {
                actions: (
                  <Button size="small" variant="signal" onClick={() => setAnswered(true)}>
                    Allow once
                  </Button>
                ),
              })}
        />
      </NeedList>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const line = c.getByRole('article')
    const before = line.getBoundingClientRect().height
    await userEvent.click(c.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(line).toHaveFocus())
    await expect(line).toHaveAccessibleDescription('Allowed Once · in Halyard')
    await expect(line.getBoundingClientRect().height).toBe(before)
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'every kind', node: <NeedList style={{ width: 820 }}>{lines}</NeedList> },
        { state: 'narrow', node: <NeedList style={{ width: 480 }}>{lines}</NeedList> },
        {
          state: 'allowed always',
          node: <NeedList style={{ width: 760 }}>{settled({ said: 'Always', note: 'kept in Halyard’s rules' })}</NeedList>,
        },
        {
          state: 'denied, with a note',
          node: (
            <NeedList style={{ width: 760 }}>{settled({ said: 'Once', note: 'Publish from CI instead', denied: true }, 'Denied')}</NeedList>
          ),
        },
        { state: 'question', node: <NeedList style={{ width: 760 }}>{question()}</NeedList> },
        { state: 'questions, several', node: <NeedList style={{ width: 760 }}>{question({ brief: 'and 2 more questions' })}</NeedList> },
        {
          state: 'question, answered',
          node: <NeedList style={{ width: 760 }}>{question({ kind: 'Answered', answer: { said: 'Postgres, beside refunds' } })}</NeedList>,
        },
        {
          state: 'question, edge width',
          node: (
            <NeedList style={{ width: 360 }} bare>
              {question()}
              {question({ kind: 'Answered', answer: { said: 'Postgres, beside refunds' } })}
            </NeedList>
          ),
        },
        {
          state: 'never, edge width',
          node: (
            <NeedList style={{ width: 360 }} bare>
              {settled({ said: 'Never', note: 'kept in Halyard’s rules', denied: true }, 'Denied')}
            </NeedList>
          ),
        },
      ]}
    />
  ),
}
