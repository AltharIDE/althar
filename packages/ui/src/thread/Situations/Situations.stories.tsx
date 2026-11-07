import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { PROJECT, STAGING } from '../../fixtures/meridian'
import { OPUS } from '../../fixtures/models'
import { ToolKind, ToolState } from '../../foundations/vocabulary'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { AltharLine } from '../AltharLine/AltharLine'
import { Permission } from '../Permission/Permission'
import { Tool } from '../Tool/Tool'

/*
 * What Althar says in a task's thread of the work around it (ADR-097,
 * "Situations"), each where it happens: a command the person's own Never
 * rule refused, a task the lead started that ended without reaching it,
 * another task changing the same files, a server that was down under the
 * call that went to it, and a call that waits while the person is away.
 */

const meta = {
  title: 'Thread/Situations',
  decorators: [threadDecorator],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const open = () => undefined

/** A command the person's Never rule refused: the call, declined, and Althar's line naming the rule. The lead was told the same. */
function NeverMet() {
  return (
    <>
      <Tool kind={ToolKind.Run} verb="Run" target="rm -rf ~/Library/Application\ Support/Althar" state={ToolState.Declined} />
      <AltharLine>
        Refused by your rule <code>rm -rf ~/Library</code>. The lead was told so. <LinkButton onClick={open}>Rules</LinkButton>
      </AltharLine>
    </>
  )
}

/** A task the lead started that stopped without a change: Althar's line in the parent's thread, in its warning tone. */
function ChildStopped({ how = 'unchanged' }: { how?: 'unchanged' | 'failed' | 'stopped' }) {
  return (
    <AltharLine tone="warning">
      <LinkButton onClick={open}>Codex leads reach the network in their shell</LinkButton>{' '}
      {how === 'stopped'
        ? 'stopped by you.'
        : how === 'failed'
          ? 'failed: Codex’s sandbox on Windows has no network switch.'
          : 'stopped without a change: Codex’s sandbox on Windows has no network switch.'}{' '}
      <LinkButton onClick={open}>Its report</LinkButton>
    </AltharLine>
  )
}

/** Another open task changes the same files: Althar's line in both threads, the other task linked. */
function SameFiles() {
  return (
    <AltharLine>
      <LinkButton onClick={open}>Runs show in the pill over the composer again</LinkButton> changes <code>TaskView.tsx</code> too. Both
      leads were told.
    </AltharLine>
  )
}

/** A call to one of the person's servers, failed because it wasn't signed in; the lead goes on and doesn't repeat it. */
function ServerFails({ done = false }: { done?: boolean }) {
  return (
    <>
      <Tool
        kind={ToolKind.Comment}
        verb="Move"
        target="DEV-188 to In Review"
        state={done ? ToolState.Done : ToolState.Failed}
        meta="Linear"
      />
      {!done && (
        <AltharLine tone="warning">
          Claude Code isn’t signed in to Linear, so this didn’t go through. <LinkButton onClick={open}>Sign in</LinkButton>
        </AltharLine>
      )}
    </>
  )
}

/** A command the person's Never rule refused. */
export const NeverRuleMet: Story = {
  render: () => <NeverMet />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Refused by your rule/)).toBeVisible()
  },
}

/** A lead-started task that stopped without a change. */
export const ChildStoppedWithoutAChange: Story = { render: () => <ChildStopped /> }

/** One the person stopped. */
export const ChildStoppedByYou: Story = { render: () => <ChildStopped how="stopped" /> }

/** One that failed. */
export const ChildFailed: Story = { render: () => <ChildStopped how="failed" /> }

/** Two tasks changing the same files. */
export const TwoTasksSameFiles: Story = { render: () => <SameFiles /> }

/** A server that fails mid-task. */
export const ServerFailsMidTask: Story = { render: () => <ServerFails /> }

/** An ask that waits while the person is away: how long, and where else it reached them. */
export const AskWaits: Story = {
  render: () => (
    <Permission
      {...STAGING}
      project={PROJECT}
      agent={OPUS}
      step="Implement"
      waited="Waiting 40 min · sent to your iPhone at 13:20"
      onAnswer={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Waiting 40 min/)).toBeVisible()
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'never rule met', node: <NeverMet /> },
        { state: 'child stopped without a change', node: <ChildStopped /> },
        { state: 'child stopped by you', node: <ChildStopped how="stopped" /> },
        { state: 'child failed', node: <ChildStopped how="failed" /> },
        { state: 'same files', node: <SameFiles /> },
        { state: 'server fails', node: <ServerFails /> },
        { state: 'server fails, dark', node: <ServerFails />, dark: true },
        { state: 'never rule met, dark', node: <NeverMet />, dark: true },
      ]}
    />
  ),
}
