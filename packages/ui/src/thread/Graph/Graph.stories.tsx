import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PROJECT } from '../../fixtures/meridian'
import { CODEX } from '../../fixtures/models'
import { AllowedBy, GraphAnswer, GraphNodeState } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { GraphChanged, GraphProposal, GraphStrip, type GraphNode } from './Graph'

const REPLACED: GraphNode[] = [
  { id: 'triage', label: 'Triage', state: GraphNodeState.Done },
  { id: 'implement', label: 'Implement', state: GraphNodeState.Done },
  { id: 'review', label: 'Review', state: GraphNodeState.Done },
  { id: 'security-review', label: 'Security review', state: GraphNodeState.Done },
  { id: 'verify-on-staging', label: 'Verify on staging', state: GraphNodeState.Stopped },
  { id: 'verify-on-fixtures', label: 'Verify on fixtures', state: GraphNodeState.Added },
  { id: 'open-pr', label: 'Open PR', state: GraphNodeState.Next },
]
const OPS = [
  'Stopped Verify on staging, 2 minutes in. It had only read; nothing to undo.',
  'Added Verify on fixtures: replay yesterday’s refund log against the branch locally.',
  'Open PR now waits on Verify on fixtures.',
]
const PROPOSED: GraphNode[] = [
  { id: 'open-pr', label: 'Open PR', state: GraphNodeState.Now },
  { id: 'merge', label: 'Merge', state: GraphNodeState.Next },
  { id: 'deploy-to-staging', label: 'Deploy to staging', state: GraphNodeState.Added },
  { id: 'watch-s-h', label: 'Watch 429s · 1h', state: GraphNodeState.Added },
]

const meta = {
  title: 'Thread/Graph',
  component: GraphChanged,
  decorators: [threadDecorator],
  args: {
    rev: 3,
    summary: 'Verify on staging replaced by Verify on fixtures',
    nodes: REPLACED,
    ops: OPS,
    cause: { by: AllowedBy.Lead, lead: CODEX, why: 'after your message about staging' },
    project: PROJECT,
    onUndo: fn(),
  },
} satisfies Meta<typeof GraphChanged>
export default meta
type Story = StoryObj<typeof meta>

/** Just applied: Undo runs down from ten seconds, counted from when you first see the line. */
export const Changed: Story = {}

/** Undo puts the graph back a revision. */
export const UndoingAChange: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(await c.findByRole('button', { name: /Undo/ }))
    await expect(args.onUndo).toHaveBeenCalled()
    await expect(c.getByText('Graph change undone')).toBeInTheDocument()
    await expect(c.getByText('· rev 2')).toBeInTheDocument()
  },
}

/** Past the time to undo, opened to what changed and who changed it. */
export const SettledOpen: Story = { args: { settled: true, defaultOpen: true } }

/** Added by one of the project's rules. */
export const ByRule: Story = {
  args: {
    settled: true,
    defaultOpen: true,
    rev: 2,
    summary: 'Security review added',
    cause: { by: AllowedBy.Rule, rule: 'a security review whenever authentication files change' },
  },
}

export const Strip: Story = { render: () => <GraphStrip nodes={REPLACED} /> }

const PROPOSAL = {
  by: CODEX,
  what: 'Add Deploy to staging and Watch 429s after the PR merges',
  nodes: PROPOSED,
  needs: 'Deploying to staging, which this run was not given',
  budget: 'About $3 more, within the project’s monthly limit',
}

/** A change beyond what the run was given waits for you. */
export const Proposal: Story = {
  render: () => <GraphProposal {...PROPOSAL} onAnswer={fn()} onUndo={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Keep the current graph/ }))
    /* the answered line takes focus, so it is read and nothing is lost with the button */
    await expect(document.activeElement).toHaveTextContent('Kept the current graph')
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(c.getByRole('button', { name: /Apply change/ })).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'changed, undo running', node: <GraphChanged {...args} /> },
        { state: 'settled', node: <GraphChanged {...args} settled /> },
        { state: 'settled, open', node: <GraphChanged {...args} settled defaultOpen /> },
        { state: 'by a rule, open', node: <GraphChanged {...args} {...ByRule.args} /> },
        { state: 'undo, hover', force: 'hover', node: <GraphChanged {...args} /> },
        { state: 'strip', node: <GraphStrip nodes={REPLACED} /> },
        { state: 'proposal', node: <GraphProposal {...PROPOSAL} /> },
        { state: 'proposal, applied', node: <GraphProposal {...PROPOSAL} defaultAnswer={GraphAnswer.Apply} /> },
        { state: 'proposal, kept', node: <GraphProposal {...PROPOSAL} defaultAnswer={GraphAnswer.Keep} /> },
      ]}
    />
  ),
}
