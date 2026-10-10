import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { DATABASE, FIRST_PARTNER, OVER_LIMIT, QUEUE_QUESTIONS, WAITING, WHO_HEARS } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { States, statesOn } from '../../storybook/States'
import { Question, type QuestionAnswer } from './Question'

const meta = {
  title: 'Thread/Question',
  component: Question,
  decorators: [threadDecorator],
  args: { parts: [OVER_LIMIT], onAnswer: fn() },
} satisfies Meta<typeof Question>
export default meta
type Story = StoryObj<typeof meta>

const SEVERAL = { title: QUEUE_QUESTIONS.title, parts: QUEUE_QUESTIONS.parts }
const SAID_SEVERAL: QuestionAnswer = {
  store: { optionIds: ['postgres'] },
  wait: { optionIds: [], words: 'Until the partner’s next payout run' },
  notify: { optionIds: ['partner', 'success'] },
}

/** One question, each option with a note on what it implies. */
export const Asks: Story = {}

/** Keys pick within the question; Answer folds it to what was said, and focus goes to that line. */
export const AnsweringWithKeys: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('2')
    await expect(c.getByRole('radio', { name: /Queue it/ })).toBeChecked()
    await userEvent.keyboard('1')
    await expect(c.getByRole('radio', { name: /Refuse with 429/ })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ 'over-limit': { optionIds: ['refuse'] } })
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Refuse with 429 and Retry-After'))
  },
}

/** Something else, in the person's own words: writing in it picks it, and Enter answers. */
export const InYourWords: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox', { name: /Something else/ }), 'Refuse, but log it for partner success')
    await expect(c.getByRole('radio', { name: 'Something else' })).toBeChecked()
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith({ 'over-limit': { optionIds: [], words: 'Refuse, but log it for partner success' } })
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Refuse, but log it for partner success'))
  },
}

/**
 * Three at once, as Claude Code asks them: what the agent said above them,
 * each question's short name, and one that takes several picks. Keys pick in
 * the question that has focus; one Answer sends them all.
 */
export const SeveralQuestions: Story = {
  args: SEVERAL,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('form', { name: 'Needs your answer · 3 questions' })).toBeInTheDocument()
    const store = c.getByRole('radiogroup', { name: 'Which database should the refund queue live in?' })
    const wait = c.getByRole('radiogroup', { name: /How long may a queued refund wait/ })
    const notify = c.getByRole('group', { name: /Who should hear/ })
    await expect(notify).toHaveAccessibleDescription('Pick any that apply')

    await userEvent.click(within(store).getByRole('radio', { name: /Postgres/ }))
    await userEvent.click(within(wait).getByRole('radio', { name: /15 minutes/ }))
    await userEvent.keyboard('3')
    await expect(within(wait).getByRole('radio', { name: /end of the day/ })).toBeChecked()
    await expect(within(store).getByRole('radio', { name: /Postgres/ })).toBeChecked()

    await userEvent.click(within(notify).getByRole('checkbox', { name: /The partner/ }))
    await userEvent.keyboard('2')
    await expect(within(notify).getByRole('checkbox', { name: /Partner success/ })).toBeChecked()
    await expect(within(notify).getByRole('checkbox', { name: /The partner/ })).toBeChecked()

    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({
      store: { optionIds: ['postgres'] },
      wait: { optionIds: ['day'] },
      notify: { optionIds: ['partner', 'success'] },
    })
    await expect(c.getByText('The partner and Partner success')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Postgres, beside refunds'))
  },
}

/** A question with no options: a field, named by the question. */
export const WordsOnly: Story = {
  args: { parts: [FIRST_PARTNER] },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox', { name: FIRST_PARTNER.question }), 'Acme, who asked for it{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith({ 'first-partner': { optionIds: [], words: 'Acme, who asked for it' } })
  },
}

/** Answer pressed with questions left: each says what it needs, and focus goes to the first. Answering it clears its line. */
export const MissingAnswer: Story = {
  args: SEVERAL,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Postgres/ }))
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).not.toHaveBeenCalled()
    const said = c.getAllByRole('alert').map((a) => a.textContent)
    await expect(said).toEqual(['Pick one, or write your own', 'Pick at least one, or write your own'])
    const wait = c.getByRole('radiogroup', { name: /How long may a queued refund wait/ })
    await expect(wait).toHaveAccessibleDescription('Pick one, or write your own')
    await expect(document.activeElement).toBe(within(wait).getByRole('radio', { name: /15 minutes/ }))
    await userEvent.keyboard('2')
    await expect(c.getAllByRole('alert')).toHaveLength(1)
  },
}

/** Sent, waiting for the agent to take it: Answer is busy, and the picks can't be changed. */
export const Answering: Story = {
  args: { answer: null, answering: true, defaultPick: { 'over-limit': { optionIds: ['refuse'] } } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const answer = c.getByRole('button', { name: /Answer/ })
    await expect(answer).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByRole('radio', { name: /Queue it/ })).toBeDisabled()
    await userEvent.click(answer)
    await expect(args.onAnswer).not.toHaveBeenCalled()
  },
}

