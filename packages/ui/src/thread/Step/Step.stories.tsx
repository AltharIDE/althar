import type { Meta, StoryObj } from '@storybook/react-vite'

import { STEPS } from '../../fixtures/meridian'
import { CODEX, OPUS, SONNET } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Prose } from '../Turn/Turn'
import { Step, StepPosition } from './Step'
import { StepState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'

const RULE = 'Added by your rule: security review on changes that touch money handling.'

const meta = {
  title: 'Thread/Step',
  component: Step,
  decorators: [threadDecorator],
  args: { n: 2, of: 6, label: 'Implement', model: OPUS, state: StepState.Running },
} satisfies Meta<typeof Step>
export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}
export const Started: Story = { args: { state: StepState.Started } }
export const Done: Story = {
  args: {
    n: 4,
    label: 'Security review',
    model: SONNET,
    state: StepState.Done,
    outcome: 'No findings',
    took: '4m',
    thread: STEPS.security,
    why: RULE,
    detail: <Prose>Checked the limiter order, what reaches the logs, and the webhook retry path you asked about. Nothing to report.</Prose>,
  },
}
export const DoneOpen: Story = { args: { ...Done.args, defaultOpen: true } }
export const Stopped: Story = {
  args: {
    n: 5,
    label: 'Verify on staging',
    model: CODEX,
    state: StepState.Stopped,
    outcome: 'stopped by the lead after your message',
    took: '2m in',
  },
}
export const Tracks: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 10 }}>
      <StepPosition n={1} of={6} state={StepState.Started} />
      <StepPosition n={3} of={6} state={StepState.Running} />
      <StepPosition n={4} of={6} state={StepState.Done} />
      <StepPosition n={5} of={6} state={StepState.Stopped} />
    </div>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button[aria-expanded]', focus: 'button[aria-expanded]', pressed: 'button[aria-expanded]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'started', node: <Step {...args} state={StepState.Started} /> },
        { state: 'running', node: <Step {...args} /> },
        { state: 'done', node: <Step {...args} {...Done.args} /> },
        { state: 'done, open', node: <Step {...args} {...Done.args} defaultOpen /> },
        { state: 'stopped', node: <Step {...args} {...Stopped.args} /> },
        { state: 'no model', node: <Step {...args} model={undefined} /> },
        { state: 'summary, hover', force: 'hover', node: <Step {...args} {...Done.args} /> },
        { state: 'summary, focus', force: 'focus', node: <Step {...args} {...Done.args} /> },
      ]}
    />
  ),
}
