import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Severity } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { ArtifactCard } from './ArtifactCard'

const meta = {
  title: 'Outputs/ArtifactCard',
  component: ArtifactCard,
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
  args: {
    kind: 'Review',
    title: 'Token refresh: review findings',
    meta: 'Task 418 · Sonnet 5 and Gemini 3 Pro',
    findings: { [Severity.High]: 1, [Severity.Medium]: 2 },
    onOpen: fn(),
  },
} satisfies Meta<typeof ArtifactCard>
export default meta
type Story = StoryObj<typeof meta>

/** A review, with its findings counted, heaviest first. */
export const WithFindings: Story = {}
/** A plan: no findings to count. */
export const Plan: Story = {
  args: { kind: 'Plan', title: 'Billing webhook v2 migration plan', meta: 'Task 419 · in use', findings: undefined },
}
export const NotOpenable: Story = { args: { onOpen: undefined } }

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open Token refresh: review findings' }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'article', focus: 'article button', pressed: 'article button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'findings', node: <ArtifactCard {...args} /> },
        {
          state: 'every severity',
          node: <ArtifactCard {...args} findings={{ [Severity.High]: 2, [Severity.Medium]: 4, [Severity.Low]: 3 }} />,
        },
        { state: 'plan', node: <ArtifactCard {...args} {...Plan.args} /> },
        { state: 'not openable', node: <ArtifactCard {...args} onOpen={undefined} /> },
        { state: 'hover', node: <ArtifactCard {...args} /> },
        { state: 'focus', node: <ArtifactCard {...args} /> },
      ]}
    />
  ),
}
