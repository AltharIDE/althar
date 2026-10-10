import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { DECISION, PUBLISH, READY, STUCK } from '../../fixtures/home'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
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
    <AskAnswered said="Allowed npm publish" denied={false} onUndo={fn()}>
      <AskNote>in Halyard</AskNote>
    </AskAnswered>
  </>
)

/** Every kind on one sheet, and one just answered, folded in place. */
export const EveryKind: Story = { render: () => <NeedList style={{ maxWidth: 820 }}>{lines}</NeedList> }

/** Narrow, whose it is goes under the title. */
export const Narrow: Story = { render: () => <NeedList style={{ maxWidth: 480 }}>{lines}</NeedList> }

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'every kind', node: <NeedList style={{ width: 820 }}>{lines}</NeedList> },
        { state: 'narrow', node: <NeedList style={{ width: 480 }}>{lines}</NeedList> },
      ]}
    />
  ),
}