/** The answer didn't go through: said beside Answer, the picks kept, and it can be sent again. */
export const AnswerFailed: Story = {
  args: {
    answer: null,
    error: 'The answer didn’t reach the lead. Try again.',
    defaultPick: { 'over-limit': { optionIds: ['refuse'] } },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('alert')).toHaveTextContent('The answer didn’t reach the lead')
    await expect(c.getByRole('radio', { name: /Refuse with 429/ })).toBeChecked()
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ 'over-limit': { optionIds: ['refuse'] } })
  },
}

/** Held by the consumer: busy while it sends, then answered, and focus goes to the line once it is. */
export const SentThenAnswered: Story = {
  render: function SentThenAnswered(args) {
    const [sent, setSent] = useState<QuestionAnswer | null>(null)
    const [answer, setAnswer] = useState<QuestionAnswer | null>(null)
    useEffect(() => {
      if (!sent) return
      const later = window.setTimeout(() => setAnswer(sent), 400)
      return () => window.clearTimeout(later)
    }, [sent])
    return (
      <Question
        {...args}
        answer={answer}
        answering={sent !== null && answer === null}
        onAnswer={(a) => {
          args.onAnswer?.(a)
          setSent(a)
        }}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Queue it/ }))
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(c.getByRole('button', { name: /Answer/ })).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByRole('button', { name: /Answer/ })).toHaveFocus()
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Queue it and return 202'))
  },
}

/** Answered, from earlier in the thread: what was said, then the question, quieter. */
export const Answered: Story = { args: { defaultAnswer: { 'over-limit': { optionIds: ['refuse'] } } } }

/** Several answered: a line for each, several picks said as one phrase, words as they were written. */
export const AnsweredSeveral: Story = { args: { ...SEVERAL, defaultAnswer: SAID_SEVERAL } }

/** Withdrawn: the agent stopped asking. Not answered, quietly, and why. */
export const Withdrawn: Story = {
  args: { withdrawn: 'the lead stopped asking' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('form')).toBeNull()
    await expect(c.getByText('Not answered')).toBeInTheDocument()
    await expect(c.getByText('· the lead stopped asking')).toBeInTheDocument()
  },
}

/** Several withdrawn, when the task was stopped: a line for each, the reason once. */
export const WithdrawnSeveral: Story = { args: { ...SEVERAL, withdrawn: 'the task was stopped' } }

/** Answered, then taken back: the question asks again, with what was picked. */
export const Undoing: Story = {
  args: { onUndo: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('2')
    await userEvent.click(c.getByRole('button', { name: /Answer/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ 'over-limit': { optionIds: ['queue'] } })
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndo).toHaveBeenCalledWith({ 'over-limit': { optionIds: ['queue'] } })
    await expect(c.getByRole('radio', { name: /Queue it/ })).toBeChecked()
  },
}

const LONG_WORDS: QuestionAnswer = {
  'over-limit': {
    optionIds: [],
    words: 'Refuse with 429 as charges do, but log each refusal with the partner id so partner success can see who hits the limit',
  },
}

export const AllStates: Story = {
  parameters: statesOn({
    hover: '[role=radiogroup] label:nth-of-type(2)',
    focus: '[role=radiogroup] input:checked',
    pressed: 'button[type="submit"]',
  }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'nothing picked', node: <Question {...args} /> },
        { state: 'an option', node: <Question {...args} defaultPick={{ 'over-limit': { optionIds: ['refuse'] } }} /> },
        {
          state: 'something else',
          node: <Question {...args} defaultPick={{ 'over-limit': { optionIds: [], words: 'Refuse, but log it' } }} />,
        },
        { state: 'option, hover', force: 'hover', node: <Question {...args} /> },
        { state: 'option, focus', force: 'focus', node: <Question {...args} defaultPick={{ 'over-limit': { optionIds: ['queue'] } }} /> },
        {
          state: 'answer, pressed',
          force: 'pressed',
          node: <Question {...args} defaultPick={{ 'over-limit': { optionIds: ['refuse'] } }} />,
        },
        {
          state: 'several questions',
          node: (
            <Question
              {...args}
              {...SEVERAL}
              defaultPick={{ store: { optionIds: ['postgres'] }, notify: { optionIds: ['partner', 'oncall'] } }}
            />
          ),
        },
        { state: 'several, nothing said above', node: <Question {...args} parts={[DATABASE, WAITING]} /> },
        { state: 'words only', node: <Question {...args} parts={[FIRST_PARTNER]} /> },
        {
          state: 'several picks, no words',
          node: <Question {...args} parts={[{ ...WHO_HEARS, words: false }]} defaultPick={{ notify: { optionIds: ['success'] } }} />,
        },
        { state: 'answering', node: <Question {...args} {...Answering.args} /> },
        { state: 'answer failed', node: <Question {...args} {...AnswerFailed.args} /> },
        { state: 'answered', node: <Question {...args} {...Answered.args} onUndo={() => {}} /> },
        { state: 'answered, several', node: <Question {...args} {...AnsweredSeveral.args} /> },
        { state: 'answered, long words', node: <Question {...args} defaultAnswer={LONG_WORDS} /> },
        { state: 'withdrawn', node: <Question {...args} {...Withdrawn.args} /> },
        { state: 'withdrawn, several', node: <Question {...args} {...WithdrawnSeveral.args} /> },
      ]}
    />
  ),
}
