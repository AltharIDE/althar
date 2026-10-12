import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { LIMIT_OPTIONS } from '../../fixtures/meridian'
import { CODEX, GEMINI_PRO, OPUS, SONNET } from '../../fixtures/models'
import { LimitAnswer } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { ThreadFrame } from '../../storybook/ThreadFrame'
import { RateLimit } from './RateLimit'

const meta = {
  title: 'Thread/RateLimit',
  component: RateLimit,
  args: {
    runtime: 'Claude Code',
    resets: '14:00',
    step: 'Implement',
    options: LIMIT_OPTIONS,
    onSwap: fn(),
    onWait: fn(),
  },
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <ThreadFrame>{Story()}</ThreadFrame>)],
} satisfies Meta<typeof RateLimit>
export default meta
type Story = StoryObj<typeof meta>

const none = LIMIT_OPTIONS.map((o) => ({ ...o, busy: true }))

/** The project says to ask: the models free now, the first offered, or waiting for the reset. */
export const Default: Story = {}
/** The limit paused more than the step: the lead, and a review on the same account. */
export const PausedSeveral: Story = {
  args: {
    step: undefined,
    affects: [
      { id: 'lead', label: 'the lead', model: OPUS },
      { id: 'sec', label: 'Security review', model: SONNET },
    ],
  },
}
/** The agent didn't say when it resets: the models free now, or trying it again. */
export const ResetUnknown: Story = { args: { resets: null, onWait: undefined, onAgain: fn() } }
/** Every other model is out too: it can only wait. */
export const NoneFree: Story = { args: { options: none } }
/** Nothing else is free and the reset isn't known: only trying again. */
export const OnlyAgain: Story = { args: { options: none, resets: null, onWait: undefined, onAgain: fn() } }
/** Two accounts of one agent offer the same model: each is its own choice. */
export const TwoAccounts: Story = {
  args: {
    options: [
      { id: 'codex:work', model: CODEX, note: 'via Codex · work' },
      { id: 'codex:personal', model: CODEX, note: 'via Codex · personal' },
      { id: 'gemini', model: GEMINI_PRO, note: 'via Gemini CLI · paid per use' },
    ],
  },
}

export const Moving: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Choose another model/ }))
    await userEvent.click(await within(document.body).findByRole('menuitemradio', { name: /Gemini 3 Pro/ }))
    await userEvent.click(c.getByRole('button', { name: /Continue with Gemini 3 Pro/ }))
    await expect(args.onSwap).toHaveBeenCalledWith(GEMINI_PRO.id)
    await expect(document.activeElement).toHaveTextContent('Moved to Gemini 3 Pro')
  },
}

export const Waiting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Wait until 14:00' }))
    await expect(args.onWait).toHaveBeenCalledOnce()
    await expect(document.activeElement).toHaveTextContent('Waiting until 14:00')
  },
}

export const TryingAgain: Story = {
  args: { resets: null, onWait: undefined, onAgain: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/didn’t say when it resets/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Try Claude Code again' }))
    await expect(args.onAgain).toHaveBeenCalledOnce()
    await expect(document.activeElement).toHaveTextContent('Trying Claude Code again')
  },
}

/** Answered, from history: one line each way. */
export const Answered: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 10 }}>
      <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Moved, model: CODEX }} />
      <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Waiting }} />
      <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Again }} />
    </div>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'ask', node: <RateLimit {...args} /> },
        { state: 'several paused', node: <RateLimit {...args} {...PausedSeveral.args} /> },
        { state: 'reset unknown', node: <RateLimit {...args} {...ResetUnknown.args} /> },
        { state: 'none free', node: <RateLimit {...args} options={none} /> },
        { state: 'only again', node: <RateLimit {...args} {...OnlyAgain.args} /> },
        { state: 'moved', node: <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Moved, model: CODEX }} /> },
        { state: 'waiting', node: <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Waiting }} /> },
        { state: 'trying again', node: <RateLimit {...args} defaultResult={{ kind: LimitAnswer.Again }} /> },
        { state: 'hover', node: <RateLimit {...args} /> },
        { state: 'focus', node: <RateLimit {...args} /> },
        { state: 'pressed', node: <RateLimit {...args} /> },
      ]}
    />
  ),
}
